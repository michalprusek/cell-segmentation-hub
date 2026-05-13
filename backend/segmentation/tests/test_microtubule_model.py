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


def test_rdp_preserves_embedding_alignment(monkeypatch):
    """The RDP simplification in wrapper.predict() must keep embedding
    samples index-aligned with the simplified centerline.

    Cross-frame tracking (`/api/v1/track`) uses Hungarian matching over
    the 32-d embeddings sampled per polyline vertex. If the embedding
    array is one shape and the polyline another, trackId assignments
    silently corrupt — no exception, just wrong correspondences.
    """
    cv2 = pytest.importorskip("cv2")
    pytest.importorskip("torch")
    from models.microtubule.wrapper import MicrotubuleModel

    # Synthetic wiggle on a 30-pt line: most points should be droppable
    # by RDP (eps=0.75 px) since they are near-collinear.
    rows = np.linspace(10.0, 40.0, 30)
    cols = np.full_like(rows, 20.0) + 0.1 * np.sin(np.linspace(0, 6, 30))
    wiggly = np.stack([rows, cols], axis=1)

    # Stub the model + the internal helpers so we never touch torch.
    mt = MicrotubuleModel.__new__(MicrotubuleModel)
    mt._model = object()
    mt._device = "cpu"

    fake_embed = np.random.randn(32, 64, 64).astype(np.float32)

    def fake_predict_seed_embed(_model, _norm, device):
        seed_prob = np.zeros((64, 64), dtype=np.float32)
        return seed_prob, fake_embed

    def fake_extract(_binary, _params, embeddings=None):  # noqa: ARG001
        return [{"centerline": wiggly}]

    # Inject the fakes via the same import paths the wrapper uses.
    import importlib

    seg_mt = importlib.import_module("models.microtubule.segment_mt")
    monkeypatch.setattr(seg_mt, "predict_seed_embed", fake_predict_seed_embed)
    monkeypatch.setattr(
        seg_mt, "PYSOAX_PARAMS_DEFAULT", {}, raising=False
    )
    monkeypatch.setattr(seg_mt, "_normalize", lambda x: x.astype(np.float32))

    import pysoax  # absolute import, same as wrapper

    monkeypatch.setattr(pysoax, "extract_soax_instances", fake_extract)

    result = mt.predict(np.zeros((64, 64), dtype=np.float32), seed_threshold=0.5)
    centerlines = result["centerlines_rc"]
    embeddings = result["embedding_samples"]

    assert len(centerlines) == 1
    assert len(embeddings) == 1
    # The load-bearing invariant: one embedding row per polyline vertex.
    assert centerlines[0].shape[0] == embeddings[0].shape[0]
    # And the simplification actually fired.
    assert centerlines[0].shape[0] < wiggly.shape[0], (
        "RDP should have dropped redundant near-collinear points"
    )
    # Endpoints preserved (RDP keeps first + last).
    np.testing.assert_allclose(centerlines[0][0], wiggly[0], atol=1e-3)
    np.testing.assert_allclose(centerlines[0][-1], wiggly[-1], atol=1e-3)


def test_rdp_short_polyline_passthrough(monkeypatch):
    """Centerlines with <=3 points must not be RDP-simplified.

    The guard `cl.shape[0] > 3` in wrapper.predict() avoids degenerate
    inputs to approxPolyDP. The polyline + matched embeddings should
    pass through unchanged.
    """
    pytest.importorskip("cv2")
    pytest.importorskip("torch")
    from models.microtubule.wrapper import MicrotubuleModel

    short_cl = np.array([[0.0, 0.0], [5.0, 5.0], [10.0, 10.0]], dtype=np.float64)

    mt = MicrotubuleModel.__new__(MicrotubuleModel)
    mt._model = object()
    mt._device = "cpu"

    fake_embed = np.random.randn(32, 16, 16).astype(np.float32)

    import importlib

    seg_mt = importlib.import_module("models.microtubule.segment_mt")
    monkeypatch.setattr(
        seg_mt, "predict_seed_embed",
        lambda _m, _n, device: (np.zeros((16, 16), dtype=np.float32), fake_embed),
    )
    monkeypatch.setattr(seg_mt, "PYSOAX_PARAMS_DEFAULT", {}, raising=False)
    monkeypatch.setattr(seg_mt, "_normalize", lambda x: x.astype(np.float32))

    import pysoax

    monkeypatch.setattr(
        pysoax, "extract_soax_instances",
        lambda _b, _p, embeddings=None: [{"centerline": short_cl}],
    )

    result = mt.predict(np.zeros((16, 16), dtype=np.float32), seed_threshold=0.5)
    assert result["centerlines_rc"][0].shape == short_cl.shape
    assert result["embedding_samples"][0].shape[0] == short_cl.shape[0]
