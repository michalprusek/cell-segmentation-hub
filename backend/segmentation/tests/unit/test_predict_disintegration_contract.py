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


# ---- the paper's read-out, from the RASTER (review findings G13, G14, G20, F14) ----

import json  # noqa: E402
from pathlib import Path  # noqa: E402

from api import disintegration_metrics as dm  # noqa: E402

_FIX = (Path(__file__).resolve().parents[3]
        / "segmentation_cpu_tests" / "fixtures" / "di_parity")


def _dispersed_with_specks(h=512, w=512):
    """Core r=80 (above MIN_CORE_PX), corona ring to r=120, plus 12 isolated 2x2
    corona specks far out: each 4 px, i.e. below the 50 px polygon filter."""
    m = _concentric_mask(h, w, r_out=120, r_core=80)
    for k in range(12):
        t = 2 * np.pi * k / 12
        y, x = int(h / 2 + 200 * np.sin(t)), int(w / 2 + 200 * np.cos(t))
        m[y:y + 2, x:x + 2] = 1
    return m


def test_image_metrics_are_computed_from_the_raster_mask():
    mask = _dispersed_with_specks()
    out = _run(mask)
    im = out["image_metrics"]
    ref = dm.disintegration_index(mask)
    assert im["reference"] == "core" and im["source"] == "model_raster"
    for k in dm.METRIC_FIELDS:
        assert im[k] == pytest.approx(ref[k], abs=1e-12), k
    # the specks the polygon filter drops are still in the read-out
    assert im["n_fragments"] == 13
    fg_polys = [p for p in out["polygons"] if p.get("partClass") != "core"]
    assert len(fg_polys) == 1
    assert im["algorithm_sha256"] == dm.ALGORITHM_SOURCE_SHA256
    json.dumps(im, allow_nan=False)


def test_threshold_is_inert_and_says_so():
    mask = _dispersed_with_specks()
    loader = ModelLoader(base_path=".")
    outs = []
    for thr in (0.1, 0.9):
        loader.loaded_models["spheroid_disintegration"] = _FakeModel(mask)
        outs.append(loader.predict_disintegration(Image.new("RGB", (512, 512)), threshold=thr))
    a, b = outs
    assert a["threshold_applies"] is False and b["threshold_applies"] is False
    assert a["image_metrics"]["DI"] == b["image_metrics"]["DI"]
    assert [p["points"] for p in a["polygons"]] == [p["points"] for p in b["polygons"]]


def test_core_too_small_is_undefined_in_the_raster_read_out():
    out = _run(_concentric_mask())            # core r=18: far below MIN_CORE_PX
    im = out["image_metrics"]
    assert im["reference"] == "core_too_small"
    assert im["DI"] is None and im["index_B"] is None
    assert "below the minimum core size" in im["note"]


def test_input_scale_warning_is_returned():
    out = _run(_dispersed_with_specks())      # a 512 x 512 frame
    assert out["warnings"] and "512x512" in out["warnings"][0]
    assert out["warnings"] == out["image_metrics"]["warnings"]


@pytest.mark.skipif(not (_FIX / "expected.json").exists(),
                    reason="parity fixtures live beside backend/segmentation (not in the ml image)")
def test_inference_path_reproduces_compute_di_on_the_parity_fixtures():
    """The full predict_disintegration path returns compute_di.py's numbers to 1e-9."""
    exp = json.loads((_FIX / "expected.json").read_text())
    masks = dict(np.load(_FIX / "masks.npz"))
    defined = [k for k, v in exp["expected"].items() if v["metrics"] is not None]
    assert len(defined) >= 3
    for name, e in exp["expected"].items():
        im = _run(masks[name])["image_metrics"]
        if e["metrics"] is None:
            assert im["DI"] is None and im["note"] == e["undefined_reason"], name
            continue
        for k, v in e["metrics"].items():
            assert abs(im[k] - v) <= exp["tolerance"], (name, k, im[k], v)


# ---- the pixel size: resampled to 1.28 um/px when known (api.disintegration_scale) ----

class _ScaleFreeModel:
    """Class from the grey level, on whatever grid it is handed; records shapes."""

    def __init__(self):
        self.shapes = []

    def predict(self, rgb):
        self.shapes.append(rgb.shape)
        g = rgb[:, :, 0].astype(np.int16)
        out = np.zeros(g.shape, np.uint8)
        out[g < 160] = 1
        out[g < 80] = 2
        return out


