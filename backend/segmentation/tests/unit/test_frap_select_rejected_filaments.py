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


def test_a_filament_that_contributes_a_chosen_spot_has_no_rejected_filament_entry():
    mts = [horizontal(300, 100, 400)]
    r = S.select_spots(mts, SHAPE, UM_PER_PX, k_min=1, k_max=10)
    assert len(r.spots) == 1
    assert r.rejected_filaments == []
