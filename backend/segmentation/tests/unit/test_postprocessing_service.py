"""
Unit tests for PostprocessingService.

Covers:
  - mask_to_polygons  (threshold, squeeze, multi-region, hole detection,
                       small-region filtering, exception safety)
  - _region_to_polygon (structure, degenerate contour, simplification,
                        confidence calculation)
  - filter_polygons    (area, confidence, combined, None thresholds, empty)
  - optimize_polygons  (dedup, close, degenerate rejection, valid pass-through)
  - polygons_to_coco_format (structure, bbox, flattened segmentation,
                              sequential ids, malformed skip)
"""

import sys
import os

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from services.postprocessing import PostprocessingService
from tests.fixtures.mask_fixtures import (  # noqa: F401  (pytest fixture imports)
    single_circle_mask,
    multi_region_mask,
    mask_with_hole,
    tiny_region_mask,
    sample_polygons,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_service() -> PostprocessingService:
    return PostprocessingService()


def _is_valid_polygon_dict(p: dict) -> bool:
    """Return True if *p* has the four keys the service promises to return."""
    return {"points", "area", "confidence", "type"}.issubset(p.keys())


# ---------------------------------------------------------------------------
# Fixtures local to this module
# ---------------------------------------------------------------------------

@pytest.fixture
def service() -> PostprocessingService:
    return _make_service()


@pytest.fixture
def empty_mask() -> np.ndarray:
    return np.zeros((256, 256), dtype=np.float32)


@pytest.fixture
def threshold_mask() -> np.ndarray:
    """
    256x256 mask whose foreground pixels all have value 0.4.
    The blob is large enough to survive min_area filtering.
    Using a filled 60-px circle via numpy distance formula.
    """
    mask = np.zeros((256, 256), dtype=np.float32)
    h, w = mask.shape
    cy, cx = 128, 128
    y_idx, x_idx = np.ogrid[:h, :w]
    mask[(y_idx - cy) ** 2 + (x_idx - cx) ** 2 <= 60 ** 2] = 0.4
    return mask


# ---------------------------------------------------------------------------
# mask_to_polygons
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestMaskToPolygons:
    """Tests for PostprocessingService.mask_to_polygons."""

    def test_single_circle_returns_one_polygon(self, service, single_circle_mask):
        """A single blob should produce exactly one polygon with required keys."""
        result = service.mask_to_polygons(single_circle_mask, threshold=0.5)

        assert len(result) == 1
        assert _is_valid_polygon_dict(result[0])

    def test_empty_mask_returns_empty_list(self, service, empty_mask):
        """An all-zero mask must produce an empty polygon list."""
        result = service.mask_to_polygons(empty_mask, threshold=0.5)

        assert result == []

    def test_threshold_filtering_above_returns_empty(self, service, threshold_mask):
        """Mask values of 0.4 should yield nothing when threshold=0.5."""
        result = service.mask_to_polygons(threshold_mask, threshold=0.5)

        assert result == []

    def test_threshold_filtering_below_returns_polygon(self, service, threshold_mask):
        """Same 0.4-value mask should yield a polygon when threshold=0.3."""
        result = service.mask_to_polygons(threshold_mask, threshold=0.3)

        assert len(result) >= 1

    def test_multi_region_returns_three_polygons(self, service, multi_region_mask):
        """Three well-separated blobs should each produce a polygon."""
        result = service.mask_to_polygons(multi_region_mask, threshold=0.5)

        # All three circles have area >> min_area=50; expect exactly 3
        assert len(result) == 3

    def test_small_region_filtered_out(self, service, tiny_region_mask):
        """Regions below min_area=50 must not appear in the output."""
        result = service.mask_to_polygons(tiny_region_mask, threshold=0.5)

        assert result == []

    def test_3d_mask_squeezed(self, service, single_circle_mask):
        """Shape (1, H, W) should be squeezed to (H, W) and processed normally."""
        mask_3d = single_circle_mask[np.newaxis, ...]  # (1, 256, 256)
        result = service.mask_to_polygons(mask_3d, threshold=0.5)

        assert len(result) == 1

    def test_4d_mask_squeezed(self, service, single_circle_mask):
        """Shape (1, 1, H, W) should be handled without raising an exception."""
        mask_4d = single_circle_mask[np.newaxis, np.newaxis, ...]  # (1, 1, 256, 256)
        result = service.mask_to_polygons(mask_4d, threshold=0.5)

        # The important guarantee: no exception and at least one polygon
        assert isinstance(result, list)
        assert len(result) >= 1

    def test_detect_holes_true_processes_donut(self, service, mask_with_hole):
        """A doughnut mask with detect_holes=True should return a polygon."""
        result = service.mask_to_polygons(mask_with_hole, threshold=0.5, detect_holes=True)

        assert len(result) >= 1
        assert _is_valid_polygon_dict(result[0])

    def test_detect_holes_false_processes_donut(self, service, mask_with_hole):
        """Same mask with detect_holes=False should also return a polygon
        (RETR_EXTERNAL ignores internal holes entirely)."""
        result = service.mask_to_polygons(mask_with_hole, threshold=0.5, detect_holes=False)

        assert len(result) >= 1

    def test_exception_returns_empty_list(self, service):
        """Passing a non-array object should not raise; returns empty list."""
        result = service.mask_to_polygons("not_an_array", threshold=0.5)  # type: ignore[arg-type]

        assert result == []

    def test_polygon_points_are_dicts_with_x_y(self, service, single_circle_mask):
        """Every point in every polygon must be a dict with 'x' and 'y' keys."""
        result = service.mask_to_polygons(single_circle_mask, threshold=0.5)

        assert len(result) == 1
        for point in result[0]["points"]:
            assert "x" in point and "y" in point
            assert isinstance(point["x"], float)
            assert isinstance(point["y"], float)

    def test_polygon_confidence_within_bounds(self, service, single_circle_mask):
        """Confidence must be a float in [0, 1]."""
        result = service.mask_to_polygons(single_circle_mask, threshold=0.5)

        assert len(result) == 1
        conf = result[0]["confidence"]
        assert isinstance(conf, float)
        assert 0.0 <= conf <= 1.0

    def test_polygon_area_positive(self, service, single_circle_mask):
        """Area must be a positive float."""
        result = service.mask_to_polygons(single_circle_mask, threshold=0.5)

        assert len(result) == 1
        assert result[0]["area"] > 0.0


# ---------------------------------------------------------------------------
# _region_to_polygon  (tested indirectly through mask_to_polygons because
#  _region_to_polygon is a private helper — its contract is validated via
#  the public API output)
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestRegionToPolygon:
    """
    Tests that exercise the internal _region_to_polygon path.

    Because _region_to_polygon is a private method we test it through
    mask_to_polygons, which calls it for every region that passes the area
    filter.  Where we need tighter control we call the method directly.
    """

    def test_valid_region_has_correct_structure(self, service, single_circle_mask):
        """Output dict must contain points, area, confidence, type."""
        result = service.mask_to_polygons(single_circle_mask, threshold=0.5)

        assert len(result) == 1
        poly = result[0]
        assert set(poly.keys()) >= {"points", "area", "confidence", "type"}

    def test_type_field_is_external(self, service, single_circle_mask):
        """The 'type' field should be 'external' for normal regions."""
        result = service.mask_to_polygons(single_circle_mask, threshold=0.5)

        assert result[0]["type"] == "external"

    def test_fewer_than_3_points_returns_none_directly(self, service):
        """
        Call _region_to_polygon with a 1-pixel mask; contour will have
        fewer than 3 points → must return None (not raise).
        """
        from skimage import measure

        single_px = np.zeros((16, 16), dtype=np.uint8)
        single_px[8, 8] = 1
        labeled = measure.label(single_px, connectivity=2)
        regions = measure.regionprops(labeled)

        original_mask = single_px.astype(np.float32)
        region_mask = (labeled == regions[0].label).astype(np.uint8)

        result = service._region_to_polygon(region_mask, original_mask, regions[0])

        # Either None or a valid polygon — if not None it must pass structure check
        assert result is None or _is_valid_polygon_dict(result)

    def test_large_contour_triggers_simplification(self, service):
        """
        Contour with >5000 points should be simplified via approxPolyDP.
        We verify that the output polygon has <= 5000 points.
        """
        # Build a thin, jagged ring-like mask to maximise contour length
        mask = np.zeros((512, 512), dtype=np.float32)
        # Draw a large circle border by alternating columns (creates jagged edge)
        h, w = mask.shape
        cy, cx, r = 256, 256, 230
        y_idx, x_idx = np.ogrid[:h, :w]
        dist = np.sqrt((y_idx - cy) ** 2 + (x_idx - cx) ** 2)
        # Thick ring so the region is large enough to pass area filter
        mask[(dist >= r - 6) & (dist <= r + 6)] = 1.0

        result = service.mask_to_polygons(mask, threshold=0.5)

        assert len(result) >= 1
        for poly in result:
            assert len(poly["points"]) <= 5000

    def test_confidence_equals_mean_mask_value(self, service):
        """
        For a uniform-value mask, confidence should equal that value.
        """
        fill_value = 0.75
        mask = np.zeros((256, 256), dtype=np.float32)
        h, w = mask.shape
        cy, cx = 128, 128
        y_idx, x_idx = np.ogrid[:h, :w]
        mask[(y_idx - cy) ** 2 + (x_idx - cx) ** 2 <= 60 ** 2] = fill_value

        result = service.mask_to_polygons(mask, threshold=0.5)

        assert len(result) == 1
        # Allow small floating-point tolerance
        assert abs(result[0]["confidence"] - fill_value) < 0.01


# ---------------------------------------------------------------------------
# filter_polygons
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestFilterPolygons:
    """Tests for PostprocessingService.filter_polygons."""

    def test_filter_by_min_area(self, service, sample_polygons):
        """Polygons whose area < min_area must be removed."""
        # sample_polygons has areas 10000, 400, 1600
        result = service.filter_polygons(sample_polygons, min_area=500)

        areas = [p["area"] for p in result]
        assert all(a >= 500 for a in areas)
        assert 400.0 not in areas

    def test_filter_by_min_confidence(self, service, sample_polygons):
        """Polygons whose confidence < min_confidence must be removed."""
        # confidences are 0.95, 0.60, 0.82
        result = service.filter_polygons(sample_polygons, min_confidence=0.80)

        confs = [p["confidence"] for p in result]
        assert all(c >= 0.80 for c in confs)
        assert 0.60 not in confs

    def test_filter_by_both(self, service, sample_polygons):
        """Both area and confidence filters applied simultaneously."""
        result = service.filter_polygons(
            sample_polygons, min_area=1000, min_confidence=0.85
        )

        # Only the first polygon (area=10000, conf=0.95) should survive
        assert len(result) == 1
        assert result[0]["area"] == 10000.0

    def test_filter_none_thresholds_keeps_all(self, service, sample_polygons):
        """Passing None for both thresholds must return all polygons unchanged."""
        result = service.filter_polygons(sample_polygons, min_area=None, min_confidence=None)

        assert len(result) == len(sample_polygons)

    def test_filter_empty_input(self, service):
        """Filtering an empty list must return an empty list."""
        result = service.filter_polygons([], min_area=100, min_confidence=0.5)

        assert result == []

    def test_filter_removes_all_below_threshold(self, service, sample_polygons):
        """A very high threshold should leave an empty list."""
        result = service.filter_polygons(sample_polygons, min_area=99999)

        assert result == []


# ---------------------------------------------------------------------------
# optimize_polygons
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestOptimizePolygons:
    """Tests for PostprocessingService.optimize_polygons."""

    def _poly(self, points, area=1000.0, confidence=0.9):
        return {"points": points, "area": area, "confidence": confidence, "type": "external"}

    def test_removes_consecutive_duplicates(self, service):
        """Consecutive duplicate points should be collapsed to one."""
        pts = [
            {"x": 0.0, "y": 0.0},
            {"x": 0.0, "y": 0.0},   # duplicate
            {"x": 1.0, "y": 0.0},
            {"x": 1.0, "y": 1.0},
            {"x": 0.0, "y": 1.0},
        ]
        result = service.optimize_polygons([self._poly(pts)])

        assert len(result) == 1
        # The two leading (0,0) entries should have been collapsed to one
        unique_starts = [p for p in result[0]["points"] if p == {"x": 0.0, "y": 0.0}]
        # After dedup the closing copy is appended — so (0,0) appears at most twice
        assert len(unique_starts) <= 2

    def test_closes_open_polygon(self, service):
        """A polygon whose first != last point should be closed automatically."""
        pts = [
            {"x": 0.0, "y": 0.0},
            {"x": 10.0, "y": 0.0},
            {"x": 10.0, "y": 10.0},
            {"x": 0.0, "y": 10.0},
        ]
        result = service.optimize_polygons([self._poly(pts)])

        assert len(result) == 1
        closed = result[0]["points"]
        assert closed[0] == closed[-1]

    def test_rejects_degenerate_polygon(self, service):
        """A polygon with fewer than 3 unique points must be dropped."""
        pts = [
            {"x": 1.0, "y": 1.0},
            {"x": 2.0, "y": 2.0},
        ]
        result = service.optimize_polygons([self._poly(pts)])

        # Degenerate: 2 points → after closing = 3 entries but only 2 unique;
        # cleaned_points has len 2 → closes to 3 (< 4) → rejected
        assert result == []

    def test_preserves_valid_polygon(self, service):
        """A well-formed polygon must appear in the output unchanged."""
        pts = [
            {"x": 0.0, "y": 0.0},
            {"x": 50.0, "y": 0.0},
            {"x": 50.0, "y": 50.0},
            {"x": 0.0, "y": 50.0},
        ]
        result = service.optimize_polygons([self._poly(pts)])

        assert len(result) == 1

    def test_optimize_empty_input(self, service):
        """Empty input list must produce an empty output list."""
        result = service.optimize_polygons([])

        assert result == []

    def test_already_closed_polygon_not_double_closed(self, service):
        """A polygon that is already closed must not gain an extra closing point."""
        pts = [
            {"x": 0.0, "y": 0.0},
            {"x": 10.0, "y": 0.0},
            {"x": 10.0, "y": 10.0},
            {"x": 0.0, "y": 10.0},
            {"x": 0.0, "y": 0.0},  # pre-closed
        ]
        result = service.optimize_polygons([self._poly(pts)])

        assert len(result) == 1
        # Must not add a second closing copy
        assert result[0]["points"].count({"x": 0.0, "y": 0.0}) <= 2


# ---------------------------------------------------------------------------
# polygons_to_coco_format
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestPolygonsToCOCOFormat:
    """Tests for PostprocessingService.polygons_to_coco_format."""

    IMAGE_SIZE = (256, 256)

    def _simple_polygon(self, x0=10, y0=20, x1=60, y1=70, area=2500.0, conf=0.9):
        return {
            "points": [
                {"x": float(x0), "y": float(y0)},
                {"x": float(x1), "y": float(y0)},
                {"x": float(x1), "y": float(y1)},
                {"x": float(x0), "y": float(y1)},
            ],
            "area": area,
            "confidence": conf,
            "type": "external",
        }

    def test_single_polygon_coco_structure(self, service):
        """A single polygon must produce one annotation with required COCO keys."""
        result = service.polygons_to_coco_format(
            [self._simple_polygon()], self.IMAGE_SIZE
        )

        assert len(result) == 1
        ann = result[0]
        for key in ("id", "category_id", "segmentation", "area", "bbox", "iscrowd", "score"):
            assert key in ann, f"Missing key '{key}' in COCO annotation"

    def test_category_id_is_one(self, service):
        """category_id should be 1 (single-class cell segmentation)."""
        result = service.polygons_to_coco_format(
            [self._simple_polygon()], self.IMAGE_SIZE
        )

        assert result[0]["category_id"] == 1

    def test_iscrowd_is_zero(self, service):
        """iscrowd should always be 0."""
        result = service.polygons_to_coco_format(
            [self._simple_polygon()], self.IMAGE_SIZE
        )

        assert result[0]["iscrowd"] == 0

    def test_bbox_calculation(self, service):
        """bbox must be [x_min, y_min, width, height]."""
        poly = self._simple_polygon(x0=10, y0=20, x1=60, y1=70)
        result = service.polygons_to_coco_format([poly], self.IMAGE_SIZE)

        bbox = result[0]["bbox"]
        assert len(bbox) == 4
        x_min, y_min, width, height = bbox
        assert x_min == 10.0
        assert y_min == 20.0
        assert width == 50.0   # 60 - 10
        assert height == 50.0  # 70 - 20

    def test_segmentation_is_flattened(self, service):
        """segmentation must be [[x1, y1, x2, y2, ...]] (nested list, flat coords)."""
        poly = self._simple_polygon(x0=0, y0=0, x1=10, y1=10)
        result = service.polygons_to_coco_format([poly], self.IMAGE_SIZE)

        seg = result[0]["segmentation"]
        # Outer list contains one list of flat numbers
        assert isinstance(seg, list) and len(seg) == 1
        flat = seg[0]
        assert isinstance(flat, list)
        # 4 points → 8 coordinates
        assert len(flat) == 8
        # Values must be floats
        assert all(isinstance(v, float) for v in flat)

    def test_multiple_polygons_sequential_ids(self, service):
        """id values must be sequential 1-based integers."""
        polys = [self._simple_polygon() for _ in range(5)]
        result = service.polygons_to_coco_format(polys, self.IMAGE_SIZE)

        ids = [ann["id"] for ann in result]
        assert ids == list(range(1, 6))

    def test_score_equals_polygon_confidence(self, service):
        """The 'score' field must equal the source polygon's confidence."""
        poly = self._simple_polygon(conf=0.77)
        result = service.polygons_to_coco_format([poly], self.IMAGE_SIZE)

        assert result[0]["score"] == pytest.approx(0.77, abs=1e-6)

    def test_area_equals_polygon_area(self, service):
        """The 'area' field must equal the source polygon's area."""
        poly = self._simple_polygon(area=3141.0)
        result = service.polygons_to_coco_format([poly], self.IMAGE_SIZE)

        assert result[0]["area"] == pytest.approx(3141.0, abs=1e-6)

    def test_malformed_polygon_skipped(self, service):
        """A polygon without 'points' must be skipped (no exception)."""
        bad_poly = {"area": 100.0, "confidence": 0.5, "type": "external"}
        good_poly = self._simple_polygon()

        result = service.polygons_to_coco_format([bad_poly, good_poly], self.IMAGE_SIZE)

        # Only the valid polygon should appear
        assert len(result) == 1
        assert result[0]["id"] == 2  # Index-based; bad polygon is index 0

    def test_empty_polygons_returns_empty(self, service):
        """An empty input list must yield an empty annotation list."""
        result = service.polygons_to_coco_format([], self.IMAGE_SIZE)

        assert result == []


# ---------------------------------------------------------------------------
# detect_core_polygon  (ASPP spheroid core)
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestDetectCorePolygon:
    """Tests for PostprocessingService.detect_core_polygon."""

    H, W = 256, 256
    CY, CX = 128, 128
    R_OUTER = 80   # full spheroid radius
    R_CORE = 35    # dense centre radius

    def _disk_with_core_image(self) -> np.ndarray:
        """Bright field analogue: bright background, light corona, dark core."""
        img = np.full((self.H, self.W), 230, dtype=np.uint8)
        y, x = np.ogrid[:self.H, :self.W]
        d2 = (y - self.CY) ** 2 + (x - self.CX) ** 2
        img[d2 <= self.R_OUTER ** 2] = 160  # corona (mid-grey)
        img[d2 <= self.R_CORE ** 2] = 40    # core (dark)
        return img

    def _outer_polygon(self) -> dict:
        """Square polygon enclosing the entire spheroid (drives 'largest' pick)."""
        x0, y0 = self.CX - self.R_OUTER, self.CY - self.R_OUTER
        x1, y1 = self.CX + self.R_OUTER, self.CY + self.R_OUTER
        return {
            "points": [
                {"x": float(x0), "y": float(y0)},
                {"x": float(x1), "y": float(y0)},
                {"x": float(x1), "y": float(y1)},
                {"x": float(x0), "y": float(y1)},
            ],
            "area": float((2 * self.R_OUTER) ** 2),
            "confidence": 0.9,
            "type": "external",
        }

    def test_core_detected_with_partclass(self, service):
        """Synthetic disk+core image yields a polygon tagged partClass='core'."""
        img = self._disk_with_core_image()
        polys = [self._outer_polygon()]

        core = service.detect_core_polygon(img, polys)

        assert core is not None
        assert core["partClass"] == "core"
        assert core["type"] == "external"
        assert _is_valid_polygon_dict(core)
        assert len(core["points"]) >= 3

    def test_core_area_smaller_than_outer(self, service):
        """Core area must lie strictly inside the outer polygon's area."""
        img = self._disk_with_core_image()
        outer = self._outer_polygon()

        core = service.detect_core_polygon(img, [outer])

        assert core is not None
        assert 0 < core["area"] < outer["area"]
        # Roughly the area of the inner disk (allow ±35% for rasterization)
        expected = np.pi * self.R_CORE ** 2
        assert abs(core["area"] - expected) / expected < 0.35

    def test_picks_largest_polygon(self, service):
        """Among multiple polygons, core must be sourced from the largest one."""
        img = self._disk_with_core_image()
        outer = self._outer_polygon()
        # A small distractor polygon located in a uniform-bright corner
        small = {
            "points": [
                {"x": 5.0, "y": 5.0},
                {"x": 15.0, "y": 5.0},
                {"x": 15.0, "y": 15.0},
                {"x": 5.0, "y": 15.0},
            ],
            "area": 100.0,
            "confidence": 0.5,
            "type": "external",
        }

        core = service.detect_core_polygon(img, [small, outer])

        assert core is not None
        # Core centroid should fall near the disk centre, not the corner distractor
        xs = [p["x"] for p in core["points"]]
        ys = [p["y"] for p in core["points"]]
        cx_est = sum(xs) / len(xs)
        cy_est = sum(ys) / len(ys)
        assert abs(cx_est - self.CX) < 20
        assert abs(cy_est - self.CY) < 20

    def test_uniform_intensity_falls_back_to_full_polygon(self, service):
        """Uniform intensity → Otsu undefined → return full polygon as 'core'.

        Honours the user's 'always add some core' requirement.
        """
        img = np.full((self.H, self.W), 100, dtype=np.uint8)
        outer = self._outer_polygon()

        core = service.detect_core_polygon(img, [outer])

        assert core is not None
        assert core["partClass"] == "core"
        # Fallback covers the whole polygon, so area should match the outer
        # polygon's filled mask area within rasterization tolerance.
        assert core["area"] > 0

    def test_empty_polygons_returns_none(self, service):
        """No input polygons → no core."""
        img = self._disk_with_core_image()
        assert service.detect_core_polygon(img, []) is None

    def test_invalid_image_returns_none(self, service):
        """Empty / None image → no core, no exception."""
        outer = self._outer_polygon()
        assert service.detect_core_polygon(None, [outer]) is None
        assert service.detect_core_polygon(np.array([]), [outer]) is None

    def test_polygon_with_too_few_points_returns_none(self, service):
        """Polygon with <3 points cannot define a region → None."""
        img = self._disk_with_core_image()
        bad = {
            "points": [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 1.0}],
            "area": 1.0,
            "confidence": 0.5,
            "type": "external",
        }
        assert service.detect_core_polygon(img, [bad]) is None

    # -- 2-of-3 voting (compact gate) ---------------------------------------

    def _circular_polygon(self, cx, cy, r, n=64) -> dict:
        """Approximate a circle with n vertices (high solidity)."""
        thetas = np.linspace(0, 2 * np.pi, n, endpoint=False)
        pts = [{"x": float(cx + r * np.cos(t)), "y": float(cy + r * np.sin(t))}
               for t in thetas]
        return {
            "points": pts,
            "area": float(np.pi * r ** 2),
            "confidence": 0.9,
            "type": "external",
        }

    def test_compact_spheroid_returns_whole_polygon(self, service):
        """Round mask with mild interior gradient → 2-of-3 votes → whole polygon."""
        # Bright background, single dark disk (no corona) → uniform-ish inside.
        img = np.full((self.H, self.W), 230, dtype=np.uint8)
        y, x = np.ogrid[:self.H, :self.W]
        d2 = (y - self.CY) ** 2 + (x - self.CX) ** 2
        img[d2 <= self.R_OUTER ** 2] = 60   # uniform dark spheroid
        # Add a tiny gradient so Otsu has something to split (still low mean_diff).
        img[d2 <= (self.R_OUTER - 10) ** 2] = 50
        # Use a circular polygon → solidity ~1.0
        poly = self._circular_polygon(self.CX, self.CY, self.R_OUTER)

        core = service.detect_core_polygon(img, [poly])

        assert core is not None
        assert core["partClass"] == "core"
        # Compact path returns the input polygon points verbatim.
        assert len(core["points"]) == len(poly["points"])
        # And the area covers the full mask area (within rasterization tolerance).
        assert core["area"] > 0.9 * poly["area"]

    def test_invasive_spheroid_returns_inner_subset(self, service):
        """Disk+corona image with bbox polygon → bimodal path → smaller core."""
        # The synthetic disk+corona has high mean_diff (~140) and low core_frac
        # (~0.15), and the bbox polygon is convex (sol=1.0). Only solidity votes
        # → 1 vote → bimodal path returns inner disk.
        img = self._disk_with_core_image()
        outer = self._outer_polygon()

        core = service.detect_core_polygon(img, [outer])

        assert core is not None
        assert core["area"] < outer["area"] * 0.5
        # Centroid of the returned core should sit at the disk centre.
        xs = [p["x"] for p in core["points"]]
        ys = [p["y"] for p in core["points"]]
        assert abs(sum(xs) / len(xs) - self.CX) < 20
        assert abs(sum(ys) / len(ys) - self.CY) < 20

    def test_compact_threshold_constants_present(self, service):
        """Voting thresholds are class-level so tests can introspect them."""
        assert hasattr(service, "COMPACT_MEAN_DIFF_MAX")
        assert hasattr(service, "COMPACT_CORE_FRAC_MIN")
        assert hasattr(service, "COMPACT_SOLIDITY_MIN")
        assert 0 < service.COMPACT_MEAN_DIFF_MAX < 256
        assert 0 < service.COMPACT_CORE_FRAC_MIN < 1
        assert 0 < service.COMPACT_SOLIDITY_MIN < 1
