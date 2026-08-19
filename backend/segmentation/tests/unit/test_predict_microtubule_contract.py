"""The wire contract of ``ModelLoader.predict_microtubule`` after the v5H swap.

The model is stubbed: what is under test is the hand-off between the wrapper's
``centerlines_rc`` and the polyline dicts the backend persists, not the
checkpoint. Every field asserted here is read by something downstream --
the editor keys rendering off ``geometry`` and ``class``, the tracker off
``id``, and the metrics off point order.
"""

import numpy as np
import pytest
from PIL import Image


class _StubMT:
    """Returns one centerline in (row, col), the wrapper's contract.

    Mirrors the real MicrotubuleModel's surface, including ``params`` and
    ``DEFAULT_SEED_THRESHOLD``: the loader reads them to report which cut was
    actually applied when the caller passes none.
    """

    DEFAULT_SEED_THRESHOLD = 0.97

    def __init__(self, centerlines=None):
        self._cls = (
            centerlines
            if centerlines is not None
            else [np.array([[10.0, 20.0], [11.0, 21.0], [12.0, 22.0]])]
        )
        self.params = {"prob_thr": 0.97}
        self.seen_threshold = "unset"

    def predict(self, image_np, seed_threshold=None, params=None):
        self.seen_threshold = seed_threshold
        return {
            "centerlines_rc": self._cls,
            "prob": np.zeros(np.asarray(image_np).shape[:2], np.float32),
        }


@pytest.fixture
def loader(monkeypatch):
    from ml.model_loader import ModelLoader

    ld = ModelLoader()
    ld.loaded_models["microtubule"] = _StubMT()
    monkeypatch.setattr(ld, "get_model", lambda *a, **k: None)
    monkeypatch.setattr(ld, "release_model", lambda *a, **k: None)
    return ld


def test_polylines_carry_no_embedding(loader):
    """A leftover _embedding would be persisted to the DB by
    segmentationService and then shipped to a tracker that no longer reads it --
    tens of MB per video for nothing."""
    out = loader.predict_microtubule(Image.new("L", (64, 64)))
    assert out["polylines"], "no polylines produced"
    for p in out["polylines"]:
        assert "_embedding" not in p
        assert "_embedding_dim" not in p


def test_points_are_xy_not_rowcol(loader):
    """centerlines_rc is (row, col); the wire format is {x: col, y: row}.
    Swapping these renders every microtubule mirrored about the diagonal."""
    out = loader.predict_microtubule(Image.new("L", (64, 64)))
    assert out["polylines"][0]["points"][0] == {"x": 20.0, "y": 10.0}
    assert out["polylines"][0]["points"][2] == {"x": 22.0, "y": 12.0}


def test_editor_facing_fields_are_unchanged(loader):
    """The editor keys polyline rendering off these; changing them breaks MT
    display with no error anywhere."""
    p = loader.predict_microtubule(Image.new("L", (64, 64)))["polylines"][0]
    assert p["geometry"] == "polyline"
    assert p["class"] == "microtubule"
    assert p["type"] == "external"
    assert p["id"] == "polyline_1"
    assert p["instanceId"].startswith("mt_")
    assert p["vertices_count"] == 3


def test_instance_ids_are_unique_per_polyline(loader, monkeypatch):
    """One microtubule = one instanceId. Duplicates collapse distinct MTs in
    the instance panel."""
    loader.loaded_models["microtubule"] = _StubMT(
        [np.array([[0.0, 0.0], [1.0, 1.0]]), np.array([[5.0, 5.0], [6.0, 6.0]])]
    )
    out = loader.predict_microtubule(Image.new("L", (64, 64)))
    ids = [p["instanceId"] for p in out["polylines"]]
    assert len(set(ids)) == 2


def test_an_explicit_threshold_is_forwarded_to_the_model(loader):
    """An override must reach the wrapper rather than being swallowed."""
    out = loader.predict_microtubule(Image.new("L", (64, 64)), threshold=0.85)
    assert loader.loaded_models["microtubule"].seen_threshold == 0.85
    assert out["threshold_used"] == 0.85


def test_no_threshold_means_the_models_own_fitted_cut(loader):
    """THE reason this defaults to None.

    The stack-wide default of 0.5 would cut a very confident foreground far too
    low and flood the instancer. Passing None lets the wrapper use
    params_v5h.json's prob_thr — and the response must report what was APPLIED,
    not the empty request.

    (This used to add that 0.97 was not expressible on /segment at all, whose
    threshold was declared `le=0.9`. That bound has been raised to 0.99 — it was
    rejecting every microtubule request with a 422 — but the reason for
    defaulting to None is unchanged.)
    """
    out = loader.predict_microtubule(Image.new("L", (64, 64)))
    assert loader.loaded_models["microtubule"].seen_threshold is None
    assert out["threshold_used"] == 0.97


def test_response_envelope_is_unchanged(loader):
    """polygons stays present-and-empty: the backend branches on its presence."""
    out = loader.predict_microtubule(Image.new("L", (64, 64)))
    assert out["model_used"] == "microtubule"
    assert out["polygons"] == []
    assert out["image_size"] == {"width": 64, "height": 64}
    assert out["processing_info"]["num_polylines"] == 1


def test_no_polylines_is_an_empty_list_not_an_error(loader):
    """A frame with no microtubules is a legitimate result, not a failure."""
    loader.loaded_models["microtubule"] = _StubMT([])
    out = loader.predict_microtubule(Image.new("L", (64, 64)))
    assert out["polylines"] == []
    assert out["processing_info"]["num_polylines"] == 0
