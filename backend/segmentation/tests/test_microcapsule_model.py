"""Tests for the microcapsule YOLO11n-seg instance-segmentation wrapper.

Two layers:
  1. Pure unit tests for `_touches_border` — the completeness rule that decides
     which capsules are excluded from metrics. No weights / ultralytics needed,
     so these always run.
  2. An integration smoke test that loads the real weights against a synthetic
     bright-field-style image (capsule-like rings, some deliberately clipped by
     the frame) and asserts the wrapper's output contract: per-instance
     polygons, the complete/incomplete border flag, and area_px == contourArea.
     Skipped when ultralytics or the weights file is absent.

Run inside a GPU one-off ML container (pytest is not installed in the image) —
see the project memory `reference_run_ml_python_tests`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

WEIGHTS = SEG_ROOT / "weights" / "microcapsule_yolo11n.pt"


# ---------------------------------------------------------------------------
# 1. Pure completeness-rule tests (no model / weights required)
# ---------------------------------------------------------------------------
def test_touches_border_interior_polygon_is_complete():
    from models.microcapsule import _touches_border

    # A square well inside a 200x200 frame — no edge contact.
    poly = np.array([[50, 50], [150, 50], [150, 150], [50, 150]], np.float32)
    assert _touches_border(poly, height=200, width=200) is False


@pytest.mark.parametrize(
    "poly",
    [
        np.array([[0, 40], [60, 40], [60, 120], [0, 120]], np.float32),  # left edge
        np.array([[40, 0], [120, 0], [120, 80], [40, 80]], np.float32),  # top edge
        np.array(
            [[140, 40], [200, 40], [200, 120], [140, 120]], np.float32
        ),  # right edge (width=200)
        np.array(
            [[40, 140], [120, 140], [120, 200], [40, 200]], np.float32
        ),  # bottom edge (height=200)
    ],
)
def test_touches_border_edge_polygon_is_incomplete(poly):
    from models.microcapsule import _touches_border

    assert _touches_border(poly, height=200, width=200) is True


def test_touches_border_respects_margin():
    from models.microcapsule import _touches_border

    # 3 px from the left edge → within the default 3 px margin → cut off.
    near = np.array([[3, 40], [60, 40], [60, 120], [3, 120]], np.float32)
    assert _touches_border(near, height=200, width=200) is True
    # 4 px from every edge → outside the margin → complete.
    clear = np.array([[4, 4], [196, 4], [196, 196], [4, 196]], np.float32)
    assert _touches_border(clear, height=200, width=200) is False


# ---------------------------------------------------------------------------
# 2. Integration smoke test against the real weights
# ---------------------------------------------------------------------------
def _synthetic_capsules():
    """A 1280x1024 bright-field-ish image with 5 capsule-like rings.

    Returns (image_bgr, n_interior, n_clipped) where the first 3 capsules are
    fully inside the frame and the last 2 run off the border.
    """
    import cv2

    w, h = 1280, 1024
    img = np.full((h, w, 3), 205, np.uint8)
    capsules = [
        (300, 300, 90),     # interior
        (700, 500, 120),    # interior
        (980, 760, 70),     # interior
        (40, 520, 110),     # clipped by LEFT edge
        (1180, 180, 130),   # clipped by RIGHT/TOP corner
    ]
    for (cx, cy, r) in capsules:
        cv2.circle(img, (cx, cy), r, (175, 175, 175), -1)
        cv2.circle(img, (cx, cy), max(r - 10, 1), (200, 200, 200), -1)
        cv2.circle(img, (cx, cy), r, (95, 95, 95), 4)
    return img, 3, 2


@pytest.mark.skipif(
    not WEIGHTS.exists(), reason="microcapsule_yolo11n.pt not placed"
)
def test_microcapsule_wrapper_output_contract():
    pytest.importorskip("ultralytics")
    import cv2
    import torch
    from models.microcapsule import MicrocapsuleModel, _touches_border

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MicrocapsuleModel()
    model.load_weights(str(WEIGHTS), device)

    img, _, _ = _synthetic_capsules()
    h, w = img.shape[:2]
    instances = model.predict(img, conf=0.25)

    # The model detects capsules on this synthetic image.
    assert len(instances) >= 1, "expected at least one detected capsule"

    for inst in instances:
        poly = inst["polygon_xy"]
        assert poly.shape[1] == 2 and len(poly) >= 3
        # confidence is a probability
        assert 0.0 <= inst["confidence"] <= 1.0
        # area_px is exactly cv2.contourArea of the returned polygon
        assert inst["area_px"] == pytest.approx(
            float(cv2.contourArea(poly)), rel=1e-5, abs=1e-3
        )
        # equiv diameter follows 2*sqrt(area/pi)
        expected_d = 2.0 * float(np.sqrt(inst["area_px"] / np.pi))
        assert inst["equiv_diameter_px"] == pytest.approx(expected_d, rel=1e-6)
        # complete flag agrees with the border rule applied to its polygon
        assert inst["complete"] == (not _touches_border(poly, h, w))

    # Sorted largest-area first (deterministic instance numbering).
    areas = [inst["area_px"] for inst in instances]
    assert areas == sorted(areas, reverse=True)


@pytest.mark.skipif(
    not WEIGHTS.exists(), reason="microcapsule_yolo11n.pt not placed"
)
def test_microcapsule_detects_border_cut_capsules():
    pytest.importorskip("ultralytics")
    import torch
    from models.microcapsule import MicrocapsuleModel

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = MicrocapsuleModel()
    model.load_weights(str(WEIGHTS), device)

    img, n_interior, n_clipped = _synthetic_capsules()
    instances = model.predict(img, conf=0.25)

    complete = [i for i in instances if i["complete"]]
    incomplete = [i for i in instances if not i["complete"]]

    # The two frame-clipped capsules must be flagged incomplete, and at least
    # the interior capsules complete. (Exact counts depend on detections, so we
    # assert the directional invariant the metrics filter relies on.)
    assert len(incomplete) >= 1, "border-cut capsules should be flagged incomplete"
    assert len(complete) >= 1, "interior capsules should be flagged complete"
