"""The FRAP endpoint, with the model stubbed — wiring, not inference."""
import io
import numpy as np
import pytest
import tifffile
from fastapi import FastAPI
from fastapi.testclient import TestClient


class _StubLoader:
    """Returns two clean horizontal filaments, in the real response shape."""

    def predict_microtubule(self, image, *args, **kwargs):
        def line(y):
            return {"id": f"polyline_{y}", "instanceId": f"mt_{y}",
                    "points": [{"x": 100.0, "y": float(y)}, {"x": 400.0, "y": float(y)}],
                    "class": "microtubule", "geometry": "polyline"}
        return {"polylines": [line(150), line(450)], "success": True}


@pytest.fixture
def client():
    from api import frap_targets
    from api.routes import get_model_loader
    app = FastAPI()
    app.include_router(frap_targets.router, prefix="/api/v1")
    app.dependency_overrides[get_model_loader] = lambda: _StubLoader()
    return TestClient(app)


def _tiff_bytes(pages):
    buf = io.BytesIO()
    tifffile.imwrite(buf, np.stack(pages).astype(np.uint16))
    return buf.getvalue()


def test_returns_spots_for_a_single_page_frame(client):
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("frame.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1", "k_max": "10"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["n_polylines"] == 2
    assert len(body["spots"]) == 2
    assert body["coordinate_order"] == "x=col, y=row, in input image pixels"
    assert set(body["rejected_by"]) >= {"length", "bleach_clearance", "readout_clearance"}
    assert set(body["dropped_by"]) >= {"separation", "budget"}


def test_um_per_px_is_required(client):
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("frame.tif", _tiff_bytes([page]), "image/tiff")},
                    data={})
    assert r.status_code == 422


def test_selects_the_named_irm_page_from_a_multipage_tiff(client):
    irm = np.zeros((600, 600), dtype=np.uint16)
    fluor = np.full((600, 600), 100, dtype=np.uint16)
    fluor[145:156, 100:401] = 900          # decorate only the y=150 filament
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", _tiff_bytes([irm, fluor]), "image/tiff")},
                    data={"um_per_px": "0.1", "irm_page": "0", "fluor_page": "1",
                          "k_min": "1", "k_max": "10"})
    assert r.status_code == 200
    ys = [round(s["y"]) for s in r.json()["spots"]]
    assert ys == [150]                      # the undecorated one is dropped


def test_a_page_index_outside_the_file_is_a_400(client):
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "irm_page": "7"})
    assert r.status_code == 400
    assert "page" in r.json()["detail"].lower()


def test_params_json_override_reaches_selection(client):
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("frame.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1", "k_max": "10",
                          "params_json": '{"r_iso_um": 35.0}'})
    assert r.status_code == 200
    body = r.json()
    # The stub's two filaments sit 300 px (30 um) apart in y. With the default
    # r_iso_um (3.0), test_returns_spots_for_a_single_page_frame gets 2 spots on
    # this same image -- that separation clears easily. Widening r_iso_um past
    # 30 um makes each filament's readout window reach across to the other one,
    # so both candidates get rejected on readout_clearance instead. Zero spots
    # here is proof the override actually reached select_spots, not just that
    # the JSON was accepted.
    assert body["spots"] == []
    assert body["rejected_by"]["readout_clearance"] > 0


