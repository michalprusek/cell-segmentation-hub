"""Geometry primitives for FRAP spot placement — all lengths in pixels."""
import numpy as np
import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "models"))
import frap_geometry as G  # noqa: E402


def test_resample_gives_uniform_spacing_on_a_straight_line():
    line = np.array([[0.0, 0.0], [100.0, 0.0]])
    out = G.resample_polyline(line, step_px=2.0)
    steps = np.linalg.norm(np.diff(out, axis=0), axis=1)
    assert out.shape[1] == 2
    assert np.allclose(steps, steps[0])
    assert steps[0] == pytest.approx(2.0, abs=0.05)


def test_resample_preserves_the_endpoints():
    poly = np.array([[3.0, 4.0], [10.0, 4.0], [10.0, 20.0]])
    out = G.resample_polyline(poly, step_px=1.0)
    assert out[0] == pytest.approx([3.0, 4.0])
    assert out[-1] == pytest.approx([10.0, 20.0])


def test_length_of_a_right_angle_is_the_sum_of_its_legs():
    poly = np.array([[0.0, 0.0], [3.0, 0.0], [3.0, 4.0]])
    assert G.polyline_length_px(poly) == pytest.approx(7.0)


def test_degenerate_polylines_do_not_raise():
    assert G.polyline_length_px(np.zeros((1, 2))) == 0.0
    assert G.polyline_length_px(np.zeros((0, 2))) == 0.0
    assert G.resample_polyline(np.zeros((1, 2)), step_px=1.0).shape[1] == 2


def test_tangent_of_a_45_degree_line_is_45_degrees():
    line = np.array([[0.0, 0.0], [50.0, 50.0]])
    pts = G.resample_polyline(line, step_px=1.0)
    ang = G.tangent_angles(pts, baseline_px=8.0, step_px=1.0)
    assert np.degrees(ang[len(ang) // 2]) == pytest.approx(45.0, abs=0.5)


def test_a_straight_line_has_zero_curvature():
    pts = G.resample_polyline(np.array([[0.0, 0.0], [80.0, 0.0]]), step_px=1.0)
    curv = G.curvature_profile(pts, baseline_px=8.0, step_px=1.0)
    assert float(np.max(curv)) == pytest.approx(0.0, abs=1e-6)


def test_curvature_of_a_circle_is_one_over_its_radius():
    # A quarter circle of radius 40 px: curvature must come out at 1/40 rad/px.
    t = np.linspace(0.0, np.pi / 2, 400)
    arc = np.stack([40.0 * np.cos(t), 40.0 * np.sin(t)], axis=1)
    pts = G.resample_polyline(arc, step_px=1.0)
    curv = G.curvature_profile(pts, baseline_px=8.0, step_px=1.0)
    mid = curv[len(curv) // 4: 3 * len(curv) // 4]
    assert float(np.median(mid)) == pytest.approx(1.0 / 40.0, rel=0.1)


def test_footprint_clearance_is_zero_when_a_neighbour_sits_on_the_roi():
    others = np.array([[10.0, 0.0]])
    d = G.footprint_clearance_px(
        center_xy=(10.0, 0.0), tangent_rad=0.0,
        half_len_px=8.0, half_wid_px=3.0, other_pts_xy=others,
    )
    assert d == pytest.approx(0.0)


def test_footprint_clearance_measures_from_the_roi_edge_not_the_centre():
    # THE REGRESSION TEST FOR 5a. The ROI is 16 px long along x and the neighbour
    # sits 20 px away along x, so the centre distance is 20 px but the real
    # clearance is only 20 - 8 = 12 px. An implementation that measures from the
    # centre returns 20.0 and fails here — which is the entire point of the test.
    others = np.array([[20.0, 0.0]])
    d = G.footprint_clearance_px(
        center_xy=(0.0, 0.0), tangent_rad=0.0,
        half_len_px=8.0, half_wid_px=3.0, other_pts_xy=others,
    )
    assert d == pytest.approx(12.0)


def test_footprint_clearance_follows_the_tangent_rotation():
    # Same neighbour, ROI rotated 90 deg: now the neighbour is off the ROI's SHORT
    # axis, so the clearance is 20 - 3 = 17 px instead of 12 px.
    others = np.array([[20.0, 0.0]])
    d = G.footprint_clearance_px(
        center_xy=(0.0, 0.0), tangent_rad=np.pi / 2,
        half_len_px=8.0, half_wid_px=3.0, other_pts_xy=others,
    )
    assert d == pytest.approx(17.0)


def test_footprint_clearance_takes_the_nearest_of_several_neighbours():
    others = np.array([[20.0, 0.0], [0.0, 9.0], [40.0, 40.0]])
    d = G.footprint_clearance_px(
        center_xy=(0.0, 0.0), tangent_rad=0.0,
        half_len_px=8.0, half_wid_px=3.0, other_pts_xy=others,
    )
    assert d == pytest.approx(6.0)  # the point at (0, 9): 9 - 3


def test_clearance_is_infinite_with_no_neighbours():
    empty = np.zeros((0, 2))
    assert G.footprint_clearance_px((0.0, 0.0), 0.0, 8.0, 3.0, empty) == float("inf")
    assert G.window_clearance_px(np.array([[0.0, 0.0]]), empty) == float("inf")


def test_window_clearance_is_the_min_distance_to_the_observation_stretch():
    window = np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 0.0]])
    others = np.array([[10.0, 7.0], [30.0, 0.0]])
    assert G.window_clearance_px(window, others) == pytest.approx(7.0)
