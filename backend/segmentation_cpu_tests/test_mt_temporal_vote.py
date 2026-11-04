"""The microtubule temporal vote: the hub's code reproduces the research path that measured it.

`segmentation/tests/fixtures/mt_vote` (recipe `make_mt_fixture_vote.py` beside it) is one synthetic
clip triplet and what the RESEARCH code emits for its middle frame: S1's real-video functions, run
on the package as it was before the vote existed. Here the hub's own code runs from the committed
probability map, so no checkpoint and no GPU are needed; the network level is
`segmentation/tests/test_microtubule_temporal_vote.py`. The same code reproduced S1 on 211 of 211
interior frames of 12 real videos, bit for bit (research repo, `scripts/ult/temporal/replay_vote.py`).
"""

from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from test_inference_serialisation import routes  # the real module, torch-safe

_SEG = Path(__file__).resolve().parents[1] / "segmentation"
_PKG = _SEG / "models" / "microtubule"
FIX = _SEG / "tests" / "fixtures" / "mt_vote"
sys.path.insert(0, str(_SEG))

from api.mt_geometry_cost import SHIFT_TOL, align_neighbours, best_shift  # noqa: E402
from api.mt_temporal_vote import parse_curves, same_curves, verdict  # noqa: E402


def _load_wrapper():
    # `models/__init__` imports mamba_ssm, which needs a CUDA driver. The wrapper imports no
    # torch at module level, so it is loaded by path and puts its own package on sys.path.
    spec = importlib.util.spec_from_file_location("mt_wrapper_cpu", _PKG / "wrapper.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


W = _load_wrapper()
from instance.instancer_lh import instance_lh  # noqa: E402
from instance.instancer_lh_vote import Neighbour, decode_ladder  # noqa: E402


@pytest.fixture(scope="module")
def fx():
    ref = json.loads((FIX / "reference_vote.json").read_text())
    prob = np.load(FIX / "reference_prob_eval_scale.npz")["prob"].astype(np.float32)
    return ref, prob


def _model(prob):
    model = W.MicrotubuleModel()
    model._params_path = _PKG / "params_v16.json"
    model.infer_maps = lambda image: {"prob_eval": prob}  # the network, replaced by its committed map
    return model


def _curves(ref):
    """What the backend sends, through the route's own parser."""
    return [parse_curves(json.dumps(ref[k]), k) for k in ("previous", "current", "following")]


def _rc(curves):
    return [np.asarray(c, dtype=float) for c in curves]


def test_vote_reproduces_the_research_path(fx):
    ref, prob = fx
    previous, current, following = _curves(ref)
    neighbours, (d_prev, d_next) = align_neighbours(previous, current, following)
    assert np.array_equal(d_prev, ref["shift_previous"])
    assert np.array_equal(d_next, ref["shift_next"])
    out = _model(prob).predict_voted(None, neighbours)
    assert out["decoder"] == "lh"
    assert same_curves(out["voted"], _rc(ref["voted_rc"]), atol=1e-9)
    # lam 0 is the stored per-frame output, which is what lets the route detect an edit
    assert same_curves(out["per_frame"], current, atol=1e-9)
    assert verdict(out["per_frame"], out["voted"], current) == (True, None, True)


def test_lam_zero_is_instance_lh_whatever_the_neighbours(fx):
    ref, prob = fx
    model = _model(prob)
    params, thr = model.params, model.params["prob_thr"]
    neighbours, _ = align_neighbours(*_curves(ref))
    votes = [Neighbour([(c * W.UP)[:, ::-1] for c in n]) for n in neighbours]
    a = decode_ladder(prob, thr, W.KAPPA_MAX, params, votes, (0.0,))[0.0]
    b = instance_lh(prob, thr, W.KAPPA_MAX, params)
    assert len(a) == len(b) and all(np.array_equal(x, y) for x, y in zip(a, b))


def test_the_vote_reads_the_shift_sign_and_the_axis_order(fx):
    # The fixture's frame was chosen, by a rule declared before scoring, so that both mistakes show.
    ref, prob = fx
    model, expected = _model(prob), _rc(ref["voted_rc"])
    neighbours, (d_prev, d_next) = align_neighbours(*_curves(ref))
    negated = [[c - 2 * d_prev for c in neighbours[0]], [c - 2 * d_next for c in neighbours[1]]]
    assert not same_curves(model.predict_voted(None, negated)["voted"], expected)
    transposed = [[c[:, ::-1] for c in n] for n in neighbours]
    assert not same_curves(model.predict_voted(None, transposed)["voted"], expected)
    alone = model.predict_voted(None, [[], []])
    assert same_curves(alone["voted"], alone["per_frame"], atol=0.0)


def test_verdict_acts_only_on_the_measured_condition(fx):
    ref, _ = fx
    current = _curves(ref)[1]
    per_frame = [c.copy() for c in current]
    nudged = [c.copy() for c in current]
    nudged[3][0] += 0.01
    assert verdict(per_frame, per_frame, nudged) == (False, "not_per_frame", False)
    assert verdict(per_frame, per_frame, current[:-1]) == (False, "not_per_frame", False)
    assert verdict(None, None, current) == (False, "arc_limit", False)
    assert verdict(per_frame, per_frame, current) == (True, None, False)


def test_parse_curves_reads_x_y_as_row_col():
    (curve,) = parse_curves("[[[10, 2], [11.5, 3]]]", "current")
    assert np.array_equal(curve, [[2, 10], [3, 11.5]])
    assert parse_curves("[]", "current") == []


@pytest.mark.parametrize("raw", ["{}", "3", "not json", "[[[1, 2, 3]]]", '[["a"]]', "[[[1, NaN]]]"])
def test_parse_curves_refuses_what_is_not_curves(raw):
    with pytest.raises(ValueError, match="previous"):
        parse_curves(raw, "previous")


def test_best_shift_finds_a_translation_within_its_tolerance_and_leaves_an_empty_field():
    rng = np.random.default_rng(0)
    a = np.cumsum(rng.normal(scale=2.0, size=(600, 2)), axis=0) + 300
    true = np.array([20.0, -14.0])
    assert np.linalg.norm(best_shift(a, a + true) - true) <= SHIFT_TOL
    assert np.array_equal(best_shift(np.zeros((0, 2)), a), [0.0, 0.0])
    assert np.array_equal(best_shift(a, np.zeros((0, 2))), [0.0, 0.0])


class _VoteLoader:
    """Stands in for ModelLoader.predict_microtubule_voted."""

    def __init__(self, per_frame, voted):
        self.per_frame, self.voted, self.calls = per_frame, voted, 0

    def predict_microtubule_voted(self, image, neighbours_rc):
        self.calls += 1
        return {
            "per_frame": self.per_frame,
            "voted": self.voted,
            "decoder": "lh" if self.per_frame is not None else "instance_a_fallback",
            "polylines": None if self.voted is None else [{"id": f"polyline_{i + 1}"} for i in range(len(self.voted))],
            "model_used": "microtubule",
            "threshold_used": 0.995,
            "image_size": {"width": 8, "height": 8},
        }


def _png():
    buf = io.BytesIO()
    from PIL import Image

    Image.fromarray(np.zeros((8, 8), np.uint16)).save(buf, format="PNG")
    return buf.getvalue()


def _call(loader, current="[[[1, 1], [5, 5]]]", previous="[]", following="[]"):
    upload = UploadFile(filename="frame.png", file=io.BytesIO(_png()))
    return asyncio.run(routes.microtubule_temporal_vote(upload, previous, current, following, loader))


def test_route_writes_nothing_for_an_edited_frame():
    loader = _VoteLoader([np.array([[1.0, 1.0], [5.0, 5.0]])], [np.array([[1.0, 1.0], [5.0, 6.0]])])
    out = _call(loader, current="[[[1, 1], [5, 6]]]")
    assert (out["applied"], out["reason"], out["changed"], out["polylines"]) == (False, "not_per_frame", False, [])
    assert out["decoder"] == "lh"


def test_route_returns_the_voted_curves_when_the_frame_is_the_per_frame_output():
    loader = _VoteLoader([np.array([[1.0, 1.0], [5.0, 5.0]])], [np.array([[1.0, 1.0], [6.0, 5.0]])])
    out = _call(loader)
    assert (out["applied"], out["reason"], out["changed"], out["decoder"]) == (True, None, True, "lh_vote")
    assert len(out["polylines"]) == 1 and loader.calls == 1


def test_route_says_arc_limit_beyond_the_l_h_limit():
    out = _call(_VoteLoader(None, None))
    assert (out["applied"], out["reason"], out["polylines"], out["decoder"]) == (False, "arc_limit", [], "instance_a_fallback")


def test_route_answers_422_before_any_inference_on_malformed_curves():
    loader = _VoteLoader([], [])
    with pytest.raises(HTTPException) as err:
        _call(loader, following="{}")
    assert err.value.status_code == 422 and "following" in str(err.value.detail)
    assert loader.calls == 0
