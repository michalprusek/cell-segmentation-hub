"""The spheroid-disintegration frame is scored at 1.28 um/px, whatever it came at.

`backend/segmentation/api/disintegration_scale.py` resamples a frame whose
pixel size is known to the 1.28 um/px the model and the paper's read-out were
validated at, runs the model there, computes the read-out there, and maps the
mask back to the uploaded grid. These tests pin, without a network or a GPU:

* without a pixel size, or within 2 % of 1.28, the path is the old one exactly:
  no resize call, the model gets the identical array, the read-out is the
  identical dict;
* sizes go the right way (larger pixels -> the frame grows) on a NON-square
  frame, so a swapped (width, height) cannot pass, and come back to the
  uploaded shape;
* the read-out applies `MIN_CORE_PX` (defined at 1.28 um/px) on the model grid,
  in both directions, while the areas stay on the uploaded grid;
* factors outside 0.5-2x, and growth past the ceiling, are not resampled and
  say so;
* `/api/disintegration-index` scores edited polygons on the same grid, so an
  edited image and a fresh one agree.

The stand-in "model" classifies by intensity, which no scale moves; the tests
that need a scale-DEPENDENT outcome get it from `MIN_CORE_PX`, which is exactly
what the real read-out depends on.
"""

from __future__ import annotations

import asyncio
import contextlib
import importlib
import io
import sys
import types
from pathlib import Path

import cv2
import numpy as np
import pytest
from PIL import Image

_SEG = Path(__file__).resolve().parents[1] / "segmentation"
sys.path.insert(0, str(_SEG))

dm = importlib.import_module("api.disintegration_metrics")
dsc = importlib.import_module("api.disintegration_scale")
mep = importlib.import_module("api.metrics_endpoint")


# `routes` reads torch at import time; same stand-in rule as
# test_inference_serialisation.py (it must not outlive the import).
@contextlib.contextmanager
def _torch_or_stand_in():
    try:  # pragma: no cover - depends on the environment, not the code
        import torch  # noqa: F401
    except ImportError:  # pragma: no cover
        pass
    else:
        yield
        return
    stand_in = types.ModuleType("torch")
    stand_in.cuda = types.SimpleNamespace(
        is_available=lambda: False,
        Stream=object,
        current_stream=lambda *a, **k: None,
    )
    stand_in.Tensor = object
    sys.modules["torch"] = stand_in
    try:
        yield
    finally:
        if sys.modules.get("torch") is stand_in:
            del sys.modules["torch"]


with _torch_or_stand_in():
    routes = importlib.import_module("api.routes")

BG, CORONA, CORE = 200, 120, 40  # grey levels of the synthetic frames


def _scene(h: int, w: int, r_core: float, r_corona: float, specks: int = 16) -> np.ndarray:
    """A 3-class mask: core disk, corona annulus, isolated corona specks."""
    yy, xx = np.ogrid[:h, :w]
    cy, cx = (h - 1) / 2, (w - 1) / 2
    d2 = (yy - cy) ** 2 + (xx - cx) ** 2
    m = np.zeros((h, w), np.uint8)
    m[d2 <= r_corona**2] = 1
    m[d2 <= r_core**2] = 2
    rad = min(h, w) * 0.42
    for k in range(specks):
        t = 2 * np.pi * k / specks
        y, x = int(cy + rad * np.sin(t)), int(cx + rad * np.cos(t))
        m[y - 3:y + 3, x - 3:x + 3] = 1
    return m


def _frame(mask: np.ndarray) -> np.ndarray:
    return np.choose(mask, [BG, CORONA, CORE]).astype(np.uint8)


