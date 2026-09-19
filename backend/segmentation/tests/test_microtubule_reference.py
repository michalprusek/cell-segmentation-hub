"""The deployed microtubule model reproduces the pipeline it was MEASURED with.

``tests/fixtures/mt_sparse35/`` holds a synthetic IRM frame (the generator the model was
trained on, composited on a real empty-field IRM background, exact ground truth) and what the
research evaluation harness emits for it with the SPARSE35 ep040 checkpoint: the 1.5x
probability map and the polyline set (``eval_v5.py --infer-scale 1.0 --no-fov``,
``params_a_derived.json``, cut 0.98 -- the settings behind roi303 TEST 0.641 / htw TEST 0.601).

This test loads the REAL checkpoint through the production wrapper and checks both levels
(see ``models/microtubule/reference_check.py`` for why they are separate). It is the test that
says "the thing in the container is the thing that was measured"; the stub tests in
``test_microtubule_model.py`` pin the contract and cannot say that.

Skips cleanly without the checkpoint (CI has no GPU and no weights). Run it in the ML
container (``make test-ml``) or on a box where ``weights/microtubule_sparse35_ep040.pth``
is staged. ``MT_REF_STRICT=1`` demands identity within 0.05 px and an exact count -- what a
same-GPU, same-torch run should give.
"""
from __future__ import annotations

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
from models.microtubule.wrapper import UP, MicrotubuleModel  # noqa: E402

FIXTURE = _SEG / "tests" / "fixtures" / "mt_sparse35"
pytestmark = pytest.mark.model


def _checkpoint() -> Path:
    # Same resolution as conftest._mt_checkpoint: relative to the cwd, because that is what
    # ModelLoader's 'weights/...' string does.
    return Path.cwd() / "weights" / "microtubule_sparse35_ep040.pth"


@pytest.fixture(scope="module")
def loaded():
    ckpt = _checkpoint()
    if not ckpt.exists():
        pytest.skip(f"checkpoint not staged at {ckpt} (scripts/download-microtubule-weights.sh)")
    if not (FIXTURE / "mt_sparse35_synthetic_irm.png").exists():
        pytest.skip(f"fixture missing at {FIXTURE}")
    model = MicrotubuleModel().load_weights(ckpt)
    return model, rc.load_fixture(FIXTURE)


def _tol(model) -> rc.Tolerance:
    if os.environ.get("MT_REF_STRICT") == "1":
        return rc.Tolerance(map_max_abs=1e-3, map_flip_frac=0.0, poly_match_px=0.05,
                            poly_matched_frac=1.0, poly_count_slack=0)
    return rc.CUDA_TOL if str(model._device).startswith("cuda") else rc.CPU_TOL


def test_checkpoint_is_the_measured_one(loaded):
    """The fixture pins the sha256 of the checkpoint that produced the reference; a file of
    the right shape but the wrong bytes loads without error and fails only here."""
    import hashlib

    model, fx = loaded
    h = hashlib.sha256()
    with open(model._ckpt_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    assert h.hexdigest() == fx["manifest"]["ckpt_sha256"]


def test_probability_map_matches_the_harness(loaded):
    """Level 1: inference path (normalisation, native tiling, precision, 1.5x resampling)."""
    model, fx = loaded
    maps = model.infer_maps(fx["image"])
    m = rc.compare_maps(maps["prob_eval"], fx["ref_prob_eval"], fx["thr"])
    tol = _tol(model)
    assert m["shape"] == tuple(fx["ref_prob_eval"].shape)
    assert m["max_abs"] <= tol.map_max_abs, m
    assert m["flip_frac"] <= tol.map_flip_frac, m
    assert maps["prob"].shape == fx["image"].shape


def test_polylines_match_the_harness(loaded):
    """Level 2: the instancer (vendored copy vs the upstream that produced the numbers)."""
    model, fx = loaded
    out = model.predict(fx["image"], params={"polyline_eps_px": 0.0})
    pred = [np.asarray(cl, float)[:, ::-1] * UP for cl in out["centerlines_rc"]]
    tol = _tol(model)
    p = rc.compare_polylines(pred, fx["ref_xy_eval"], tol.poly_match_px)
    assert p["matched_frac"] >= tol.poly_matched_frac, p
    assert abs(p["n_pred"] - p["n_ref"]) <= tol.poly_count_slack, p


def test_model_still_finds_the_ground_truth(loaded):
    """Smoke floor only (the reference itself scores F1 0.74 against the exact GT of this
    frame); the identity tests above are the real check."""
    model, fx = loaded
    out = model.predict(fx["image"], params={"polyline_eps_px": 0.0})
    pred = [np.asarray(cl, float)[:, ::-1] * UP for cl in out["centerlines_rc"]]
    g = rc.gt_coverage(pred, [q * UP for q in fx["gt_xy_native"]])
    assert g["gt_covered"] >= 0.5, g
    assert g["pred_on_gt"] >= 0.7, g


# ---------------------------------------------------------------------------
# Checkpoint-free. The reference 1.5x map is committed, so level 2 (the vendored
# instancer + the shipped params vector) can be pinned on any box, including CI
# and a fresh clone with no weights. Review finding 2026-09-19: without this, an
# instancer or params regression passed every weights-free run.
# ---------------------------------------------------------------------------


def _fixture_or_skip():
    if not (FIXTURE / "reference_prob_eval_scale.npz").exists():
        pytest.skip(f"fixture missing at {FIXTURE}")
    return rc.load_fixture(FIXTURE)


def test_default_threshold_is_the_reference_threshold():
    fx = _fixture_or_skip()
    model = MicrotubuleModel()
    assert model.params["prob_thr"] == pytest.approx(fx["thr"])
    assert model.DEFAULT_SEED_THRESHOLD == pytest.approx(fx["thr"])
    assert model.params["min_length"] == pytest.approx(15.0)


def test_vendored_instancer_reproduces_the_reference_from_the_committed_map():
    """Level 2 without the network: threshold the committed reference map at the
    reference cut and run the vendored instance_a with the shipped vector. The
    map is float16, so 24 pixels sit inside the rounding band of the cut and a
    few vertices move by a fraction of a pixel; the count must be exact and every
    reference polyline matched within 1 px. Discriminative: min_length 44.74
    gives 7/22, merge_radius 8.98 gives 21/22 (measured 2026-09-19)."""
    from instance.instancer_a import instance_a

    fx = _fixture_or_skip()
    prob = fx["ref_prob_eval"]
    params = {**MicrotubuleModel().params, "polyline_eps_px": 0.0}
    polylines, _ = instance_a(prob > fx["thr"], 0.25, params, channels=prob[None], prob=prob,
                              return_masks=False)
    pred = [np.asarray(p, float) for p in polylines]
    p = rc.compare_polylines(pred, fx["ref_xy_eval"], 1.0)
    assert p["n_pred"] == p["n_ref"] == 22, p
    assert p["matched"] == 22, p
