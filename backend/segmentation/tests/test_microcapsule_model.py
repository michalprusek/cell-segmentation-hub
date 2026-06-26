"""Tests for the microcapsule distilled-U-Net instance-segmentation wrapper.

Two layers:
  1. Pure unit tests — the completeness rule (`_touches_border`, which decides
     which capsules are excluded from metrics) and the watershed instance
     separation (`predict_instances`, which splits touching capsules into
     distinct labels). These need only numpy / scipy / scikit-image, so they
     run anywhere those are installed.
  2. A guarded contract test that builds the U-Net from the local
     ``microcapsule_unet.pt`` checkpoint and runs the full
     letterbox -> forward -> watershed -> contour pipeline, asserting the
     per-instance dict shape the rest of the stack carries through. Skipped
     unless the weights file and segmentation-models-pytorch are present — see
     the project memory `reference_run_ml_python_tests`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

WEIGHTS = SEG_ROOT / "weights" / "microcapsule_unet.pt"


# ---------------------------------------------------------------------------
# 1. Pure completeness-rule tests (no model required)
# ---------------------------------------------------------------------------
def test_touches_border_interior_polygon_is_complete():
    from models.microcapsule import _touches_border

    poly = np.array([[50, 50], [150, 50], [150, 150], [50, 150]], np.float32)
    assert _touches_border(poly, height=200, width=200) is False


@pytest.mark.parametrize(
    "poly",
    [
        np.array([[0, 40], [60, 40], [60, 120], [0, 120]], np.float32),  # left edge
        np.array([[40, 0], [120, 0], [120, 80], [40, 80]], np.float32),  # top edge
        np.array([[140, 40], [200, 40], [200, 120], [140, 120]], np.float32),  # right
        np.array([[40, 140], [120, 140], [120, 200], [40, 200]], np.float32),  # bottom
    ],
)
def test_touches_border_edge_polygon_is_incomplete(poly):
    from models.microcapsule import _touches_border

    assert _touches_border(poly, height=200, width=200) is True


def test_touches_border_respects_margin():
    from models.microcapsule import _touches_border, _BORDER_MARGIN_PX

    # Default margin is 20 px: a capsule reaching within 20 px of any edge is cut
    # off; an inset that clears 20 px on every edge is complete. Pixels run
    # 0..199, so the far thresholds are width-1-margin = 179 / height-1 = 179.
    assert _BORDER_MARGIN_PX == 20
    near = np.array([[18, 40], [60, 40], [60, 120], [18, 120]], np.float32)
    assert _touches_border(near, height=200, width=200) is True
    clear = np.array([[25, 25], [174, 25], [174, 174], [25, 174]], np.float32)
    assert _touches_border(clear, height=200, width=200) is False
    # Boundary: exactly at the margin is cut off; one px further in is complete.
    at_margin = np.array([[20, 40], [174, 40], [174, 174], [20, 174]], np.float32)
    assert _touches_border(at_margin, height=200, width=200) is True
    just_clear = np.array([[21, 40], [174, 40], [174, 174], [21, 174]], np.float32)
    assert _touches_border(just_clear, height=200, width=200) is False


# ---------------------------------------------------------------------------
# 1b. Watershed instance separation — touching capsules become distinct labels
# ---------------------------------------------------------------------------
def _disk_mask(size, cx, cy, r):
    yy, xx = np.ogrid[:size, :size]
    return ((xx - cx) ** 2 + (yy - cy) ** 2) <= r * r


def _fg_and_dist(mask):
    """Build the (foreground, normalized-distance) pair predict_instances eats."""
    from scipy.ndimage import distance_transform_edt

    fg = mask.astype(np.float32)
    dist = distance_transform_edt(mask).astype(np.float32)
    peak = dist.max()
    if peak > 0:
        dist = dist / peak
    return fg, dist


def test_predict_instances_single_disk_is_one_label():
    pytest.importorskip("skimage")
    from models.unet_lite import predict_instances

    fg, dist = _fg_and_dist(_disk_mask(200, 100, 100, 50))
    lab = predict_instances(fg, dist)
    assert lab.dtype == np.uint16
    assert lab.max() == 1


def test_predict_instances_splits_touching_disks():
    """A dumbbell of two overlapping disks must split into two labels: the
    distance peaks at the two centres clear the h-maxima prominence over the
    shallow neck between them."""
    pytest.importorskip("skimage")
    from models.unet_lite import predict_instances

    mask = _disk_mask(200, 65, 100, 40) | _disk_mask(200, 135, 100, 40)
    fg, dist = _fg_and_dist(mask)
    lab = predict_instances(fg, dist)
    assert lab.max() == 2


def test_predict_instances_two_disjoint_disks():
    pytest.importorskip("skimage")
    from models.unet_lite import predict_instances

    mask = _disk_mask(200, 50, 100, 30) | _disk_mask(200, 150, 100, 30)
    fg, dist = _fg_and_dist(mask)
    lab = predict_instances(fg, dist)
    assert lab.max() == 2


def test_predict_instances_empty_foreground_returns_zero():
    pytest.importorskip("skimage")
    from models.unet_lite import predict_instances

    zero = np.zeros((120, 120), np.float32)
    lab = predict_instances(zero, zero)
    assert lab.dtype == np.uint16
    assert lab.max() == 0


# ---------------------------------------------------------------------------
# 2. Guarded U-Net wrapper contract test (needs the local checkpoint + smp)
# ---------------------------------------------------------------------------
@pytest.mark.skipif(
    not WEIGHTS.exists(), reason="microcapsule_unet.pt not present in this env"
)
def test_unet_wrapper_predict_contract():
    pytest.importorskip("segmentation_models_pytorch")
    pytest.importorskip("skimage")
    import cv2
    import torch

    from models.microcapsule import MicrocapsuleModel

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MicrocapsuleModel()
    model.load_weights(str(WEIGHTS), device)

    # Bright-field-like synthetic frame: dark-rimmed discs on a mid-grey field.
    img = np.full((256, 256, 3), 180, np.uint8)
    for cx, cy in [(80, 80), (180, 175)]:
        cv2.circle(img, (cx, cy), 34, (70, 70, 70), -1)
        cv2.circle(img, (cx, cy), 34, (25, 25, 25), 3)

    instances = model.predict(img, conf=0.5)
    assert isinstance(instances, list)

    # Whatever the model finds must obey the contract the stack relies on.
    areas = [inst["area_px"] for inst in instances]
    assert areas == sorted(areas, reverse=True)  # largest-area first
    for inst in instances:
        poly = inst["polygon_xy"]
        assert poly.ndim == 2 and poly.shape[1] == 2 and len(poly) >= 3
        assert poly.dtype == np.float32
        assert 0.0 <= inst["confidence"] <= 1.0
        assert isinstance(inst["complete"], bool)
        assert inst["area_px"] == pytest.approx(
            float(cv2.contourArea(poly.astype(np.float32))), rel=1e-4, abs=1e-2
        )
        assert inst["equiv_diameter_px"] > 0
