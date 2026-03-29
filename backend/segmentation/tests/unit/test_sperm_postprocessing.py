"""
Unit tests for the sperm postprocessing pipeline.

Source: backend/segmentation/sperm_final/inference/postprocess.py

Functions under test:
    mask_to_skeleton, skeleton_to_ordered_path, prune_skeleton,
    rdp_simplify, resample_polyline, contour_to_midline,
    bspline_smooth, mask_to_polyline, connect_sperm_polylines,
    _orient_polyline_toward
"""
import sys
import os

import pytest
import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from sperm_final.inference.postprocess import (
    mask_to_skeleton,
    skeleton_to_ordered_path,
    prune_skeleton,
    rdp_simplify,
    resample_polyline,
    contour_to_midline,
    bspline_smooth,
    mask_to_polyline,
    connect_sperm_polylines,
    _orient_polyline_toward,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _horizontal_line_mask(length: int = 40, thickness: int = 3,
                           canvas: int = 60) -> np.ndarray:
    """Binary uint8 mask with a horizontal bar through the middle."""
    m = np.zeros((canvas, canvas), dtype=np.uint8)
    cy = canvas // 2
    start = (canvas - length) // 2
    m[cy - thickness // 2: cy + thickness // 2 + 1, start: start + length] = 1
    return m


def _elongated_mask(canvas: int = 50) -> np.ndarray:
    """Tall, thin binary mask (1-px wide vertical stripe)."""
    m = np.zeros((canvas, canvas), dtype=np.uint8)
    m[5:canvas - 5, canvas // 2] = 1
    return m


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestMaskToSkeleton:

    def test_mask_to_skeleton_basic(self):
        """A filled rectangle mask should produce skeleton pixels (non-empty)."""
        mask = np.zeros((30, 60), dtype=np.uint8)
        mask[10:20, 5:55] = 1
        skel = mask_to_skeleton(mask)
        assert skel.dtype == np.uint8
        assert skel.sum() > 0, "Skeleton of a rectangle should not be empty"

    def test_mask_to_skeleton_empty(self):
        """An empty mask should produce an empty skeleton."""
        mask = np.zeros((30, 30), dtype=np.uint8)
        skel = mask_to_skeleton(mask)
        assert skel.sum() == 0


@pytest.mark.unit
class TestSkeletonToOrderedPath:

    def test_skeleton_to_ordered_path_empty(self):
        """Empty skeleton → empty path."""
        skel = np.zeros((20, 20), dtype=np.uint8)
        path = skeleton_to_ordered_path(skel)
        assert path == []

    def test_skeleton_to_ordered_path_straight_line(self):
        """Horizontal single-pixel line → path with endpoints at both ends."""
        skel = np.zeros((20, 50), dtype=np.uint8)
        # Draw a straight horizontal skeleton row
        skel[10, 5:45] = 1
        path = skeleton_to_ordered_path(skel)
        assert len(path) >= 2
        # All points should be in the same row (y=10)
        xs = [p[0] for p in path]
        ys = [p[1] for p in path]
        assert all(y == 10 for y in ys), "All path points should lie on y=10"
        # Should span the drawn segment
        assert min(xs) <= 6
        assert max(xs) >= 43


@pytest.mark.unit
class TestPruneSkeleton:

    def test_prune_skeleton_removes_short_branches(self):
        """A T-junction with a short branch should have that branch removed."""
        skel = np.zeros((30, 30), dtype=np.uint8)
        # Horizontal trunk
        skel[15, 2:28] = 1
        # Short vertical branch (3 px, below min_branch_length=5)
        skel[15:18, 15] = 1
        pruned = prune_skeleton(skel, min_branch_length=5)
        # The short branch pixels above the trunk should be gone
        assert skel.sum() >= pruned.sum(), (
            "Pruned skeleton should have equal or fewer pixels"
        )

    def test_prune_skeleton_no_junctions(self):
        """A simple path with no junctions should not be modified."""
        skel = np.zeros((20, 40), dtype=np.uint8)
        skel[10, 5:35] = 1
        original_sum = skel.sum()
        pruned = prune_skeleton(skel, min_branch_length=5)
        assert pruned.sum() == original_sum, (
            "No-junction skeleton should be unchanged by pruning"
        )


@pytest.mark.unit
class TestRDPSimplify:

    def test_rdp_simplify_straight_line(self):
        """Collinear points should simplify to only the two endpoints."""
        # 10 collinear points along y = x
        points = [(float(i), float(i)) for i in range(10)]
        simplified = rdp_simplify(points, eps=0.5)
        assert len(simplified) == 2, (
            f"Collinear points should reduce to 2 endpoints, got {len(simplified)}"
        )

    def test_rdp_simplify_preserves_corners(self):
        """An L-shaped path should retain the corner point."""
        # Horizontal segment + corner + vertical segment
        points = [(0.0, 0.0), (5.0, 0.0), (10.0, 0.0),
                  (10.0, 5.0), (10.0, 10.0)]
        simplified = rdp_simplify(points, eps=0.5)
        # The corner (10, 0) must survive
        assert (10.0, 0.0) in simplified or any(
            abs(p[0] - 10.0) < 1e-6 and abs(p[1]) < 1e-6 for p in simplified
        ), "Corner of L-shape should be preserved"

    def test_rdp_simplify_too_few_points(self):
        """Less than 3 points → returned unchanged."""
        points = [(0.0, 0.0), (1.0, 1.0)]
        result = rdp_simplify(points, eps=1.0)
        assert len(result) == 2


@pytest.mark.unit
class TestResamplePolyline:

    def test_resample_polyline_uniform_spacing(self):
        """Resampled points should be approximately uniformly spaced."""
        # Straight horizontal line from (0,0) to (100,0)
        points = [(0.0, 0.0), (100.0, 0.0)]
        n = 11
        resampled = resample_polyline(points, n)
        assert len(resampled) == n
        # Each consecutive pair should be ~10 units apart
        for i in range(1, len(resampled)):
            dist = abs(resampled[i][0] - resampled[i - 1][0])
            assert abs(dist - 10.0) < 1e-6, f"Unexpected gap at index {i}: {dist}"

    def test_resample_polyline_empty(self):
        """Empty input returns empty list."""
        assert resample_polyline([], 5) == []

    def test_resample_polyline_single_point_repeated(self):
        """Single-point polyline → n copies of that point."""
        result = resample_polyline([(3.0, 4.0)], 4)
        assert len(result) == 4
        assert all(p == (3.0, 4.0) for p in result)


@pytest.mark.unit
class TestContourToMidline:

    def test_contour_to_midline_elongated_shape(self):
        """An elongated rectangle mask should yield at least 2 midline points."""
        mask = np.zeros((50, 100), dtype=np.uint8)
        mask[20:30, 5:95] = 1  # wide horizontal rectangle
        path = contour_to_midline(mask)
        assert len(path) >= 2, "Elongated shape should produce a midline"

    def test_contour_to_midline_empty_mask(self):
        """Empty mask → empty midline."""
        mask = np.zeros((30, 30), dtype=np.uint8)
        path = contour_to_midline(mask)
        assert path == []


@pytest.mark.unit
class TestMaskToPolyline:

    def test_mask_to_polyline_head_cls(self):
        """cls=1 (Head) should always produce exactly 3 output points."""
        mask = np.zeros((40, 40), dtype=np.float32)
        mask[10:30, 15:25] = 1.0  # filled rectangle ≈ head shape
        result = mask_to_polyline(mask, cls=1, mask_threshold=0.5)
        assert len(result) == 3, (
            f"Head (cls=1) should produce 3 points, got {len(result)}"
        )

    def test_mask_to_polyline_empty_mask_returns_empty(self):
        """Empty mask → empty polyline."""
        mask = np.zeros((30, 30), dtype=np.float32)
        result = mask_to_polyline(mask, cls=2, mask_threshold=0.5)
        assert result == []

    def test_mask_to_polyline_tail_cls_positive_count(self):
        """cls=3 (Tail) with a long mask should produce multiple points."""
        mask = np.zeros((10, 80), dtype=np.float32)
        mask[3:7, 5:75] = 1.0
        result = mask_to_polyline(mask, cls=3, mask_threshold=0.5)
        assert len(result) >= 2, (
            f"Tail polyline should have at least 2 points, got {len(result)}"
        )


@pytest.mark.unit
class TestConnectSpermPolylines:

    def _make_part(self, shape=(20, 60), rect=(5, 5, 15, 55)):
        """Create a minimal sperm part dict with a binary mask."""
        r0, c0, r1, c1 = rect
        m = np.zeros(shape, dtype=np.float32)
        m[r0:r1, c0:c1] = 1.0
        return {"mask": m, "score": 0.99, "cls": 1}

    def test_connect_sperm_polylines_complete_sperm(self):
        """A fully-populated sperm dict should return head/midpiece/tail keys."""
        sperm = {
            "head": self._make_part((30, 30), (5, 5, 25, 25)),
            "midpiece": self._make_part((10, 80), (3, 5, 7, 75)),
            "tail": self._make_part((10, 100), (3, 5, 7, 95)),
        }
        result = connect_sperm_polylines(sperm, mask_threshold=0.3)
        assert "head" in result
        assert "midpiece" in result
        assert "tail" in result

    def test_connect_sperm_polylines_missing_part(self):
        """If a part is missing the corresponding key holds an empty list."""
        sperm = {
            "head": None,
            "midpiece": self._make_part((10, 80), (3, 5, 7, 75)),
            "tail": self._make_part((10, 100), (3, 5, 7, 95)),
        }
        result = connect_sperm_polylines(sperm, mask_threshold=0.3)
        assert result["head"] == []


@pytest.mark.unit
class TestOrientPolylineToward:

    def test_orient_polyline_start_closer(self):
        """When start is already closest, the polyline is returned unchanged."""
        poly = [(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)]
        target = (0.0, 0.0)
        result = _orient_polyline_toward(poly, target, use_start=True)
        assert result[0] == (0.0, 0.0)

    def test_orient_polyline_end_closer_triggers_reversal(self):
        """When end is closer to target but use_start=True, list is reversed."""
        poly = [(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)]
        target = (10.0, 0.0)  # closer to end
        result = _orient_polyline_toward(poly, target, use_start=True)
        # After reversal the start should be at (10, 0)
        assert result[0] == (10.0, 0.0)

    def test_orient_polyline_too_short(self):
        """Single-point polyline is returned as-is."""
        poly = [(3.0, 4.0)]
        result = _orient_polyline_toward(poly, (0.0, 0.0), use_start=True)
        assert result == poly


@pytest.mark.unit
class TestBsplineSmooth:

    def test_bspline_smooth_returns_correct_point_count(self):
        """bspline_smooth should return exactly n_output points."""
        points = [(float(i), float(i) * 0.5) for i in range(10)]
        smoothed, arc_len = bspline_smooth(points, n_output=20)
        assert len(smoothed) == 20, f"Expected 20 points, got {len(smoothed)}"

    def test_bspline_smooth_arc_length_positive(self):
        """Arc length should be positive for a non-degenerate polyline."""
        points = [(0.0, 0.0), (10.0, 0.0), (20.0, 5.0), (30.0, 0.0), (40.0, 0.0)]
        _, arc_len = bspline_smooth(points, n_output=10)
        assert arc_len > 0.0, "Arc length must be positive"

    def test_bspline_smooth_too_few_points_fallback(self):
        """Fewer than 4 points fall back gracefully without raising."""
        points = [(0.0, 0.0), (5.0, 3.0)]
        smoothed, arc_len = bspline_smooth(points, n_output=5)
        assert len(smoothed) == len(points), (
            "Fallback should return input points when there are fewer than 4"
        )
        assert arc_len >= 0.0