def _frame_of(mask):
    return Image.fromarray(np.choose(mask, [200, 120, 40]).astype(np.uint8), mode="L")


def _without_timing(out):
    out = dict(out)
    out["processing_info"] = {k: v for k, v in out["processing_info"].items()
                              if k != "processing_time_s"}
    return out


@pytest.mark.parametrize("um", [None, 1.28, 1.29])
def test_no_pixel_size_or_1_28_is_the_old_path_exactly(um):
    mask = _dispersed_with_specks()
    loader = ModelLoader(base_path=".")
    loader.loaded_models["spheroid_disintegration"] = _FakeModel(mask)
    base = loader.predict_disintegration(Image.new("RGB", (512, 512)), threshold=0.5)
    loader.loaded_models["spheroid_disintegration"] = _FakeModel(mask)
    out = loader.predict_disintegration(Image.new("RGB", (512, 512)), threshold=0.5,
                                        um_per_px=um)
    assert _without_timing(out) == _without_timing(base)
    assert "resample" not in out["image_metrics"]


def test_a_coarse_frame_is_segmented_at_1_28_and_drawn_on_the_upload():
    # 2.56 um/px: the model runs on a frame twice the size, the polygons and
    # the reported size stay on the uploaded 300 x 260 grid.
    mask = _concentric_mask(260, 300, r_out=80, r_core=40)  # core ~5 000 px
    model = _ScaleFreeModel()
    loader = ModelLoader(base_path=".")
    loader.loaded_models["spheroid_disintegration"] = model
    out = loader.predict_disintegration(_frame_of(mask), um_per_px=2.56)
    assert model.shapes == [(520, 600, 3)]
    im = out["image_metrics"]
    assert im["resample"] == {"input_um_per_px": 2.56, "model_um_per_px": 1.28,
                              "factor": 2.0, "model_w": 600, "model_h": 520}
    # MIN_CORE_PX is a 1.28 um/px quantity: ~20 000 px there, ~5 000 here
    assert im["reference"] == "core"
    assert im["area_core_px"] < dm.MIN_CORE_PX
    assert out["image_size"] == {"width": 300, "height": 260}
    assert (im["image_width"], im["image_height"]) == (300, 260)
    xs = [pt["x"] for p in out["polygons"] for pt in p["points"]]
    ys = [pt["y"] for p in out["polygons"] for pt in p["points"]]
    assert 0 <= min(xs) and max(xs) < 300 and 0 <= min(ys) and max(ys) < 260
    json.dumps(im, allow_nan=False)


def test_an_out_of_range_pixel_size_is_not_resampled_and_warns():
    mask = _dispersed_with_specks()
    loader = ModelLoader(base_path=".")
    loader.loaded_models["spheroid_disintegration"] = _FakeModel(mask)
    out = loader.predict_disintegration(Image.new("RGB", (512, 512)), um_per_px=0.1)
    assert "resample" not in out["image_metrics"]
    assert any("resamples only factors" in w for w in out["warnings"])
    assert out["warnings"] == out["image_metrics"]["warnings"]


def test_the_callers_pixel_ceiling_bounds_the_resample():
    # 2.0 um/px would grow the 300 x 260 frame to ~469 x 406; with the
    # caller's ceiling at the frame's own size the loader must not resample,
    # and must say why. Without the ceiling the same call resamples.
    mask = _concentric_mask(260, 300, r_out=80, r_core=40)
    model = _ScaleFreeModel()
    loader = ModelLoader(base_path=".")
    loader.loaded_models["spheroid_disintegration"] = model
    out = loader.predict_disintegration(_frame_of(mask), um_per_px=2.0,
                                        max_pixels=300 * 260)
    assert model.shapes == [(260, 300, 3)]
    assert "resample" not in out["image_metrics"]
    assert out["image_metrics"]["resample_skipped"]["input_um_per_px"] == 2.0
    assert any("would grow" in w for w in out["warnings"])

    out = loader.predict_disintegration(_frame_of(mask), um_per_px=2.0)
    assert model.shapes[-1] == (406, 469, 3)
    assert out["image_metrics"]["resample"]["factor"] == pytest.approx(2.0 / 1.28)
