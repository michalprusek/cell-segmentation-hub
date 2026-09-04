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
# Importable once `api.mt_metrics` has put the models directory on sys.path.
mt_measure = pytest.importorskip("mt_measure")
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


# --- the vectorised fill (2026-09-01) ----------------------------------------
#
# `rasterize_band` builds every segment quadrilateral and joint triangle at once
# and fills the batch in one flattened pixel pass, because a single convex fill
# cost ~80 us of numpy CALL overhead whatever its area. The speedup is only
# allowed to exist because the output did not move, so these pin the two
# properties that make that true and that a "simplification" would break.


def _random_convex_polys(rng, n, k):
    """N convex k-gons: a jittered regular polygon at a random place/size."""
    out = []
    for _ in range(n):
        cx, cy = rng.uniform(3, 57, 2)
        r = rng.uniform(0.3, 14.0)
        a0 = rng.uniform(0, 2 * np.pi)
        ang = a0 + np.arange(k) * (2 * np.pi / k)
        rad = r * rng.uniform(0.75, 1.0, k)
        out.append(np.stack([cx + rad * np.cos(ang),
                             cy + rad * np.sin(ang)], axis=1))
    return np.asarray(out)


@pytest.mark.parametrize("k", [3, 4])
def test_batched_fill_equals_filling_one_polygon_at_a_time(k):
    """The batch must be the union of the single fills, pixel for pixel.

    `fill_convex_polygon` is the documented entry point and `_fill_convex_polygons`
    is what `rasterize_band` actually calls; if they ever disagree, the band
    silently depends on which one a caller reached for.
    """
    rng = np.random.default_rng(4972)
    polys = _random_convex_polys(rng, 120, k)
    one_at_a_time = np.zeros((60, 60), np.uint8)
    for p in polys:
        mt_measure.fill_convex_polygon(one_at_a_time, p)
    batched = np.zeros((60, 60), np.uint8)
    mt_measure._fill_convex_polygons(batched, polys)
    assert one_at_a_time.sum() > 0, "fixture filled nothing; the test is vacuous"
    assert np.array_equal(one_at_a_time, batched)


def test_fill_does_not_depend_on_how_the_batch_is_chunked(monkeypatch):
    """`_FILL_CHUNK_PIXELS` is a memory guard rail, not a parameter of the result.

    It bounds the working set of one vectorised pass; splitting the batch
    differently must not move a pixel, or the ceiling would be a tuning knob on
    the exported numbers.
    """
    pts = np.asarray([[6, 8], [30, 41], [52, 12], [20, 20], [48, 50]], np.float32)
    full = _rasterize_band(pts, 60, 60, 7)
    monkeypatch.setattr(mt_measure, "_FILL_CHUNK_PIXELS", 1)
    tiny_chunks = _rasterize_band(pts, 60, 60, 7)
    assert full.sum() > 0
    assert np.array_equal(full, tiny_chunks)


