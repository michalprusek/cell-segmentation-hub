"""Per-microtubule intensity measurement — a thin adapter over the shared code.

The geometry and the statistics are NOT defined here. They live once, in
``backend/segmentation/models/mt_measure.py``, which the project export's
``/mt-metrics`` endpoint imports too; this module only converts between that
code's conventions and the essays CSV. So a change to how a band is rasterised
or how a background ring is drawn reaches the batch and the export together.

Until 2026-08-13 this file carried its own implementation, and the two had
drifted badly. The export was aligned to ImageJ *Measure* in 2026-07 (PR #301,
#304) while this module still lived in a separate repository, so it never
received that work and kept measuring:

* a **round-capped** band (Bresenham line dilated by a disk) instead of ImageJ's
  ``Roi.convertLineToArea`` offset polygon;
* a background ring of ``bg_gap + bg_width`` = 6 px with a 1 px guard, instead of
  ``thickness * margin`` = 10 px excluding exactly the bands;
* ``numpy.median`` instead of ImageJ's histogram tie-rule;
* a population standard deviation instead of ImageJ's sample one.

Measured on one real frame with identical centerlines, the two disagreed on
every quantity except length: band area by −7.8 % to +26.5 %, the background ring
by a factor of 2.2, and the net signal — what the assay reports — by a median of
+9.9 % and up to +33.2 %. **Numbers produced before 2026-08-13 are therefore not
comparable with numbers produced after it**; the geometry changed, not a bug in
the arithmetic.

Geometry, in the shared convention (defaults ``mt_width=5``, ``bg_margin=2.0``)::

      ...background ring (out to 10 px)...[ MT band, 5 px ]...ring...

The ring for MT *i* reaches ``mt_width * bg_margin`` pixels from *i*'s own band
and excludes the band of EVERY microtubule, so a neighbouring filament can never
be counted as background.
"""
from __future__ import annotations

import numpy as np

from _mt_package import ensure_on_path

# Puts the directory holding the shared model package — and mt_measure beside it
# — on sys.path. Deliberately at import time and deliberately allowed to raise:
# a missing shared module must be an error, not a quiet fall-back to a second
# copy, which is the failure this arrangement exists to prevent.
ensure_on_path()
import mt_measure  # noqa: E402  (needs the path set above)


def measure_frame(tirf: np.ndarray, centerlines_rc: list[np.ndarray],
                  *, mt_width: int = 5, bg_margin: float = 2.0,
                  px_um: float | None = None) -> list[dict]:
    """Measure every MT in one frame and return one CSV row per filament.

    ``centerlines_rc`` are ``(M, 2)`` ``(row, col)`` arrays as the v7 model emits
    them; the shared code works in ``(x, y)``, so they are swapped on the way in.
    Getting that swap wrong is invisible on a square frame, which is why it
    happens here, once, rather than at each call site.
    """
    h, w = tirf.shape
    img = tirf.astype(np.float64)
    polylines_xy = [np.asarray(cl, dtype=np.float32)[:, ::-1]
                    for cl in centerlines_rc]

    geom = mt_measure.frame_geometry(polylines_xy, h, w, mt_width, bg_margin)

    rows: list[dict] = []
    for i, (band, ring, length_px) in enumerate(
            zip(geom.bands, geom.vicinities, geom.lengths), start=1):
        mt = mt_measure.region_stats(img, band)
        bg = mt_measure.region_stats(img, ring)
        # An empty ring means "no local background available" — blank, not zero.
        # A zero would silently inflate the net signal by the whole signal.
        has_bg = bg.n > 0
        rows.append({
            "mt_id": i,
            "length_px": round(length_px, 2),
            "length_um": round(length_px * px_um, 4) if px_um else None,
            "mt_mean_intensity": round(mt.mean, 3),
            "mt_std_intensity": round(mt.std, 3),
            "mt_sum_intensity": round(mt.sum, 1),
            "bg_mean_intensity": round(bg.mean, 3) if has_bg else None,
            "bg_median_intensity": round(bg.median, 3) if has_bg else None,
            "bg_sum_intensity": round(bg.sum, 1) if has_bg else None,
            # Kept for continuity with earlier runs: mean minus mean.
            "net_mean_intensity": (
                round(mt.mean - bg.mean, 3) if has_bg else None),
            "n_px_mt": mt.n,
            "n_px_bg": bg.n,
            # The band median, which this CSV never carried and the export
            # always did.
            "mt_median_intensity": round(mt.median, 3),
            # The export's readout, to the digit: mean minus the ring's MEDIAN.
            # A median background resists a neighbouring filament's halo in a way
            # the mean does not, which is why the export reports this one.
            "signal_minus_background": (
                round(mt.mean - bg.median, 3) if has_bg else None),
        })
    return rows
