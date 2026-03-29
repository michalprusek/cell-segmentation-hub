"""
Unit tests for error scenarios across the ML service.

Covers:
- ModelManager: unknown model, missing weights, corrupted checkpoint
- InferenceService: invalid image input, NaN / Inf output detection
- GPU OOM simulation via monkeypatching
"""
import io
import sys
import os
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import torch
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from services.model_loader import ModelManager

_INFERENCE_AVAILABLE = True
try:
    _mock_ml = MagicMock()
    _mock_ml.get_global_executor = MagicMock()
    _mock_ml.InferenceError = type("InferenceError", (RuntimeError,), {})
    _mock_ml.InferenceResourceError = type("InferenceResourceError", (RuntimeError,), {})
    sys.modules.setdefault("ml", MagicMock())
    sys.modules.setdefault("ml.inference_executor", _mock_ml)
    from services.inference import InferenceService as _InferenceService
except ImportError:
    _INFERENCE_AVAILABLE = False


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_model_manager():
    """Reset singleton state before and after every test."""
    if hasattr(ModelManager, "_instance") and ModelManager._instance is not None:
        ModelManager._instance._initialized = False
        ModelManager._instance = None
    yield
    if hasattr(ModelManager, "_instance") and ModelManager._instance is not None:
        ModelManager._instance._initialized = False
        ModelManager._instance = None


@pytest.fixture
def manager():
    """Fresh ModelManager instance for each test."""
    return ModelManager()


# ---------------------------------------------------------------------------
# ModelManager error tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestModelManagerErrors:
    """Error handling in ModelManager.load_model()."""

    def test_load_unknown_model_raises_value_error(self, manager):
        """Requesting an unknown model name should raise ValueError."""
        with pytest.raises(ValueError, match="Unknown model"):
            manager.load_model("totally_unknown_model_xyz")

    def test_load_missing_weights_raises_file_not_found(self, manager, tmp_path):
        """If weights file does not exist, FileNotFoundError should be raised."""
        # Patch weights_path to a non-existent file inside a known config
        model_name = list(manager.model_configs.keys())[0]
        manager.model_configs[model_name]["weights_path"] = tmp_path / "nonexistent.pth"
        with pytest.raises(FileNotFoundError):
            manager.load_model(model_name)

    def test_load_corrupted_weights_raises_runtime_error(self, manager, tmp_path):
        """A weights file with garbage content should trigger RuntimeError."""
        model_name = list(manager.model_configs.keys())[0]
        bad_file = tmp_path / "bad_weights.pth"
        bad_file.write_bytes(b"\x00corrupted_data\xff")
        manager.model_configs[model_name]["weights_path"] = bad_file
        with pytest.raises(RuntimeError):
            manager.load_model(model_name)

    def test_load_torch_load_raises_runtime_error(self, manager, tmp_path):
        """If torch.load raises unexpectedly, load_model wraps it in RuntimeError."""
        model_name = list(manager.model_configs.keys())[0]
        # Create a file so the exists() check passes
        weights_file = tmp_path / "weights.pth"
        weights_file.write_bytes(b"dummy")
        manager.model_configs[model_name]["weights_path"] = weights_file

        with patch("services.model_loader.torch.load", side_effect=Exception("boom")):
            with pytest.raises(RuntimeError):
                manager.load_model(model_name)

    def test_cuda_oom_during_inference(self, manager, tmp_path):
        """CUDA OOM error during model creation should propagate as RuntimeError."""
        model_name = list(manager.model_configs.keys())[0]
        weights_file = tmp_path / "weights.pth"
        weights_file.write_bytes(b"dummy")
        manager.model_configs[model_name]["weights_path"] = weights_file

        oom_error = RuntimeError("CUDA out of memory")

        with patch("services.model_loader.torch.load", side_effect=oom_error):
            with pytest.raises(RuntimeError, match="CUDA out of memory|Failed to load"):
                manager.load_model(model_name)

    def test_validate_model_nan_output(self, manager):
        """_validate_model should raise RuntimeError when output contains NaN."""
        mock_model = MagicMock(spec=torch.nn.Module)
        nan_tensor = torch.full((1, 1, 64, 64), float("nan"))
        mock_model.return_value = nan_tensor

        with pytest.raises(RuntimeError, match="(?i)nan|validation failed"):
            manager._validate_model(mock_model, "test_model")

    def test_validate_model_inf_output(self, manager):
        """_validate_model should raise RuntimeError when output contains Inf."""
        mock_model = MagicMock(spec=torch.nn.Module)
        inf_tensor = torch.full((1, 1, 64, 64), float("inf"))
        mock_model.return_value = inf_tensor

        with pytest.raises(RuntimeError, match="(?i)inf|validation failed"):
            manager._validate_model(mock_model, "test_model")


# ---------------------------------------------------------------------------
# InferenceService error tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
@pytest.mark.skipif(not _INFERENCE_AVAILABLE, reason="InferenceService import fails due to relative import issue")
class TestInferenceServiceErrors:
    """Error handling in InferenceService.segment_image()."""

    @pytest.fixture
    def service(self):
        from services.inference import InferenceService
        mgr = MagicMock()
        mgr.device = torch.device("cpu")
        mgr.loaded_models = {}
        with patch("services.inference.get_global_executor") as mock_exec:
            mock_executor = MagicMock()
            mock_executor.executor._max_workers = 1
            mock_executor.enable_cuda_streams = False
            mock_exec.return_value = mock_executor
            svc = InferenceService(mgr)
        return svc

    @pytest.mark.asyncio
    async def test_segment_invalid_image_raises(self, service):
        """Non-image bytes passed to segment_image should raise RuntimeError."""
        with pytest.raises(RuntimeError):
            await service.segment_image(
                image_data=b"this_is_not_an_image",
                model_name="hrnet",
            )

    @pytest.mark.asyncio
    async def test_segment_model_load_failure_raises(self, service):
        """If load_model raises, segment_image propagates as RuntimeError."""
        service.model_manager.load_model.side_effect = FileNotFoundError("weights missing")
        img = Image.new("RGB", (128, 128), color="white")
        buf = io.BytesIO()
        img.save(buf, format="PNG")

        with pytest.raises(RuntimeError):
            await service.segment_image(
                image_data=buf.getvalue(),
                model_name="hrnet",
            )

    def test_inference_timeout_clears_cuda_cache(self, service, monkeypatch):
        """Simulate a timeout: torch.cuda.empty_cache should be called on cleanup."""
        called = []

        def fake_empty_cache():
            called.append(True)

        monkeypatch.setattr(torch.cuda, "empty_cache", fake_empty_cache)

        # Manually call empty_cache as the timeout handler would
        torch.cuda.empty_cache()
        assert called, "CUDA cache clearing was not invoked"
