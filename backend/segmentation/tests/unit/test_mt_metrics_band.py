"""Regression tests for the microtubule band rasteriser and stat conventions.

The band and per-MT statistics must reproduce what ImageJ's *Analyze ▸ Measure*
reports for the exported line ROI, because a biologist re-measures those ROIs in
ImageJ and compares. For a wide line (``strokeWidth > 1``) ImageJ does NOT use
the straightener/line-profile path — ``Analyzer.measureLength`` calls
``Roi.convertLineToArea`` to turn the stroked line into a filled polygon and
measures the raw pixels inside it. ``_rasterize_band`` reproduces that exact
polygon:

- exact ``thickness``-wide band (odd AND even widths, via the top-left fill rule);
- FLAT end caps extended 0.5 px along the line (a prior distance-transform band
  used ROUND caps and over-counted area by ~8 % at width 5 / ~14 % at width 8);
- ImageJ's median tie-rule (upper of the two central values for even counts);
- sample standard deviation (ddof=1), which ImageJ's ImageStatistics reports.

Validated against ImageJ 1.54p's own ``Roi.convertLineToArea`` + ``ImageStatistics``
on real microtubule frames: area/mean/median match to 0.00 % at width 5 and
≤0.15 % at width 8.

pytest is not installed in the ML runtime container; the module-level
``importorskip`` makes this a no-op there and runnable in the GPU one-off image.
"""
import numpy as np
import pytest

# Skips the whole file if the ML web deps (fastapi/pydantic) are unavailable.
mt = pytest.importorskip("api.mt_metrics")
_rasterize_band = mt._rasterize_band
_imagej_median = mt._imagej_median


def _mid_width(points, thickness, h=80, w=220):
    band = _rasterize_band(np.asarray(points, np.float32), h, w, thickness)
    # width at a column safely inside the span (away from the end caps)
    return int(band[:, 100].sum()), int(band.sum())


def test_straight_line_width_equals_thickness_odd():
    line = [[30, 30], [130, 30]]
    for t in (1, 3, 5, 7):
        width, _ = _mid_width(line, t)
        assert width == t, f"thickness {t} -> band width {width}, expected {t}"


def test_straight_line_width_equals_thickness_even():
    # Even widths put the band edges on integer rows; the top-left fill rule must
    # keep exactly one boundary row so an N-px band is N px tall — not N-1 (strict
    # interior) or N+1 (inclusive interior).
    line = [[30, 30], [130, 30]]
    for t in (2, 4, 6, 8):
        width, _ = _mid_width(line, t)
        assert width == t, f"thickness {t} -> band width {width}, expected {t}"


def test_end_caps_are_flat_not_round():
    # A straight 100-px line at thickness 5 spans 101 columns after the 0.5-px cap
    # extension at each end, so area == 101*5 == 505 EXACTLY. Round caps (the old
    # distance-transform band) would add a ~5-px-radius semicircle at each end.
    _, area = _mid_width([[30, 30], [130, 30]], 5)
    assert area == 505, f"area {area}; flat caps expected 505, round caps ~545+"


def test_thickness_one_is_the_centreline():
    width, _ = _mid_width([[30, 30], [130, 30]], 1)
    assert width == 1


def test_degenerate_polyline_is_empty():
    band = _rasterize_band(np.asarray([[10, 10]], np.float32), 40, 40, 5)
    assert band.sum() == 0


def test_diagonal_band_area_matches_length_times_thickness():
    # A 45° diagonal of length ~100 px at thickness 5 has area ≈ length*thickness
    # (± cap/rounding), NOT the inflated count a round-cap band produced.
    p = [[20, 20], [120, 120]]
    _, area = _mid_width(p, 5, h=200, w=200)
    length = np.hypot(100, 100)  # ~141.4
    assert abs(area - length * 5) < length, f"area {area} vs ~{length*5:.0f}"


