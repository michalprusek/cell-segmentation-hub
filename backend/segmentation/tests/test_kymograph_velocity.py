"""Unit tests for the kymograph blob-velocity analysis helpers.

Pure NumPy tests (no GPU, no model weights) for the per-trajectory metrics
added on top of the existing blob detector:

- ``edge_touch``  — left/right/both/none flag (motor walks off the MT end)
- ``track_intensity`` — background-subtracted signal along a trajectory
- ``detect_blobs`` — now aggregates its internal run segmentation into two
  per-trajectory totals (run time excludes pauses; run length is the directed
  distance) and no longer exposes a ``runs`` array.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

from api.kymograph_velocity import (  # noqa: E402
    detect_blobs,
    edge_touch,
    net_velocity_threshold,
    track_intensity,
)


def _processive_kymo(F: int = 40, X: int = 60, x0: int = 5, v: int = 1):
    """A synthetic kymograph with one bright +v px/frame diagonal streak."""
    kymo = np.full((F, X), 100.0, dtype=np.float32)
    for t in range(F):
        xc = x0 + v * t
        if 0 <= xc < X:
            kymo[t, xc] = 800.0
            if xc - 1 >= 0:
                kymo[t, xc - 1] = 400.0
            if xc + 1 < X:
                kymo[t, xc + 1] = 400.0
    return kymo


# ── edge_touch ────────────────────────────────────────────────────────────


def test_edge_touch_interior():
    assert edge_touch([[0, 10], [1, 11], [2, 12]], 60) == "none"


def test_edge_touch_left():
    assert edge_touch([[0, 1], [1, 5], [2, 9]], 60) == "left"


def test_edge_touch_right():
    assert edge_touch([[0, 50], [1, 55], [2, 59]], 60) == "right"


def test_edge_touch_both():
    assert edge_touch([[0, 1], [1, 30], [2, 59]], 60) == "both"


def test_edge_touch_empty():
    assert edge_touch([], 60) == "none"


def test_edge_touch_tol_boundary_inclusive():
    # Default tol=2.0: a point exactly at the threshold is INSIDE the edge.
    L = 60
    assert edge_touch([[0, 2.0], [1, 30]], L) == "left"  # min == tol
    assert edge_touch([[0, 2.01], [1, 30]], L) == "none"  # just outside
    # Right boundary is n_samples-1-tol == 57.
    assert edge_touch([[0, 30], [1, 57.0]], L) == "right"  # max == 57
    assert edge_touch([[0, 30], [1, 56.99]], L) == "none"


# ── net_velocity_threshold (the µm/s -> column/frame cut-off) ───────────────


def test_net_velocity_threshold_known_conversion():
    # 0.01 µm/s, 400 ms/frame, 0.07245 µm/px, 1 px/column.
    thr = net_velocity_threshold(0.01, 400.0, 0.07245, 1.0)
    # 0.01 * 0.4 / 0.07245 ≈ 0.05521 columns/frame.
    assert abs(thr - 0.01 * 0.4 / 0.07245) < 1e-12
    assert abs(thr - 0.055210) < 1e-5


def test_net_velocity_threshold_is_display_inverse():
    # The threshold must be the algebraic inverse of the column/frame -> µm/s
    # display conversion, so a track displayed at exactly the cut-off sits on
    # the boundary. v_um_s = v_colframe * px_per_col * px_um / (ms/1000).
    px_um, ms, ppc, cut = 0.065, 1000.0, 2.3, 0.02
    thr = net_velocity_threshold(cut, ms, px_um, ppc)
    v_um_s = thr * ppc * px_um / (ms / 1000.0)
    assert abs(v_um_s - cut) < 1e-12


def test_net_velocity_threshold_scales_with_px_per_column():
    # Doubling px-per-column halves the column/frame threshold (same µm/s).
    a = net_velocity_threshold(0.01, 400.0, 0.07245, 1.0)
    b = net_velocity_threshold(0.01, 400.0, 0.07245, 2.0)
    assert abs(a - 2 * b) < 1e-12


# ── track_intensity ───────────────────────────────────────────────────────


def test_track_intensity_signal_above_background():
    kymo = _processive_kymo()
    points = [[t, 5 + t] for t in range(40)]
    out = track_intensity(kymo, points, width=3)
    assert out["intensity_signal"] is not None
    assert out["intensity_background"] is not None
    # Bright streak (~400-800) sits well above the flat ~100 background.
    assert out["intensity_signal"] > out["intensity_background"]
    assert out["intensity_minus_bg"] == (
        out["intensity_signal"] - out["intensity_background"]
    )
    assert out["intensity_minus_bg"] > 0


def test_track_intensity_background_median_is_flat_field():
    kymo = _processive_kymo()
    points = [[t, 5 + t] for t in range(40)]
    out = track_intensity(kymo, points, width=1)
    # Background bands fall on the flat 100-valued field.
    assert out["intensity_background"] == 100.0


def test_track_intensity_empty_points():
    kymo = _processive_kymo()
    out = track_intensity(kymo, [], width=3)
    assert out == {
        "intensity_signal": None,
        "intensity_background": None,
        "intensity_minus_bg": None,
    }


def test_track_intensity_signal_present_but_no_background_room():
    # A kymograph narrower than signal+gap+bg bands: every sample gets a signal
    # band but neither background band fits -> signal present, background None,
    # and (the load-bearing guard) minus_bg None rather than == signal.
    kymo = np.full((10, 3), 500.0, dtype=np.float32)
    points = [[t, 1] for t in range(10)]  # centred on the only interior column
    out = track_intensity(kymo, points, width=3)
    assert out["intensity_signal"] is not None
    assert out["intensity_background"] is None
    assert out["intensity_minus_bg"] is None


# ── detect_blobs aggregation (no runs array) ──────────────────────────────


def test_detect_blobs_reports_run_totals_not_runs():
    kymo = _processive_kymo(F=40, X=60, x0=5, v=1)
    tracks = detect_blobs(kymo)
    assert len(tracks) == 1
    tr = tracks[0]
    # The per-run array is gone; only the two aggregated totals remain.
    assert "runs" not in tr
    assert set(tr.keys()) == {
        "points",
        "net_pxframe",
        "snr",
        "total_run_time_frames",
        "total_run_displacement_px",
    }
    # +1 px/frame streak over ~39 frames.
    assert tr["net_pxframe"] > 0.9
    assert tr["total_run_time_frames"] > 0
    # Directed distance ≈ velocity × duration ≈ the full 39-px sweep.
    assert tr["total_run_displacement_px"] > 30


def test_detect_blobs_static_field_has_no_tracks():
    # A flat field with no streak yields no moving particles.
    kymo = np.full((40, 60), 100.0, dtype=np.float32)
    assert detect_blobs(kymo) == []
