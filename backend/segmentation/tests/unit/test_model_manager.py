"""
Unit tests for ModelManager (services/model_loader.py).

Key behaviours tested:
- Singleton pattern
- Device selection (CPU when CUDA is unavailable)
- model_configs structure (hrnet and cbam_resunet keys)
- is_model_available() (False when weights file is absent)
- get_model_info() dict structure
- load_model() caching (second call returns same object)
- unload_model() removes the model from loaded_models
- cleanup() clears all loaded models
- get_memory_usage() returns required keys

The singleton is reset between every test via the autouse fixture so that
test order does not matter.
"""
import sys
import os
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import torch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from services.model_loader import ModelManager


# ---------------------------------------------------------------------------
# Singleton reset fixture (autouse so every test starts clean)
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_model_manager():
    """Reset singleton state before and after every test."""
    _reset()
    yield
    _reset()


def _reset():
    """Tear down the ModelManager singleton fully."""
    instance = ModelManager._instance
    if instance is not None:
        # Clear loaded models to release any memory held
        instance.loaded_models.clear()
        # Mark as uninitialized so __init__ re-runs on the next ModelManager()
        if hasattr(instance, "_initialized"):
            del instance._initialized
        ModelManager._instance = None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestSingletonPattern:

    def test_singleton_same_instance(self):
        """Two successive ModelManager() calls must return the same object."""
        m1 = ModelManager()
        m2 = ModelManager()
        assert m1 is m2, "ModelManager is a singleton — should return the same instance"

    def test_singleton_thread_safety(self):
        """Multiple threads constructing ModelManager should all get the same object."""
        instances = []

        def create():
            instances.append(ModelManager())

        threads = [threading.Thread(target=create) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(set(id(i) for i in instances)) == 1, (
            "All threads should receive the same singleton instance"
        )


@pytest.mark.unit
class TestDeviceSelection:

    def test_device_is_cpu_when_cuda_unavailable(self, monkeypatch):
        """When torch.cuda.is_available() is False, device should be CPU."""
        monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
        manager = ModelManager()
        assert manager.device.type == "cpu", (
            f"Expected CPU device, got {manager.device}"
        )

    def test_device_is_gpu_when_cuda_available(self, monkeypatch):
        """When torch.cuda.is_available() returns True, device should be CUDA."""
        monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
        manager = ModelManager()
        assert manager.device.type == "cuda", (
            f"Expected CUDA device, got {manager.device}"
        )


@pytest.mark.unit
class TestModelConfigsStructure:

    def test_hrnet_config_exists(self):
        """model_configs must contain an 'hrnet' entry."""
        manager = ModelManager()
        assert "hrnet" in manager.model_configs, (
            "model_configs should contain 'hrnet'"
        )

    def test_cbam_resunet_config_exists(self):
        """model_configs must contain a 'cbam_resunet' entry."""
        manager = ModelManager()
        assert "cbam_resunet" in manager.model_configs, (
            "model_configs should contain 'cbam_resunet'"
        )

    def test_each_config_has_required_keys(self):
        """Every model config entry must have class, weights_path, params."""
        manager = ModelManager()
        required = {"class", "weights_path", "params"}
        for name, cfg in manager.model_configs.items():
            missing = required - cfg.keys()
            assert not missing, (
                f"Config for '{name}' is missing keys: {missing}"
            )


@pytest.mark.unit
class TestIsModelAvailable:

    def test_is_model_available_false_when_no_weights(self):
        """is_model_available returns False when the weights file does not exist."""
        manager = ModelManager()
        model_name = list(manager.model_configs.keys())[0]
        # Point at a file that certainly does not exist
        manager.model_configs[model_name]["weights_path"] = Path("/nonexistent/path/weights.pth")
        assert manager.is_model_available(model_name) is False

    def test_is_model_available_false_for_unknown_name(self):
        """is_model_available returns False for a model name not in configs."""
        manager = ModelManager()
        assert manager.is_model_available("no_such_model") is False

    def test_is_model_available_true_when_weights_exist(self, tmp_path):
        """is_model_available returns True when the weights file exists on disk."""
        manager = ModelManager()
        model_name = list(manager.model_configs.keys())[0]
        weights_file = tmp_path / "model.pth"
        weights_file.write_bytes(b"fake_weights")
        manager.model_configs[model_name]["weights_path"] = weights_file
        assert manager.is_model_available(model_name) is True


@pytest.mark.unit
class TestGetModelInfo:

    def test_get_model_info_structure(self):
        """get_model_info should return a dict with known keys."""
        manager = ModelManager()
        model_name = list(manager.model_configs.keys())[0]
        info = manager.get_model_info(model_name)
        assert info is not None
        for key in ("name", "description", "parameters", "available", "loaded"):
            assert key in info, f"get_model_info is missing key: '{key}'"

    def test_get_model_info_name_matches(self):
        """The 'name' field should match the requested model name."""
        manager = ModelManager()
        for name in manager.model_configs:
            info = manager.get_model_info(name)
            assert info["name"] == name

    def test_get_model_info_unknown_returns_none(self):
        """Unknown model name should return None."""
        manager = ModelManager()
        assert manager.get_model_info("unknown_xyz") is None

    def test_get_model_info_loaded_field_false_before_load(self):
        """'loaded' should be False when the model has not been loaded yet."""
        manager = ModelManager()
        model_name = list(manager.model_configs.keys())[0]
        info = manager.get_model_info(model_name)
        assert info["loaded"] is False


@pytest.mark.unit
class TestLoadModelCaching:

    def test_load_model_returns_cached_on_second_call(self, tmp_path):
        """A second load_model() call for the same model returns the cached instance."""
        manager = ModelManager()
        model_name = list(manager.model_configs.keys())[0]

        # Inject a mock model directly into loaded_models (bypass actual weight loading)
        mock_model = MagicMock(spec=torch.nn.Module)
        manager.loaded_models[model_name] = mock_model

        result = manager.load_model(model_name)
        assert result is mock_model, (
            "Second load_model() should return cached model, not reload"
        )

    def test_load_model_info_loaded_true_after_cache(self):
        """get_model_info 'loaded' should be True after model is in loaded_models."""
        manager = ModelManager()
        model_name = list(manager.model_configs.keys())[0]
        manager.loaded_models[model_name] = MagicMock(spec=torch.nn.Module)
        info = manager.get_model_info(model_name)
        assert info["loaded"] is True


@pytest.mark.unit
class TestUnloadModel:

    def test_unload_model_removes_from_loaded(self):
        """unload_model() should remove the model from loaded_models."""
        manager = ModelManager()
        model_name = list(manager.model_configs.keys())[0]
        manager.loaded_models[model_name] = MagicMock(spec=torch.nn.Module)

        manager.unload_model(model_name)

        assert model_name not in manager.loaded_models, (
            "unload_model() should remove model from loaded_models"
        )

    def test_unload_nonexistent_model_no_error(self):
        """Calling unload_model for a model that isn't loaded should not raise."""
        manager = ModelManager()
        # Should not raise
        manager.unload_model("not_loaded_model")


@pytest.mark.unit
class TestCleanupAll:

    def test_cleanup_clears_all_models(self):
        """cleanup() should remove all models from loaded_models."""
        manager = ModelManager()
        for name in manager.model_configs:
            manager.loaded_models[name] = MagicMock(spec=torch.nn.Module)

        manager.cleanup()

        assert len(manager.loaded_models) == 0, (
            "cleanup() should clear all loaded models"
        )


@pytest.mark.unit
class TestGetMemoryUsage:

    def test_get_memory_usage_returns_dict(self):
        """get_memory_usage should return a dict with 'loaded_models' and 'device'."""
        manager = ModelManager()
        info = manager.get_memory_usage()
        assert isinstance(info, dict)
        assert "loaded_models" in info, "Memory usage must include 'loaded_models'"
        assert "device" in info, "Memory usage must include 'device'"

    def test_get_memory_usage_loaded_models_count(self):
        """'loaded_models' count should reflect current state of loaded_models dict."""
        manager = ModelManager()
        info = manager.get_memory_usage()
        assert info is not None
        initial_count = info["loaded_models"]
        # Add a fake model
        manager.loaded_models["test_model"] = MagicMock()
        new_count = manager.get_memory_usage()["loaded_models"]
        assert new_count == initial_count + 1