def test_imagej_median_is_upper_of_two_middles():
    # ImageJ's histogram median returns the value where the cumulative count first
    # exceeds n/2 — the UPPER of the two central order statistics for even n —
    # whereas numpy.median averages them.
    assert _imagej_median(np.array([1, 2, 3, 4])) == 3.0  # np.median -> 2.5
    assert _imagej_median(np.array([10, 20, 30])) == 20.0
    assert _imagej_median(np.array([5])) == 5.0
    assert _imagej_median(np.array([])) == 0.0


# --- background composite ROI (``_bg``) --------------------------------------
#
# The exported composite must rasterise IN IMAGEJ back to the exact vicinity mask
# so measuring it reproduces the mean/median_background columns. ImageJ fills a
# pixel when its centre is inside the polygon; the composite therefore has to
# trace pixel EDGES (half-integer coords), not pixel centres. These tests emulate
# ImageJ's even-odd fill at pixel centres and require an exact round-trip.

roifile = pytest.importorskip("roifile")
_vicinity_composite_roi_bytes = mt._vicinity_composite_roi_bytes


def _decode_subpaths(roi_bytes):
    roi = roifile.ImagejRoi.frombytes(roi_bytes)
    m = np.asarray(roi.multi_coordinates, dtype=np.float64)
    subs, cur, i = [], [], 0
    while i < len(m):
        op = m[i]
        if op == 0.0:  # MOVETO
            if cur:
                subs.append(np.array(cur))
            cur = [(m[i + 1], m[i + 2])]
            i += 3
        elif op == 1.0:  # LINETO
            cur.append((m[i + 1], m[i + 2]))
            i += 3
        else:  # CLOSE (4.0)
            if cur:
                subs.append(np.array(cur))
                cur = []
            i += 1
    if cur:
        subs.append(np.array(cur))
    return subs


def _imagej_even_odd_fill(subs, h, w):
    """Fill at pixel centres (px+0.5, py+0.5) with the even-odd rule — matches how
    ImageJ's ShapeRoi rasterises the composite path."""
    y, x = np.mgrid[0:h, 0:w]
    px = x + 0.5
    py = y + 0.5
    inside = np.zeros((h, w), dtype=bool)
    for s in subs:
        n = len(s)
        for k in range(n):
            x1, y1 = s[k]
            x2, y2 = s[(k + 1) % n]
            straddles = (y1 > py) != (y2 > py)
            with np.errstate(divide="ignore", invalid="ignore"):
                x_cross = (x2 - x1) * (py - y1) / (y2 - y1) + x1
            inside ^= straddles & (px < x_cross)
    return inside.astype(np.uint8)


def _ring_mask(h=60, w=60):
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(yy - 30, xx - 30)
    return ((r <= 18) & (r >= 8)).astype(np.uint8)  # annulus with a hole


def test_vicinity_composite_empty_mask_is_none():
    assert _vicinity_composite_roi_bytes(np.zeros((20, 20), bool), "bg", None, None) is None


def test_vicinity_composite_traces_pixel_edges_not_centres():
    # Edge crossings put vertices on pixel boundaries, so a coordinate is
    # half-integer whenever it lies on a horizontal/vertical edge. A cv2
    # centre-trace regression would emit integer-only coordinates (and shrink the
    # ROI in ImageJ), so requiring some x.5 coordinates guards against that.
    mask = _ring_mask()
    subs = _decode_subpaths(_vicinity_composite_roi_bytes(mask.astype(bool), "bg", None, None))
    fracs = np.concatenate([s.ravel() for s in subs]) % 1.0
    assert np.any(np.isclose(fracs, 0.5)), "composite must trace pixel edges (x.5 coords)"


def test_vicinity_composite_rasterises_back_to_the_exact_mask():
    # The key round-trip: ImageJ's even-odd fill of the composite must recover the
    # vicinity mask pixel-for-pixel (a hole for the annulus included).
    mask = _ring_mask()
    subs = _decode_subpaths(_vicinity_composite_roi_bytes(mask.astype(bool), "bg", None, None))
    assert len(subs) == 2, "annulus should yield an outer contour + a hole contour"
    recovered = _imagej_even_odd_fill(subs, *mask.shape)
    assert np.array_equal(recovered, mask), "composite must round-trip to the exact mask"
