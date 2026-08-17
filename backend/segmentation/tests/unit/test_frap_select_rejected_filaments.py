"""RejectedFilament: why a filament produced no bleach spot, and roughly where.

Separate from test_frap_select.py (which is off limits per the Task 5 dispatch)
because this addition is scoped narrowly: one entry per filament that ends up
contributing no spot, carrying the modal per-filament rejection reason. These
tests exist so a shortfall is diagnosable from the overlay, not just from a count.
"""
import numpy as np
import pytest

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "models"))
import frap_select as S  # noqa: E402

UM_PER_PX = 0.1          # 10 px per micrometre — keeps the arithmetic readable
SHAPE = (600, 600)


def horizontal(y, x0, x1):
    return np.array([[float(x0), float(y)], [float(x1), float(y)]])


def test_a_filament_rejected_at_the_length_gate_yields_one_rejected_filament_reason_length():
    mts = [horizontal(300, 100, 130)]          # 30 px = 3 um, below l_min 5 um
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert r.spots == []
    assert len(r.rejected_filaments) == 1
    rf = r.rejected_filaments[0]
    assert rf.reason == "length"
    assert rf.mt_index == 0
    assert rf.x == pytest.approx(115.0, abs=1.0)   # arc-length midpoint of [100, 130]
    assert rf.y == pytest.approx(300.0, abs=0.5)


def test_close_parallels_yield_rejected_filaments_with_reason_readout_clearance():
    # 15 px = 1.5 um apart, well inside r_iso = 3 um: both filaments' candidates
    # clear the bleach footprint but fail the wider readout-isolation radius.
    mts = [horizontal(300, 100, 400), horizontal(315, 100, 400)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert r.spots == []
    assert len(r.rejected_filaments) == 2
    reasons = {rf.mt_index: rf.reason for rf in r.rejected_filaments}
    assert reasons == {0: "readout_clearance", 1: "readout_clearance"}


def test_a_frame_with_two_distinct_rejection_reasons_attributes_each_filament_its_own_reason():
    # Distinguishes per-filament tallying from a frame-wide one, which the simpler
    # close-parallels test above cannot: there, EVERY rejected candidate in the
    # whole frame fails for the same reason (readout_clearance), so a frame-wide
    # accumulator and a per-filament one happen to agree by coincidence -- see the
    # mutation-test note in the module-level report for confirmation that the
    # close-parallels test alone does not catch a frame-wide-vs-per-filament bug.
    # Here, a third filament near the top border -- isolated from the other two
    # (295 px away, far past query_r_px, so it shares no candidates with them) --
    # fails exclusively on "border", while the frame's DOMINANT reason overall is
    # still readout_clearance (two filaments' worth of candidates vs. one). A
    # frame-wide-accumulator bug would mislabel this filament "readout_clearance"
    # instead of its own true "border".
    mts = [horizontal(300, 100, 400), horizontal(315, 100, 400), horizontal(5, 100, 400)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert r.spots == []
    reasons = {rf.mt_index: rf.reason for rf in r.rejected_filaments}
    assert reasons == {0: "readout_clearance", 1: "readout_clearance", 2: "border"}


def test_a_filament_that_contributes_a_chosen_spot_has_no_rejected_filament_entry():
    mts = [horizontal(300, 100, 400)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert len(r.spots) == 1
    assert r.rejected_filaments == []


def test_three_filaments_closer_than_d_sep_yield_a_separation_drop():
    # Same fixture as test_frap_select.py's test_spots_respect_the_minimum_separation:
    # 60 px = 6 um apart, well beyond r_iso (3 um) and bleach clearance, so every
    # filament's own candidate individually passes every criterion — none is ever
    # rejected_by anything. But 60 px < d_sep_px (100 px @ d_sep_um=10), and the
    # only pairwise-independent subset of three points spaced 60/60/120 px apart is
    # size 2, so exactly one of the three MUST lose at the greedy pick to
    # separation, regardless of which two win the tie.
    mts = [horizontal(200, 100, 400), horizontal(260, 100, 400), horizontal(320, 100, 400)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert len(r.spots) == 2
    assert r.dropped_by["separation"] == 1
    assert r.dropped_by["budget"] == 0
    sep_entries = [rf for rf in r.rejected_filaments if rf.reason == "separation"]
    assert len(sep_entries) == 1
    # And it must not also appear in rejected_by (it failed no criterion): the
    # frame-wide histogram should show zero criterion rejections for this scenario.
    assert all(v == 0 for v in r.rejected_by.values())


def test_more_passing_filaments_than_k_max_yield_a_budget_drop():
    # Two filaments 400 px apart -- far beyond d_sep_px (100 px @ d_sep_um=10) and
    # each fully isolated from the other for every criterion -- but k_max=1 means
    # only one slot exists. The loser cleared separation but ran out of budget.
    mts = [horizontal(100, 100, 400), horizontal(500, 100, 400)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=1)
    assert len(r.spots) == 1
    assert r.dropped_by["budget"] == 1
    assert r.dropped_by["separation"] == 0
    budget_entries = [rf for rf in r.rejected_filaments if rf.reason == "budget"]
    assert len(budget_entries) == 1
    assert all(v == 0 for v in r.rejected_by.values())
