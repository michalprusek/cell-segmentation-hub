#!/usr/bin/env python3
"""Classify ANY soma instance labelling, not just the pre-cut pilot crops.

Until now the classifier could only score the 3849 crops that were cut from
Stepanka's polygons, because `dataset.samples_for` looks its input up in the
pilot manifest. That welded the classifier to expert annotation and made an
end-to-end run impossible: instances invented by the S1 instancer have no
manifest row and no crop on disk.

This module cuts the crop on the fly with the SAME geometry the training crops
used -- margin = 25 % of the instance's longer side, floored at 32 px, clipped
to the frame. Reproducing that geometry is not cosmetic: the model sees a fixed
224x224 window after resizing, so a different margin changes how much context
per object it gets, which is a different input distribution from the one it was
trained on.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

# VENDOR EDIT (2 of 4): the classifier lives beside this file as
# `soma_predict.py` rather than in a sibling `soma_classifier/` package, so the
# whole runtime set is one flat directory that can be diffed against the
# research package file by file.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import soma_predict as sc_predict

Image.MAX_IMAGE_PIXELS = None
MARGIN_FRAC = 0.25
MARGIN_MIN_PX = 32


def crop_box(y0: int, x0: int, y1: int, x1: int, shape) -> tuple[int, int, int, int]:
    """Pilot crop geometry, reproduced exactly (see soma_crops_v2/README.txt)."""
    margin = max(MARGIN_MIN_PX, int(round(MARGIN_FRAC * max(y1 - y0, x1 - x0))))
    return (max(0, y0 - margin), max(0, x0 - margin),
            min(shape[0], y1 + margin), min(shape[1], x1 + margin))


def cut_crops(image: np.ndarray, inst: np.ndarray, ids=None):
    """One PIL crop per instance label, in the order of the returned id list."""
    if ids is None:
        ids = [int(v) for v in np.unique(inst) if v]
    objs = ndi.find_objects(inst)
    a = image.astype(np.float32)
    lo, hi = np.percentile(a, (0.5, 99.5))
    g = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)
    g8 = (g * 255).astype(np.uint8)

    out_ids, crops = [], []
    for i in ids:
        if i - 1 >= len(objs) or objs[i - 1] is None:
            continue
        sl = objs[i - 1]
        y0, x0, y1, x1 = crop_box(sl[0].start, sl[1].start, sl[0].stop, sl[1].stop,
                                  inst.shape)
        if y1 - y0 < 4 or x1 - x0 < 4:
            continue
        out_ids.append(i)
        crops.append(Image.fromarray(g8[y0:y1, x0:x1]))
    return out_ids, crops


def classify(image: np.ndarray, inst: np.ndarray, ids=None, thr: float = 0.5):
    """Return (p_by_id, accepted_id_set). p = probability it is NOT a soma."""
    out_ids, crops = cut_crops(image, inst, ids)
    if not crops:
        return {}, set()
    p = sc_predict.predict_images(crops)
    pd = {i: float(v) for i, v in zip(out_ids, p)}
    return pd, {i for i, v in pd.items() if v < thr}
