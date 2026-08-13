"""Contract test for ``ModelLoader.predict_disintegration``.

The spheroid-disintegration model produces the polygon split the core-anchored
Disintegration Index depends on: foreground (corona ∪ core) as plain
``type="external"`` polygons, and the dense core (class 2) as polygons tagged
``partClass="core"``. If that split silently breaks — class index inverted
(``==2`` vs ``==1``), the ``partClass="core"`` tag dropped, foreground mistagged
as core, or the core never emitted — the well-tested DI endpoint turns the result
into a *wrong scientific index* (or an all-N/A panel) with a fully green gate.
This locks the contract using a MOCKED model, so it needs no smp/timm/torch net
and no 118 MB checkpoint — only numpy + the postprocessing service.

pytest is not installed in the ML runtime container; the module-level
``importorskip`` makes this a no-op there and runnable in the GPU one-off image.
"""
import numpy as np
import pytest

# Skips the whole file if the ML web deps (fastapi/pydantic/skimage) are absent.
_ml = pytest.importorskip("ml.model_loader")
pytest.importorskip("PIL")
from PIL import Image  # noqa: E402

ModelLoader = _ml.ModelLoader


class _FakeModel:
    """Stands in for DisintegrationModel: ``predict`` returns a fixed mask."""

    def __init__(self, mask):
        self._mask = mask

    def predict(self, rgb):  # noqa: ARG002 - image ignored, mask is fixed
        return self._mask


def _concentric_mask(h=128, w=128, r_out=40, r_core=18):
    """bg=0, corona ring=1, dense core=2 — concentric disks."""
    yy, xx = np.ogrid[:h, :w]
    d2 = (yy - h // 2) ** 2 + (xx - w // 2) ** 2
    m = np.zeros((h, w), np.uint8)
    m[d2 <= r_out ** 2] = 1
    m[d2 <= r_core ** 2] = 2
    return m


def _run(mask):
    loader = ModelLoader(base_path=".")
    # Inject so get_model() short-circuits — no disk load, no smp/timm/torch.
    loader.loaded_models["spheroid_disintegration"] = _FakeModel(mask)
    h, w = mask.shape
    return loader.predict_disintegration(Image.new("RGB", (w, h)), threshold=0.5)


def test_core_and_foreground_split_matches_DI_contract():
    out = _run(_concentric_mask())
    polys = out["polygons"]
    cores = [p for p in polys if p.get("partClass") == "core"]
    fgs = [p for p in polys if p.get("partClass") != "core"]

    assert out["model_used"] == "spheroid_disintegration"
    # Core is emitted (not swallowed) and reported.
    assert len(cores) == 1
    assert out["processing_info"]["num_core"] == 1
    assert len(fgs) >= 1
    # Core carries the exact tags the DI split + area metrics key on.
    assert cores[0]["type"] == "external"
    assert cores[0]["class"] == "spheroid"
    # Foreground is NOT mistagged as core.
    assert all(p.get("partClass") != "core" for p in fgs)
    # Core strictly inside the foreground → guards a class-index inversion
    # (tagging the corona ring as the core would flip this ordering).
    assert 0 < cores[0]["area"] < max(p["area"] for p in fgs)
    cx = float(np.mean([pt["x"] for pt in cores[0]["points"]]))
    cy = float(np.mean([pt["y"] for pt in cores[0]["points"]]))
    assert abs(cx - 64) < 12 and abs(cy - 64) < 12  # centred core, not the ring


def test_no_core_class_emits_no_core_polygon():
    # Only background + corona, no class-2 pixels anywhere.
    mask = _concentric_mask(r_core=0)
    out = _run(mask)
    cores = [p for p in out["polygons"] if p.get("partClass") == "core"]
    assert cores == []
    assert out["processing_info"]["num_core"] == 0
    # Foreground (the corona) is still segmented.
    assert out["processing_info"]["num_polygons"] >= 1
