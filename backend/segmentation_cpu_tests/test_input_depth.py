"""High-bit-depth frames reach the 8-bit models stretched, not clipped.

Imports the REAL `api.input_depth` and the REAL `api.routes` dispatch, so what
is tested is what `/segment` runs. See `input_depth`'s docstring for the
production measurement behind every number here.
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from test_inference_serialisation import routes  # the real module, torch-safe

from api import input_depth
from api.input_depth import open_image_page, prepare_for_model, stretch_to_uint8


def _camera_frame(dtype=np.uint16, hot_pixel=None):
    """A 12-bit-camera-like frame: a dark disc on a bright, graded field."""
    yy, xx = np.mgrid[0:200, 0:240]
    field = 3000 + 4.0 * xx + 1.5 * yy  # 3000..4258, never near 255
    disc = (yy - 100) ** 2 + (xx - 120) ** 2 < 45**2
    frame = np.where(disc, 900 + 2.0 * xx, field)
    if hot_pixel is not None:
        frame[5, 7] = hot_pixel
    return frame.astype(dtype)


def test_pillow_really_does_clip_which_is_the_bug_being_fixed():
    # If a Pillow upgrade ever starts rescaling here, this whole module is
    # redundant and this test says so.
    image = Image.fromarray(_camera_frame())
    assert image.mode in ("I;16", "I;16L", "I;16N")
    seen = np.asarray(image.convert("L"))
    assert seen.min() == 255 and seen.max() == 255


def test_a_16_bit_frame_keeps_its_contrast():
    frame = _camera_frame()
    out, info = stretch_to_uint8(Image.fromarray(frame))

    pixels = np.asarray(out)
    assert out.mode == "L" and pixels.dtype == np.uint8
    assert pixels.shape == frame.shape
    assert len(np.unique(pixels)) > 100
    # The disc is still darker than the field, by a wide margin.
    assert pixels[100, 120] + 100 < pixels[20, 20]
    # Order is preserved everywhere: a stretch, not a remap.
    flat_in, flat_out = frame.ravel(), pixels.ravel().astype(int)
    order = np.argsort(flat_in, kind="stable")
    assert np.all(np.diff(flat_out[order]) >= 0)

    assert info["from_mode"] == out_mode_of(frame)
    assert info["method"] == "percentile_stretch"
    assert (info["low_percentile"], info["high_percentile"]) == (0.1, 99.9)
    assert info["low"] == pytest.approx(np.percentile(frame, 0.1))
    assert info["high"] == pytest.approx(np.percentile(frame, 99.9))


def out_mode_of(frame):
    return Image.fromarray(frame).mode


def test_one_hot_pixel_does_not_set_the_scale():
    # The reason this is a percentile stretch and not min-max: on a real
    # production frame the maximum was 51 586 against a p99.9 of 16 851.
    clean, _ = stretch_to_uint8(Image.fromarray(_camera_frame()))
    hot, _ = stretch_to_uint8(Image.fromarray(_camera_frame(hot_pixel=60000)))

    a, b = np.asarray(clean).astype(int), np.asarray(hot).astype(int)
    assert np.abs(a - b).max() <= 1 or (np.abs(a - b) > 1).sum() == 1
    assert b[5, 7] == 255

    # Min-max, for contrast, would have crushed the field into the bottom of
    # the range.
    frame = _camera_frame(hot_pixel=60000).astype(float)
    minmax = (frame - frame.min()) / (frame.max() - frame.min()) * 255
    assert minmax[20, 20] < 20 < b[20, 20]


@pytest.mark.parametrize("dtype,mode", [(np.int32, "I"), (np.float32, "F")])
def test_32_bit_and_float_frames_are_stretched_too(dtype, mode):
    image = Image.fromarray(_camera_frame(dtype))
    assert image.mode == mode
    out, info = stretch_to_uint8(image)
    assert info["from_mode"] == mode
    assert len(np.unique(np.asarray(out))) > 100


def test_a_big_endian_tiff_is_stretched_with_its_values_read_correctly():
    # One of the three production frames is exactly this: a big-endian 16-bit
    # TIFF, which Pillow opens as "I;16B". Reading it with the wrong byte
    # order would still produce 256 levels - of noise - so compare with the
    # little-endian result rather than counting levels.
    import io

    import tifffile

    frame = _camera_frame()
    buffer = io.BytesIO()
    tifffile.imwrite(buffer, frame, byteorder=">")
    big = Image.open(io.BytesIO(buffer.getvalue()))
    assert big.mode == "I;16B"

    out, info = stretch_to_uint8(big)
    reference, _ = stretch_to_uint8(Image.fromarray(frame))

    assert info["from_mode"] == "I;16B"
    assert np.array_equal(np.asarray(out), np.asarray(reference))


def test_non_finite_float_pixels_do_not_poison_the_stretch():
    frame = _camera_frame(np.float32)
    frame[0, 0], frame[0, 1], frame[0, 2] = np.nan, np.inf, -np.inf
    out, info = stretch_to_uint8(Image.fromarray(frame))
    pixels = np.asarray(out)
    assert np.isfinite(info["low"]) and np.isfinite(info["high"])
    assert (pixels[0, 0], pixels[0, 1], pixels[0, 2]) == (0, 255, 0)
    assert len(np.unique(pixels)) > 100


def test_a_flat_frame_becomes_mid_grey_not_noise():
    out, info = stretch_to_uint8(Image.fromarray(np.full((8, 9), 4000, np.uint16)))
    assert np.unique(np.asarray(out)).tolist() == [128]
    assert info["low"] == info["high"] == 4000


@pytest.mark.parametrize("mode", ["L", "RGB", "RGBA", "P", "CMYK", "1"])
def test_8_bit_input_is_returned_as_the_very_same_object(mode):
    image = Image.new(mode, (12, 10))
    out, info = stretch_to_uint8(image)
    assert out is image and info is None


def test_the_models_that_read_native_depth_are_left_alone():
    image = Image.fromarray(_camera_frame())
    for model in ("microtubule", "neurite_soma"):
        out, info = prepare_for_model(image, model)
        assert out is image and info is None
    assert input_depth.NATIVE_DEPTH_MODELS == {"microtubule", "neurite_soma"}


class _RecordingLoader:
    """Records the image each branch of the dispatch was handed."""

    def __init__(self):
        self.seen = {}

    def _record(self, name, image):
        self.seen[name] = image
        return {"polygons": [], "polylines": []}

    def predict(self, image, model, *a, **k):
        return self._record(model, image)

    def predict_sperm(self, image, model_name=None, **k):
        return self._record(model_name, image)

    def predict_wound(self, image, *a, **k):
        return self._record("wound", image)

    def predict_microcapsule(self, image, *a, **k):
        return self._record("microcapsule", image)

    def predict_disintegration(self, image, *a, **k):
        return self._record("spheroid_disintegration", image)

    def predict_microtubule(self, image, *a, **k):
        return self._record("microtubule", image)

    def predict_neurite_soma(self, image, *a, **k):
        return self._record("neurite_soma", image)


EIGHT_BIT_MODELS = [
    "hrnet",
    "cbam_resunet",
    "unet_spherohq",
    "segformer",
    "mamba_unet",
    "sperm",
    "sperm_2part",
    "wound",
    "microcapsule",
    "spheroid_disintegration",
]


def test_every_model_is_accounted_for():
    # 12 models in the registry: these ten plus the two native-depth ones. A
    # thirteenth must be put on one side or the other deliberately.
    assert len(EIGHT_BIT_MODELS) == 10
    assert not set(EIGHT_BIT_MODELS) & input_depth.NATIVE_DEPTH_MODELS
    assert len(set(EIGHT_BIT_MODELS) | input_depth.NATIVE_DEPTH_MODELS) == 12


@pytest.mark.parametrize("model", EIGHT_BIT_MODELS)
def test_the_real_dispatch_hands_8_bit_models_a_stretched_frame(model):
    loader = _RecordingLoader()
    source = Image.fromarray(_camera_frame())

    result = routes._dispatch_inference(loader, model, source, 0.5, True)

    seen = loader.seen[model]
    assert seen.mode == "L"
    assert len(np.unique(np.asarray(seen))) > 100
    assert result["input_conversion"]["method"] == "percentile_stretch"


@pytest.mark.parametrize("model", sorted(input_depth.NATIVE_DEPTH_MODELS))
def test_the_real_dispatch_hands_native_models_the_original(model):
    loader = _RecordingLoader()
    source = Image.fromarray(_camera_frame())

    result = routes._dispatch_inference(loader, model, source, 0.5, True)

    assert loader.seen[model] is source
    assert "input_conversion" not in result


@pytest.mark.parametrize("model", EIGHT_BIT_MODELS)
def test_the_real_dispatch_does_not_touch_8_bit_input(model):
    loader = _RecordingLoader()
    source = Image.new("RGB", (16, 12))

    result = routes._dispatch_inference(loader, model, source, 0.5, True)

    assert loader.seen[model] is source
    assert "input_conversion" not in result



# --- opening the upload ----------------------------------------------------


def _tiff_stack(pages):
    import io

    import tifffile

    buffer = io.BytesIO()
    tifffile.imwrite(buffer, np.stack(pages), photometric="minisblack")
    return buffer.getvalue()


def _png(array):
    import io

    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, "PNG")
    return buffer.getvalue()


def test_a_single_image_is_page_0_of_1():
    image, pages = open_image_page(_png(np.zeros((6, 5), np.uint8)))
    assert pages == 1 and image.size == (5, 6)


def test_each_page_of_a_stack_can_be_selected():
    stack = _tiff_stack([np.full((6, 5), 1000 * (i + 1), np.uint16) for i in range(3)])
    for page in range(3):
        image, pages = open_image_page(stack, page)
        assert pages == 3
        assert np.unique(np.asarray(image)).tolist() == [1000 * (page + 1)]


def test_a_page_past_the_end_is_the_callers_error():
    from fastapi import HTTPException

    stack = _tiff_stack([np.zeros((4, 4), np.uint16)] * 2)
    with pytest.raises(HTTPException) as caught:
        open_image_page(stack, 2)
    assert caught.value.status_code == 400
    assert "2 page(s)" in caught.value.detail


@pytest.mark.parametrize(
    "data",
    [b"", b"this is not an image", b"\x89PNG\r\n\x1a\n" + b"\x00" * 16],
    ids=["empty", "text", "png-magic-then-garbage"],
)
def test_bytes_that_are_not_an_image_are_a_400_not_a_500(data):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as caught:
        open_image_page(data)
    assert caught.value.status_code == 400


def test_opening_does_not_decode_the_pixels():
    # See the note in `open_image_page`: decoding belongs on the executor.
    # A PNG truncated AFTER its header therefore still opens here.
    rng = np.random.default_rng(0)
    whole = _png(rng.integers(0, 255, (300, 300), dtype=np.uint8))
    image, pages = open_image_page(whole[: len(whole) // 2])
    assert pages == 1 and image.size == (300, 300)


# --- the real route --------------------------------------------------------


class _Upload:
    def __init__(self, data, filename="frame.tif"):
        self._data, self.filename, self.content_type = data, filename, None

    async def read(self):
        return self._data


class _RouteLoader(_RecordingLoader):
    AVAILABLE_MODELS = {name: {} for name in EIGHT_BIT_MODELS}
    device = "cpu"


def _segment(loader, data, **form):
    import asyncio

    params = {
        "model": "hrnet",
        "threshold": 0.5,
        "detect_holes": True,
        "page": 0,
        "max_pixels": None,
    }
    params.update(form)
    return asyncio.run(
        routes.segment_image(file=_Upload(data), loader=loader, **params)
    )


def test_the_route_segments_the_requested_page_and_reports_the_count():
    stack = _tiff_stack(
        [_camera_frame(), _camera_frame()[::-1].copy(), _camera_frame()]
    )
    loader = _RouteLoader()

    result = _segment(loader, stack, page=1)

    assert (result["page"], result["page_count"]) == (1, 3)
    expected, _ = stretch_to_uint8(Image.fromarray(_camera_frame()[::-1].copy()))
    assert np.array_equal(np.asarray(loader.seen["hrnet"]), np.asarray(expected))


def test_the_route_defaults_to_page_0():
    stack = _tiff_stack([_camera_frame(), _camera_frame()[::-1].copy()])
    loader = _RouteLoader()
    result = _segment(loader, stack)
    assert (result["page"], result["page_count"]) == (0, 2)
    expected, _ = stretch_to_uint8(Image.fromarray(_camera_frame()))
    assert np.array_equal(np.asarray(loader.seen["hrnet"]), np.asarray(expected))


def test_the_route_refuses_an_unknown_model_before_reading_the_image():
    from fastapi import HTTPException

    loader = _RouteLoader()
    with pytest.raises(HTTPException) as caught:
        _segment(loader, b"not even an image", model="no_such_model")
    assert caught.value.status_code == 400
    assert "no_such_model" in caught.value.detail
    assert loader.seen == {}


@pytest.mark.parametrize("page", [2, 99])
def test_the_route_refuses_a_page_past_the_end(page):
    from fastapi import HTTPException

    loader = _RouteLoader()
    with pytest.raises(HTTPException) as caught:
        _segment(loader, _tiff_stack([_camera_frame()] * 2), page=page)
    assert caught.value.status_code == 400
    assert loader.seen == {}


def test_the_route_answers_400_for_bytes_that_are_not_an_image():
    from fastapi import HTTPException

    loader = _RouteLoader()
    with pytest.raises(HTTPException) as caught:
        _segment(loader, b"plain text with a .tif name")
    assert caught.value.status_code == 400
    assert loader.seen == {}


def test_the_route_refuses_an_image_over_the_callers_pixel_ceiling():
    from fastapi import HTTPException

    loader = _RouteLoader()
    frame = _png(np.zeros((30, 40), np.uint8))  # 1200 px

    with pytest.raises(HTTPException) as caught:
        _segment(loader, frame, max_pixels=1199)
    assert caught.value.status_code == 413
    assert caught.value.detail == {
        "error": "image_too_large",
        "width": 40,
        "height": 30,
        "pixels": 1200,
        "max_pixels": 1199,
    }
    assert loader.seen == {}

    # Exactly at the ceiling is allowed, and so is no ceiling at all.
    assert _segment(loader, frame, max_pixels=1200)["success"] is True
    assert _segment(loader, frame)["success"] is True


def test_the_route_answers_400_for_a_file_truncated_after_its_header():
    # It opens (the header is intact) and fails only when decoded. That used
    # to happen inside a model's preprocessing and surface as a 500.
    from fastapi import HTTPException

    rng = np.random.default_rng(0)
    whole = _png(rng.integers(0, 255, (300, 300), dtype=np.uint8))
    loader = _RouteLoader()

    with pytest.raises(HTTPException) as caught:
        _segment(loader, whole[: len(whole) // 2])

    assert caught.value.status_code == 400
    assert "could not be decoded" in caught.value.detail
    assert loader.seen == {}
    # The lock is not left held by the failure.
    assert not routes._inference_lock.locked()
    assert _segment(loader, whole)["success"] is True
