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
