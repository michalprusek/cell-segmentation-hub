"""Microtubule band + background geometry and statistics — the ONE copy.

Every caller that turns a polyline into intensity numbers imports this module:

* ``api/mt_metrics.py`` — the ``/mt-metrics`` endpoint behind the project export;
* ``backend/essays/module/mt_pipeline/measure.py`` — the Automated Essays batch,
  which reaches it through ``_mt_package.ensure_on_path()`` exactly as it reaches
  the v7 model package;
* ``api/kymograph_velocity.py`` — the background-subtracted intensity of a
  KymoButler trajectory, added 2026-09-01. A kymograph IS an image (rows =
  frames, columns = arc-length positions) and a trajectory IS a centerline on
  it, so the same band, the same ring and the same statistics apply; the only
  adaptation is the ``(frame, x)`` -> ``(x, y)`` swap. See that module's
  ``tracks_intensity`` for the one place the analogy is imperfect — the ring is
  isotropic on axes that are not the same quantity.

They used to have separate implementations, and they drifted. The export was
aligned to ImageJ *Measure* in 2026-07 (PR #301, #304) while the essays module
was still a separate repository, so it never received that work. Measured on one
real frame, 24 microtubules, identical centerlines: band area differed by −7.8 %
to +26.5 %, the background ring was 2.2x larger on the export side, and the net
signal — the number the assay reports — differed by a median of +9.9 % and up to
+33.2 %. Only length agreed. Two answers to "how bright is this filament" is
worse than either answer alone, because nothing announces which one you are
holding.

So the geometry and the statistics live here, once. **A change to this file
reaches both callers**; there is no second copy to forget.

Conventions are ImageJ's, because a biologist re-measuring the exported ROI in
ImageJ must get the numbers back:

* the band is ``Roi.convertLineToArea`` — an offset polygon with butt caps, not a
  distance transform with round caps (which over-counted area by ~8 % at width 5);
* the median follows ImageJ's histogram tie-rule (``sorted[n // 2]``), not
  numpy's average-of-two-central;
* the standard deviation is the *sample* one (``ddof=1``), 0 for a single pixel.

Deliberately depends on numpy and cv2 only — no torch. It sits beside the
``microtubule`` package rather than inside it because importing that package
loads the v7 wrapper and therefore torch, which measurement has no need of.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import numpy as np


# Tie-breaker for a pixel that falls exactly on a polygon edge; see the top-left
# rule on ``fill_convex_polygon``. It is compared against a cross product of
# pixel-scale coordinates, so it is a sign nudge, not a distance.
_EPS = 1e-9

# Ceiling on the pixels one vectorised fill pass materialises. The pass holds
# about a dozen 8-byte temporaries over its flattened bounding-box grid, so
# 1 << 18 is a ~25 MB transient working set. It is a guard rail and nothing
# more: measured over all 53 713 convex fills of 4 023 real production
# centerlines, ONE fill's bounding box is 77 px at the median, 1 590 at p99 and
# 19 040 at its worst, and a whole centerline's fills total 25 065 px at their
# worst — so real work is one chunk and the loop below runs once. A single
# polygon larger than the ceiling is never split (the fill rule needs the whole
# polygon); it becomes its own chunk, which is exactly the peak the per-polygon
# loop this replaced already had.
_FILL_CHUNK_PIXELS = 1 << 18


# --------------------------------------------------------------------------- #
#  Geometry
# --------------------------------------------------------------------------- #
def polyline_length(points: np.ndarray) -> float:
    """Sum of consecutive Euclidean distances. Returns 0 for <2 points."""
    if points.shape[0] < 2:
        return 0.0
    diffs = np.diff(points, axis=0)
    return float(np.sqrt((diffs ** 2).sum(axis=1)).sum())


def fill_convex_polygon(band: np.ndarray, poly: np.ndarray) -> None:
    """Set to 1 every ``band`` pixel strictly inside the convex polygon ``poly``.

    ``poly`` is an ``(N, 2)`` array of ``[x, y]`` float vertices. A pixel is
    considered inside iff the point at its *integer* coordinate ``(px, py)`` lies
    on the interior side of every edge, with a **top-left fill rule** for pixels
    that fall exactly on an edge: only edges pointing generally downward
    (``dy > 0``) or horizontally leftward (``dy == 0 and dx < 0``) claim their
    boundary pixels. This reproduces ImageJ's ``PolygonFiller`` scanline
    convention (it only bites at even stroke widths, where the band edges land on
    integer coordinates — an 8-px band then keeps exactly one boundary row, not
    zero or two). Verified against ImageJ's own ``Roi.convertLineToArea`` masks at
    IoU >= 0.998 for stroke widths 5 and 8 on real microtubule frames.

    Windowed to the polygon's bounding box, so cost is O(bbox), not O(H*W).

    One polygon at a time. ``rasterize_band`` needs a few hundred of them per
    polyline and hands the whole batch to ``_fill_convex_polygons`` instead; this
    entry point exists because a single fill reads better than a batch of one,
    and because the ImageJ rule above is documented once, here.
    """
    _fill_convex_polygons(band, np.asarray(poly)[None])


def _fill_convex_polygons(band: np.ndarray, polys: np.ndarray) -> None:
    """Fill every polygon of ``polys`` — :func:`fill_convex_polygon`, batched.

    ``polys`` is ``(P, K, 2)``: P convex polygons that all carry K vertices, in
    ``[x, y]`` order. Nothing is ever cleared, so the result is the union of the
    P fills and the order they are visited in cannot matter.

    **This is deliberately harder to read than the per-polygon loop it replaced
    (2026-09-01). Do not simplify it back.** The fills a band needs are tiny —
    over all 53 713 of them on 4 023 real production centerlines, one fill's
    bounding box is 77 px at the median and 19 040 px at its very worst — so the
    cost was never the pixel arithmetic. It was the ~40 numpy calls each fill
    made: measured on this box, 79-83 us per fill *whether the polygon covered 30
    pixels or 3 000*, i.e. essentially all call overhead. Flattening every
    polygon's bounding box into ONE pixel vector makes that O(K) numpy calls for
    the entire batch instead of O(P x K) — the per-pixel work is unchanged, and
    so is every number it produces. Measured, ``rasterize_band``: 0.339 s ->
    0.027 s for 60 real centerlines on a 1476x1924 export frame (12.4x), 0.649 s
    -> 0.070 s for 162 on a 2048^2 essays position (9.2x), and 49.1 ms -> 2.2 ms
    for one 299-point kymograph trajectory (22.6x). The spread IS the vertex
    count; see ``rasterize_band``.

    Bit-identity is the whole point of the exercise, so the arithmetic below is
    the scalar version's operation for operation and in its groupings, not an
    algebraically equal rearrangement:

    * ``cross`` keeps the ``dx * (gy - ay) - dy * (gx - ax)`` grouping. The
      obvious hoist — ``dx*gy - dy*gx - (dx*ay - dy*ax)``, which would lift two
      products clean out of the pixel loop — is NOT safe, and the margin is
      thinner than it looks: measured over 31 380 real fills on a 2048^2 frame it
      disagrees with this form by up to 9.8e-11 against a ``_EPS`` tie-breaker of
      1e-9, so **10x of headroom**, shrinking as coordinates grow, with 5 424 of
      those pixels already sitting at ``|cross| < 1e-6``. It moved no pixel on
      the 8 820-case equivalence corpus — which is the reason this is written
      down rather than left to the next reader's judgement;
    * ``dx``, ``dy`` and therefore the top-left threshold are properties of the
      EDGE, not of the pixel, so they are resolved once per polygon and only
      gathered. Their values are the scalars the loop computed;
    * the shoelace is accumulated left to right in K explicit adds. ``np.sum``
      agrees here and only here: numpy's pairwise summation degenerates to a
      running total below 8 terms (checked on numpy 1.26 — equal at K = 3, 4, 5,
      different at K = 8, 9) and these polygons are triangles and quadrilaterals.
      Writing it out is what keeps that true should a K ever grow. The winding
      tie is live on real data — the shoelace is exactly 0 for 34 of those 31 380
      fills, a zero-area quadrilateral from a repeated vertex — so ``>= 0`` is
      kept exactly as the scalar form had it, and reversing a winding reverses
      every edge and so re-decides which boundary pixels the top-left rule takes.
    """
    h, w = band.shape
    p = np.asarray(polys)
    if p.ndim != 3 or p.shape[0] == 0 or p.shape[1] == 0:
        return
    xs = p[:, :, 0]
    ys = p[:, :, 1]
    k = p.shape[1]

    # Per-polygon bounding box, clipped to the frame. A box that ends up empty
    # (the polygon is entirely off-frame) gets area 0 and contributes no pixels,
    # which is the scalar form's early ``return``.
    x0 = np.maximum(np.floor(xs.min(axis=1)).astype(np.int64), 0)
    x1 = np.minimum(np.ceil(xs.max(axis=1)).astype(np.int64), w - 1)
    y0 = np.maximum(np.floor(ys.min(axis=1)).astype(np.int64), 0)
    y1 = np.minimum(np.ceil(ys.max(axis=1)).astype(np.int64), h - 1)
    box_w = np.where(x1 >= x0, x1 - x0 + 1, 0)
    areas = np.where(y1 >= y0, y1 - y0 + 1, 0) * box_w
    if not areas.any():
        return

    # Orient CCW so the interior is the positive (left) side of every edge.
    terms = xs * np.roll(ys, -1, axis=1) - np.roll(xs, -1, axis=1) * ys
    shoelace = terms[:, 0]
    for j in range(1, k):
        shoelace = shoelace + terms[:, j]
    ccw = (shoelace >= 0)[:, None]
    # (K, P) and C-contiguous: the pixel loop gathers one whole row per edge.
    vx = np.ascontiguousarray(np.where(ccw, xs, xs[:, ::-1]).T)
    vy = np.ascontiguousarray(np.where(ccw, ys, ys[:, ::-1]).T)

    nxt = np.roll(np.arange(k), -1)
    edge_dx = vx[nxt] - vx
    edge_dy = vy[nxt] - vy
    top_left = (edge_dy > 0) | ((edge_dy == 0) & (edge_dx < 0))
    thr = np.where(top_left, -_EPS, _EPS)

    csum = np.cumsum(areas)
    lo = 0
    while lo < areas.size:
        base = int(csum[lo - 1]) if lo else 0
        hi = int(np.searchsorted(csum, base + _FILL_CHUNK_PIXELS, side="right"))
        hi = max(hi, lo + 1)  # one oversized polygon is its own chunk
        _fill_chunk(
            band, x0[lo:hi], y0[lo:hi], box_w[lo:hi], areas[lo:hi],
            vx[:, lo:hi], vy[:, lo:hi],
            edge_dx[:, lo:hi], edge_dy[:, lo:hi], thr[:, lo:hi],
        )
        lo = hi


def _fill_chunk(
    band: np.ndarray,
    x0: np.ndarray, y0: np.ndarray, box_w: np.ndarray, areas: np.ndarray,
    vx: np.ndarray, vy: np.ndarray,
    edge_dx: np.ndarray, edge_dy: np.ndarray, thr: np.ndarray,
) -> None:
    """One vectorised pass of :func:`_fill_convex_polygons` over a slice of it."""
    total = int(areas.sum())
    if total == 0:
        return
    # Every polygon's bounding box, concatenated into one flat pixel vector:
    # ``owner`` says which polygon a pixel belongs to, and (gx, gy) is its
    # INTEGER coordinate — the point the scalar form tested via meshgrid.
    owner = np.repeat(np.arange(areas.size), areas)
    offset = np.arange(total) - (np.cumsum(areas) - areas)[owner]
    row_w = box_w[owner]
    gy = y0[owner] + offset // row_w
    gx = x0[owner] + offset % row_w

    inside = np.ones(total, dtype=bool)
    for e in range(vx.shape[0]):
        ax = vx[e][owner]
        ay = vy[e][owner]
        cross = edge_dx[e][owner] * (gy - ay) - edge_dy[e][owner] * (gx - ax)
        inside &= cross > thr[e][owner]
    band[gy[inside], gx[inside]] = 1


def rasterize_band(points: np.ndarray, h: int, w: int, thickness: int) -> np.ndarray:
    """Rasterize a polyline as the 0/1 region ImageJ measures for a wide line ROI.

    This must coincide with the pixels ImageJ's *Analyze > Measure* samples when a
    biologist measures the exported ImageJ line ROI (stroke width ``thickness``).
    For a wide line (``strokeWidth > 1``) ImageJ does NOT use the
    straightener/line-profile path; ``Analyzer.measureLength`` calls
    ``Roi.convertLineToArea`` to turn the stroked line into a FILLED polygon and
    then measures the raw pixels inside it. We rasterise that exact polygon:

      * ``radius = thickness / 2``;
      * per segment, a quadrilateral offset ``+/-radius`` perpendicular to the
        segment (perpendicular of unit tangent ``(dx, dy)`` is ``(dy, -dx)``);
      * the two endpoints extended ``0.5`` px along the line (butt caps — ImageJ's
        line<->area 0.5 px convention);
      * a triangular filler at each interior joint (ImageJ's ``rightTurn`` logic);
      * the union rasterised at integer pixel coordinates (``fill_convex_polygon``).

    Why this replaced a distance-transform band: the old band used *round* caps
    (semicircles) and a symmetric distance threshold, over-counting area by ~8 %
    at width 5 and ~14 % at width 8 versus ImageJ, and shifting mean/median by a
    few percent. This offset polygon matches ImageJ to area 0.0 % / mean 0.0 % /
    median ~0.15 % (IoU 1.000 at width 5) on real microtubule frames.

    ``points`` is ``(M, 2)`` in ``[x, y]`` order — note that the segmentation
    model emits ``(row, col)``, so that caller must swap before calling.

    Every quadrilateral and every joint filler is built for the whole polyline at
    once and handed to ``_fill_convex_polygons`` in two batches, rather than
    walked segment by segment (2026-09-01). That is not a change of geometry: the
    expressions below are the ones the loop evaluated, in the same groupings, so
    the band is bit-identical — only the number of numpy calls falls, from
    O(segments) to O(1). It matters because vertex count is what this costs, and
    the callers disagree about it by an order of magnitude: an RDP-simplified
    microtubule centerline has 4-20 points, while a kymograph trajectory
    (``api/kymograph_velocity.tracks_intensity``) has one point per FRAME it
    lives on — 39 at the median and up to 252 on the real 299-frame kymograph of
    container 4972cad8. Which is why the kymograph caller is what exposed this:
    the export had been paying the same per-fill overhead since this band
    replaced the distance-transform one in 2026-07, just at a tenth of the
    vertex count, so it read as "an export is slow" rather than as a hot loop.
    """
    band = np.zeros((h, w), dtype=np.uint8)
    n = int(points.shape[0])
    if points.ndim != 2 or points.shape[1] != 2 or n < 2:
        return band
    pts = np.asarray(points, dtype=np.float64)
    radius = max(int(thickness), 1) / 2.0

    # Unit tangent of every segment. Zero-length segments (a repeated vertex is a
    # real input) take the loop's ``(0.0, 0.0)``; dividing by 1.0 instead of
    # masking keeps that lane free of a spurious divide-by-zero, and ``~(> 0)``
    # rather than ``== 0`` also catches a NaN length, which the loop's
    # ``if length > 0`` sent down the same branch.
    delta = pts[1:] - pts[:-1]
    seg_len = np.hypot(delta[:, 0], delta[:, 1])
    tangent = delta / np.where(seg_len > 0, seg_len, 1.0)[:, None]
    tangent[~(seg_len > 0)] = 0.0
    tx = tangent[:, 0]
    ty = tangent[:, 1]

    # Butt caps: the first segment starts 0.5 px before the first point and the
    # last ends 0.5 px past the last, each along its own tangent (ImageJ's
    # line<->area convention). Interior joints are the raw vertices.
    ax = pts[:-1, 0].copy()
    ay = pts[:-1, 1].copy()
    bx = pts[1:, 0].copy()
    by = pts[1:, 1].copy()
    ax[0] = pts[0, 0] - 0.5 * tx[0]
    ay[0] = pts[0, 1] - 0.5 * ty[0]
    bx[-1] = pts[-1, 0] + 0.5 * tx[-1]
    by[-1] = pts[-1, 1] + 0.5 * ty[-1]

    # One offset quadrilateral per segment; perpendicular of (tx, ty) is (ty, -tx).
    rx = radius * tx
    ry = radius * ty
    quads = np.empty((n - 1, 4, 2), dtype=np.float64)
    quads[:, 0, 0] = ax + ry
    quads[:, 0, 1] = ay - rx
    quads[:, 1, 0] = ax - ry
    quads[:, 1, 1] = ay + rx
    quads[:, 2, 0] = bx - ry
    quads[:, 2, 1] = by + rx
    quads[:, 3, 0] = bx + ry
    quads[:, 3, 1] = by - rx
    _fill_convex_polygons(band, quads)

    if n > 2:
        # The outer wedge at each interior joint (ImageJ's ``rightTurn`` logic).
        # A left turn is the same triangle mirrored through the vertex, so the
        # two branches differ only by a sign — and ``a + (-b)`` is exactly
        # ``a - b`` in IEEE arithmetic, which is what keeps the merged form
        # bit-identical to the loop's if/else.
        jx = pts[1:-1, 0]
        jy = pts[1:-1, 1]
        r0x, r0y = rx[:-1], ry[:-1]   # radius * tangent of the incoming segment
        r1x, r1y = rx[1:], ry[1:]     # radius * tangent of the outgoing segment
        turn = np.where((tx[1:] * ty[:-1]) > (tx[:-1] * ty[1:]), 1.0, -1.0)
        tris = np.empty((n - 2, 3, 2), dtype=np.float64)
        tris[:, 0, 0] = jx + turn * (0.5 * (r0y + r1y))
        tris[:, 0, 1] = jy - turn * (0.5 * (r0x + r1x))
        tris[:, 1, 0] = jx - turn * r0y
        tris[:, 1, 1] = jy + turn * r0x
        tris[:, 2, 0] = jx - turn * r1y
        tris[:, 2, 1] = jy + turn * r1x
        _fill_convex_polygons(band, tris)
    return band


def dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Dilate a binary mask by a disc of given radius (in pixels)."""
    if radius <= 0:
        return mask
    import cv2
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (radius * 2 + 1, radius * 2 + 1),
    )
    return cv2.dilate(mask, kernel)


