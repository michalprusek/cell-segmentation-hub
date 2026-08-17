"""The FRAP selection policy. Synthetic filaments, hand-checked outcomes."""
import numpy as np
import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "models"))
import frap_select as S  # noqa: E402

UM_PER_PX = 0.1          # 10 px per micrometre — keeps the arithmetic readable
SHAPE = (600, 600)


def horizontal(y, x0, x1):
    return np.array([[float(x0), float(y)], [float(x1), float(y)]])


def test_a_lone_long_filament_yields_one_spot_at_its_midpoint():
    mts = [horizontal(300, 100, 400)]          # 300 px = 30 um
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert len(r.spots) == 1
    assert r.spots[0].x == pytest.approx(250.0, abs=5.0)
    assert r.spots[0].y == pytest.approx(300.0, abs=0.5)
    assert r.shortfall is False        # 1 spot achievable, k_min=1: not a shortfall


def test_l_min_is_large_enough_to_hold_the_observation_window():
    # l_min_um's stated rationale is that the filament must HOLD the observation
    # window. That is an arithmetic relationship between three defaults, not a
    # standalone number: candidates come from the middle f_mid of the filament, so
    # the most extreme one sits (1 - f_mid)/2 of the length from the nearer end and
    # needs obs_len/2 of room there. Hence l_min >= obs_len / (1 - f_mid), which at
    # the defaults is 3.0 / 0.5 = 6.0 um. Below that, _slice_window CLIPS and
    # criterion 5b is evaluated over a SHORTER window than intended -- the unsafe
    # direction, and silent.
    # SCOPE OF THIS TEST: the DEFAULTS. The same relationship is enforced for
    # params_json OVERRIDES by api/frap_targets._check_window_fits, which re-derives
    # it from the effective values; that half is covered by
    # test_params_json_f_mid_alone_cannot_clip_the_observation_window.
    p = S.SelectionParams()
    assert p.l_min_um >= p.obs_len_um / (1.0 - p.f_mid)


def test_a_filament_shorter_than_l_min_is_rejected():
    mts = [horizontal(300, 100, 130)]          # 30 px = 3 um, below l_min 6 um
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert r.spots == []
    assert r.rejected_by["length"] >= 1
    assert r.shortfall is True         # 0 spots achievable, k_min=1: a shortfall