def test_vicinity_bounding_box_is_the_one_np_nonzero_would_give():
    """`vicinity_mask` finds the band's extent with `any` + `argmax` reductions.

    `np.nonzero` was 1.190 s of that function's 1.220 s for 162 microtubules on
    a 2048^2 frame — it walks every frame pixel and materialises two index
    arrays only for four order statistics to be taken off them. The replacement
    is an identity, not an approximation, and these are the masks where an
    off-by-one or an empty-mask `argmax` would show: nothing set, one pixel at
    each edge and corner, everything set, and two far-apart blobs.
    """
    h, w = 37, 53

    def reference(band, not_signal, margin_radius):
        """The pre-2026-09-01 body, verbatim."""
        ys, xs = np.nonzero(band)
        vicinity = np.zeros(band.shape, dtype=bool)
        if ys.size == 0:
            return vicinity
        y0 = max(0, int(ys.min()) - margin_radius)
        y1 = min(h, int(ys.max()) + margin_radius + 1)
        x0 = max(0, int(xs.min()) - margin_radius)
        x1 = min(w, int(xs.max()) + margin_radius + 1)
        capsule = mt_measure.dilate(band[y0:y1, x0:x1], margin_radius)
        vicinity[y0:y1, x0:x1] = (capsule > 0) & not_signal[y0:y1, x0:x1]
        return vicinity

    masks = {"empty": np.zeros((h, w), np.uint8), "full": np.ones((h, w), np.uint8)}
    for y in (0, 1, h // 2, h - 2, h - 1):
        for x in (0, 1, w // 2, w - 2, w - 1):
            m = np.zeros((h, w), np.uint8)
            m[y, x] = 1
            masks["px_%d_%d" % (y, x)] = m
    two_blobs = np.zeros((h, w), np.uint8)
    two_blobs[1, 1] = two_blobs[h - 2, w - 2] = 1
    masks["two_blobs"] = two_blobs

    rng = np.random.default_rng(301)
    not_signal = rng.random((h, w)) < 0.7
    checked = 0
    for name, band in masks.items():
        for r in (0, 1, 3, 8):
            assert np.array_equal(
                mt_measure.vicinity_mask(band, not_signal, r),
                reference(band, not_signal, r),
            ), "%s at margin_radius=%d" % (name, r)
            checked += 1
    assert checked == len(masks) * 4


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


def test_the_band_math_is_the_shared_module_not_a_local_copy():
    """This endpoint and the Automated Essays batch must measure identically.

    They did not until 2026-08-13: the export was aligned to ImageJ *Measure* in
    2026-07 while the essays module was still a separate repository, and on one
    real frame the two disagreed on the net signal by a median of +9.9 % (up to
    +33.2 %). The fix was structural — one implementation in
    ``models/mt_measure.py`` — so what is worth asserting is that this module
    still delegates rather than that today's numbers happen to line up.
    """
    shared = pytest.importorskip("mt_measure")
    assert mt._rasterize_band is shared.rasterize_band
    assert mt._vicinity_mask is shared.vicinity_mask
    assert mt._imagej_median is shared.imagej_median
    assert mt._polyline_length is shared.polyline_length
    assert mt._fill_convex_polygon is shared.fill_convex_polygon
    assert mt._dilate is shared.dilate


# --- the composite ROI is traced on the ring's BOUNDING BOX -------------------
#
# A ring is a sliver: on production container 4972cad8 frame 0 (1476x1924, 59
# real polylines) the median ring is 4 437 px, 0.16 % of the frame. Until
# 2026-09-04 every step of the encoder was linear in the whole frame — the
# uint8 copy, the `sum`, a 22.7 MB float64 pad per polyline, and marching
# squares over all of it. Windowing them cut those 59 rings from 2 177 ms to
# 121 ms (17.9x) with all 59 `.roi` blobs byte-identical.
#
# The identity is exact by construction (a window containing every set pixel
# contains every 0.5 iso-crossing; the crossings are half-integers; the integer
# origin adds losslessly in float64) — but the OFFSET is the thing a bug lands
# on, and an offset bug is silent: the ROI still rasterises to a ring, just in
# the wrong place. Hence a byte comparison against the un-windowed encoder
# rather than a shape assertion.

def _vicinity_composite_roi_bytes_reference(vicinity, name, stroke_color, position):
    """The pre-2026-09-04 body, verbatim: traced on the whole frame."""
    import struct

    from skimage import measure

    mask = np.ascontiguousarray(vicinity.astype(np.uint8))
    if mask.sum() == 0:
        return None
    contours = measure.find_contours(np.pad(mask, 1).astype(np.float64), 0.5)

    path = []
    for c in contours:
        pts = np.column_stack((c[:, 1] - 0.5, c[:, 0] - 0.5))
        if len(pts) > 1 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]
        if len(pts) < 3:
            continue
        prev = np.roll(pts, 1, axis=0)
        nxt = np.roll(pts, -1, axis=0)
        cross = ((pts[:, 0] - prev[:, 0]) * (nxt[:, 1] - prev[:, 1])
                 - (pts[:, 1] - prev[:, 1]) * (nxt[:, 0] - prev[:, 0]))
        pts = pts[np.abs(cross) > 1e-9]
        if len(pts) < 3:
            continue
        path.extend((0.0, float(pts[0, 0]), float(pts[0, 1])))
        for q in pts[1:]:
            path.extend((1.0, float(q[0]), float(q[1])))
        path.append(4.0)
    if not path:
        return None
    multi = np.asarray(path, dtype=np.float32)

    ys, xs = np.nonzero(mask)
    roi = roifile.ImagejRoi(
        roitype=roifile.ROI_TYPE.RECT,
        name=name,
        left=int(xs.min()),
        top=int(ys.min()),
        right=int(xs.max()) + 1,
        bottom=int(ys.max()) + 1,
        n_coordinates=0,
        shape_roi_size=int(multi.size),
        multi_coordinates=multi,
    )
    if stroke_color is not None:
        roi.stroke_color = struct.pack(">I", int(stroke_color) & 0xFFFFFFFF)
    if position is not None and position > 0:
        roi.position = int(position)
    return roi.tobytes()


def _assert_roi_bytes_identical(mask, what):
    got = _vicinity_composite_roi_bytes(mask, "mt_bg", 0xFF00FF00, 3)
    want = _vicinity_composite_roi_bytes_reference(mask, "mt_bg", 0xFF00FF00, 3)
    assert got == want, f"{what}: windowed ROI differs from the full-frame trace"
    return got


def test_composite_roi_is_byte_identical_to_the_full_frame_trace():
    """An annulus far from the origin: a dropped window offset shifts every
    vertex by (x0, y0) and would be invisible to a shape-only assertion."""
    h, w = 220, 260
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(yy - 150, xx - 190)
    mask = ((r <= 26) & (r >= 11))
    blob = _assert_roi_bytes_identical(mask, "offset annulus")
    assert blob and len(blob) > 64


def test_composite_roi_identical_for_rings_touching_every_border():
    """A ring against a frame edge is the case the 1-px pad exists for, and the
    window's own border is not the frame's — so the pad has to be applied to the
    WINDOW, and the unpad has to survive the origin shift."""
    h, w = 90, 110
    for (cy, cx) in ((0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1),
                     (0, w // 2), (h // 2, 0), (h - 1, w // 2), (h // 2, w - 1)):
        yy, xx = np.mgrid[0:h, 0:w]
        r = np.hypot(yy - cy, xx - cx)
        mask = (r <= 20) & (r >= 9)
        _assert_roi_bytes_identical(mask, f"ring at ({cy},{cx})")


def test_composite_roi_identical_for_a_disconnected_ring():
    """Two separate blobs: the window spans both, so the contour scan order —
    which fixes the order of the MOVETO subpaths in the encoded path — must not
    change."""
    h, w = 140, 180
    mask = np.zeros((h, w), dtype=bool)
    yy, xx = np.mgrid[0:h, 0:w]
    mask |= (np.hypot(yy - 30, xx - 30) <= 14) & (np.hypot(yy - 30, xx - 30) >= 6)
    mask |= (np.hypot(yy - 105, xx - 150) <= 18) & (np.hypot(yy - 105, xx - 150) >= 7)
    _assert_roi_bytes_identical(mask, "two rings")


def test_composite_roi_identical_on_random_sparse_masks():
    rng = np.random.default_rng(20260904)
    h, w = 70, 95
    for _ in range(25):
        mask = np.zeros((h, w), dtype=bool)
        y0 = int(rng.integers(0, h - 12))
        x0 = int(rng.integers(0, w - 12))
        patch = rng.random((12, 12)) < 0.55
        mask[y0:y0 + 12, x0:x0 + 12] = patch
        if not mask.any():
            continue
        _assert_roi_bytes_identical(mask, f"random at ({y0},{x0})")


def test_composite_roi_bounding_rectangle_is_the_tight_one():
    """The ROI header's rect is `np.nonzero(mask).min()/.max()+1` in frame
    coordinates. It is now read off `mask_bbox` instead, and those must be the
    same four integers — ImageJ positions the ROI from them."""
    h, w = 80, 95
    mask = np.zeros((h, w), dtype=bool)
    mask[13:41, 22:70] = True
    mask[20:34, 30:60] = False
    roi = roifile.ImagejRoi.frombytes(
        _vicinity_composite_roi_bytes(mask, "bg", None, None)
    )
    ys, xs = np.nonzero(mask)
    assert (roi.top, roi.left, roi.bottom, roi.right) == (
        int(ys.min()), int(xs.min()), int(ys.max()) + 1, int(xs.max()) + 1
    )
