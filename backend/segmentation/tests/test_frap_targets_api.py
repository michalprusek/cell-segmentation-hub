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


def test_each_spot_carries_the_models_own_instance_id(client):
    # frap_spots.json exists for offline analysis, and mt_index alone is an index
    # into a list the response does not contain -- so nothing in the file could be
    # joined back to the segmentation that produced it. The stub's instanceIds are
    # mt_150 and mt_450, one per filament, in the order the polylines arrive.
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1", "k_max": "10"})
    assert r.status_code == 200, r.text
    spots = r.json()["spots"]
    assert len(spots) == 2
    expected = {0: "mt_150", 1: "mt_450"}
    for spot in spots:
        assert "mt_index" in spot          # kept alongside, not replaced by the id
        assert spot["mt_instance_id"] == expected[spot["mt_index"]]


class _OneDegeneratePolylineLoader:
    """A single-point polyline first, then two usable filaments.

    _polylines_from FILTERS anything with fewer than two points, and mt_index is an
    index into what SURVIVES that filter. Collecting the instance ids in a separate
    pass over the unfiltered list would therefore shift every id by one -- so this
    frame is the one that tells a correct implementation from a plausible one.
    """

    def predict_microtubule(self, image, *args, **kwargs):
        def line(y, name):
            return {"id": f"polyline_{y}", "instanceId": name,
                    "points": [{"x": 100.0, "y": float(y)}, {"x": 400.0, "y": float(y)}],
                    "class": "microtubule", "geometry": "polyline"}
        return {"polylines": [
            {"id": "polyline_degenerate", "instanceId": "mt_DROPPED",
             "points": [{"x": 10.0, "y": 10.0}],
             "class": "microtubule", "geometry": "polyline"},
            line(150, "mt_FIRST"),
            line(450, "mt_SECOND"),
        ], "success": True}


