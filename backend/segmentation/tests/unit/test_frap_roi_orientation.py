"""The bleach ROI must follow the filament, not the image axes.

Every fixture in the FRAP suite used a HORIZONTAL filament, so `tangent_deg` was
0.0 everywhere and the rotation in `_roi_polygon` was multiplying by cos 0 and
sin 0. Measured: replacing `th = np.radians(spot.tangent_deg)` with `th = 0.0` —
i.e. drawing every ROI axis-aligned, ignoring the filament entirely — passed all
82 FRAP tests.

That is the expensive direction. The criteria VALIDATE an oriented footprint,
the microscope BLEACHES what the JSON says, and a diagonal filament would be
bleached across instead of along it while every number downstream still looked
right.

These tests use filaments at 45 and -30 degrees, which is the only thing that
can tell an oriented ROI from an axis-aligned one.
"""

import sys

import numpy as np
import pytest

sys.path.insert(0, "/app")
sys.path.insert(0, "/app/models")

from api import frap_render as FR  # noqa: E402
from models import frap_select as S  # noqa: E402

SHAPE = (600, 600)
UM_PER_PX = 0.1


def _at_angle(deg: float, cx: float, cy: float, half_len_px: float = 220.0):
    """A straight filament through (cx, cy) at `deg`, as (x, y) samples."""
    t = np.linspace(-half_len_px, half_len_px, 441)
    th = np.radians(deg)
    return np.stack([cx + t * np.cos(th), cy + t * np.sin(th)], axis=1).astype(np.float32)


def _elongated_params():
    """Non-square on purpose: a square ROI cannot show its orientation."""
    return S.SelectionParams(spot_len_um=2.0, spot_wid_um=0.4, r_iso_um=0.05, f_mid=0.02)


def _principal_axis_deg(poly) -> float:
    """Direction of the polygon's long axis, in degrees, folded to [0, 180)."""
    pts = np.asarray(poly, dtype=float)
    pts = pts - pts.mean(axis=0)
    # The eigenvector of the largest eigenvalue of the covariance IS the long axis.
    vals, vecs = np.linalg.eigh(np.cov(pts.T))
    v = vecs[:, int(np.argmax(vals))]
    return float(np.degrees(np.arctan2(v[1], v[0])) % 180.0)


@pytest.mark.parametrize("angle", [0.0, 30.0, 45.0, -30.0, 75.0])
def test_the_drawn_roi_long_axis_follows_the_filament(angle):
    p = _elongated_params()
    spot = S.Spot(x=300.0, y=300.0, tangent_deg=angle, mt_index=0,
                  mt_length_um=10.0, bleach_clearance_um=5.0,
                  readout_clearance_um=5.0, snr=3.0, score=1.0)
    poly = FR._roi_polygon(spot, p, UM_PER_PX)

    assert _principal_axis_deg(poly) == pytest.approx(angle % 180.0, abs=1.0)


def test_an_axis_aligned_roi_is_wrong_for_a_diagonal_filament():
    """The mutation this file exists for, stated as an assertion.

    At 45 degrees an oriented ROI and an axis-aligned one differ by 45 degrees of
    long axis — so a test that only ever sees horizontal filaments cannot tell
    them apart, and this one can.
    """
    p = _elongated_params()
    spot = S.Spot(x=300.0, y=300.0, tangent_deg=45.0, mt_index=0,
                  mt_length_um=10.0, bleach_clearance_um=5.0,
                  readout_clearance_um=5.0, snr=3.0, score=1.0)
    oriented = _principal_axis_deg(FR._roi_polygon(spot, p, UM_PER_PX))

    flat = S.Spot(x=300.0, y=300.0, tangent_deg=0.0, mt_index=0,
                  mt_length_um=10.0, bleach_clearance_um=5.0,
                  readout_clearance_um=5.0, snr=3.0, score=1.0)
    axis_aligned = _principal_axis_deg(FR._roi_polygon(flat, p, UM_PER_PX))

    assert abs(oriented - axis_aligned) == pytest.approx(45.0, abs=1.0)


@pytest.mark.parametrize("angle", [25.0, 45.0, -40.0])
def test_selection_reports_the_filament_angle_it_actually_found(angle):
    """`tangent_deg` on the Spot is what the microscope rotates the ROI by.

    Driving this through select_spots rather than constructing a Spot by hand is
    what proves the angle SURVIVES the pipeline, instead of only that
    _roi_polygon can rotate.
    """
    p = _elongated_params()
    curve = _at_angle(angle, 300.0, 300.0)
    r = S.select_spots([curve], SHAPE, UM_PER_PX, params=p, k_min=1, k_max=3)

    assert r.spots, f"no spot on a {angle} degree filament"
    for spot in r.spots:
        assert spot.tangent_deg % 180.0 == pytest.approx(angle % 180.0, abs=3.0)


def test_a_diagonal_roi_covers_pixels_an_axis_aligned_one_would_miss():
    """End to end through the rasteriser, not just the vertex list.

    A vertex-level assertion can be satisfied by a polygon that is rotated and
    then drawn unrotated; this compares the actual filled masks.
    """
    p = _elongated_params()
    diag = S.Spot(x=300.0, y=300.0, tangent_deg=45.0, mt_index=0,
                  mt_length_um=10.0, bleach_clearance_um=5.0,
                  readout_clearance_um=5.0, snr=3.0, score=1.0)
    flat = S.Spot(x=300.0, y=300.0, tangent_deg=0.0, mt_index=0,
                  mt_length_um=10.0, bleach_clearance_um=5.0,
                  readout_clearance_um=5.0, snr=3.0, score=1.0)

    import io

    from PIL import Image

    def mask(spot):
        png = FR.render_mask_png([spot], SHAPE, p, UM_PER_PX)
        return np.asarray(Image.open(io.BytesIO(png))) > 0

    d, f = mask(diag), mask(flat)
    assert d.sum() > 0 and f.sum() > 0
    # Same footprint, different orientation: neither may contain the other.
    assert (d & ~f).sum() > 0, "the diagonal ROI covers nothing the flat one misses"
    assert (f & ~d).sum() > 0
