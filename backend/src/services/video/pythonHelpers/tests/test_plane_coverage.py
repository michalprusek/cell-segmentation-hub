"""The sparse-channel detector, pinned against the SHAPES REAL DATA HAS.

Every scenario below was taken from a read-only scan of production uploads on
2026-08-28 (40 video containers, ~1300 PNG planes on disk), not invented:

* ``20260526_Well7_002_DIV4_WT_x2512-100x.tif`` — 29 frames, 3 channels, two of
  them real on frame 0 and exactly zero on frames 1-28. Eight more containers
  from the same user have the identical shape. This is the bug being fixed.
* ``WellD18_ChannelIRM,TIRF 488_Seq0000.nd2`` — 301 frames where EVERY channel
  is exactly zero from frame 240 on: an aborted acquisition, not a sparse
  channel, and forward-filling its 61 missing timepoints would fabricate a
  minute of data that was never recorded.
* Every other container — no plane anywhere with ``min == max``, and the
  faintest real plane at std 2.10 ADU. That is what makes ``min == max`` a
  categorical test rather than a tuned threshold, and it is why
  ``test_faint_real_plane_is_not_blank`` uses 2.1 rather than something
  comfortable.

The synthetic every-N-th case is the one shape NOT in that scan. It is what the
user reported (a microscope that refreshes IRM every N-th frame), it is the
general case the frame-0-only containers are a degenerate instance of, and it is
what ``test_every_third_frame`` covers.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from plane_coverage import (  # noqa: E402
    coverage_payload,
    is_blank_plane,
    plan_sparse_channels,
)


# --------------------------------------------------------------------------
# is_blank_plane
# --------------------------------------------------------------------------


def test_all_zero_plane_is_blank():
    """The literal shape production writes: every un-acquired plane scanned was
    filled with zeros, not with a camera offset."""
    assert is_blank_plane(np.zeros((8, 8), dtype=np.uint16))


def test_constant_non_zero_plane_is_blank():
    """Not every writer fills with zero; some use the camera's black level. The
    criterion is constancy, not the value."""
    assert is_blank_plane(np.full((8, 8), 100, dtype=np.uint16))


def test_faint_real_plane_is_not_blank():
    """std 2.1 ADU is the FAINTEST real plane in the production scan. A
    standard-deviation threshold high enough to be worth having would eat it;
    ``min == max`` does not come close."""
    rng = np.random.default_rng(0)
    plane = np.round(rng.normal(300.0, 2.1, size=(64, 64))).astype(np.uint16)
    assert plane.std() < 3.0  # the test is only meaningful if it IS faint
    assert not is_blank_plane(plane)


def test_single_differing_pixel_is_not_blank():
    """One hot pixel is enough. Deliberate: this errs towards leaving a frame
    alone, and showing a black frame is a smaller error than showing the
    neighbour's pixels in a measurement tool."""
    plane = np.zeros((8, 8), dtype=np.uint16)
    plane[3, 4] = 1
    assert not is_blank_plane(plane)


def test_empty_plane_is_blank():
    assert is_blank_plane(np.zeros((0, 0), dtype=np.uint16))


# --------------------------------------------------------------------------
# plan_sparse_channels
# --------------------------------------------------------------------------


def _blanks(rows: list[list[bool]]) -> dict[int, list[bool]]:
    return {t: row for t, row in enumerate(rows)}


def test_dense_video_plans_nothing():
    """The overwhelmingly common case must stay untouched — a false positive
    here would change every existing upload."""
    blanks = _blanks([[False, False]] * 10)
    assert plan_sparse_channels(blanks, 2) == {}


def test_real_well7_shape_channel_real_only_on_frame_zero():
    """20260526_Well7_002: channels 0 and 1 real on frame 0 only, channel 2
    real throughout."""
    rows = [[False, False, False]] + [[True, True, False]] * 28
    plan = plan_sparse_channels(_blanks(rows), 3)

    assert sorted(plan) == [0, 1], "channel 2 is dense and must not appear"
    assert plan[0]["coveredFrames"] == [0]
    assert plan[0]["fillFrames"] == {t: 0 for t in range(1, 29)}
    assert plan[1]["fillFrames"] == plan[0]["fillFrames"]


