"""Smoke tests for the microtubule v7 model wrapper + loader integration.

These tests deliberately bypass the actual DINOv3-L + DPT + PySOAX inference:

- The DINOv3 backbone is a gated 1.1 GB HuggingFace download and the v7
  checkpoint is 1.2 GB — together far too heavy for CI.
- PySOAX is iterative (5000 snake-evolution iterations per frame) and would
  dominate test runtime even on a real image.

Instead, we monkey-patch ``MicrotubuleModel.predict()`` with a synthetic
result and assert that the downstream conversion (``predict_microtubule``)
emits a well-formed response — the same contract the backend, the tracker,
and the kymograph endpoint all rely on.
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))


def test_microtubule_model_class_importable():
    """The optional ``MicrotubuleModel`` is exported from models/."""
    from models import MicrotubuleModel  # noqa: F401

    # In an environment without transformers / nd2 this is None — the loader
    # raises a clear error when the model is requested. Either outcome is
    # acceptable for this smoke check; we just want the symbol to exist.
    assert MicrotubuleModel is None or hasattr(MicrotubuleModel, "predict")


def test_predict_microtubule_response_shape(monkeypatch):
    """Conversion from wrapper output to API response is correct.

    The wrapper returns row/col centerlines and float16 embedding samples;
    ``predict_microtubule`` must convert them to (x, y) polyline points and
    base64-encoded embeddings while populating instanceId, geometry, etc.
    """
    pytest.importorskip("torch")  # model_loader imports torch unconditionally
    from ml.model_loader import ModelLoader

    H, W, D = 32, 32, 32
    fake_centerlines = [
        np.array([[5.0, 10.0], [5.0, 11.0], [5.0, 12.0]], dtype=np.float64),
        np.array([[10.0, 5.0], [11.0, 5.0], [12.0, 5.0], [13.0, 5.0]], dtype=np.float64),
    ]
    fake_embeddings = [
        np.random.randn(cl.shape[0], D).astype(np.float16) for cl in fake_centerlines
    ]

    loader = ModelLoader.__new__(ModelLoader)
    # Attributes the method actually uses (sidestep __init__ which boots torch)
    loader.is_processing = False
    loader.current_model = None
    loader.device = "cpu"
    loader.loaded_models = {}

    class _StubMTModel:
        def predict(self, image_np, seed_threshold=None, pysoax_params=None):
            return {
                "centerlines_rc": fake_centerlines,
                "seed_prob": np.zeros((H, W), dtype=np.float32),
                "embedding_samples": fake_embeddings,
            }

    loader.loaded_models["microtubule"] = _StubMTModel()
    monkeypatch.setattr(loader, "get_model", lambda name: loader.loaded_models[name])
    monkeypatch.setattr(loader, "release_model", lambda name: None)

    pil = Image.new("L", (W, H), color=128)
    result = loader.predict_microtubule(pil, threshold=0.5)

    assert result["model_used"] == "microtubule"
    assert result["polygons"] == []  # MT model produces polylines only
    assert len(result["polylines"]) == len(fake_centerlines)

    for poly, cl, emb in zip(result["polylines"], fake_centerlines, fake_embeddings):
        assert poly["geometry"] == "polyline"
        assert poly["class"] == "microtubule"
        assert poly["instanceId"].startswith("mt_")
        assert poly["vertices_count"] == cl.shape[0]
        # (row, col) → (x = col, y = row) conversion
        for i, pt in enumerate(poly["points"]):
            assert pt["x"] == pytest.approx(cl[i, 1])
            assert pt["y"] == pytest.approx(cl[i, 0])
        # Embedding round-trips through base64 → original float16 array.
        emb_bytes = base64.b64decode(poly["_embedding"])
        decoded = np.frombuffer(emb_bytes, dtype=np.float16).reshape(cl.shape[0], D)
        np.testing.assert_array_equal(decoded, emb)


def test_predict_microtubule_unloaded_raises(monkeypatch):
    """If the model wasn't loaded, the predict path returns a clear error."""
    pytest.importorskip("torch")
    from ml.model_loader import ModelLoader

    loader = ModelLoader.__new__(ModelLoader)
    loader.is_processing = False
    loader.current_model = None
    loader.device = "cpu"
    loader.loaded_models = {}
    monkeypatch.setattr(loader, "get_model", lambda name: None)

    with pytest.raises(ValueError, match="Microtubule model not loaded"):
        loader.predict_microtubule(Image.new("L", (16, 16)), threshold=0.5)
