"""The temporal vote at the network level: the fixture frame through the deployed checkpoint.

``tests/fixtures/mt_vote`` is one synthetic clip triplet with what the research path emits for its
middle frame (``make_mt_fixture_vote.py`` beside it). The decoder level, from the committed map,
runs in CI as ``segmentation_cpu_tests/test_mt_temporal_vote.py``; this adds the network and the
PNG, and skips without the checkpoint like ``test_microtubule_reference_v16.py``. On the research
box (L40S) the same code reproduced the fixture and 211 of 211 real interior frames bit for bit;
another card gets the tolerance classes of ``reference_check``. ``MT_REF_STRICT=1`` demands identity.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

_SEG = Path(__file__).resolve().parents[1]
_PKG = _SEG / "models" / "microtubule"
for _p in (str(_PKG), str(_PKG / "vendor")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from api.mt_geometry_cost import align_neighbours  # noqa: E402
from api.mt_temporal_vote import parse_curves, same_curves, verdict  # noqa: E402
from models.microtubule import reference_check as rc  # noqa: E402
from models.microtubule.wrapper import UP, MicrotubuleModel  # noqa: E402

FIXTURE = _SEG / "tests" / "fixtures" / "mt_vote"
CKPT = Path.cwd() / "weights" / "microtubule_v16_deb_s4_ep040.pth"


@pytest.fixture(scope="module")
def loaded():
    if not CKPT.exists():
        pytest.skip(f"checkpoint not staged at {CKPT} (scripts/download-microtubule-weights.sh)")
    ref = json.loads((FIXTURE / "reference_vote.json").read_text())
    prob = np.load(FIXTURE / "reference_prob_eval_scale.npz")["prob"].astype(np.float32)
    image = np.asarray(Image.open(FIXTURE / "frame_t.png"))
    return MicrotubuleModel().load_weights(CKPT), ref, prob, image


def _xy_eval(curves):
    return [np.asarray(c, float)[:, ::-1] * UP for c in curves]


@pytest.mark.model
def test_fixture_frame_through_the_checkpoint_gives_the_research_vote(loaded):
    model, ref, prob, image = loaded
    curves = [parse_curves(json.dumps(ref[k]), k) for k in ("previous", "current", "following")]
    neighbours, _ = align_neighbours(*curves)
    out = model.predict_voted(image, neighbours)
    expected = [np.asarray(c, float) for c in ref["voted_rc"]]
    if os.environ.get("MT_REF_STRICT") == "1":
        assert same_curves(out["voted"], expected, atol=1e-6)
        assert verdict(out["per_frame"], out["voted"], curves[1]) == (True, None, True)
        return
    tol = rc.CUDA_TOL if str(model._device).startswith("cuda") else rc.CPU_TOL
    m = rc.compare_maps(model.infer_maps(image)["prob_eval"], prob, model.params["prob_thr"])
    assert m["max_abs"] <= tol.map_max_abs and m["flip_frac"] <= tol.map_flip_frac, m
    p = rc.compare_polylines(_xy_eval(out["voted"]), _xy_eval(expected), tol.poly_match_px)
    assert p["matched_frac"] >= tol.poly_matched_frac, p
    assert abs(p["n_pred"] - p["n_ref"]) <= tol.poly_count_slack, p


@pytest.mark.model
def test_lam_zero_is_what_predict_returns_for_the_same_image(loaded):
    # What makes the route's edit check possible: on one card, the vote's lam 0 IS the stored output.
    model, _, _, image = loaded
    out = model.predict_voted(image, [[], []])
    assert same_curves(out["per_frame"], model.predict(image)["centerlines_rc"], atol=0.0)
