"""Tests for the microcapsule SAM 3 instance-segmentation wrapper.

Two layers:
  1. Pure unit tests — the completeness rule (`_touches_border`, which decides
     which capsules are excluded from metrics) and the nested-mask merge
     (`_merge_nested`, which collapses a capsule's outer shell / inner wall /
     interior bubble to one outer boundary). No SAM 3 / GPU needed, so these
     always run.
  2. A guarded integration smoke test that builds SAM 3 and runs the "circle"
     prompt on a real image. Skipped unless the `sam3` package is installed
     (it downloads the ~3.4 GB sam3.pt from HuggingFace), so it only runs in the
     GPU one-off ML container — see the project memory
     `reference_run_ml_python_tests`.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import pytest

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

REAL_IMAGE = Path("/tmp/mc_test/real_339.tiff")  # provided in the GPU test env


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
    from models.microcapsule import _touches_border

    near = np.array([[3, 40], [60, 40], [60, 120], [3, 120]], np.float32)
    assert _touches_border(near, height=200, width=200) is True
    clear = np.array([[4, 4], [196, 4], [196, 196], [4, 196]], np.float32)
    assert _touches_border(clear, height=200, width=200) is False


# ---------------------------------------------------------------------------
# 1b. Nested-mask merge — one outer boundary per capsule
# ---------------------------------------------------------------------------
def _disk(size, cx, cy, r):
    yy, xx = np.ogrid[:size, :size]
    return ((xx - cx) ** 2 + (yy - cy) ** 2) <= r * r


def _ring(size, cx, cy, r_outer, r_inner):
    yy, xx = np.ogrid[:size, :size]
    d2 = (xx - cx) ** 2 + (yy - cy) ** 2
    return (d2 <= r_outer * r_outer) & (d2 >= r_inner * r_inner)


def test_merge_nested_collapses_outer_ring_and_inner_disk():
    """SAM 3's outer mask is often an annulus; on the RAW ring an inner disk
    barely overlaps, so containment must be measured on hole-FILLED masks."""
    from models.microcapsule import _merge_nested

    outer_ring = _ring(300, 150, 150, 100, 78)  # capsule shell (hollow centre)
    inner_disk = _disk(300, 150, 150, 75)        # inner wall (sits in the hole)
    # Raw overlap is tiny (disk falls in the ring's hole) but they ARE concentric.
    kept = _merge_nested([inner_disk, outer_ring])
    assert kept == [1]  # only the (filled) outer ring survives


def test_merge_nested_drops_inner_and_bubble_keeps_outer():
    from models.microcapsule import _merge_nested

    outer = _disk(240, 120, 120, 90)   # capsule outer shell (largest)
    inner = _disk(240, 120, 120, 70)   # inner wall (fully inside outer)
    bubble = _disk(240, 120, 120, 12)  # interior bubble (fully inside outer)
    kept = _merge_nested([inner, outer, bubble])
    # Only the outer mask (index 1 in the input) survives.
    assert kept == [1]


def test_merge_nested_keeps_separate_capsules():
    from models.microcapsule import _merge_nested

    a = _disk(240, 70, 120, 50)
    b = _disk(240, 180, 120, 50)  # disjoint capsule
    kept = _merge_nested([a, b])
    assert sorted(kept) == [0, 1]  # both kept (not nested)


def test_merge_nested_ignores_empty_masks():
    from models.microcapsule import _merge_nested

    empty = np.zeros((240, 240), bool)
    disk = _disk(240, 120, 120, 60)
    kept = _merge_nested([empty, disk])
    assert kept == [1]


# ---------------------------------------------------------------------------
# 2. Guarded SAM 3 integration smoke test
# ---------------------------------------------------------------------------
@pytest.mark.skipif(
    not REAL_IMAGE.exists(), reason="real test image not present in this env"
)
def test_sam3_circle_segments_capsules():
    pytest.importorskip("sam3")
    import cv2
    import tifffile
    import torch
    from models.microcapsule import MicrocapsuleModel

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MicrocapsuleModel()
    model.load_weights(os.environ.get("HF_HOME", "weights/sam3"), device)

    img = tifffile.imread(str(REAL_IMAGE))
    if img.ndim == 2:
        img = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_GRAY2BGR)
    else:
        img = cv2.cvtColor(img[:, :, :3].astype(np.uint8), cv2.COLOR_RGB2BGR)

    instances = model.predict(img, conf=0.3)
    assert len(instances) >= 1
    for inst in instances:
        poly = inst["polygon_xy"]
        assert poly.shape[1] == 2 and len(poly) >= 3
        assert 0.0 <= inst["confidence"] <= 1.0
        assert inst["area_px"] == pytest.approx(
            float(cv2.contourArea(poly)), rel=1e-5, abs=1e-3
        )
        assert isinstance(inst["complete"], bool)
    # Largest first (deterministic instance numbering).
    areas = [inst["area_px"] for inst in instances]
    assert areas == sorted(areas, reverse=True)