def test_every_third_frame():
    """The reported case: the reference channel refreshes every 3rd frame."""
    rows = [[t % 3 != 0, False] for t in range(9)]
    plan = plan_sparse_channels(_blanks(rows), 2)

    assert list(plan) == [0]
    assert plan[0]["coveredFrames"] == [0, 3, 6]
    assert plan[0]["fillFrames"] == {1: 0, 2: 0, 4: 3, 5: 3, 7: 6, 8: 6}


def test_gap_reads_from_the_PREVIOUS_real_frame_not_the_nearest():
    """4 is one frame from 5 and two from 3, and it still reads from 3. Reading
    forward would show the user pixels recorded AFTER the timepoint they are
    looking at."""
    rows = [[t not in (0, 3, 5), False] for t in range(7)]
    plan = plan_sparse_channels(_blanks(rows), 2)
    assert plan[0]["fillFrames"][4] == 3


def test_leading_gap_reads_forward_from_the_first_real_frame():
    """Frames before the first acquisition have no previous one. They take the
    first real frame instead: leaving them black is the bug, and the picture
    they get is the one the user sees a frame later anyway."""
    rows = [[t not in (2, 4), False] for t in range(6)]
    plan = plan_sparse_channels(_blanks(rows), 2)
    assert plan[0]["fillFrames"][0] == 2
    assert plan[0]["fillFrames"][1] == 2
    assert plan[0]["fillFrames"][3] == 2
    assert plan[0]["fillFrames"][5] == 4


def test_aborted_acquisition_is_not_a_sparse_channel():
    """WellD18: from frame 5 on, EVERY channel is blank. That is a run that
    stopped, not a channel with holes — filling it would invent timepoints."""
    rows = [[False, False]] * 5 + [[True, True]] * 8
    assert plan_sparse_channels(_blanks(rows), 2) == {}


def test_sparse_channel_alongside_an_aborted_tail():
    """Both at once. The gaps among the ACQUIRED frames are filled; the frames
    after the run stopped are left alone, so nothing back-fills them."""
    rows = [
        [False, False],  # 0 both real
        [True, False],  # 1 gap in ch0
        [False, False],  # 2 both real
        [True, True],  # 3 acquisition stopped here
        [True, True],  # 4
    ]
    plan = plan_sparse_channels(_blanks(rows), 2)
    assert list(plan) == [0]
    assert plan[0]["coveredFrames"] == [0, 2]
    assert plan[0]["fillFrames"] == {1: 0}, "frames 3 and 4 were never acquired"


def test_channel_blank_everywhere_is_not_sparse():
    """Nothing to propagate FROM. Marking it 0%-covered would leave the channel
    unrenderable on every frame instead of on none."""
    rows = [[True, False]] * 6
    assert plan_sparse_channels(_blanks(rows), 2) == {}


def test_single_acquired_frame_plans_nothing():
    rows = [[False, False]] + [[True, True]] * 4
    assert plan_sparse_channels(_blanks(rows), 2) == {}


def test_single_channel_video_can_never_be_sparse():
    """With one channel, a blank plane means the whole frame is missing — there
    is no other channel to contradict it. This is what keeps `/display` (the
    single-channel path) out of the feature entirely."""
    rows = [[t % 2 == 1] for t in range(8)]
    assert plan_sparse_channels(_blanks(rows), 1) == {}


def test_zero_channels():
    assert plan_sparse_channels({}, 0) == {}


# --------------------------------------------------------------------------
# coverage_payload
# --------------------------------------------------------------------------


def test_payload_empty_for_a_dense_channel():
    """A dense video's result JSON must keep its exact historical shape."""
    assert coverage_payload(None) == {}


def test_payload_keys_are_strings_and_sorted():
    plan = plan_sparse_channels(_blanks([[t % 3 != 0, False] for t in range(9)]), 2)
    payload = coverage_payload(plan[0])
    assert payload == {"fillFrames": {"1": 0, "2": 0, "4": 3, "5": 3, "7": 6, "8": 6}}
    assert list(payload["fillFrames"]) == ["1", "2", "4", "5", "7", "8"]


def test_payload_carries_no_second_encoding_of_the_covered_set():
    """The covered frames are exactly "not a key of fillFrames". Emitting them
    as well would be a second thing that can disagree with the first."""
    plan = plan_sparse_channels(_blanks([[t % 3 != 0, False] for t in range(9)]), 2)
    assert set(coverage_payload(plan[0])) == {"fillFrames"}


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
