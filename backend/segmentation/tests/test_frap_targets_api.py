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
