"""Unit tests for the kymograph trajectory-analysis helpers.

Two layers, deliberately:

- **Pure NumPy** (no GPU, no model weights) for the per-trajectory metrics —
  ``edge_touch``, ``tracks_intensity``, ``flag_bright_outliers``,
  ``net_velocity_threshold``, ``_subpixel_peak``.
- **``detect_tracks``**, the KymoButler adapter, driven through the REAL
  vendored preprocessing / segmentation / morphology / tracking code with only
  the network's forward pass stubbed. What is under test is the wiring — the key
  set the wire contract depends on, the (frame, column) orientation, and the
  SNR / run-total derivation — not the checkpoint's accuracy, which is measured
  against upstream's own reference counts in ``models/kymobutler/config.py``.

The kymograph fixture is realistic on purpose: Poisson-ish shot noise on a
non-flat background, streaks a couple of columns wide with a soft profile, and
crossing trajectories. A flat field with one 800-valued diagonal (which is what
this file used to test against) passes for a detector that does nothing but
threshold, so it proves nothing about either detector.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

from api.kymograph_velocity import (  # noqa: E402
    _subpixel_peak,
    detect_tracks,
    edge_touch,
    flag_bright_outliers,
    kymograph_polarity,
    net_velocity_threshold,
    tracks_intensity,
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


def _noisy_kymo(
    streaks=((5, 1.0), (55, -1.0)),
    F: int = 64,
    X: int = 64,
    amp: float = 900.0,
    seed: int = 7,
):
    """A kymograph that looks like a real one: shot noise, drifting background.

    ``streaks`` is ``((x0, v), ...)`` in columns and columns/frame. Each streak
    is laid down with a Gaussian cross-section ~1.1 columns wide, so its centre
    is genuinely sub-pixel rather than snapped to a column, and the two default
    streaks CROSS near the middle — which is the case the DoG-blob detector this
    replaced had to guess at and KymoButler's decision module is for.
    """
    rng = np.random.default_rng(seed)
    # Non-flat background: a slow illumination gradient plus Poisson shot noise,
    # so the per-row median subtraction and the MAD noise estimate both have
    # something real to remove.
    base = 300.0 + 60.0 * np.linspace(0.0, 1.0, X)[None, :]
    base = base + 20.0 * np.sin(np.linspace(0, 3.0, F))[:, None]
    kymo = rng.poisson(base).astype(np.float32)

    cols = np.arange(X, dtype=np.float64)
    for x0, v in streaks:
        for t in range(F):
            xc = x0 + v * t
            if not (0 <= xc < X):
                continue
            kymo[t] += amp * np.exp(-0.5 * ((cols - xc) / 1.1) ** 2)
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


# ── tracks_intensity ──────────────────────────────────────────────────────
#
# The region and the statistics are ``mt_measure``'s, not this module's: a
# trajectory is measured exactly as a microtubule is (ImageJ
# ``Roi.convertLineToArea`` band, ring = dilate(band) minus EVERY band,
# histogram-tie-rule median). What is under test here is that mapping — the
# (frame, x) -> (x, y) swap, the neighbour exclusion the ring buys, and the
# null contract — not the shared geometry, which ``test_mt_metrics_band.py``
# pins against ImageJ.


def _parallel_trajectories(cols, T=60, X=60, field=100.0, bright=900.0,
                           width=3):
    """A kymograph with one static (vertical) bright streak per entry of ``cols``.

    Static on purpose: a vertical trajectory has a band of exactly ``width``
    columns, so the arithmetic below is checkable by hand.
    """
    kymo = np.full((T, X), field, dtype=np.float32)
    half = (width - 1) // 2
    for c in cols:
        kymo[:, c - half:c + half + 1] = bright
    points = [[[t, float(c)] for t in range(T)] for c in cols]
    return kymo, points


def test_tracks_intensity_signal_above_background():
    kymo = _processive_kymo()
    points = [[[t, 5 + t] for t in range(40)]]
    out = tracks_intensity(kymo, points, width=3)[0]
    assert out["intensity_signal"] is not None
    assert out["intensity_background"] is not None
    # Bright streak (~400-800) sits well above the flat ~100 background.
    assert out["intensity_signal"] > out["intensity_background"]
    assert out["intensity_minus_bg"] == (
        out["intensity_signal"] - out["intensity_background"]
    )
    assert out["intensity_minus_bg"] > 0


def test_tracks_intensity_background_is_the_flat_field():
    """The ring lands on empty field, and the band swallows the streak.

    ``width=3`` covers the 800-valued peak AND its two 400-valued shoulders, so
    nothing of the trajectory leaks into its own ring — which is the reason the
    band width must be at least the streak width. (At ``width=1`` the shoulders
    fall in the ring; the median still reads 100 here only because the ring is
    much larger than the two contaminated columns.)
    """
    kymo = _processive_kymo()
    points = [[[t, 5 + t] for t in range(40)]]
    assert tracks_intensity(kymo, points, width=3)[0][
        "intensity_background"
    ] == 100.0


def test_tracks_intensity_excludes_a_neighbouring_trajectory():
    """The whole point of measuring a trajectory the way a microtubule is.

    Three parallel streaks 6 columns apart — ordinary traffic on a busy
    microtubule. The middle one's background ring reaches 6 px
    (``width * margin_multiplier`` = 3 * 2) either side, which is far enough to
    touch both neighbours, and excludes them because every detected trajectory
    contributes a band to the exclusion mask.
    """
    kymo, points = _parallel_trajectories([20, 26, 32])
    middle = tracks_intensity(kymo, points, 3)[1]
    assert middle["intensity_signal"] == 900.0
    assert middle["intensity_background"] == 100.0  # the true empty field
    assert middle["intensity_minus_bg"] == 800.0

    # The same trajectory on the same kymograph, measured as if it had no
    # neighbours — which is what a per-track background computes, and what this
    # ring would compute if it did not subtract the other bands. Its ring is
    # then half neighbour, the (upper) tie-rule median lands on the neighbour,
    # and a streak 9x brighter than the field reports ZERO contrast.
    alone = tracks_intensity(kymo, [points[1]], 3)[0]
    assert alone["intensity_signal"] == middle["intensity_signal"]
    assert alone["intensity_background"] == 900.0
    assert alone["intensity_minus_bg"] == 0.0


def test_tracks_intensity_background_uses_the_imagej_tie_rule():
    """``sorted[n // 2]``, not ``numpy.median``'s average of the two centrals.

    Half the ring sits on a 100-valued field and half on a 200-valued one, so
    the two central order statistics differ: ImageJ reports the upper (200),
    numpy reports their mean (150). The per-microtubule metric has reported the
    ImageJ one since PR #304 and a trajectory must not report the other.
    """
    kymo = np.full((30, 40), 100.0, dtype=np.float32)
    kymo[:, 20:] = 200.0
    points = [[[t, 20.0] for t in range(30)]]
    assert tracks_intensity(kymo, points, 3)[0]["intensity_background"] == 200.0


def test_tracks_intensity_margin_multiplier_sizes_the_ring():
    """The ring is tunable, and 0 collapses it onto the band (no background)."""
    kymo, points = _parallel_trajectories([20, 26, 32])
    assert tracks_intensity(kymo, points, 3, margin_multiplier=0.0)[1][
        "intensity_background"
    ] is None
    # Too narrow to reach past the neighbours' bands is still fine — the ring
    # simply holds fewer, closer field pixels.
    assert tracks_intensity(kymo, points, 3, margin_multiplier=1.0)[1][
        "intensity_background"
    ] == 100.0


def test_tracks_intensity_empty_input():
    assert tracks_intensity(_processive_kymo(), [], width=3) == []


def test_tracks_intensity_degenerate_track_keeps_its_slot():
    """A <2-point trajectory rasterises to nothing; it must not shift the list."""
    kymo, points = _parallel_trajectories([20, 40])
    out = tracks_intensity(kymo, [points[0], [[0, 5.0]], points[1]], 3)
    assert len(out) == 3
    assert out[1] == {
        "intensity_signal": None,
        "intensity_background": None,
        "intensity_minus_bg": None,
    }
    assert out[0]["intensity_signal"] == 900.0
    assert out[2]["intensity_signal"] == 900.0


def test_tracks_intensity_signal_present_but_no_background_room():
    # A kymograph narrower than band + ring: the trajectory's own band covers
    # every column, so the ring has no non-signal pixel left -> signal present,
    # background None, and (the load-bearing guard) minus_bg None rather than
    # == signal.
    kymo = np.full((10, 3), 500.0, dtype=np.float32)
    points = [[[t, 1] for t in range(10)]]  # centred on the only interior column
    out = tracks_intensity(kymo, points, width=3)[0]
    assert out["intensity_signal"] is not None
    assert out["intensity_background"] is None
    assert out["intensity_minus_bg"] is None


# ── flag_bright_outliers ──────────────────────────────────────────────────


def _tracks_with_signals(signals):
    return [{"intensity_signal": s} for s in signals]


def test_flag_bright_outliers_marks_high_outlier():
    # A tight cluster around 100 plus one bright aggregate at 1000.
    tracks = _tracks_with_signals([95, 100, 102, 98, 105, 1000])
    flag_bright_outliers(tracks)
    assert [tr["bright"] for tr in tracks] == [
        False,
        False,
        False,
        False,
        False,
        True,
    ]


def test_flag_bright_outliers_none_when_uniform():
    # No spread (MAD == 0) → no outlier can be defined → nothing flagged.
    tracks = _tracks_with_signals([100, 100, 100, 100])
    flag_bright_outliers(tracks)
    assert all(tr["bright"] is False for tr in tracks)


def test_flag_bright_outliers_too_few_tracks():
    # Fewer than 3 signals → no population to judge an outlier against.
    tracks = _tracks_with_signals([100, 5000])
    flag_bright_outliers(tracks)
    assert all(tr["bright"] is False for tr in tracks)


def test_flag_bright_outliers_assigns_default_to_all():
    # Every track gets a `bright` key even when its signal is None.
    tracks = [
        {"intensity_signal": 100},
        {"intensity_signal": None},
        {"intensity_signal": 102},
        {"intensity_signal": 99},
    ]
    flag_bright_outliers(tracks)
    assert all("bright" in tr for tr in tracks)
    # The None-signal track is never flagged.
    assert tracks[1]["bright"] is False


# ── _subpixel_peak guard ──────────────────────────────────────────────────


def test_subpixel_peak_refines_towards_the_true_maximum():
    # A parabola peaking between columns 4 and 5, sampled on the integers.
    row = np.exp(-0.5 * ((np.arange(10.0) - 4.6) / 1.2) ** 2) * 100.0
    x = _subpixel_peak(row, 5, len(row))
    assert 4.0 < x < 5.0


def test_subpixel_peak_negative_centre_returns_index_without_warning():
    """Regression: KymoButler hands over columns that are not DoG maxima.

    The DoG detector this replaced only ever called ``_subpixel_peak`` at a
    ``find_peaks`` maximum above a positive height, so the centre sample was
    positive by construction and the guard never needed to check it. KymoButler
    hands over a thinned-skeleton column instead, which can sit on a NEGATIVE
    band-pass value — ``log`` then returned NaN for every such sample. The
    result was still ``j`` (NaN fails the ``abs(den) > 1e-9`` test), but only
    after a RuntimeWarning per point, on every track, on every kymograph.
    """
    import warnings

    row = np.array([5.0, 5.0, -3.0, 5.0, 5.0])
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # any RuntimeWarning fails the test
        assert _subpixel_peak(row, 2, len(row)) == 2.0
    # The two flanking-sample guards must still hold on their own.
    assert _subpixel_peak(np.array([-1.0, 5.0, 5.0]), 1, 3) == 1.0
    assert _subpixel_peak(np.array([5.0, 5.0, -1.0]), 1, 3) == 1.0


def test_subpixel_peak_never_refines_towards_a_minimum():
    """Regression: an upward parabola must be rejected, not interpolated.

    ``den = a - 2b + c`` is the second difference: negative is concave-down (a
    maximum, what the formula solves for) and positive is concave-UP, where
    ``0.5·(a-c)/den`` locates the bottom of a valley. The DoG detector only ever
    called this at a ``find_peaks`` maximum so the case could not arise;
    KymoButler hands over a thinned-skeleton column that need not be a maximum
    at all. Accepting ``abs(den) > 1e-9`` moved this sample to 1.167 — deeper
    into the valley — injecting wrong-direction jitter of up to a full column
    into the velocity of exactly the slow trajectories the refinement is for.
    """
    row = np.array([100.0, 1.0, 10.0])  # j=1 is a local MINIMUM
    assert _subpixel_peak(row, 1, 3) == 1.0


# ── polarity ──────────────────────────────────────────────────────────────


def test_kymograph_polarity_detects_an_inverted_kymograph():
    bright_on_dark = _noisy_kymo(streaks=((6, 1.0),), F=48, X=64)
    assert kymograph_polarity(bright_on_dark) == 1.0
    assert kymograph_polarity(4000.0 - bright_on_dark) == -1.0
    # A constant field has no polarity to detect and must not divide by zero.
    assert kymograph_polarity(np.full((8, 8), 7.0)) == 1.0


def test_tracks_intensity_signs_minus_bg_by_polarity():
    """``intensity_minus_bg`` must mean "contrast", not "raw difference".

    On a polarity-inverted kymograph the trajectory's pixels are DARKER than
    their surround, so the unsigned difference is negative — which reads on the
    velocity table and in the exported sheet as a trajectory with no signal
    under it. The two raw fields stay unsigned: they are documented as raw pixel
    values comparable with the per-MT intensity metric, and they still are.
    """
    kymo = np.full((20, 40), 4000.0, dtype=np.float32)
    kymo[:, 19:22] = 1000.0  # a dark vertical trajectory
    points = [[t, 20.0] for t in range(20)]

    default = tracks_intensity(kymo, [points], 3)[0]
    assert default["intensity_signal"] < default["intensity_background"]
    assert default["intensity_minus_bg"] < 0

    inverted = tracks_intensity(kymo, [points], 3, polarity=-1.0)[0]
    # Same raw readings, opposite sign on the contrast.
    assert inverted["intensity_signal"] == default["intensity_signal"]
    assert inverted["intensity_background"] == default["intensity_background"]
    assert inverted["intensity_minus_bg"] == -default["intensity_minus_bg"]
    assert inverted["intensity_minus_bg"] > 0


def test_flag_bright_outliers_follows_polarity():
    """On an inverted kymograph the DIMMEST raw mean is the strongest signal."""
    tracks = [{"intensity_signal": v} for v in (100.0, 101.0, 99.0, 100.5, 900.0)]
    flag_bright_outliers(tracks)
    assert [t["bright"] for t in tracks] == [False, False, False, False, True]

    dark = [{"intensity_signal": v} for v in (900.0, 899.0, 901.0, 900.5, 100.0)]
    flag_bright_outliers(dark, polarity=-1.0)
    assert [t["bright"] for t in dark] == [False, False, False, False, True]
    # ...and the same population under +1 must flag nothing: the outlier is low.
    dark2 = [{"intensity_signal": v} for v in (900.0, 899.0, 901.0, 900.5, 100.0)]
    flag_bright_outliers(dark2)
    assert not any(t["bright"] for t in dark2)


# ── detect_tracks: the KymoButler adapter ─────────────────────────────────
#
# The network forward pass is stubbed; EVERYTHING else is the real vendored
# code — preprocess_array, resize_to_multiple_of_16, the (1,2,H,W) unwrap,
# process_segmentation_bi's binarise/smooth/thin/prune/filter, detect_seeds,
# _make_track, the duplicate/subset/overlap cleanup — plus the adapter's own
# sub-pixel refinement, SNR and run-total derivation.


class _StubBiNet:
    """Emits a trackness map that is a soft band around a +1 col/frame diagonal.

    Returns ``(B, 2, H, W)`` with the FOREGROUND in channel 0, matching what
    ``OnnxBiNet`` produces from the real graph — ``segment_bidirectional``
    reads ``pred[0, 0]``.
    """

    def __init__(self, x0: float = 6.0, v: float = 1.0, width: float = 1.1):
        self.x0, self.v, self.width = x0, v, width

    def eval(self):
        return self

    def __call__(self, tensor):
        import torch

        _, _, h, w = tensor.shape
        rows = torch.arange(h, dtype=torch.float32).unsqueeze(1)
        cols = torch.arange(w, dtype=torch.float32).unsqueeze(0)
        centre = self.x0 + self.v * rows
        fg = torch.exp(-0.5 * ((cols - centre) / self.width) ** 2)
        return torch.stack([fg, 1.0 - fg], dim=0).unsqueeze(0)


@pytest.fixture
def stub_binet(monkeypatch):
    """Route detect_tracks' model load to a stub; leave everything else real."""
    kb = pytest.importorskip("kymobutler")

    def _load(keys, model_dir=None, device="cpu"):
        # decnet is None on purpose: track_bidirectional only consults the
        # decision module when it is not None, so the geometry path runs
        # end-to-end without the 124 MB graph.
        return {"binet": _StubBiNet(), "decnet": None}

    monkeypatch.setattr(kb, "load_models", _load)
    return kb


WIRE_KEYS = {
    "points",
    "net_pxframe",
    "snr",
    "total_run_time_frames",
    "total_run_displacement_px",
}


def test_detect_tracks_emits_exactly_the_wire_keys(stub_binet):
    """``KymographTrack`` is ``extra='forbid'`` — one stray key 500s the route."""
    tracks = detect_tracks(_noisy_kymo(streaks=((6, 1.0),), F=48, X=64), device="cpu")
    assert tracks, "stubbed trackness map produced no trajectory"
    for tr in tracks:
        assert set(tr.keys()) == WIRE_KEYS


def test_detect_tracks_recovers_the_streak_velocity_and_orientation(stub_binet):
    """+1 column/frame in, +1 column/frame out — and points are (frame, x)."""
    tracks = detect_tracks(_noisy_kymo(streaks=((6, 1.0),), F=48, X=64), device="cpu")
    tr = max(tracks, key=lambda t: len(t["points"]))
    assert tr["net_pxframe"] == pytest.approx(1.0, abs=0.15)
    frames = [p[0] for p in tr["points"]]
    assert frames == sorted(frames), "points must be time-ordered"
    assert all(isinstance(p[0], int) for p in tr["points"])
    # Orientation: a +1 col/frame streak starting at column 6 must have its
    # first point near column 6, NOT near row 6 (a (row, col) transpose here
    # would still produce a plausible-looking diagonal).
    assert abs(tr["points"][0][1] - (6 + tr["points"][0][0])) < 4


def test_detect_tracks_run_totals_are_populated(stub_binet):
    tracks = detect_tracks(_noisy_kymo(streaks=((6, 1.0),), F=48, X=64), device="cpu")
    tr = max(tracks, key=lambda t: len(t["points"]))
    assert tr["total_run_time_frames"] > 0
    # Directed distance ~ |v| x duration; the streak sweeps most of the width.
    assert tr["total_run_displacement_px"] > 0.5 * tr["total_run_time_frames"]


def test_detect_tracks_snr_scales_with_raw_contrast(stub_binet):
    """SNR must rise with real signal, not with the (identical) stub map."""
    dim = detect_tracks(
        _noisy_kymo(streaks=((6, 1.0),), F=48, X=64, amp=400.0), device="cpu"
    )
    bright = detect_tracks(
        _noisy_kymo(streaks=((6, 1.0),), F=48, X=64, amp=1600.0), device="cpu"
    )
    assert dim and bright
    assert max(t["snr"] for t in bright) > 2 * max(t["snr"] for t in dim)


def test_detect_tracks_snr_is_positive_for_a_dark_trajectory(stub_binet):
    """A dark streak on a bright background must not report a NEGATIVE SNR.

    Regression, found on real data. The DoG detector this replaced peaked on
    POSITIVE band-pass maxima only, so it could not see a dark trajectory at all
    and never had to sign its amplitudes. KymoButler detects polarity and
    inverts, so it does find them — and on one production kymograph (a 640 nm
    channel whose raw median sits at 247 of 255) every one of its 16
    trajectories came back at SNR -6.2..-2.5, which reads as "no evidence" when
    the evidence was in fact excellent.

    The fixture is deliberately inverted rather than merely dim: ``is_negated``
    must fire, so this also pins that the amplitude is read off the RAW matrix.
    Measuring on KymoButler's already-inverted normalised copy would flip the
    sign a second time and land back on a negative SNR.
    """
    from kymobutler import preprocess_array

    bright_bg = 4000.0 - _noisy_kymo(streaks=((6, 1.0),), F=48, X=64, amp=900.0)
    assert preprocess_array(bright_bg)[2] is True, "fixture must read as inverted"

    tracks = detect_tracks(bright_bg, device="cpu")
    assert tracks, "no trajectory found on an inverted kymograph"
    tr = max(tracks, key=lambda t: len(t["points"]))
    assert tr["snr"] > 2.0


def test_detect_tracks_flat_field_has_no_trajectories(monkeypatch):
    """No trackness anywhere -> no tracks, and no exception on the empty path."""
    kb = pytest.importorskip("kymobutler")

    class _Empty:
        def eval(self):
            return self

        def __call__(self, tensor):
            import torch

            _, _, h, w = tensor.shape
            fg = torch.zeros(h, w)
            return torch.stack([fg, 1.0 - fg], dim=0).unsqueeze(0)

    monkeypatch.setattr(
        kb, "load_models", lambda keys, model_dir=None, device="cpu": {
            "binet": _Empty(), "decnet": None
        }
    )
    assert detect_tracks(np.full((40, 60), 100.0, dtype=np.float32)) == []


def test_detect_tracks_rejects_a_degenerate_kymograph():
    """Guarded before any model load, so it needs no weights."""
    assert detect_tracks(np.zeros((3, 60), dtype=np.float32)) == []
    assert detect_tracks(np.zeros((40, 3), dtype=np.float32)) == []
    assert detect_tracks(np.zeros((40,), dtype=np.float32)) == []


def test_detect_tracks_rejects_an_unknown_mode():
    with pytest.raises(ValueError, match="mode"):
        detect_tracks(np.zeros((40, 60), dtype=np.float32), mode="sideways")


# ── the wire contract the Node backend depends on ─────────────────────────


def test_detect_tracks_output_satisfies_the_kymograph_track_model(stub_binet):
    """End-to-end shape check of exactly what /kymograph builds and returns.

    ``KymographTrack`` forbids extra fields, and ``kymographService.ts`` reads
    eleven of them off the wire. Running the route's real enrichment sequence
    over ``detect_tracks`` output is what proves the detector swap needs no
    Node change — a helper-only test would not.
    """
    from api.tracker_kymograph import KymographTrack

    kymo = _noisy_kymo(streaks=((6, 1.0),), F=48, X=64)
    raw = detect_tracks(kymo, device="cpu")
    assert raw
    for tr, vals in zip(
        raw, tracks_intensity(kymo, [tr["points"] for tr in raw], 3)
    ):
        tr["edge"] = edge_touch(tr["points"], kymo.shape[1])
        tr.update(vals)
    flag_bright_outliers(raw)

    models = [KymographTrack(**tr) for tr in raw]
    for m in models:
        # Every field kymographService.ts maps, plus the two the exporter needs.
        assert isinstance(m.points, list) and m.points
        assert isinstance(m.net_pxframe, float)
        assert isinstance(m.snr, float)
        assert isinstance(m.total_run_displacement_px, float)
        assert isinstance(m.total_run_time_frames, float)
        assert m.edge in ("left", "right", "both", "none")
        assert isinstance(m.bright, bool)


# ── real ONNX graphs, when they are staged ────────────────────────────────


def _weights_staged() -> bool:
    # ``kymobutler``, not ``models.kymobutler``: the package spelling goes
    # through models/__init__, which imports mamba_ssm and needs a CUDA driver.
    # api.kymograph_velocity put the models directory on sys.path at import.
    from kymobutler.config import DEFAULT_MODEL_DIR

    return (DEFAULT_MODEL_DIR / "bidirectional_seg.onnx").exists()


@pytest.mark.slow
@pytest.mark.skipif(
    not _weights_staged(),
    reason="KymoButler ONNX weights not staged "
    "(scripts/download-kymobutler-weights.sh)",
)
def test_real_binet_detects_a_processive_streak():
    """The genuine 22 MB graph, loaded through onnx2torch, on a real-ish input.

    Guards the two things a stub cannot: that ``onnx2torch`` still converts these
    graphs, and that a NON-256x256 input runs at all (the ONNX file declares a
    static [1,1,256,256] input, which is why onnxruntime is not usable here).
    """
    pytest.importorskip("onnx2torch")
    kymo = _noisy_kymo(streaks=((8, 0.9),), F=96, X=112, amp=1400.0)
    assert kymo.shape != (256, 256)
    tracks = detect_tracks(kymo, device="cpu")
    assert tracks, "the real network found no trajectory on a clear streak"
    tr = max(tracks, key=lambda t: len(t["points"]))
    assert tr["net_pxframe"] == pytest.approx(0.9, abs=0.3)
    assert set(tr.keys()) == WIRE_KEYS


@pytest.mark.slow
@pytest.mark.skipif(
    not _weights_staged(),
    reason="KymoButler ONNX weights not staged "
    "(scripts/download-kymobutler-weights.sh)",
)
def test_models_are_loaded_once_per_device():
    """The nets are ~150 MB and take seconds to convert; the cache is not optional."""
    pytest.importorskip("onnx2torch")
    from kymobutler.models.weights import load_models

    first = load_models(("binet",), device="cpu")
    second = load_models(("binet",), device="cpu")
    assert first["binet"] is second["binet"]