def test_instance_ids_survive_the_short_polyline_filter_in_step():
    page = np.zeros((600, 600), dtype=np.uint16)
    r = _client_with(_OneDegeneratePolylineLoader()).post(
        "/api/v1/frap/targets",
        files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
        data={"um_per_px": "0.1", "k_min": "1", "k_max": "10"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_polylines"] == 2, "the one-point polyline must not be counted"
    got = {s["mt_index"]: s["mt_instance_id"] for s in body["spots"]}
    assert got == {0: "mt_FIRST", 1: "mt_SECOND"}


def _client_with(loader):
    from api import frap_targets
    from api.routes import get_model_loader
    app = FastAPI()
    app.include_router(frap_targets.router, prefix="/api/v1")
    app.dependency_overrides[get_model_loader] = lambda: loader
    return TestClient(app)


class _OomLoader:
    """What a real CUDA OOM looks like here: a bare RuntimeError.

    predict_microtubule wraps nothing -- unlike predict_wound, which converts
    torch.cuda.OutOfMemoryError into InferenceError -- so this, not InferenceError,
    is what the endpoint actually receives when the GPU is full.
    """

    def predict_microtubule(self, image, *args, **kwargs):
        raise RuntimeError(
            "CUDA out of memory. Tried to allocate 2.00 GiB (GPU 0; 23.68 GiB total)")


class _NotLoadedLoader:
    def predict_microtubule(self, image, *args, **kwargs):
        raise ValueError("Microtubule model not loaded. Run load_model('microtubule')")


class _TimingOutLoader:
    def predict_microtubule(self, image, *args, **kwargs):
        from ml.inference_executor import InferenceTimeoutError
        raise InferenceTimeoutError("microtubule", 60.0, (600, 600))


class _FailingLoader:
    def predict_microtubule(self, image, *args, **kwargs):
        from ml.inference_executor import InferenceError
        raise InferenceError("CUDA out of memory")


def _post_with(loader, pages=None, **form):
    """POST one frame at the defaults, overriding any form field by keyword."""
    data = {"um_per_px": "0.1", "k_min": "1"}
    data.update(form)
    if pages is None:
        pages = [np.zeros((600, 600), dtype=np.uint16)]
    return _client_with(loader).post(
        "/api/v1/frap/targets",
        files={"file": ("f.tif", _tiff_bytes(pages), "image/tiff")},
        data=data)


@pytest.mark.parametrize("loader, needle", [
    (_OomLoader(), "CUDA out of memory"),
    (_NotLoadedLoader(), "not loaded"),
])
def test_the_failures_that_really_happen_are_a_500_an_operator_can_read(loader, needle):
    # The regression this pins: the endpoint caught only InferenceError and
    # InferenceTimeoutError, and predict_microtubule raises NEITHER. A real CUDA OOM
    # is a bare RuntimeError and a missing model a bare ValueError, so both fell
    # through to the global handler and reached the microscope as
    # `{"detail": "Internal error (id: ab12cd34)"}` -- which is also what a malformed
    # request produces, i.e. exactly the confusion the error mapping exists to
    # prevent. The previous tests passed only because their fakes raised the two
    # classes the handler expected.
    r = _post_with(loader)
    assert r.status_code == 500, r.text
    detail = str(r.json()["detail"])
    assert needle in detail, detail
    assert "600x600" in detail, detail        # names the frame it failed on
    assert "server-side" in detail, detail    # and says it is not the operator's file
    assert "id:" not in detail, detail        # never the bare correlation ID


def test_a_timeout_shaped_error_is_a_500_because_no_timeout_can_fire():
    # There is deliberately no 504 branch: predict_microtubule takes a `timeout`
    # argument and never reads it -- no executor, no wait -- so InferenceTimeoutError
    # is unreachable on this path and a handler for it only disguised the fact that
    # no timeout exists. This test exists so that removing the branch stays a
    # decision; if an executor is ever put behind that call, replace it with a 504
    # assertion and restore the clause ABOVE the InferenceError one.
    r = _post_with(_TimingOutLoader())
    assert r.status_code == 500, r.text
    assert "timed out" in str(r.json()["detail"])


def test_an_inference_failure_is_a_500_carrying_the_models_own_message():
    page = np.zeros((600, 600), dtype=np.uint16)
    r = _client_with(_FailingLoader()).post(
        "/api/v1/frap/targets",
        files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
        data={"um_per_px": "0.1", "k_min": "1"})
    assert r.status_code == 500, r.text
    assert "CUDA out of memory" in str(r.json()["detail"])


def test_a_body_over_the_size_cap_is_a_413(client, monkeypatch):
    # `raw = file.file.read()` had no cap at all. A 4000-page frame is ~2 GB, and
    # this endpoint is about to be the only externally reachable route to a shared
    # GPU host. The cap is monkeypatched down here rather than posting 256 MiB.
    from api import frap_targets
    monkeypatch.setattr(frap_targets, "MAX_UPLOAD_BYTES", 4096)
    page = np.zeros((600, 600), dtype=np.uint16)
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", _tiff_bytes([page]), "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1"})
    assert r.status_code == 413, r.text
    assert "4096" in r.json()["detail"]


def test_a_file_with_too_many_pages_is_a_400(client):
    from api import frap_targets
    buf = io.BytesIO()
    tifffile.imwrite(buf, np.zeros((frap_targets.MAX_PAGES + 6, 8, 8), np.uint8))
    raw = buf.getvalue()
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", raw, "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1"})
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "page" in detail.lower()
    assert str(frap_targets.MAX_PAGES) in detail


def test_a_page_declaring_absurd_dimensions_is_refused_before_it_is_decoded(client):
    # The amplification this guards, measured: an all-zero 6000x6000 page under
    # zlib is ~39 KB on the wire and 36 million pixels once decoded. The declared
    # size comes from the TIFF tags, so the check has to happen BEFORE asarray() --
    # checking the decoded array would already have paid the RSS.
    buf = io.BytesIO()
    tifffile.imwrite(buf, np.zeros((6000, 6000), np.uint8), compression="zlib")
    raw = buf.getvalue()
    assert len(raw) < 100_000, f"fixture should be tiny on the wire, got {len(raw)}"
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", raw, "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1"})
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "36000000" in detail
    assert "before" in detail.lower() or "decod" in detail.lower()


def test_only_the_pages_actually_used_are_decoded(client):
    # A mechanism test, deliberately: nothing observable in the RESPONSE
    # distinguishes "decoded 6 pages" from "decoded 2", so the only way to hold the
    # per-page read in place is to count the decodes. tifffile.imread does not route
    # through TiffPage.asarray at all (it reads a whole series in one go), so a
    # regression to imread shows up here as zero recorded decodes.
    from unittest.mock import patch
    pages = [np.zeros((600, 600), dtype=np.uint16) for _ in range(6)]
    real = tifffile.TiffPage.asarray
    decoded = []

    def counting(self, *args, **kwargs):
        decoded.append(self.index)
        return real(self, *args, **kwargs)

    with patch.object(tifffile.TiffPage, "asarray", counting):
        r = client.post("/api/v1/frap/targets",
                        files={"file": ("f.tif", _tiff_bytes(pages), "image/tiff")},
                        data={"um_per_px": "0.1", "irm_page": "0", "fluor_page": "1",
                              "k_min": "1"})
    assert r.status_code == 200, r.text
    assert sorted(decoded) == [0, 1], f"decoded pages {sorted(decoded)}, wanted [0, 1]"


def test_a_channel_last_tiff_is_refused_naming_both_interpretations(client):
    # A single (H, W, 3) page was read as an H-page STACK, so page 0 became a
    # 3-pixel-wide slice: the model found nothing, the operator got OK n=0, and
    # concluded the field was empty. Which layout NIS's ImageSaveAs actually writes
    # is spec section 9 item 1 and explicitly unverified, so refuse and name both
    # readings rather than pick one.
    buf = io.BytesIO()
    tifffile.imwrite(buf, np.zeros((600, 600, 3), np.uint8), photometric="rgb")
    r = client.post("/api/v1/frap/targets",
                    files={"file": ("f.tif", buf.getvalue(), "image/tiff")},
                    data={"um_per_px": "0.1", "k_min": "1"})
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert "(600, 600, 3)" in detail
    assert "channel-last" in detail
    assert "600 separate" in detail


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


def test_params_json_f_mid_alone_cannot_clip_the_observation_window(client):
    # The cross-field case the per-key checks structurally cannot catch: each sees
    # one key, and this constraint spans three. f_mid ALONE is the realistic input --
    # someone widens the candidate band and does not think about l_min_um -- and it
    # is the unsafe direction, because below the bound _slice_window CLIPS, so
    # criterion 5b is evaluated over a shorter stretch than intended and a
    # contaminant just past the clipped end is never seen.
    r = _post_params(client, '{"f_mid": 0.8}')
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    # All three values must be named: the operator has to know which one to change.
    assert "l_min_um=6.0" in detail
    assert "obs_len_um=3.0" in detail
    assert "f_mid=0.8" in detail
    assert "15.0" in detail                     # the derived minimum


def test_params_json_f_mid_with_a_matching_l_min_is_accepted(client):
    # The constraint has to be satisfiable, and satisfying it has to use the
    # OVERRIDDEN l_min_um rather than the default -- otherwise the check would be
    # unpassable by exactly the correction its own message asks for.
    r = _post_params(client, '{"f_mid": 0.8, "l_min_um": 20.0}')
    assert r.status_code == 200, r.text


def test_params_json_f_mid_of_exactly_one_is_a_400_not_a_zero_division(client):
    # The range check is [0.0, 1.0] INCLUSIVE, so 1.0 PASSES it and reaches the
    # division: 1 - 1.0 == 0.0. The two values below therefore fail through
    # DIFFERENT paths, and both are asserted -- 1.0 by the dedicated guard (there is
    # no l_min_um that rescues it, so it gets its own message), 1.5 by the range.
    r = _post_params(client, '{"f_mid": 1.0}')
    assert r.status_code == 400, r.text
    assert "f_mid" in r.json()["detail"]
    assert "strictly below 1.0" in r.json()["detail"]

    r2 = _post_params(client, '{"f_mid": 1.5}')
    assert r2.status_code == 400, r2.text
    assert "between 0.0 and 1.0" in r2.json()["detail"]


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
    """One filament, 5 px = 0.5 um long -- well under the default l_min_um=6.0, so
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


# --- pixel scale bounds -------------------------------------------------------


def test_a_scale_in_nanometres_per_pixel_is_refused():
    # 72.45 is the rig's own 0.07245 um/px written in nm/px, which is how the slip
    # actually happens. Before this bound it was accepted: on a field of filaments
    # 0.8 um apart -- where nothing is safe to bleach -- it returned 10 spots,
    # shortfall false, and every rejection counter zero, because um_per_px divides
    # EVERY criterion and a large one relaxes all of them together. That is the most
    # confident-looking response this endpoint can emit, and it was wrong.
    r = _post_with(_StubLoader(), um_per_px="72.45")
    assert r.status_code == 400, r.text
    detail = str(r.json()["detail"])
    assert "um_per_px" in detail
    assert "0.07245" in detail          # names the value they probably meant


def test_a_scale_that_makes_the_roi_sub_pixel_is_refused():
    # The range check alone does not catch this: 5.0 um/px is inside it, but a
    # 1 um spot is then a fifth of a pixel across. Such an ROI cannot be bleached,
    # and the mask PNG degenerates to a few stray pixels while the JSON still
    # describes a full-size spot -- the two artefacts that are supposed to BE the
    # same selection, disagreeing with nothing to announce it.
    r = _post_with(_StubLoader(), um_per_px="5.0")
    assert r.status_code == 400, r.text
    detail = str(r.json()["detail"])
    assert "smaller than one pixel" in detail
    assert "spot_len_um" in detail


def test_the_real_rig_calibration_is_accepted():
    # The guard rejects wrong UNITS, never a real acquisition. 0.07245 um/px is this
    # project's recorded ND2 calibration; if this ever fails, the bound is too tight.
    r = _post_with(_StubLoader(), um_per_px="0.07245")
    assert r.status_code == 200, r.text


# --- a skipped criterion and a shortfall are visible on the wire ---------------


def test_omitting_the_fluor_page_is_announced_not_silent():
    # Omitting fluor_page removes the SNR criterion entirely, and on a real frame
    # that makes the run 21x faster AND more productive (0 spots -> 10) -- so the
    # case that most needs announcing is the one that looks healthiest. Before these
    # fields, `rejected_by["snr"] == 0` read identically to "every candidate passed
    # the brightness test".
    r = _post_with(_StubLoader(), um_per_px="0.1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["snr_evaluated"] is False
    assert "snr_min" in body["warning"]
    assert all(s["snr"] is None for s in body["spots"])


def test_a_frame_with_no_filaments_says_so():
    class _EmptyLoader:
        def predict_microtubule(self, image, *args, **kwargs):
            return {"polylines": [], "success": True}

    r = _post_with(_EmptyLoader(), um_per_px="0.1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["n_polylines"] == 0
    # A missing 'polylines' key and a genuinely empty field produced byte-identical
    # responses; the model is IRM-only, so pointing irm_page at a fluorescence page
    # is a one-character mistake that looks like an empty field.
    assert "irm_page" in body["warning"]


def test_a_healthy_field_carries_no_warning():
    # A real two-page frame: the y=150 filament is decorated on the fluorescence
    # page so it clears snr_min, and k_min=1 makes one spot a success. Nothing was
    # skipped and nothing fell short, so there must be nothing to report -- a
    # warning that fires on a good field would be trained away within a week.
    irm = np.zeros((600, 600), dtype=np.uint16)
    fluor = np.full((600, 600), 100, dtype=np.uint16)
    fluor[145:156, 100:401] = 900
    r = _post_with(_StubLoader(), pages=[irm, fluor],
                   fluor_page="1", k_min="1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["snr_evaluated"] is True
    assert body["shortfall"] is False
    assert body["warning"] is None


# --- a missing server codec is not the operator's fault ------------------------


def test_a_missing_codec_package_is_a_500_not_a_400():
    # tifffile decodes Deflate itself but delegates LZW to imagecodecs, which was
    # absent from the ML image -- so an ordinary LZW frame (ImageJ's and NIS's
    # default compression) came back as 400 "Unreadable TIFF", i.e. the server
    # blaming the operator's file for its own missing dependency. The operator sees
    # only that one line in frap_status.txt and re-saves the frame forever.
    from unittest.mock import patch

    err = ValueError("<COMPRESSION.LZW: 5> requires the 'imagecodecs' package")
    with patch("tifffile.TiffPage.asarray", side_effect=err):
        r = _post_with(_StubLoader())
    assert r.status_code == 500, r.text
    detail = str(r.json()["detail"])
    assert "imagecodecs" in detail
    assert "maintainer" in detail
    assert "re-saving it will not help" in detail


def test_a_genuinely_corrupt_page_is_still_a_400():
    # The counterpart: the codec branch must not swallow real bad input. Without
    # this, "everything is a 500" would pass the test above.
    from unittest.mock import patch

    with patch("tifffile.TiffPage.asarray",
               side_effect=ValueError("truncated file")):
        r = _post_with(_StubLoader())
    assert r.status_code == 400, r.text
    assert "Unreadable TIFF" in str(r.json()["detail"])


# --- orientation and frame shape ----------------------------------------------


class _DiagonalLoader:
    """One filament at exactly 45 degrees.

    Every other stub in this file emits horizontal filaments, so tangent_deg was
    0.0 in every endpoint test and a rotation bug was a no-op by construction --
    rotating every ROI by 90 degrees passed the whole suite.
    """

    def predict_microtubule(self, image, *args, **kwargs):
        return {"polylines": [{
            "id": "polyline_diag", "instanceId": "mt_diag",
            "points": [{"x": 100.0, "y": 100.0}, {"x": 400.0, "y": 400.0}],
            "class": "microtubule", "geometry": "polyline"}], "success": True}


def test_a_diagonal_filament_reports_its_real_angle_on_a_non_square_frame():
    # NON-SQUARE deliberately: every fixture in every FRAP test file was square
    # (600x600, 8x8, 6000x6000), so swapping rows for cols -- in the border gate, in
    # select_spots, in the mask canvas, or in image_shape on the wire -- changed
    # nothing anywhere. The camera this endpoint sizes its page budget for is
    # 2560x2160.
    page = np.zeros((480, 640), dtype=np.uint16)
    r = _post_with(_DiagonalLoader(), pages=[page], k_min="1")
    assert r.status_code == 200, r.text
    body = r.json()

    # rows then cols, matching coordinate_order's "x=col, y=row".
    assert body["image_shape"] == [480, 640]
    assert len(body["spots"]) == 1, body
    spot = body["spots"][0]

    # (100,100) -> (400,400): dx == dy, so the tangent is 45 degrees.
    assert spot["tangent_deg"] == pytest.approx(45.0, abs=0.5)
    # The ROI the microscope BLEACHES must carry the angle the criteria VALIDATED.
    assert spot["roi"]["angle_deg"] == spot["tangent_deg"]
    # ...and sit on the filament, where x == y. A transposed coordinate pair would
    # still land inside this frame, so the equality is what catches it.
    assert spot["x"] == pytest.approx(spot["y"], abs=2.0)