def test_close_parallels_are_both_rejected():
    # 15 px = 1.5 um apart, well inside r_iso = 3 um.
    mts = [horizontal(300, 100, 400), horizontal(315, 100, 400)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert r.spots == []


def test_a_neighbour_clearing_the_centre_but_not_the_footprint_is_rejected():
    # THE 5a REGRESSION TEST AT POLICY LEVEL. With an oriented rectangle ROI of
    # spot_len 1 um (5 px half-length) plus bleach_spread 0.5 um (5 px), a neighbour
    # 8 px away ALONG the filament axis clears the centre by 0.8 um but sits inside
    # the dilated footprint. A centre-distance implementation lets this through.
    params = S.SelectionParams(spot_shape="rect", r_iso_um=0.0, obs_len_um=0.2, f_mid=0.0)
    mts = [horizontal(300, 100, 400)]
    blocker = np.array([[258.0, 300.0], [258.0, 340.0]])   # crosses 8 px past the midpoint
    r = S.select_spots(mts + [blocker], SHAPE, UM_PER_PX, params=params, k_min=1, k_max=10)
    assert r.spots == []
    assert r.rejected_by["bleach_clearance"] >= 1


def test_a_candidate_near_the_border_is_rejected():
    mts = [horizontal(5, 100, 400)]            # 5 px from the top edge
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert r.spots == []
    assert r.rejected_by["border"] >= 1


def test_spots_respect_the_minimum_separation():
    # Three parallel filaments 60 px = 6 um apart: isolated enough to pass, but
    # closer than d_sep = 10 um, so only alternate ones can be picked.
    mts = [horizontal(200, 100, 400), horizontal(260, 100, 400), horizontal(320, 100, 400)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    xs = np.array([[s.x, s.y] for s in r.spots])
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            assert np.linalg.norm(xs[i] - xs[j]) * UM_PER_PX >= 10.0 - 1e-6


def test_the_roomier_candidate_ranks_first():
    tight = horizontal(150, 100, 400)
    tight_neighbour = horizontal(190, 100, 400)   # 4 um away: passes r_iso 3 um, barely
    roomy = horizontal(450, 100, 400)             # nothing near it
    r = S.select_spots([tight, tight_neighbour, roomy], SHAPE, UM_PER_PX, k_min=1, k_max=1)
    assert len(r.spots) == 1
    assert r.spots[0].y == pytest.approx(450.0, abs=1.0)


def test_a_crossing_at_the_exact_midpoint_moves_the_spot_but_keeps_the_filament():
    mts = [horizontal(300, 100, 400)]
    crossing = np.array([[250.0, 240.0], [250.0, 360.0]])
    r = S.select_spots(mts + [crossing], SHAPE, UM_PER_PX, k_min=1, k_max=10)
    chosen = [s for s in r.spots if abs(s.y - 300.0) < 1.0]
    assert len(chosen) == 1
    assert abs(chosen[0].x - 250.0) > 25.0     # pushed clear of the crossing


def test_empty_input_returns_empty_output():
    r = S.select_spots([], SHAPE, UM_PER_PX)
    assert r.spots == []
    assert r.n_polylines == 0


def test_an_even_point_count_still_yields_a_candidate_at_f_mid_zero():
    # Regression for the candidate-band bounds. A 299 px span resamples to n=300, so
    # mid=149.5 is fractional. The original ceil/floor pair gave lo=150 > hi=149 and
    # therefore NO candidates at all — a filament silently skipped rather than rejected.
    mts = [horizontal(300, 100, 399)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, params=S.SelectionParams(f_mid=0.0),
                       k_min=1, k_max=10)
    assert r.n_candidates >= 1
    assert len(r.spots) == 1


def test_a_quantised_window_still_catches_a_too_close_neighbour():
    # Regression for query_r_px's window term. step_px=3.0 with a tiny obs_len_um
    # forces the max(1, ...) floor in _window_half_k: obs_half_px=1.0 px but the
    # window actually reaches k*step_px=3.0 px (obs_reach_px), not obs_half_px.
    # r_iso_um=1.5 makes the window term (obs_reach_px + r_iso_px = 18.0) dominate
    # the footprint term (hypot(5,5) + 5 = 12.07). The single candidate sits at
    # (250, 300) with its window at x in [247, 253]; the neighbour sits 17.5 px
    # from the candidate centre but only 14.5 px from the window's near edge —
    # inside r_iso_px=15.0, a genuine readout-clearance violation. The OLD bound
    # (obs_half_px + r_iso_px + 1.0 = 17.0) excludes it from the KD-tree query and
    # the candidate reads as isolated; the NEW bound (obs_reach_px + r_iso_px +
    # step_px = 21.0) includes it and the candidate is correctly rejected.
    params = S.SelectionParams(step_px=3.0, obs_len_um=0.2, r_iso_um=1.5, f_mid=0.0)
    mts = [horizontal(300, 100, 400)]
    neighbour = np.array([[267.5, 300.0]])
    r = S.select_spots(mts + [neighbour], SHAPE, UM_PER_PX, params=params, k_min=1, k_max=10)
    assert r.spots == []
    assert r.rejected_by["readout_clearance"] >= 1


def test_the_brightness_test_rejects_an_undecorated_filament():
    # Two filaments, identical geometry; only the lower one has 488 signal.
    bright = horizontal(200, 100, 400)
    dark = horizontal(400, 100, 400)
    fluor = np.full(SHAPE, 100.0, dtype=np.float32)
    fluor[195:206, 100:401] = 900.0            # decorate `bright` only
    r = S.select_spots([bright, dark], SHAPE, UM_PER_PX, fluor=fluor, k_min=1, k_max=10)
    ys = [round(s.y) for s in r.spots]
    assert 200 in ys
    assert 400 not in ys
    assert r.rejected_by["snr"] >= 1