class _IntensityModel:
    """Stands in for DisintegrationModel.predict: the class from the grey level.

    Records the shape of every input, which is how the tests see on which
    grid the model actually ran.
    """

    def __init__(self):
        self.calls: list[np.ndarray] = []

    def __call__(self, rgb: np.ndarray) -> np.ndarray:
        self.calls.append(rgb)
        g = rgb[:, :, 0].astype(np.int16)
        out = np.zeros(g.shape, np.uint8)
        out[g < (BG + CORONA) // 2] = 1
        out[g < (CORONA + CORE) // 2] = 2
        return out


# --------------------------------------------------------------------------
# the plan: when, and to what size
# --------------------------------------------------------------------------


def test_the_model_pixel_size_is_the_validated_one():
    assert dsc.MODEL_UM_PER_PX == dm.VALIDATED_UM_PER_PX == 1.28


@pytest.mark.parametrize(
    "um",
    [None, float("nan"), float("inf"), 0.0, -1.0, "not a number",
     1.28, 1.28 * 1.0199, 1.28 * 0.9801],
)
def test_no_plan_without_a_usable_pixel_size_or_within_two_percent(um):
    plan, warnings = dsc.plan_resample(2048, 2048, um)
    assert plan is None
    assert warnings == []


def test_just_past_two_percent_is_resampled():
    plan, warnings = dsc.plan_resample(2048, 2048, 1.28 * 1.025)
    assert plan is not None and warnings == []


@pytest.mark.parametrize(
    "um, size",
    [
        # larger pixels than the model's -> fewer px per um -> the frame GROWS
        (2.56, (4096, 3072)),
        (1.50, (2400, 1800)),
        # smaller pixels -> the frame shrinks
        (1.10, (1760, 1320)),
        (0.64, (1024, 768)),
    ],
)
def test_sizes_go_the_right_way_on_a_non_square_frame(um, size):
    plan, _ = dsc.plan_resample(2048, 1536, um)
    assert (plan.model_width, plan.model_height) == size
    assert plan.factor == pytest.approx(um / 1.28)
    gray = np.zeros((1536, 2048), np.uint8)
    model_gray = dsc.frame_to_model_grid(gray, plan)
    # numpy shape is (rows, cols) = (height, width)
    assert model_gray.shape == (size[1], size[0])
    back = dsc.mask_to_original_grid(np.zeros_like(model_gray), plan)
    assert back.shape == (1536, 2048)
    assert dsc.mask_to_model_grid(back, plan).shape == model_gray.shape


def test_shrinking_averages_and_enlarging_interpolates():
    rng = np.random.default_rng(0)
    gray = rng.integers(0, 256, (300, 420), dtype=np.uint8)
    shrink, _ = dsc.plan_resample(420, 300, 1.0)
    grow, _ = dsc.plan_resample(420, 300, 1.7)
    size_s = (shrink.model_width, shrink.model_height)
    size_g = (grow.model_width, grow.model_height)
    assert np.array_equal(dsc.frame_to_model_grid(gray, shrink),
                          cv2.resize(gray, size_s, interpolation=cv2.INTER_AREA))
    assert not np.array_equal(dsc.frame_to_model_grid(gray, shrink),
                              cv2.resize(gray, size_s, interpolation=cv2.INTER_LINEAR))
    assert np.array_equal(dsc.frame_to_model_grid(gray, grow),
                          cv2.resize(gray, size_g, interpolation=cv2.INTER_LINEAR))
    assert not np.array_equal(dsc.frame_to_model_grid(gray, grow),
                              cv2.resize(gray, size_g, interpolation=cv2.INTER_AREA))


def test_the_back_map_keeps_class_labels_and_shape():
    plan, _ = dsc.plan_resample(500, 380, 1.6)
    m = _scene(plan.model_height, plan.model_width, 60, 110)
    back = dsc.mask_to_original_grid(m, plan)
    assert back.dtype == np.uint8 and back.shape == (380, 500)
    assert set(np.unique(back)) <= {0, 1, 2}


@pytest.mark.parametrize("um", [1.024, 1.6])  # factors 0.8 and 1.25
def test_the_back_map_is_centred(um):
    # cv2.INTER_NEAREST samples floor(x * scale), which moves a back-mapped
    # disk by ~0.4 px; the centred variant by < 0.05 px (see _NEAREST).
    plan, _ = dsc.plan_resample(1000, 1000, um)
    mh, mw = plan.model_height, plan.model_width
    yy, xx = np.ogrid[:mh, :mw]
    disk = (((yy - (mh - 1) / 2) ** 2 + (xx - (mw - 1) / 2) ** 2)
            <= (0.3 * mw) ** 2).astype(np.uint8)
    ys, xs = np.nonzero(dsc.mask_to_original_grid(disk, plan))
    assert abs(xs.mean() - 499.5) < 0.1 and abs(ys.mean() - 499.5) < 0.1


@pytest.mark.parametrize("um", [0.5 * 1.28 * 0.99, 2.0 * 1.28 * 1.01, 0.032, 40.0])
def test_factors_outside_half_to_double_are_not_resampled_and_warn(um):
    plan, warnings = dsc.plan_resample(2048, 2048, um)
    assert plan is None
    assert len(warnings) == 1 and "resamples only factors" in warnings[0]


@pytest.mark.parametrize("um", [0.5 * 1.28, 2.0 * 1.28])
def test_the_bounds_themselves_are_resampled(um):
    plan, warnings = dsc.plan_resample(1024, 1024, um)
    assert plan is not None and warnings == []


def test_growth_past_the_ceiling_is_not_resampled_and_warns():
    plan, warnings = dsc.plan_resample(4096, 4096, 1.6)  # -> 5120 x 5120
    assert plan is None and "would grow" in warnings[0]
    # the caller's own ceiling is honoured too
    plan, warnings = dsc.plan_resample(2048, 2048, 1.6, max_pixels=2048 * 2048)
    assert plan is None and "would grow" in warnings[0]
    # ... and shrinking is never refused, however large the frame
    plan, warnings = dsc.plan_resample(6000, 6000, 1.0, max_pixels=2048 * 2048)
    assert plan is not None and warnings == []


# --------------------------------------------------------------------------
# no pixel size / 1.28 um/px: the old path, bit for bit
# --------------------------------------------------------------------------


@pytest.mark.parametrize("um", [None, 1.28, 1.29])
def test_without_a_plan_nothing_is_resized_and_the_read_out_is_unchanged(um, monkeypatch):
    mask = _scene(412, 388, 90, 150)
    gray = _frame(mask)
    plan, warnings = dsc.plan_resample(388, 412, um)
    assert plan is None and warnings == []

    def _no_resize(*a, **k):
        raise AssertionError("cv2.resize called without a plan")

    monkeypatch.setattr(dsc.cv2, "resize", _no_resize)
    model = _IntensityModel()
    m_orig, m_model = dsc.predict_on_model_grid(gray, plan, model)
    # the model saw exactly the stack the loader always built
    assert len(model.calls) == 1
    assert np.array_equal(model.calls[0], np.stack([gray] * 3, axis=2))
    assert model.calls[0].flags["C_CONTIGUOUS"]
    assert m_orig is m_model
    # the read-out is raster_metrics' own dict, nothing added
    assert dsc.read_out(m_orig, m_model, plan) == dm.raster_metrics(m_orig, 388, 412)
    # and the endpoint's variant still feeds the pixel size to the warning only
    assert (dsc.read_out(m_orig, m_model, plan, um_per_px=2.0)
            == dm.raster_metrics(m_orig, 388, 412, 2.0))


# --------------------------------------------------------------------------
# with a plan: where the model runs, and on which grid each number is counted
# --------------------------------------------------------------------------


def test_the_model_runs_on_the_model_grid_and_the_mask_comes_back():
    mask = _scene(800, 960, 120, 260)
    small = cv2.resize(_frame(mask), (768, 640), interpolation=cv2.INTER_AREA)  # 0.8x
    plan, _ = dsc.plan_resample(768, 640, 1.6)
    model = _IntensityModel()
    m_orig, m_model = dsc.predict_on_model_grid(small, plan, model)
    assert model.calls[0].shape == (800, 960, 3)
    assert m_model.shape == (800, 960)
    assert m_orig.shape == (640, 768)


def test_a_frame_shrunk_by_0_8_and_read_at_1_6_gives_the_original_fraction():
    # Core of ~20 100 px at 1.28 um/px, above MIN_CORE_PX; shrunk by 0.8 it is
    # ~12 900 px, below it, so the read-out depends on the scale it is taken at.
    mask = _scene(900, 1000, 80, 170)
    assert (mask == 2).sum() > dm.MIN_CORE_PX
    original = dm.raster_metrics(mask, 1000, 900)
    assert original["reference"] == "core"

    small = cv2.resize(_frame(mask), (800, 720), interpolation=cv2.INTER_AREA)
    model = _IntensityModel()

    # read as acquired, the core is too small and nothing is returned
    as_is = dsc.read_out(*dsc.predict_on_model_grid(small, None, model), None)
    assert as_is["reference"] == "core_too_small" and as_is["index_B"] is None

    plan, _ = dsc.plan_resample(800, 720, 1.6)
    m_orig, m_model = dsc.predict_on_model_grid(small, plan, model)
    r = dsc.read_out(m_orig, m_model, plan)
    assert r["reference"] == "core"
    assert r["index_B"] == pytest.approx(original["index_B"], abs=0.01)
    assert r["DI"] == pytest.approx(original["DI"], abs=0.01)
    # areas and size are the UPLOADED grid's, so (um/px)^2 gives real um^2
    assert (r["image_width"], r["image_height"]) == (800, 720)
    assert r["area_total_px"] == int((m_orig > 0).sum())
    assert r["area_core_px"] == int((m_orig == 2).sum()) < dm.MIN_CORE_PX
    assert r["resample"] == {
        "input_um_per_px": 1.6, "model_um_per_px": 1.28,
        "factor": pytest.approx(1.25), "model_w": 1000, "model_h": 900,
    }


def test_min_core_px_is_applied_at_model_scale_in_both_directions():
    # 2.56 um/px: a 5 000 px core is ~20 000 px at 1.28 -> defined
    coarse = _scene(500, 520, 40, 80)
    plan, _ = dsc.plan_resample(520, 500, 2.56)
    r = dsc.read_out(*dsc.predict_on_model_grid(_frame(coarse), plan, _IntensityModel()), plan)
    assert r["area_core_px"] < dm.MIN_CORE_PX  # counted on the uploaded grid
    assert r["reference"] == "core"
    assert dm.raster_metrics(coarse, 520, 500)["reference"] == "core_too_small"

    # 0.64 um/px: a ~30 000 px core is ~7 500 px at 1.28 -> undefined
    fine = _scene(700, 740, 98, 180)
    assert (fine == 2).sum() > dm.MIN_CORE_PX
    plan, _ = dsc.plan_resample(740, 700, 0.64)
    r = dsc.read_out(*dsc.predict_on_model_grid(_frame(fine), plan, _IntensityModel()), plan)
    assert r["reference"] == "core_too_small"
    assert r["area_core_px"] > dm.MIN_CORE_PX  # still the uploaded grid's count
    assert "resample" in r


def test_scale_warnings_are_evaluated_after_resampling():
    # 2560 x 2560 at 1.024 um/px is 2048 x 2048 at 1.28: nothing to warn about
    plan, _ = dsc.plan_resample(2560, 2560, 1.024)
    assert (plan.model_width, plan.model_height) == (2048, 2048)
    m = np.zeros((2048, 2048), np.uint8)
    assert dsc.read_out(np.zeros((2560, 2560), np.uint8), m, plan)["warnings"] == []
    # a frame that is still not 2048^2 at 1.28 says so, at the resampled size,
    # and never warns about the pixel size it just corrected
    plan, _ = dsc.plan_resample(1000, 1000, 2.0)
    r = dsc.read_out(np.zeros((1000, 1000), np.uint8),
                     np.zeros((plan.model_height, plan.model_width), np.uint8), plan)
    assert len(r["warnings"]) == 1
    assert "1562x1562" in r["warnings"][0] and "after resampling" in r["warnings"][0]
    assert "pixel size is" not in r["warnings"][0]


def test_extra_warnings_reach_the_read_out():
    plan, warnings = dsc.plan_resample(2048, 2048, 0.2)
    m = np.zeros((64, 64), np.uint8)
    r = dsc.read_out(m, m, plan, extra_warnings=warnings)
    assert r["warnings"][-1] == warnings[0]


# --------------------------------------------------------------------------
# the polygon fallback: an edited image is scored where a fresh one was
# --------------------------------------------------------------------------


def _polygons(mask: np.ndarray, value_test) -> list:
    sel = value_test(mask).astype(np.uint8)
    contours, _ = cv2.findContours(sel, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return [c[:, 0, :].astype(float).tolist() for c in contours if len(c) >= 3]


def test_the_fallback_without_a_pixel_size_is_unchanged():
    mask = _scene(600, 640, 90, 160)
    req = mep.DisintegrationRequest(
        mask_polygons=_polygons(mask, lambda m: m > 0),
        core_polygons=_polygons(mask, lambda m: m == 2),
        image_width=640, image_height=600,
    )
    resp = mep.disintegration_index(req)
    assert resp.resample is None
    canvas = np.zeros((600, 640), np.uint8)
    mep._fill_valid(canvas, req.mask_polygons, 1)
    mep._fill_valid(canvas, req.core_polygons, 2)
    ref = dm.raster_metrics(canvas, 640, 600)
    assert resp.index_b == ref["index_B"] and resp.di == ref["DI"]
    assert resp.n_pixels == ref["area_total_px"]


def test_an_edited_image_is_scored_like_a_fresh_one():
    mask = _scene(900, 1000, 80, 170)
    small = cv2.resize(_frame(mask), (800, 720), interpolation=cv2.INTER_AREA)
    plan, _ = dsc.plan_resample(800, 720, 1.6)
    m_orig, m_model = dsc.predict_on_model_grid(small, plan, _IntensityModel())
    fresh = dsc.read_out(m_orig, m_model, plan)

    req = dict(
        mask_polygons=_polygons(m_orig, lambda m: m > 0),
        core_polygons=_polygons(m_orig, lambda m: m == 2),
        image_width=800, image_height=720,
    )
    scored = mep.disintegration_index(mep.DisintegrationRequest(**req, pixel_size_um=1.6))
    assert scored.reference == "core"
    assert scored.index_b == pytest.approx(fresh["index_B"], abs=0.01)
    assert scored.resample == plan.info()
    assert not any("pixel size is" in w for w in scored.warnings)
    # n_pixels is the image grid's count, like the fresh read-out's areas
    assert scored.n_pixels == pytest.approx(fresh["area_total_px"], rel=0.01)

    # without the pixel size the same polygons fall below MIN_CORE_PX
    unscaled = mep.disintegration_index(mep.DisintegrationRequest(**req))
    assert unscaled.reference == "core_too_small" and unscaled.resample is None


# --------------------------------------------------------------------------
# the route: the field reaches this model and no other
# --------------------------------------------------------------------------


class _RecordingLoader:
    AVAILABLE_MODELS = {"spheroid_disintegration": {}, "hrnet": {}}
    device = "cpu"

    def __init__(self):
        self.calls = []

    def predict_disintegration(self, *a, **k):
        self.calls.append(("predict_disintegration", a, k))
        return {"polygons": []}

    def predict(self, *a, **k):
        self.calls.append(("predict", a, k))
        return {"polygons": []}


def _png(w=32, h=24) -> bytes:
    buf = io.BytesIO()
    Image.new("L", (w, h), 128).save(buf, format="PNG")
    return buf.getvalue()


def test_dispatch_hands_the_pixel_size_to_the_disintegration_model_only():
    loader = _RecordingLoader()
    image = Image.open(io.BytesIO(_png()))
    routes._dispatch_inference(
        loader, "spheroid_disintegration", image, 0.5, True, (), 2.56, 4096
    )
    name, _, kwargs = loader.calls[-1]
    assert name == "predict_disintegration"
    assert kwargs == {"um_per_px": 2.56, "max_pixels": 4096}

    # the six-argument call every other caller makes still works, unchanged
    routes._dispatch_inference(loader, "spheroid_disintegration", image, 0.5, True)
    assert loader.calls[-1][2] == {"um_per_px": None, "max_pixels": None}
    routes._dispatch_inference(loader, "hrnet", image, 0.5, True, (), 2.56)
    assert loader.calls[-1][0] == "predict"
    assert "um_per_px" not in loader.calls[-1][2]


def _segment(loader, model: str, pixel_size_um, max_pixels=None):
    from fastapi import UploadFile

    return routes.segment_image(
        file=UploadFile(file=io.BytesIO(_png()), filename="frame.png"),
        model=model,
        threshold=0.5,
        detect_holes=True,
        page=0,
        max_pixels=max_pixels,
        extra_channels=None,
        pixel_size_um=pixel_size_um,
        loader=loader,
    )


def test_a_pixel_size_for_another_model_is_refused():
    from fastapi import HTTPException

    loader = _RecordingLoader()
    with pytest.raises(HTTPException) as err:
        asyncio.run(_segment(loader, "hrnet", 1.0))
    assert err.value.status_code == 400
    assert "pixel_size_um" in str(err.value.detail)
    assert loader.calls == []  # refused before any inference


def test_the_route_threads_the_pixel_size_and_ceiling_through():
    loader = _RecordingLoader()
    result = asyncio.run(_segment(loader, "spheroid_disintegration", 0.9, 10_000))
    assert result["success"] is True
    assert loader.calls[-1][0] == "predict_disintegration"
    assert loader.calls[-1][2] == {"um_per_px": 0.9, "max_pixels": 10_000}
    # and without one, the model is called as it always was
    asyncio.run(_segment(loader, "spheroid_disintegration", None))
    assert loader.calls[-1][2] == {"um_per_px": None, "max_pixels": None}
