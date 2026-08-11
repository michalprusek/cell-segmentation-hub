"""Per-microtubule intensity measurement.

Given a microtubule (MT) centerline (an open polyline of ``(row, col)`` pixel
coordinates produced by the v7 segmentation model) and the raw TIRF intensity
frame, this module measures:

* the **MT band** — the centerline rasterised and dilated to a fixed pixel
  width (default 5 px across), i.e. the strip of pixels considered "on" the MT;
* the **background ring** — a strip of pixels *around* the MT band but outside
  it (and outside every other MT's band), used as the local background.

Geometry (defaults ``mt_width=5``, ``bg_gap=1``, ``bg_width=5``)::

      ...bg...gap[ MT band ]gap...bg...
              ^----- 5 px ----^
         ^5px^   ^1px^

The background ring for MT *i* is "within ``bg_gap + bg_width`` of MT *i*'s
band, but NOT within ``bg_gap`` of ANY MT's band". The second clause both
inserts the gap (so point-spread-function bleed of the signal is excluded) and
removes the bands of neighbouring MTs (so a nearby filament does not inflate
the background).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import binary_dilation
from skimage.draw import line as _bresenham
from skimage.morphology import disk


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #
def rasterize_centerline(centerline_rc: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """Rasterise an open polyline to a 1-pixel-wide boolean mask.

    ``centerline_rc`` is ``(M, 2)`` float ``(row, col)``; consecutive vertices
    are joined with Bresenham line segments so the centerline is connected even
    where the model's vertices are several pixels apart.
    """
    H, W = shape
    mask = np.zeros(shape, dtype=bool)
    pts = np.round(np.asarray(centerline_rc, dtype=float)).astype(np.int64)
    pts[:, 0] = np.clip(pts[:, 0], 0, H - 1)
    pts[:, 1] = np.clip(pts[:, 1], 0, W - 1)
    for (r0, c0), (r1, c1) in zip(pts[:-1], pts[1:]):
        rr, cc = _bresenham(int(r0), int(c0), int(r1), int(c1))
        mask[rr, cc] = True
    return mask


def _band_radius(width: int) -> int:
    """Disk radius that dilates a 1-px line to a band of ``width`` px across.

    width 5 -> radius 2 (2 px each side + 1 centre = 5).
    """
    return max(0, (int(width) - 1) // 2)


def band_mask(line_mask: np.ndarray, width: int) -> np.ndarray:
    """Dilate a 1-px line mask to a band ``width`` pixels across."""
    r = _band_radius(width)
    if r == 0:
        return line_mask.copy()
    return binary_dilation(line_mask, structure=disk(r))


def background_ring(band: np.ndarray, all_bands: np.ndarray,
                    gap: int, width: int) -> np.ndarray:
    """Local background ring around ``band`` (one MT), excluding all MT bands.

    = (within ``gap + width`` of this band) AND NOT (within ``gap`` of ANY band).
    """
    outer = binary_dilation(band, structure=disk(gap + width)) if (gap + width) > 0 else band
    forbidden = binary_dilation(all_bands, structure=disk(gap)) if gap > 0 else all_bands
    return outer & ~forbidden


# --------------------------------------------------------------------------- #
# Statistics
# --------------------------------------------------------------------------- #
@dataclass
class RegionStats:
    n: int
    mean: float
    std: float
    sum: float
    median: float


def region_stats(image: np.ndarray, mask: np.ndarray) -> RegionStats:
    """Intensity statistics over ``image`` where ``mask`` is True (float64)."""
    vals = image[mask].astype(np.float64)
    if vals.size == 0:
        return RegionStats(0, float("nan"), float("nan"), 0.0, float("nan"))
    return RegionStats(
        n=int(vals.size),
        mean=float(vals.mean()),
        std=float(vals.std()),
        sum=float(vals.sum()),
        median=float(np.median(vals)),
    )


def centerline_length_px(centerline_rc: np.ndarray) -> float:
    """Arc length of the polyline in pixels (sum of Euclidean segment lengths)."""
    cl = np.asarray(centerline_rc, dtype=float)
    if cl.shape[0] < 2:
        return 0.0
    d = np.diff(cl, axis=0)
    return float(np.sqrt((d ** 2).sum(axis=1)).sum())


# --------------------------------------------------------------------------- #
# Whole-frame driver
# --------------------------------------------------------------------------- #
def measure_frame(tirf: np.ndarray, centerlines_rc: list[np.ndarray],
                  *, mt_width: int = 5, bg_gap: int = 1, bg_width: int = 5,
                  px_um: float | None = None) -> list[dict]:
    """Measure every MT in one frame.

    Returns a list of per-MT dicts (one row each). The union of all MT bands is
    computed once so each MT's background ring can exclude every other filament.
    """
    shape = tirf.shape
    img = tirf.astype(np.float64)

    # Build every band first so backgrounds can exclude neighbours.
    bands = [band_mask(rasterize_centerline(cl, shape), mt_width)
             for cl in centerlines_rc]
    all_bands = np.zeros(shape, dtype=bool)
    for b in bands:
        all_bands |= b

    rows: list[dict] = []
    for i, (cl, band) in enumerate(zip(centerlines_rc, bands), start=1):
        ring = background_ring(band, all_bands, bg_gap, bg_width)
        mt = region_stats(img, band)
        bg = region_stats(img, ring)
        length_px = centerline_length_px(cl)
        rows.append({
            "mt_id": i,
            "length_px": round(length_px, 2),
            "length_um": round(length_px * px_um, 4) if px_um else None,
            "mt_mean_intensity": round(mt.mean, 3),
            "mt_std_intensity": round(mt.std, 3),
            "mt_sum_intensity": round(mt.sum, 1),
            "bg_mean_intensity": round(bg.mean, 3),
            "bg_median_intensity": round(bg.median, 3),
            "bg_sum_intensity": round(bg.sum, 1),
            "net_mean_intensity": round(mt.mean - bg.mean, 3),
            "n_px_mt": mt.n,
            "n_px_bg": bg.n,
        })
    return rows
