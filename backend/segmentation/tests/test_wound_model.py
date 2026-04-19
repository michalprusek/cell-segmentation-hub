"""Smoke test for the wound-healing segmentation model.

Ported from the vendor's ``test_predict.py`` packaged with ``wound_seg_v2.zip``.
Asserts Dice ≥ 0.90 on the bundled sample — catches preprocessing / weight /
normalization drift the instant it happens.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

WEIGHTS = SEG_ROOT / "weights" / "wound_seg_v2.pt"
SAMPLE_IMAGE = SEG_ROOT / "tests" / "fixtures" / "wound" / "sample.jpg"
SAMPLE_MASK = SEG_ROOT / "tests" / "fixtures" / "wound" / "sample_mask.jpg"

ACCEPT_DICE = 0.90


def _dice(pred_bin: np.ndarray, gt_bin: np.ndarray) -> float:
    pred = pred_bin.astype(bool)
    gt = gt_bin.astype(bool)
    tp = np.logical_and(pred, gt).sum()
    fp = np.logical_and(pred, ~gt).sum()
    fn = np.logical_and(~pred, gt).sum()
    if (tp + fp + fn) == 0:
        return 1.0
    return float((2 * tp) / (2 * tp + fp + fn))


@pytest.mark.skipif(not WEIGHTS.exists(), reason="wound_seg_v2.pt not placed")
@pytest.mark.skipif(not SAMPLE_IMAGE.exists(), reason="sample fixture missing")
def test_wound_model_dice_on_sample():
    pytest.importorskip("segmentation_models_pytorch")
    import torch
    from models.wound import WoundModel

    device = "cuda" if torch.cuda.is_available() else "cpu"
    wm = WoundModel().load_weights(str(WEIGHTS), device)

    pil = Image.open(SAMPLE_IMAGE).convert("L")
    x = wm.preprocess(pil)
    with torch.no_grad():
        logits = wm.model(x)
    mask = wm.postprocess_to_mask(logits, pil.size, threshold=0.5) > 0

    gt = np.asarray(Image.open(SAMPLE_MASK).convert("L")) > 127
    dice = _dice(mask, gt)

    assert dice >= ACCEPT_DICE, (
        f"Dice {dice:.4f} < {ACCEPT_DICE} — preprocessing / weights / threshold drift. "
        f"Check WoundModel.preprocess against vendor inference.py."
    )