def test_params_json_rejects_an_unknown_key(client):
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("frame.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "params_json": '{"not_a_param": 1}'})
    assert r.status_code == 400
    assert "not_a_param" in r.json()["detail"]


def test_params_json_must_be_a_json_object(client):
    page = np.zeros((600, 600), dtype=np.uint16)
    for bad_params_json in ("null", "5"):
        r = client.post("/api/v1/frap/targets",
                        files={"file": ("frame.tif", _tiff_bytes([page]), "image/tiff")},
                        data={"um_per_px": "0.1", "params_json": bad_params_json})
        assert r.status_code == 400, (
            f"params_json={bad_params_json!r} should be 400, got {r.status_code}: "
            f"{r.text}")


def _post_params(client, params_json):
    page = np.zeros((600, 600), dtype=np.uint16)
    return client.post("/api/v1/frap/targets",
                       files={"file": ("frame.tif", _tiff_bytes([page]), "image/tiff")},
                       data={"um_per_px": "0.1", "k_min": "1", "k_max": "10",
                             "params_json": params_json})


def test_params_json_step_px_zero_is_a_400_naming_the_key(client):
    # Measured: step_px=0 divides by zero inside resample_polyline and
    # _baseline_indices, so the operator got a 500 carrying a bare correlation ID.
    # "Is the key known" was the only check before the value was splatted into a
    # frozen dataclass, and this endpoint is about to become the only externally
    # reachable route to the service.
    r = _post_params(client, '{"step_px": 0}')
    assert r.status_code == 400, r.text
    assert "step_px" in r.json()["detail"]


def test_params_json_a_string_in_a_float_field_is_a_400_naming_the_key(client):
    # A TypeError raised deep inside numpy is not a message anybody can act on.
    r = _post_params(client, '{"r_iso_um": "three"}')
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "r_iso_um" in detail
    assert "number" in detail


def test_params_json_an_absurdly_fine_step_px_is_a_400_not_hours_of_cpu(client):
    # Measured: step_px=0.2 costs 11.03 s against 0.23 s at the default on five
    # filaments, so step_px=0.02 on a real 100-filament frame is hours of CPU on a
    # SHARED GPU host. Rate-limiting by request COUNT cannot bound that -- one
    # request is enough -- so the bound has to be on the value itself.
    r = _post_params(client, '{"step_px": 0.02}')
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "step_px" in detail
    assert "0.25" in detail


def test_params_json_a_non_finite_value_is_a_400(client):
    # json.loads accepts the NaN and Infinity literals by default, and NaN reaches
    # int(round(...)) as a ValueError rather than as anything a caller can read.
    for bad in ('{"step_px": NaN}', '{"r_iso_um": Infinity}'):
        r = _post_params(client, bad)
        assert r.status_code == 400, f"{bad} -> {r.status_code}: {r.text}"
        assert "finite" in r.json()["detail"]


def test_params_json_a_zero_or_negative_um_length_is_a_400(client):
    # Every physical criterion is a length in micrometres. Zero or negative is not a
    # loose setting, it is an isolation criterion switched off by accident.
    for bad in ('{"r_iso_um": 0}', '{"spot_len_um": -1.0}'):
        r = _post_params(client, bad)
        assert r.status_code == 400, f"{bad} -> {r.status_code}: {r.text}"
        assert "greater than zero" in r.json()["detail"]


def test_params_json_an_out_of_range_f_mid_is_a_400(client):
    r = _post_params(client, '{"f_mid": 1.5}')
    assert r.status_code == 400, r.text
    assert "f_mid" in r.json()["detail"]


def test_params_json_a_fractional_int_field_is_a_400(client):
    # band_thickness_px is an int on the dataclass and an int in mt_measure's
    # rasteriser. Silently truncating 7.5 would rasterise a different band width
    # than the caller asked for and never say so.
    r = _post_params(client, '{"band_thickness_px": 7.5}')
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "band_thickness_px" in detail
    assert "whole number" in detail


def test_params_json_a_bad_spot_shape_is_a_400(client):
    r = _post_params(client, '{"spot_shape": "hexagon"}')
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "spot_shape" in detail
    assert "ellipse" in detail


def test_params_json_a_valid_in_range_override_is_accepted_and_applied(client):
    # The other side of the boundary: validation must not become a wall. A coarser
    # resampling pitch is a legitimate setting and must still reach select_spots --
    # proved by the candidate count dropping, not merely by the 200.
    baseline = _post_params(client, "{}")
    coarse = _post_params(client, '{"step_px": 4.0, "band_thickness_px": 7}')
    assert baseline.status_code == 200, baseline.text
    assert coarse.status_code == 200, coarse.text
    assert coarse.json()["n_candidates"] < baseline.json()["n_candidates"]
    assert len(coarse.json()["spots"]) == 2


def test_mask_is_returned_and_is_a_png(client):
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1", "include_mask": "true"})
    import base64
    blob = base64.b64decode(r.json()["mask_png_b64"])
    assert blob[:8] == b"\x89PNG\r\n\x1a\n"


def test_mask_has_one_connected_blob_per_spot(client):
    from skimage.measure import label
    from PIL import Image as PILImage
    import base64
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1", "include_mask": "true"})
    body = r.json()
    mask = np.array(PILImage.open(io.BytesIO(base64.b64decode(body["mask_png_b64"]))))
    assert label(mask > 0).max() == len(body["spots"])


def test_overlay_is_omitted_unless_asked_for(client):
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1"})
    assert r.json()["overlay_png_b64"] is None
    r2 = client.post("/api/v1/frap/targets",
                     files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
                     data={"um_per_px": "0.1", "k_min": "1", "include_overlay": "true"})
    import base64
    assert base64.b64decode(r2.json()["overlay_png_b64"])[:8] == b"\x89PNG\r\n\x1a\n"


class _ShortFilamentLoader:
    """One filament, 5 px = 0.5 um long -- well under the default l_min_um=5.0, so
    it is guaranteed to be rejected at the length gate and produce exactly one
    RejectedFilament with reason="length"."""

    def predict_microtubule(self, image, *args, **kwargs):
        return {"polylines": [
            {"id": "polyline_short", "instanceId": "mt_short",
             "points": [{"x": 100.0, "y": 300.0}, {"x": 105.0, "y": 300.0}],
             "class": "microtubule", "geometry": "polyline"},
        ], "success": True}


def test_rejected_filaments_pass_through_to_the_overlay_renderer():
    # A wiring-line test, not a byte-content test: asserts the *interaction*
    # between the endpoint and the renderer, since a pass-through argument can be
    # typo'd (e.g. to `()`) and every other test here would still pass -- the stub
    # loader used elsewhere never produces a rejected filament, so nothing else
    # exercises this line.
    import base64
    from unittest.mock import patch
    from PIL import Image as PILImage
    from api import frap_targets
    from api.routes import get_model_loader

    app = FastAPI()
    app.include_router(frap_targets.router, prefix="/api/v1")
    app.dependency_overrides[get_model_loader] = lambda: _ShortFilamentLoader()
    local_client = TestClient(app)

    tiny_buf = io.BytesIO()
    PILImage.new("RGB", (2, 2), (0, 0, 0)).save(tiny_buf, format="PNG")
    tiny_png = tiny_buf.getvalue()

    page = np.zeros((600, 600), dtype=np.uint16)
    with patch("api.frap_render.render_overlay_png", return_value=tiny_png) as mock_render:
        r = local_client.post(
            "/api/v1/frap/targets",
            files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
            data={"um_per_px": "0.1", "k_min": "1", "include_overlay": "true"})

    assert r.status_code == 200
    mock_render.assert_called_once()
    rejected_arg = mock_render.call_args.kwargs["rejected"]
    assert len(rejected_arg) == 1
    assert rejected_arg[0].reason == "length"
    assert base64.b64decode(r.json()["overlay_png_b64"]) == tiny_png
