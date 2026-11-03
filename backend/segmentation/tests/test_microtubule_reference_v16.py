"""The deployed V16 model reproduces the pipeline it was MEASURED with.

``tests/fixtures/mt_v16/`` holds what the research path emits for the SPARSE35 fixture's frame with
the DEB_S4 ep040 checkpoint: the 1.5x probability map and the polyline set (``train_v5.predict`` with
Gaussian fusion, the map stored as float16 as ``eval_v5 --dump-pred`` does, then ``l_hyst2.hmask`` +
instancer L at reach 80, cut 0.995). ``make_mt_fixture_v16.py`` beside it is the recipe.

Skips cleanly without the checkpoint, except the decoder level, which runs from the committed map.
``MT_REF_STRICT=1`` demands identity within 0.05 px and an exact count.
"""
from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import numpy as np
import pytest

_SEG = Path(__file__).resolve().parents[1]
_PKG = _SEG / "models" / "microtubule"
for _p in (str(_PKG), str(_PKG / "vendor")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from models.microtubule import reference_check as rc  # noqa: E402
from models.microtubule.wrapper import KAPPA_MAX, UP, MicrotubuleModel  # noqa: E402

from instance.instancer_lh import instance_lh  # noqa: E402

FIXTURE = _SEG / "tests" / "fixtures" / "mt_v16"
CKPT = Path.cwd() / "weights" / "microtubule_v16_deb_s4_ep040.pth"


def _fx():
    if not (FIXTURE / "reference_prob_eval_scale.npz").exists():
        pytest.skip(f"fixture missing at {FIXTURE}")
    return rc.load_fixture(FIXTURE)


def _tol(model) -> rc.Tolerance:
    if os.environ.get("MT_REF_STRICT") == "1":
        return rc.Tolerance(map_max_abs=1e-3, map_flip_frac=0.0, poly_match_px=0.05,
                            poly_matched_frac=1.0, poly_count_slack=0)
    return rc.CUDA_TOL if str(model._device).startswith("cuda") else rc.CPU_TOL


@pytest.fixture(scope="module")
def loaded():
    if not CKPT.exists():
        pytest.skip(f"checkpoint not staged at {CKPT} (scripts/download-microtubule-weights.sh)")
    return MicrotubuleModel().load_weights(CKPT), _fx()


def test_decoder_reproduces_the_research_polylines_from_the_committed_map():
    """Level 2 with no checkpoint: this is the test that catches the vendored decoder or the
    params vector drifting, on any box."""
    fx = _fx()
    model = MicrotubuleModel()
    model._params_path = _PKG / "params_v16.json"
    polys = instance_lh(fx["ref_prob_eval"], fx["thr"], KAPPA_MAX, model.params)
    assert len(polys) == len(fx["ref_xy_eval"])
    for p, q in zip(polys, fx["ref_xy_eval"]):
        assert p.shape == q.shape
        assert np.abs(p - q).max() < 0.05


@pytest.mark.model
def test_checkpoint_is_the_measured_one(loaded):
    model, fx = loaded
    h = hashlib.sha256()
    with open(model._ckpt_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    assert h.hexdigest() == fx["manifest"]["ckpt_sha256"]


@pytest.mark.model
def test_loading_the_checkpoint_selects_the_v16_vector(loaded):
    model, fx = loaded
    assert model.params["decoder"] == "lh"
    assert model.params["prob_thr"] == pytest.approx(fx["thr"])


@pytest.mark.model
def test_probability_map_matches_the_harness(loaded):
    model, fx = loaded
    m = rc.compare_maps(model.infer_maps(fx["image"])["prob_eval"], fx["ref_prob_eval"], fx["thr"])
    tol = _tol(model)
    assert m["max_abs"] <= tol.map_max_abs, m
    assert m["flip_frac"] <= tol.map_flip_frac, m


@pytest.mark.model
def test_polylines_match_the_harness(loaded):
    model, fx = loaded
    out = model.predict(fx["image"], params={"polyline_eps_px": 0.0})
    pred = [np.asarray(cl, float)[:, ::-1] * UP for cl in out["centerlines_rc"]]
    tol = _tol(model)
    p = rc.compare_polylines(pred, fx["ref_xy_eval"], tol.poly_match_px)
    assert p["matched_frac"] >= tol.poly_matched_frac, p
    assert abs(p["n_pred"] - p["n_ref"]) <= tol.poly_count_slack, p
