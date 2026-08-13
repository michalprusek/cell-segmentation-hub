"""The essays numbers and the project export's numbers must be the same numbers.

Checked 2026-08-13 and they were not. Same frame, same centerlines, 24
microtubules: band area differed by −7.8 % to +26.5 %, the background ring was
2.2x larger on the export side, and the net signal — the number the assay reports
— differed by a median of +9.9 %, up to +33.2 %. Only length agreed.

The cause was structural, not arithmetic: the export was aligned to ImageJ
*Measure* in 2026-07 (PR #301, #304) while this module was still a separate
repository, so it never received that work and kept its own round-capped band,
its own ring geometry, ``numpy.median`` and a population standard deviation.
Nothing announced which of the two answers you were holding.

Both now compute through ``models/mt_measure.py``. These tests assert that, and
they assert it three ways, because "we made them the same" decays quietly:

  1. the essays adapter uses the shared module *object*, not a copy of its code;
  2. its numbers reproduce the export's recipe digit for digit on a frame whose
     answers are known by construction;
  3. the ImageJ conventions that the old implementation got wrong are actually in
     force — a test that only compared the two would pass if BOTH regressed.

Run with: pytest tests/ — needs the shared module on the path, i.e. a checkout
(it resolves to backend/segmentation/models) or the essays image. No GPU, no
checkpoint, no ND2.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

from mt_pipeline import measure as essays_measure  # noqa: E402
import mt_measure  # noqa: E402  (put on the path by mt_pipeline.measure)

THICKNESS = 5
MARGIN = 2.0


@pytest.fixture
def frame():
    """A frame whose background is textured, so a wrong ring cannot look right.

    A constant background would make every ring geometry agree, which is exactly
    the bug this file exists to catch. The gradient means a ring of the wrong
    radius samples different pixels and reports a different mean.
    """
    h = w = 96
    yy, xx = np.mgrid[0:h, 0:w]
    img = (100 + 0.5 * yy + 0.25 * xx).astype(np.float64)
    # Two filaments close enough that each sits inside the other's ring reach —
    # so the "exclude every band" rule is actually exercised.
    img[44:49, 20:70] += 900
    img[54:59, 20:70] += 700
    return img


@pytest.fixture
def centerlines():
    """(row, col) polylines, as the v7 model emits them."""
    return [
        np.array([[46.0, 20.0], [46.0, 45.0], [46.0, 69.0]]),
        np.array([[56.0, 20.0], [56.0, 69.0]]),
    ]


def _export_rows(img, centerlines):
    """The /mt-metrics recipe, spelled out as that endpoint spells it."""
    h, w = img.shape
    geom = mt_measure.frame_geometry(
        [np.asarray(cl, dtype=np.float32)[:, ::-1] for cl in centerlines],
        h, w, THICKNESS, MARGIN,
    )
    out = []
    for band, ring, length in zip(geom.bands, geom.vicinities, geom.lengths):
        sig = mt_measure.region_stats(img, band)
        bg = mt_measure.region_stats(img, ring)
        out.append(dict(
            length_px=length,
            pixel_count=sig.n,
            sum_intensity=sig.sum,
            mean_intensity=sig.mean,
            median_intensity=sig.median,
            std_intensity=sig.std,
            median_background=bg.median if bg.n else None,
            mean_background=bg.mean if bg.n else None,
            signal_minus_background=(sig.mean - bg.median) if bg.n else None,
        ))
    return out


# --------------------------------------------------------------------------
# 1. One implementation, not two that happen to agree today.
# --------------------------------------------------------------------------

def test_essays_uses_the_shared_measurement_module():
    """A local re-implementation is how the last divergence started."""
    assert essays_measure.mt_measure is mt_measure


def test_essays_defines_no_geometry_of_its_own():
    """The adapter converts coordinates and names columns — nothing more.

    If a band rasteriser or a ring builder reappears here, the two callers can
    drift again without either side failing.
    """
    local = {
        name for name in vars(essays_measure)
        if callable(getattr(essays_measure, name))
        and getattr(getattr(essays_measure, name), "__module__", None)
        == essays_measure.__name__
    }
    assert local == {"measure_frame"}, f"unexpected local implementation: {local}"


# --------------------------------------------------------------------------
# 2. The same inputs give the same numbers.
# --------------------------------------------------------------------------

def test_every_shared_column_matches_the_export(frame, centerlines):
    """Column by column, to the rounding the essays CSV applies."""
    ess = essays_measure.measure_frame(
        frame, centerlines, mt_width=THICKNESS, bg_margin=MARGIN)
    exp = _export_rows(frame, centerlines)
    assert len(ess) == len(exp) == 2

    for e, x in zip(ess, exp):
        assert e["length_px"] == round(x["length_px"], 2)
        assert e["n_px_mt"] == x["pixel_count"]
        assert e["mt_sum_intensity"] == round(x["sum_intensity"], 1)
        assert e["mt_mean_intensity"] == round(x["mean_intensity"], 3)
        assert e["mt_median_intensity"] == round(x["median_intensity"], 3)
        assert e["mt_std_intensity"] == round(x["std_intensity"], 3)
        assert e["bg_median_intensity"] == round(x["median_background"], 3)
        assert e["bg_mean_intensity"] == round(x["mean_background"], 3)
        assert e["signal_minus_background"] == round(
            x["signal_minus_background"], 3)


def test_the_background_ring_excludes_the_neighbouring_filament(frame, centerlines):
    """The two filaments are 10 px apart: each is inside the other's reach.

    If a neighbour's band leaked into the ring, the background would carry that
    filament's ~700-900 count halo and the net signal would collapse.
    """
    rows = essays_measure.measure_frame(
        frame, centerlines, mt_width=THICKNESS, bg_margin=MARGIN)
    for r in rows:
        # Background stays near the ~100-160 gradient, nowhere near the ~800+
        # filament, i.e. no band pixel was counted as background.
        assert r["bg_mean_intensity"] < 200
        assert r["signal_minus_background"] > 500


# --------------------------------------------------------------------------
# 3. The ImageJ conventions the old implementation got wrong.
# --------------------------------------------------------------------------

def test_median_uses_the_imagej_tie_rule(frame, centerlines):
    """``sorted[n // 2]``, not numpy's average of the two central values.

    Asserted on a band with an even pixel count, where the two rules differ; on
    an odd count they agree and the test would prove nothing.
    """
    geom = mt_measure.frame_geometry(
        [np.asarray(centerlines[1], dtype=np.float32)[:, ::-1]],
        *frame.shape, THICKNESS, MARGIN)
    px = frame[geom.bands[0].astype(bool)]
    assert px.size % 2 == 0, "fixture no longer exercises the tie rule"
    assert mt_measure.imagej_median(px) == float(np.sort(px)[px.size // 2])
    assert mt_measure.imagej_median(px) != float(np.median(px))


def test_std_is_the_sample_deviation(frame, centerlines):
    """ddof=1, as ImageJ's ImageStatistics reports it."""
    rows = essays_measure.measure_frame(
        frame, centerlines, mt_width=THICKNESS, bg_margin=MARGIN)
    geom = mt_measure.frame_geometry(
        [np.asarray(cl, dtype=np.float32)[:, ::-1] for cl in centerlines],
        *frame.shape, THICKNESS, MARGIN)
    px = frame[geom.bands[0].astype(bool)]
    assert rows[0]["mt_std_intensity"] == round(float(px.std(ddof=1)), 3)
    assert rows[0]["mt_std_intensity"] != round(float(px.std()), 3)


def test_band_is_the_imagej_line_area_not_a_dilated_line(frame, centerlines):
    """Butt caps, not the round caps the old essays band had.

    A horizontal 5 px band over a 49 px run is 5 * (49 + 1) px under ImageJ's
    0.5 px line-to-area extension. A disk-dilated line would round both ends and
    land elsewhere — which is precisely the ~8 % area error that was measured.
    """
    geom = mt_measure.frame_geometry(
        [np.asarray(centerlines[1], dtype=np.float32)[:, ::-1]],
        *frame.shape, THICKNESS, MARGIN)
    assert int(geom.bands[0].sum()) == 5 * 50


def test_an_empty_ring_reports_blank_not_zero():
    """A zero background would inflate the net signal by the whole signal."""
    img = np.full((20, 20), 500.0)
    # One filament filling the frame: dilating its band cannot reach any pixel
    # that is not already signal, so the ring comes out empty.
    cl = [np.array([[float(r), 0.0], [float(r), 19.0]]) for r in range(0, 20)]
    rows = essays_measure.measure_frame(img, cl, mt_width=THICKNESS,
                                        bg_margin=MARGIN)
    assert rows[0]["bg_mean_intensity"] is None
    assert rows[0]["net_mean_intensity"] is None
    assert rows[0]["signal_minus_background"] is None
    assert rows[0]["n_px_bg"] == 0
