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
from typing import List, Sequence

import numpy as np


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
    """
    h, w = band.shape
    xs = poly[:, 0]
    ys = poly[:, 1]
    x0 = max(int(np.floor(xs.min())), 0)
    x1 = min(int(np.ceil(xs.max())), w - 1)
    y0 = max(int(np.floor(ys.min())), 0)
    y1 = min(int(np.ceil(ys.max())), h - 1)
    if x1 < x0 or y1 < y0:
        return
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
    # Orient CCW so the interior is the positive (left) side of every edge.
    shoelace = float(np.sum(xs * np.roll(ys, -1) - np.roll(xs, -1) * ys))
    p = poly if shoelace >= 0 else poly[::-1]
    inside = np.ones(gx.shape, dtype=bool)
    eps = 1e-9
    k = len(p)
    for e in range(k):
        ax, ay = p[e]
        bx, by = p[(e + 1) % k]
        cross = (bx - ax) * (gy - ay) - (by - ay) * (gx - ax)
        dx = bx - ax
        dy = by - ay
        top_left = (dy > 0) or (dy == 0 and dx < 0)
        inside &= cross > (-eps if top_left else eps)
    band[y0:y1 + 1, x0:x1 + 1][inside] = 1


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
    """
    band = np.zeros((h, w), dtype=np.uint8)
    n = int(points.shape[0])
    if points.ndim != 2 or points.shape[1] != 2 or n < 2:
        return band
    pts = np.asarray(points, dtype=np.float64)
    radius = max(int(thickness), 1) / 2.0

    def _unit(dx: float, dy: float) -> tuple:
        length = float(np.hypot(dx, dy))
        return (dx / length, dy / length) if length > 0 else (0.0, 0.0)

    dx1, dy1 = _unit(pts[1, 0] - pts[0, 0], pts[1, 1] - pts[0, 1])
    dx0, dy0 = dx1, dy1
    xfrom = pts[0, 0] - 0.5 * dx1
    yfrom = pts[0, 1] - 0.5 * dy1
    for i in range(1, n):
        xto = pts[i, 0]
        yto = pts[i, 1]
        if i == n - 1:  # extend the far end by 0.5 px along the last segment
            xto += 0.5 * dx1
            yto += 0.5 * dy1
        fill_convex_polygon(band, np.array([
            [xfrom + radius * dy1, yfrom - radius * dx1],
            [xfrom - radius * dy1, yfrom + radius * dx1],
            [xto - radius * dy1, yto + radius * dx1],
            [xto + radius * dy1, yto - radius * dx1],
        ]))
        if i > 1:  # fill the outer wedge at the joint between two segments
            right_turn = (dx1 * dy0) > (dx0 * dy1)
            if right_turn:
                tri = np.array([
                    [xfrom + 0.5 * (radius * dy0 + radius * dy1),
                     yfrom - 0.5 * (radius * dx0 + radius * dx1)],
                    [xfrom - radius * dy0, yfrom + radius * dx0],
                    [xfrom - radius * dy1, yfrom + radius * dx1],
                ])
            else:
                tri = np.array([
                    [xfrom - 0.5 * (radius * dy0 + radius * dy1),
                     yfrom + 0.5 * (radius * dx0 + radius * dx1)],
                    [xfrom + radius * dy0, yfrom - radius * dx0],
                    [xfrom + radius * dy1, yfrom - radius * dx1],
                ])
            fill_convex_polygon(band, tri)
        dx0, dy0 = dx1, dy1
        xfrom, yfrom = xto, yto
        if i < n - 1:
            dx1, dy1 = _unit(pts[i + 1, 0] - pts[i, 0], pts[i + 1, 1] - pts[i, 1])
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
    """
    ys, xs = np.nonzero(band)
    vicinity = np.zeros(band.shape, dtype=bool)
    if ys.size == 0:
        return vicinity
    h, w = band.shape
    y0 = max(0, int(ys.min()) - margin_radius)
    y1 = min(h, int(ys.max()) + margin_radius + 1)
    x0 = max(0, int(xs.min()) - margin_radius)
    x1 = min(w, int(xs.max()) + margin_radius + 1)
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
    """
    pixels = image[mask.astype(bool)] if mask.dtype != bool else image[mask]
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