def mask_bbox(mask: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    """Half-open ``(y0, y1, x0, x1)`` bounding box of a 2-D mask's set pixels,
    or ``None`` when nothing is set.

    Two boolean ``any`` reductions plus ``argmax``, NOT ``np.nonzero``. That is
    the identity :func:`vicinity_mask` has used since 2026-09-01 — the first
    True row of ``mask.any(axis=1)`` IS ``ys.min()``, and no set pixel lies
    outside the row span, so the column reduction can be restricted to it — and
    the reason is measured: on 162 real microtubules of one 2048^2 essays
    position, ``np.nonzero`` cost 1.190 s of that function's 1.220 s, because it
    walks every frame pixel twice and materialises two int64 index arrays per
    microtubule only for four order statistics to be taken off them. The
    reductions give the identical four numbers for 0.058 s.

    Hoisted out of ``vicinity_mask`` on 2026-09-04 so :func:`region_stats` can
    use the same identity — it had the same shape of problem, gathering over a
    whole frame to reach 0.03 % of it.

    Works on a boolean mask or on a 0/1 integer band; ``any`` treats non-zero as
    set, which is the same rule the callers' ``astype(bool)`` applies.
    """
    if mask.ndim != 2:
        raise ValueError(f"mask_bbox expects a 2-D mask, got shape {mask.shape}")
    if mask.size == 0:
        # A zero-HEIGHT mask makes `rows` empty and `argmax` raise, where both
        # callers previously answered "nothing set" — `region_stats` with an
        # n=0 result and `vicinity_mask` with an empty ring. (A zero-WIDTH mask
        # needs no guard: `any` over an empty axis is False, so it falls out
        # below.) Kept explicit rather than left to chance: this helper is now
        # shared by four modules, and an exception where there used to be a
        # zero is a worse answer than either.
        return None
    rows = mask.any(axis=1)
    y0 = int(rows.argmax())
    if not rows[y0]:  # argmax on an all-False row mask means "empty"
        return None
    y1 = rows.size - int(rows[::-1].argmax())
    cols = mask[y0:y1].any(axis=0)
    x0 = int(cols.argmax())
    x1 = cols.size - int(cols[::-1].argmax())
    return y0, y1, x0, x1


def vicinity_mask(
    band: np.ndarray, not_signal: np.ndarray, margin_radius: int
) -> np.ndarray:
    """One microtubule's background ring: ``dilate(band, margin_radius)`` minus
    every signal band (``not_signal`` = the complement of the union of all
    bands).

    The dilation runs only within the band's bounding box expanded by
    ``margin_radius`` — a band is tiny relative to the frame, so this is O(bbox)
    instead of O(H*W). Since the band's pixels sit at least ``margin_radius``
    inside the sub-window (or at a real frame edge), the windowed dilation is
    bit-identical to a full-frame dilate. Empty band -> empty ring.

    Finding that bounding box is the expensive part, which is not obvious:
    measured on 162 real microtubules of one 2048^2 essays position, the
    ``np.nonzero(band)`` this used to open with was **1.190 s of the function's
    1.220 s** — the dilation it exists to make cheap costs 0.008 s, on a window
    of 6 137 px at the median against a 4 194 304 px frame. ``nonzero`` walks
    every frame pixel twice and materialises two int64 index arrays per
    microtubule only for four order statistics to be taken off them; two boolean
    ``any`` reductions plus ``argmax`` give the identical four numbers for
    0.058 s (a 20x cut of the whole function, and the bounds agree exactly on all
    162 bands). That reduction now lives in :func:`mask_bbox`, which
    :func:`region_stats` shares; the arithmetic below is unchanged, expressed
    against its half-open bounds instead of the inclusive ones it used to
    compute inline (``y1_incl + margin + 1`` == ``y1_halfopen + margin``).
    """
    h, w = band.shape
    vicinity = np.zeros(band.shape, dtype=bool)
    bbox = mask_bbox(band)
    if bbox is None:
        return vicinity
    by0, by1, bx0, bx1 = bbox
    y0 = max(0, by0 - margin_radius)
    y1 = min(h, by1 + margin_radius)
    x0 = max(0, bx0 - margin_radius)
    x1 = min(w, bx1 + margin_radius)
    capsule = dilate(band[y0:y1, x0:x1], margin_radius)
    vicinity[y0:y1, x0:x1] = (capsule > 0) & not_signal[y0:y1, x0:x1]
    return vicinity


@dataclass(frozen=True)
class FrameGeometry:
    """Every mask one frame needs, built once and reused across channels.

    The background rings depend on ALL bands (a neighbouring filament must never
    count as background), so they cannot be derived one microtubule at a time —
    which is exactly why this is one function rather than a per-MT helper each
    caller drives itself.
    """

    bands: List[np.ndarray]        # uint8 0/1, one per polyline
    vicinities: List[np.ndarray]   # bool ring, one per polyline
    lengths: List[float]           # polyline arc length in px


def frame_geometry(
    polylines_xy: Sequence[np.ndarray], h: int, w: int,
    thickness: int, margin_multiplier: float,
) -> FrameGeometry:
    """Bands, per-MT background rings and lengths for one frame.

    ``polylines_xy`` are ``(M, 2)`` ``[x, y]`` arrays. A polyline with fewer than
    two points yields an empty band and zero length rather than an error — the
    export receives whatever the editor stored, and one degenerate polyline must
    not cost the frame.
    """
    margin_radius = int(round(thickness * margin_multiplier))
    bands: List[np.ndarray] = []
    lengths: List[float] = []
    for pl in polylines_xy:
        pts = np.asarray(pl, dtype=np.float32)
        if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2:
            bands.append(np.zeros((h, w), dtype=np.uint8))
            lengths.append(0.0)
            continue
        bands.append(rasterize_band(pts, h, w, thickness))
        lengths.append(polyline_length(pts))

    signal_union = np.zeros((h, w), dtype=np.uint8)
    for m in bands:
        signal_union |= m
    not_signal = signal_union == 0
    vicinities = [vicinity_mask(b, not_signal, margin_radius) for b in bands]
    return FrameGeometry(bands=bands, vicinities=vicinities, lengths=lengths)


# --------------------------------------------------------------------------- #
#  Statistics
# --------------------------------------------------------------------------- #
def imagej_median(pixels: np.ndarray) -> float:
    """Median using ImageJ's histogram tie-rule so it matches *Measure* exactly.

    ImageJ's ``ImageStatistics`` reports, for an even count, the *upper* of the two
    central order statistics (the value at which the cumulative histogram first
    exceeds ``n / 2``), not their average as ``numpy.median`` does. For a sorted
    array that is simply ``sorted[n // 2]``. On 16-bit fluorescence data (integer
    valued) this reproduces ImageJ's median to the exact gray level; ``np.median``
    was off by up to a few levels on even-count bands.
    """
    n = int(pixels.size)
    if n == 0:
        return 0.0
    return float(np.sort(pixels, axis=None)[n // 2])


@dataclass(frozen=True)
class RegionStats:
    """Intensity statistics over one mask, in ImageJ's conventions.

    ``n == 0`` means the mask was empty; every other field is then 0.0 and the
    caller decides whether that reads as a zero or as "not available" (the export
    reports a null background, the essays CSV a blank cell).
    """

    n: int
    sum: float
    mean: float
    median: float
    std: float


def region_stats(image: np.ndarray, mask: np.ndarray) -> RegionStats:
    """Statistics of ``image`` under ``mask``, ImageJ-style.

    ``mask`` may be boolean or a 0/1 integer band; both index the same pixels.

    The gather is WINDOWED to the mask's bounding box (:func:`mask_bbox`), which
    is bit-identical and not merely close: boolean indexing yields the set
    pixels in row-major order, and cropping to a box that contains all of them
    yields the *same* 1-D array — same values, same order, same length — so
    numpy's pairwise summation blocks identically and ``sum``/``mean``/
    ``median``/``std`` cannot move. Verified elementwise on real production
    geometry (see ``tests/test_mt_measure_region_stats.py``).

    It matters because every caller hands this a FULL-FRAME mask describing a
    sliver of it. Measured on frame 0 of production container 4972cad8
    (1476x1924, 59 real microtubule polylines, the real 488 nm frame): a band
    covers 0.05 % of the pixels its un-windowed gather visited and a ring
    0.16 %, and the 118 calls cost **61.3 ms un-windowed against 22.2 ms
    windowed** (2.8x), interleaved in one process — the box was under heavy
    concurrent load, so the ratio is the number to trust, not the absolutes.
    ``frap_select._spot_snr`` has the same shape and worse: it measures a
    ~30 px window through this function once per CANDIDATE, thousands of times
    per ``/frap/targets`` request.

    Falls back to the whole-frame gather for anything that is not a 2-D mask
    matching ``image``, so a shape mismatch still raises the IndexError it
    always did rather than silently measuring a crop.
    """
    if mask.ndim != 2 or image.shape != mask.shape:
        pixels = image[mask.astype(bool)] if mask.dtype != bool else image[mask]
    else:
        bbox = mask_bbox(mask)
        if bbox is None:
            return RegionStats(0, 0.0, 0.0, 0.0, 0.0)
        y0, y1, x0, x1 = bbox
        sub = mask[y0:y1, x0:x1]
        pixels = image[y0:y1, x0:x1][sub if sub.dtype == bool else sub.astype(bool)]
    n = int(pixels.size)
    if n == 0:
        return RegionStats(0, 0.0, 0.0, 0.0, 0.0)
    return RegionStats(
        n=n,
        sum=float(pixels.sum()),
        mean=float(pixels.mean()),
        median=imagej_median(pixels),
        # ImageJ's ImageStatistics reports the *sample* standard deviation
        # (denominator n-1); numpy defaults to the population one (ddof=0).
        # Undefined for a single pixel — ImageJ reports 0 there.
        std=float(pixels.std(ddof=1)) if n > 1 else 0.0,
    )
