"""
Reusable numpy mask fixtures for postprocessing and polygon tests.

All arrays are float32 in the range [0.0, 1.0] unless noted otherwise,
matching the output shape expected by PostprocessingService.mask_to_polygons().

Usage in a test file or conftest.py:
    from tests.fixtures.mask_fixtures import (
        single_circle_mask,
        multi_region_mask,
        mask_with_hole,
        edge_touching_mask,
        tiny_region_mask,
        sample_polygons,
    )
"""

import numpy as np
import pytest
from typing import List, Dict, Any


# ---------------------------------------------------------------------------
# Geometry helpers (module-level so fixtures can share them)
# ---------------------------------------------------------------------------

def _filled_circle(
    canvas: np.ndarray,
    cy: int,
    cx: int,
    radius: int,
    value: float = 1.0,
) -> None:
    """Draw a filled circle in-place on a 2-D float array."""
    h, w = canvas.shape
    y_indices, x_indices = np.ogrid[:h, :w]
    dist_sq = (y_indices - cy) ** 2 + (x_indices - cx) ** 2
    canvas[dist_sq <= radius ** 2] = value


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def single_circle_mask() -> np.ndarray:
    """
    256x256 float32 mask with a single filled circle.

    Circle centre: (128, 128), radius: 60 px.
    Foreground pixel count ≈ pi * 60^2 ≈ 11310 — well above min_area=50.
    """
    mask = np.zeros((256, 256), dtype=np.float32)
    _filled_circle(mask, cy=128, cx=128, radius=60)
    return mask


@pytest.fixture
def multi_region_mask() -> np.ndarray:
    """
    256x256 float32 mask with three non-overlapping circular blobs.

    Blob centres and radii (all well-separated):
      - blob 0: centre (50,  50), radius 30
      - blob 1: centre (128, 128), radius 35
      - blob 2: centre (200, 200), radius 25
    """
    mask = np.zeros((256, 256), dtype=np.float32)
    _filled_circle(mask, cy=50,  cx=50,  radius=30)
    _filled_circle(mask, cy=128, cx=128, radius=35)
    _filled_circle(mask, cy=200, cx=200, radius=25)
    return mask


@pytest.fixture
def mask_with_hole() -> np.ndarray:
    """
    256x256 float32 mask with a doughnut shape: outer circle with an inner
    circular hole of zeros.

    Outer circle: centre (128, 128), radius 70.
    Inner hole:   centre (128, 128), radius 30.
    """
    mask = np.zeros((256, 256), dtype=np.float32)
    _filled_circle(mask, cy=128, cx=128, radius=70)
    _filled_circle(mask, cy=128, cx=128, radius=30, value=0.0)
    return mask


@pytest.fixture
def edge_touching_mask() -> np.ndarray:
    """
    256x256 float32 mask with a blob that deliberately touches the left and
    top image boundaries.

    Circle centre (0, 0), radius 40 — the top-left quadrant is cropped by
    the image boundary, so the shape is a quarter-circle arc.
    """
    mask = np.zeros((256, 256), dtype=np.float32)
    _filled_circle(mask, cy=0, cx=0, radius=40)
    return mask


@pytest.fixture
def tiny_region_mask() -> np.ndarray:
    """
    256x256 float32 mask containing only regions that are below the default
    min_area threshold (50 pixels) used by PostprocessingService.

    Two tiny blobs:
      - 3x3  square at (10, 10)  → area = 9
      - 6x6  square at (50, 50)  → area = 36
    Both are below min_area=50 and should be filtered out.
    """
    mask = np.zeros((256, 256), dtype=np.float32)
    # 3×3 blob
    mask[10:13, 10:13] = 1.0
    # 6×6 blob
    mask[50:56, 50:56] = 1.0
    return mask


@pytest.fixture
def sample_polygons() -> List[Dict[str, Any]]:
    """
    Pre-built list of polygon dicts in the format returned by
    PostprocessingService._region_to_polygon().

    Suitable for testing filter_polygons(), optimize_polygons(), and
    polygons_to_coco_format() without running full mask→polygon conversion.
    """
    return [
        {
            "points": [
                {"x": 50.0, "y": 50.0},
                {"x": 150.0, "y": 50.0},
                {"x": 150.0, "y": 150.0},
                {"x": 50.0, "y": 150.0},
            ],
            "area": 10000.0,
            "confidence": 0.95,
            "type": "external",
        },
        {
            "points": [
                {"x": 10.0, "y": 10.0},
                {"x": 30.0, "y": 10.0},
                {"x": 30.0, "y": 30.0},
                {"x": 10.0, "y": 30.0},
            ],
            "area": 400.0,
            "confidence": 0.60,
            "type": "external",
        },
        {
            "points": [
                {"x": 200.0, "y": 180.0},
                {"x": 240.0, "y": 180.0},
                {"x": 240.0, "y": 220.0},
                {"x": 200.0, "y": 220.0},
            ],
            "area": 1600.0,
            "confidence": 0.82,
            "type": "external",
        },
    ]
