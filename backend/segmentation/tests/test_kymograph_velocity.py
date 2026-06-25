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
