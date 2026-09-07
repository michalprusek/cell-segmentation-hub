#!/usr/bin/env python3
"""Phase 1 of the design: split touching somas into instances, cheapest first.

Scored against the expert's 3849 polygons. Connected components lose 17.1 % of
instances to fusion, and they fuse in the crowded regions where identity matters
most, so anything that beats that is worth having.

The screen runs on the RASTERISED EXPERT MASK, not on model predictions: that
isolates the instancing error from the segmenter's. The end-to-end variant needs
the nnU-Net predictions, which live on kajman, and is a separate measurement --
its number can only be worse, because a predicted mask smooths over the narrow
separations the expert draws.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.filters import threshold_otsu
from skimage.morphology import h_maxima, remove_small_objects
from skimage.segmentation import watershed

# VENDOR EDIT (1 of 4): `gt_io` is imported inside `main()` instead of here.
# It hardcodes a laptop checkout path (`BIOCEV_ROOT`) and is used ONLY by the
# research CLI below, so a module-level import would make the whole pipeline
# unimportable in the container. The research package is unchanged.
sys.path.insert(0, str(Path(__file__).resolve().parent))

Image.MAX_IMAGE_PIXELS = None
ROOT = Path('/Users/michalprusek/PycharmProjects/BIOCEV')
NUCLEUS = {
    'r4': ROOT / 'datasets/stepanka_neurons/Leica_confocal/Run_no.4/03_Nucleus_channel',
}
STRUCT8 = np.ones((3, 3), bool)


# ------------------------------------------------------------------ scoring
def score(gt: np.ndarray, pred: np.ndarray, iou_thr: float = 0.5) -> dict:
    """Instance F1 plus the two failure modes separately.

    A single F1 hides which of fusion and splitting dominates, and they have
    different fixes, so both are reported.
    """
    m = (gt > 0) | (pred > 0)
    pairs, counts = np.unique(np.stack([gt[m], pred[m]], 1), axis=0, return_counts=True)
    inter = {(int(a), int(b)): int(c) for (a, b), c in zip(pairs, counts) if a and b}
    gt_area = np.bincount(gt.ravel())
    pr_area = np.bincount(pred.ravel())

    best = {}
    for (g, p), i in inter.items():
        iou = i / (gt_area[g] + pr_area[p] - i)
        if iou > best.get(g, (0, 0))[0]:
            best[g] = (iou, p)
    n_gt = int((gt_area[1:] > 0).sum())
    n_pr = int((pr_area[1:] > 0).sum())
    tp = sum(1 for g, (iou, _) in best.items() if iou >= iou_thr)

    # fusion: the prediction that best covers this GT object also swallows another
    pred_gt_count = {}
    for (g, p), i in inter.items():
        if i > 0.3 * gt_area[g]:
            pred_gt_count.setdefault(p, set()).add(g)
    fused = sum(1 for g, (_, p) in best.items() if len(pred_gt_count.get(p, ())) > 1)
    # split: this GT object is substantially covered by two or more predictions
    gt_pred_count = {}
    for (g, p), i in inter.items():
        if i > 0.2 * gt_area[g]:
            gt_pred_count.setdefault(g, set()).add(p)
    splitted = sum(1 for g, s in gt_pred_count.items() if len(s) > 1)

    # Size diagnostic. A low fusion rate is only evidence of better separation
    # if the predicted objects are the right SIZE: systematically undersized
    # predictions cannot span two GT objects, so they score a low fusion rate
    # for free. Without this the two explanations are indistinguishable.
    gt_med = float(np.median(gt_area[1:][gt_area[1:] > 0])) if n_gt else 0.0
    pr_med = float(np.median(pr_area[1:][pr_area[1:] > 0])) if n_pr else 0.0

    prec = tp / max(n_pr, 1)
    rec = tp / max(n_gt, 1)
    return dict(n_gt=n_gt, n_pred=n_pr, tp=tp,
                precision=round(prec, 4), recall=round(rec, 4),
                f1=round(2 * prec * rec / max(prec + rec, 1e-9), 4),
                fused=fused, fused_rate=round(fused / max(n_gt, 1), 4),
                split=splitted, split_rate=round(splitted / max(n_gt, 1), 4),
                gt_median_area=round(gt_med, 1), pred_median_area=round(pr_med, 1),
                area_ratio=round(pr_med / gt_med, 3) if gt_med else None)


# ------------------------------------------------------------- instancers
def s0_connected_components(soma_bin, **_):
    lab, _ = ndi.label(soma_bin, structure=STRUCT8)
    return lab


def edt_um(mask, um_per_px):
    """Euclidean distance in microns, float32.

    float64 is what scipy returns and it is 1.4 GB on a 13k x 13k imax frame --
    four of those alive at once does not fit in this machine.
    """
    return (ndi.distance_transform_edt(mask) * um_per_px).astype(np.float32)


def _seeded_watershed(soma_bin, markers, edt):
    return watershed(-edt, markers, mask=soma_bin)


def s1_dt_hmaxima(soma_bin, um_per_px=0.18, h_um=2.0, edt=None, **_):
    edt = edt_um(soma_bin, um_per_px) if edt is None else edt
    peaks = h_maxima(edt, np.float32(h_um))
    markers, n = ndi.label(peaks, structure=STRUCT8)
    if n == 0:
        return s0_connected_components(soma_bin)
    return _seeded_watershed(soma_bin, markers, edt)


def s2_nucleus_seeded(soma_bin, um_per_px=0.18, h_um=2.0, nucleus=None, edt=None, **_):
    """One nucleus = one cell, which is a physical prior rather than a heuristic.

    Where a soma region contains no nucleus the S1 seeds are used instead, so
    the method degrades to S1 rather than fusing.
    """
    edt = edt_um(soma_bin, um_per_px) if edt is None else edt
    if nucleus is None:
        return s1_dt_hmaxima(soma_bin, um_per_px, h_um, edt=edt)
    nuc = nucleus > threshold_otsu(nucleus)
    nuc = remove_small_objects(nuc, int(round(6.0 / um_per_px ** 2)))
    nuc &= soma_bin
    nedt = edt_um(nuc, um_per_px)
    npk = h_maxima(nedt, np.float32(1.0)) if nuc.any() else np.zeros_like(nuc)
    del nedt
    markers, n = ndi.label(npk, structure=STRUCT8)

    covered = set(np.unique(ndi.label(soma_bin, structure=STRUCT8)[0][markers > 0])) - {0}
    comp, _ = ndi.label(soma_bin, structure=STRUCT8)
    uncovered = soma_bin & ~np.isin(comp, list(covered)) if covered else soma_bin
    if uncovered.any():
        extra = h_maxima((edt * uncovered).astype(np.float32), np.float32(h_um)) & uncovered
        elab, en = ndi.label(extra, structure=STRUCT8)
        elab[elab > 0] += n
        markers = np.maximum(markers, elab)
    if markers.max() == 0:
        return s0_connected_components(soma_bin)
    return _seeded_watershed(soma_bin, markers, edt)


METHODS = {'S0_cc': s0_connected_components,
           'S1_dt_hmax': s1_dt_hmaxima,
           'S2_nucleus': s2_nucleus_seeded}


def main():
    import gt_io  # noqa: F401  (see VENDOR EDIT 1)
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', nargs='*', default=None)
    ap.add_argument('--h', nargs='*', type=float, default=[1.0, 2.0, 3.0, 5.0])
    ap.add_argument('--out', default='/Users/michalprusek/Desktop/soma_instancing')
    a = ap.parse_args()

    frames = a.frames or [f'r4_{c}_{i:04d}' for c in ('ctrl', 'imax', 'wt') for i in (1, 2, 3)]
    res = {}
    for f in frames:
        t = time.time()
        cond = f.split('_')[1]
        um = gt_io.UM[cond]
        sem = np.array(Image.open(gt_io.GT / 'masks' / f'{f}.png'))
        gt = gt_io.soma_instances(f, sem.shape)
        soma_bin = gt > 0
        nuc_path = NUCLEUS['r4'] / f'{f[3:]}.tif'
        nucleus = None
        if nuc_path.exists():
            import tifffile
            nucleus = tifffile.imread(nuc_path)
            if nucleus.shape != soma_bin.shape:
                nucleus = None

        res[f] = {}
        res[f]['S0_cc'] = score(gt, s0_connected_components(soma_bin))
        edt = edt_um(soma_bin, um)
        for h in a.h:
            res[f][f'S1_dt_hmax_h{h}'] = score(gt, s1_dt_hmaxima(soma_bin, um, h, edt=edt))
            if nucleus is not None:
                res[f][f'S2_nucleus_h{h}'] = score(gt, s2_nucleus_seeded(soma_bin, um, h,
                                                                        nucleus, edt=edt))
        del edt
        print(f'{f}  nucleus={"yes" if nucleus is not None else "NO"}  '
              f'[{time.time()-t:.0f}s]', flush=True)
        for k, v in res[f].items():
            print(f'    {k:20s} F1 {v["f1"]:.3f}  fused {v["fused_rate"]:.3f}  '
                  f'split {v["split_rate"]:.3f}  ({v["n_pred"]} vs {v["n_gt"]} objects)')

    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    json.dump(res, open(out / 'instancing.json', 'w'), indent=2)

    keys = sorted({k for v in res.values() for k in v})
    print(f'\n{"method":22s} {"F1":>7s} {"fused":>7s} {"split":>7s}')
    for k in keys:
        vals = [res[f][k] for f in res if k in res[f]]
        print(f'{k:22s} {np.mean([v["f1"] for v in vals]):7.3f} '
              f'{np.mean([v["fused_rate"] for v in vals]):7.3f} '
              f'{np.mean([v["split_rate"] for v in vals]):7.3f}')
    print('\n->', out)


if __name__ == '__main__':
    main()
