"""Regression tests for the microtubule band rasteriser (`_rasterize_band`).

The band must be the EXACT requested thickness so `area_px` ≈ length*thickness
and the sampled region coincides with the ImageJ line ROI exported at the same
stroke width. A prior implementation used ``cv2.polylines(thickness=N)``, which
renders an ~``N+2`` px band (over-counting area by ~40 % at N=5) — these tests
lock in the exact-width behaviour so that regression can't return.

pytest / cv2 are not installed in the ML runtime container; the module-level
importorskip makes this a no-op there and runnable in the GPU one-off image.
"""
import numpy as np
import pytest

pytest.importorskip("cv2")

from api.mt_metrics import _rasterize_band  # noqa: E402


def _mid_width(points, thickness, h=80, w=220):
    band = _rasterize_band(np.asarray(points, np.float32), h, w, thickness)
    # width at a column safely inside the span (away from the end caps)
    return int(band[:, 100].sum()), int(band.sum())


def test_straight_line_width_equals_thickness_odd():
    line = [[30, 30], [130, 30]]
    for t in (1, 3, 5, 7):
        width, _ = _mid_width(line, t)
        assert width == t, f"thickness {t} -> band width {width}, expected {t}"


def test_area_close_to_length_times_thickness():
    # A straight 100-px line at thickness 5: area ≈ 100*5 plus a few cap pixels,
    # NOT the ~729 the old cv2.polylines(thickness=5) produced.
    _, area = _mid_width([[30, 30], [130, 30]], 5)
    assert 500 <= area <= 560, f"area {area} not near length*thickness (500)"


def test_thickness_one_is_the_centreline():
    width, _ = _mid_width([[30, 30], [130, 30]], 1)
    assert width == 1


def test_degenerate_polyline_is_empty():
    band = _rasterize_band(np.asarray([[10, 10]], np.float32), 40, 40, 5)
    assert band.sum() == 0
