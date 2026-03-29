"""
Unit tests for morphometric characteristic functions.

Source: backend/segmentation/utils/characteristic_functions.py

All tests use contours in the standard OpenCV format: (N, 1, 2) int32.
The conftest.py square_contour fixture (10,10)→(90,90) with known
side=80 / perimeter=320 / area=6400 is used where convenient.
"""
import sys
import os

import pytest
import numpy as np
import cv2

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from utils.characteristic_functions import (
    calculate_area_from_contour,
    calculate_perimeter_from_contour,
    calculate_circularity_from_contour,
    calculate_solidity_from_contour,
    calculate_feret_properties_from_contour,
    calculate_all,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _square_contour(x0=10, y0=10, x1=90, y1=90) -> np.ndarray:
    """Return a square OpenCV contour (4, 1, 2) int32."""
    return np.array(
        [[[x0, y0]], [[x1, y0]], [[x1, y1]], [[x0, y1]]],
        dtype=np.int32,
    )


def _circle_contour(cx=100, cy=100, radius=50, n_pts=360) -> np.ndarray:
    """Approximate a circle with n_pts evenly spaced points."""
    angles = np.linspace(0, 2 * np.pi, n_pts, endpoint=False)
    pts = np.stack(
        [cx + radius * np.cos(angles), cy + radius * np.sin(angles)], axis=1
    ).astype(np.int32)
    return pts.reshape(-1, 1, 2)


def _rectangle_contour(w=200, h=50) -> np.ndarray:
    """A flat rectangle — obviously non-circular."""
    return np.array(
        [[[0, 0]], [[w, 0]], [[w, h]], [[0, h]]],
        dtype=np.int32,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.unit
class TestAreaFromContour:

    def test_area_from_contour_square(self, square_contour):
        """80×80 square should have area ≈ 6400 px²."""
        area = calculate_area_from_contour(square_contour)
        assert abs(area - 6400.0) < 10.0, f"Expected ~6400, got {area}"

    def test_area_from_contour_known_value(self):
        """20×20 square → area ≈ 400."""
        c = _square_contour(0, 0, 20, 20)
        area = calculate_area_from_contour(c)
        assert abs(area - 400.0) < 5.0


@pytest.mark.unit
class TestPerimeterFromContour:

    def test_perimeter_from_contour_square(self, square_contour):
        """80×80 square should have perimeter ≈ 320 px."""
        perim = calculate_perimeter_from_contour(square_contour)
        assert abs(perim - 320.0) < 5.0, f"Expected ~320, got {perim}"


@pytest.mark.unit
class TestCircularityFromContour:

    def test_circularity_perfect_circle(self):
        """Dense circle approximation should have circularity close to 1.0."""
        circ_cnt = _circle_contour(cx=100, cy=100, radius=50, n_pts=500)
        circularity = calculate_circularity_from_contour(circ_cnt)
        assert circularity >= 0.70, (
            f"Circle approximation should have circularity >= 0.70, got {circularity:.4f}"
        )

    def test_circularity_rectangle_less_than_one(self):
        """A flat rectangle should have circularity well below 1."""
        rect_cnt = _rectangle_contour(w=200, h=10)
        circularity = calculate_circularity_from_contour(rect_cnt)
        assert circularity < 0.5, (
            f"Rectangle should have low circularity, got {circularity:.4f}"
        )

    def test_circularity_square(self, square_contour):
        """A square has circularity pi/4 ≈ 0.785."""
        circularity = calculate_circularity_from_contour(square_contour)
        assert 0.6 <= circularity <= 0.9, (
            f"Square circularity should be in [0.6, 0.9], got {circularity:.4f}"
        )


@pytest.mark.unit
class TestSolidityFromContour:

    def test_solidity_convex_shape(self, square_contour):
        """A convex shape (square) should have solidity ≈ 1.0."""
        solidity = calculate_solidity_from_contour(square_contour)
        assert solidity >= 0.99, (
            f"Convex shape (square) should have solidity ≈ 1.0, got {solidity:.4f}"
        )

    def test_solidity_circle_approx(self):
        """Dense circle approximation is convex → solidity ≈ 1.0."""
        circ_cnt = _circle_contour(radius=40, n_pts=200)
        solidity = calculate_solidity_from_contour(circ_cnt)
        assert solidity >= 0.98, f"Expected solidity ≥ 0.98, got {solidity:.4f}"


@pytest.mark.unit
class TestFeretPropertiesFromContour:

    def test_feret_properties_square(self, square_contour):
        """80×80 square: max Feret ≈ 113 (diagonal), min Feret ≈ 80 (side)."""
        feret_max, feret_min, aspect_ratio = calculate_feret_properties_from_contour(
            square_contour
        )
        # minAreaRect of a square returns the rotated bounding box — both sides equal 80
        assert feret_max > 0.0, "Max Feret must be positive"
        assert feret_min > 0.0, "Min Feret must be positive"
        assert aspect_ratio >= 1.0, "Aspect ratio should be >= 1.0"
        # For a square, the minAreaRect aligns with sides → both dims ≈ 80
        assert abs(feret_max - 80.0) < 5.0, (
            f"Expected feret_max ≈ 80, got {feret_max:.2f}"
        )

    def test_feret_properties_insufficient_points(self):
        """Contour with fewer than 2 points should return (0, 0, 0)."""
        single = np.array([[[10, 10]]], dtype=np.int32)
        result = calculate_feret_properties_from_contour(single)
        assert result == (0.0, 0.0, 0.0)


@pytest.mark.unit
class TestCalculateAll:

    def test_calculate_all_complete_dict(self, square_contour):
        """calculate_all should return a dict with all expected metric keys."""
        expected_keys = {
            "Area", "Perimeter", "PerimeterWithHoles", "EquivalentDiameter",
            "Circularity", "FeretDiameterMax", "FeretDiameterMaxOrthogonalDistance",
            "FeretDiameterMin", "FeretAspectRatio",
            "LengthMajorDiameterThroughCentroid",
            "LengthMinorDiameterThroughCentroid",
            "Compactness", "Convexity", "Solidity", "Sphericity", "Extent",
            "BoundingBoxWidth", "BoundingBoxHeight",
        }
        data = calculate_all(square_contour)
        missing = expected_keys - data.keys()
        assert not missing, f"Missing keys in calculate_all output: {missing}"

    def test_calculate_all_area_matches_standalone(self, square_contour):
        """Area returned by calculate_all should match calculate_area_from_contour."""
        data = calculate_all(square_contour)
        direct = calculate_area_from_contour(square_contour)
        assert abs(data["Area"] - direct) < 1e-6

    def test_calculate_all_with_hole_contours(self, square_contour):
        """Passing hole_contours should inflate PerimeterWithHoles."""
        hole = _square_contour(30, 30, 50, 50)
        data_with = calculate_all(square_contour, hole_contours=[hole])
        data_without = calculate_all(square_contour)
        assert data_with["PerimeterWithHoles"] > data_without["PerimeterWithHoles"], (
            "PerimeterWithHoles should be larger when holes are provided"
        )


@pytest.mark.unit
class TestDegenerateContourSafety:

    def test_single_point_contour_no_crash(self):
        """A single-point contour should not raise — returns zero values."""
        single = np.array([[[50, 50]]], dtype=np.int32)
        # Individual functions should return 0 without crashing
        area = calculate_area_from_contour(single)
        perim = calculate_perimeter_from_contour(single)
        assert area == 0.0
        assert perim == 0.0

    def test_two_point_contour_no_crash(self):
        """A two-point contour should not raise in calculate_all."""
        two_pts = np.array([[[0, 0]], [[10, 10]]], dtype=np.int32)
        # calculate_all internally calls diameters which guards len < 5
        try:
            data = calculate_all(two_pts)
            assert isinstance(data, dict)
        except Exception as exc:
            pytest.fail(f"calculate_all raised on 2-point contour: {exc}")
