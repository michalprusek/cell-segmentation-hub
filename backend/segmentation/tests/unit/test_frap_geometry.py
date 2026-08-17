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
