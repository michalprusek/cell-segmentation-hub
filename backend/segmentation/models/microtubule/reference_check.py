"""Compare a deployed MicrotubuleModel against the reference the model was MEASURED with.

The reference fixture (``tests/fixtures/mt_sparse35/``) was produced on the research host by the
evaluation harness that read every declared number -- ``eval_v5.py`` at native scale, the
probabilities resampled to the 1.5x frame, ``instance_a`` with ``params_a_derived.json`` at
0.98 -- on a synthetic IRM frame with exact ground truth. This module holds the comparison, so
the pytest test and the in-container verification script cannot drift apart.

Two levels, deliberately separate:

1. **Probability map** (``compare_maps``): the wrapper's ``prob_eval`` against the reference
   map. A mismatch here is the INFERENCE PATH (normalisation, tiling, precision, resampling).
2. **Polyline set** (``compare_polylines``): the wrapper's output against the reference
   polylines. A mismatch here with a matching map is the INSTANCER (the vendored copy drifting
   from upstream).

A single F1 assertion could not tell those apart; the ground-truth check (``gt_coverage``) is
only a smoke floor that the model still finds microtubules at all.

Tolerances have two regimes. On CUDA the reference was produced under bf16 autocast on an
A5000 with torch 2.5.1; a different torch or GPU may move a few probabilities by a few
thousandths, which can flip a handful of pixels at the 0.98 cut and shift a vertex by a
fraction of a pixel. On CPU the forward pass is fp32 and the drift is larger. Neither is a
defect; a transposed axis, a wrong scale or a wrong stride is, and those move things by many
pixels or change the count by many polylines.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

UP = 1.5


@dataclass(frozen=True)
class Tolerance:
    map_max_abs: float        # max |dp| allowed anywhere on the eval-scale map
    map_flip_frac: float      # fraction of pixels whose (p > thr) state may differ
    poly_match_px: float      # symmetric mean distance for two polylines to count as the same
    poly_matched_frac: float  # share of reference polylines that must find a match
    poly_count_slack: int     # |n_pred - n_ref| allowed


CUDA_TOL = Tolerance(map_max_abs=0.05, map_flip_frac=2e-4, poly_match_px=1.0,
                     poly_matched_frac=0.95, poly_count_slack=1)
CPU_TOL = Tolerance(map_max_abs=0.20, map_flip_frac=2e-3, poly_match_px=2.0,
                    poly_matched_frac=0.85, poly_count_slack=3)


def load_fixture(fixture_dir: str | Path) -> dict:
    """The committed fixture: image (uint16), GT polylines (native (x, y)), reference polylines
    (1.5x (x, y)), reference map (float16 -> float32) and the manifest."""
    from PIL import Image

    d = Path(fixture_dir)
    img = np.asarray(Image.open(d / "mt_sparse35_synthetic_irm.png"))
    if img.dtype != np.uint16:
        raise ValueError(f"fixture PNG is {img.dtype}, expected uint16")
    ref = json.loads((d / "reference_polylines.json").read_text())
    gt = json.loads((d / "gt_polylines.json").read_text())
    prob = np.load(d / "reference_prob_eval_scale.npz")["prob"].astype(np.float32)
    manifest = json.loads((d / "manifest.json").read_text())
    return {
        "image": img,
        "gt_xy_native": [np.asarray(p, float) for p in gt["polylines"]],
        "ref_xy_eval": [np.asarray(p, float) for p in ref["polylines_xy_eval_scale"]],
        "ref_prob_eval": prob,
        "thr": float(ref["thr"]),
        "manifest": manifest,
        "ref_f1_vs_gt": ref.get("f1_vs_gt_080"),
    }


def load_reference(ref_json: str | Path, ref_npz: str | Path) -> dict:
    """A reference pair for an arbitrary image (no ground truth), same layout as the fixture."""
    ref = json.loads(Path(ref_json).read_text())
    prob = np.load(ref_npz)["prob"].astype(np.float32)
    return {"ref_xy_eval": [np.asarray(p, float) for p in ref["polylines_xy_eval_scale"]],
            "ref_prob_eval": prob, "thr": float(ref["thr"]),
            "image_sha256": ref.get("image_sha256")}


#: The reference map is stored as float16 (a 1536^2 map compresses to ~1.3 MB that way). Near
#: 1.0 a float16 step is 2^-10, so a stored value can sit up to 2^-11 ~ 4.9e-4 from the value the
#: harness thresholded. A pixel whose reference lies within that band of the cut cannot be
#: compared at the bit level -- its "flip" is the storage, not the model -- so flips are counted
#: outside the band and the band's size is reported beside them.
REF_QUANTUM = 5e-4


def compare_maps(prob_eval: np.ndarray, ref_prob_eval: np.ndarray, thr: float) -> dict:
    if prob_eval.shape != ref_prob_eval.shape:
        raise AssertionError(f"eval-scale map shape {prob_eval.shape} != reference {ref_prob_eval.shape}")
    d = np.abs(prob_eval.astype(np.float32) - ref_prob_eval)
    band = np.abs(ref_prob_eval - thr) <= REF_QUANTUM
    flips = ((prob_eval > thr) != (ref_prob_eval > thr)) & ~band
    return {"shape": tuple(prob_eval.shape), "max_abs": float(d.max()), "mean_abs": float(d.mean()),
            "flip_frac": float(flips.mean()), "n_flips": int(flips.sum()), "n_in_quantum_band": int(band.sum()),
            "fg_frac": float((prob_eval > thr).mean()), "ref_fg_frac": float((ref_prob_eval > thr).mean())}


def _sym_mean_dist(a: np.ndarray, b: np.ndarray) -> float:
    from scipy.spatial import cKDTree

    da, _ = cKDTree(b).query(a)
    db, _ = cKDTree(a).query(b)
    return float(max(da.mean(), db.mean()))


def compare_polylines(pred_xy_eval: list[np.ndarray], ref_xy_eval: list[np.ndarray],
                      match_px: float) -> dict:
    """Greedy one-to-one matching on symmetric mean distance, cheapest pairs first."""
    if not ref_xy_eval:
        return {"n_pred": len(pred_xy_eval), "n_ref": 0, "matched": 0, "matched_frac": 1.0,
                "median_dist": 0.0, "max_matched_dist": 0.0}
    cands = []
    for i, r in enumerate(ref_xy_eval):
        for j, p in enumerate(pred_xy_eval):
            # cheap bbox gate before the KD-trees
            if (np.abs(r.mean(0) - p.mean(0)) > 4 * match_px + 50).any():
                continue
            cands.append((_sym_mean_dist(r, p), i, j))
    cands.sort()
    used_i, used_j, dists = set(), set(), []
    for dist, i, j in cands:
        if dist > match_px or i in used_i or j in used_j:
            continue
        used_i.add(i); used_j.add(j); dists.append(dist)
    return {"n_pred": len(pred_xy_eval), "n_ref": len(ref_xy_eval), "matched": len(dists),
            "matched_frac": len(dists) / len(ref_xy_eval),
            "median_dist": float(np.median(dists)) if dists else float("nan"),
            "max_matched_dist": float(max(dists)) if dists else float("nan")}


def gt_coverage(pred_xy_eval: list[np.ndarray], gt_xy_eval: list[np.ndarray], tol_px: float = 5.0) -> dict:
    """Smoke floor: share of GT vertices within tol of a prediction, and vice versa."""
    from scipy.spatial import cKDTree

    if not pred_xy_eval or not gt_xy_eval:
        return {"gt_covered": 0.0, "pred_on_gt": 0.0}
    P = np.concatenate(pred_xy_eval)
    G = np.concatenate(gt_xy_eval)
    dg, _ = cKDTree(P).query(G)
    dp, _ = cKDTree(G).query(P)
    return {"gt_covered": float((dg <= tol_px).mean()), "pred_on_gt": float((dp <= tol_px).mean())}


def run_check(model, image: np.ndarray, ref: dict, tol: Tolerance, gt_xy_native=None) -> dict:
    """Run the model on ``image`` and compare against ``ref``. Returns a report with ``ok``."""
    maps = model.infer_maps(image)
    thr = ref["thr"]
    m = compare_maps(maps["prob_eval"], ref["ref_prob_eval"], thr)
    out = model.predict(image, seed_threshold=thr, params={"polyline_eps_px": 0.0})
    pred_xy_eval = [np.asarray(cl, float)[:, ::-1] * UP for cl in out["centerlines_rc"]]
    p = compare_polylines(pred_xy_eval, ref["ref_xy_eval"], tol.poly_match_px)
    report = {"maps": m, "polylines": p, "prob_native_shape": tuple(out["prob"].shape)}
    problems = []
    if m["max_abs"] > tol.map_max_abs:
        problems.append(f"map max|dp| {m['max_abs']:.4f} > {tol.map_max_abs}")
    if m["flip_frac"] > tol.map_flip_frac:
        problems.append(f"map flip fraction {m['flip_frac']:.2e} > {tol.map_flip_frac:.0e}")
    if p["matched_frac"] < tol.poly_matched_frac:
        problems.append(f"polylines matched {p['matched']}/{p['n_ref']} < {tol.poly_matched_frac:.0%}")
    if abs(p["n_pred"] - p["n_ref"]) > tol.poly_count_slack:
        problems.append(f"polyline count {p['n_pred']} vs reference {p['n_ref']}")
    if tuple(out["prob"].shape) != tuple(image.shape[:2]):
        problems.append(f"native prob shape {out['prob'].shape} != image {image.shape[:2]}")
    if gt_xy_native is not None:
        g = gt_coverage(pred_xy_eval, [np.asarray(q, float) * UP for q in gt_xy_native])
        report["gt"] = g
        if g["gt_covered"] < 0.5 or g["pred_on_gt"] < 0.7:
            problems.append(f"ground-truth smoke floor: covered {g['gt_covered']:.2f}, precision {g['pred_on_gt']:.2f}")
    report["problems"] = problems
    report["ok"] = not problems
    return report


def format_report(report: dict) -> str:
    m, p = report["maps"], report["polylines"]
    lines = [f"map {m['shape']}: max|dp| {m['max_abs']:.4f}, mean {m['mean_abs']:.2e}, "
             f"flips {m['n_flips']} ({m['flip_frac']:.2e}) outside the float16 band of {m['n_in_quantum_band']} px, "
             f"fg {m['fg_frac']*100:.3f}% (ref {m['ref_fg_frac']*100:.3f}%)",
             f"polylines: {p['n_pred']} predicted vs {p['n_ref']} reference, matched {p['matched']} "
             f"({p['matched_frac']:.0%}), median dist {p['median_dist']:.3f} px, max {p['max_matched_dist']:.3f} px"]
    if "gt" in report:
        lines.append(f"ground truth: {report['gt']['gt_covered']:.2%} of GT covered, "
                     f"{report['gt']['pred_on_gt']:.2%} of prediction on GT (5 px)")
    lines.append("OK" if report["ok"] else "FAIL: " + "; ".join(report["problems"]))
    return "\n".join(lines)
