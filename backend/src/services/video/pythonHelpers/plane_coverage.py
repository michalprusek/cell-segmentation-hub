"""Recognise (frame, channel) planes the microscope never acquired, and plan the
forward fill that stands in for them.

WHY THIS EXISTS
---------------
A time-lapse does not have to capture every channel on every timepoint. A common
microtubule setup images the fluorescence continuously but refreshes the
label-free IRM reference only every N-th frame, because IRM costs illumination
and the field barely moves. NIS-Elements and Metamorph both still declare the
full ``(T, C)`` grid and write the un-acquired planes as a constant fill.

Both extractors iterate that dense grid and write one PNG per (frame, channel),
so those constant planes became **black PNGs that look exactly like data**. A
user scrubbing the editor sees the IRM channel flash on for one frame in three;
the segmenter, pointed at that channel, runs on a black image and returns either
nothing or noise. Nothing downstream could tell the difference, because "the
file exists" was the only test anyone applied.

Production evidence (2026-08-28, read-only scan of 40 real containers,
~1300 planes on disk):

* ``20260526_Well7_002_DIV4_WT_x2512-100x.tif`` — 29 frames, 3 channels.
  ``Channel_1`` (the high-contrast reference, std 472) and ``Channel_2`` are
  real on frame 0 and **exactly zero** on frames 1-28. ``Channel_3`` is real on
  all 29. Eight more of the same user's containers show the identical shape.
* ``WellD18_ChannelIRM,TIRF 488_Seq0000.nd2`` — 301 frames, 2 channels, where
  **every** channel is exactly zero from frame 240 on. That is an aborted
  acquisition, not a sparse channel, and it is why ``all channels blank`` is
  treated as "this frame was never taken" rather than as 61 gaps to fill.

THE CRITERION, AND WHY IT IS ``min == max``
-------------------------------------------
A plane is declared absent iff it is EXACTLY constant. Not "close to constant",
not "std below a threshold".

A real exposure cannot be exactly constant. Read noise alone puts several ADU of
variation on every frame a camera produces: across those ~1300 production planes
the LOWEST standard deviation of any plane carrying real signal was **2.10 ADU**
(a dim 16-bit fluorescence channel), and no real plane anywhere in the sample had
``min == max``. Every plane that did was filled with literal zeros. So the
separation is not a tuned margin — it is categorical, which is what makes the
false-positive risk of this rule essentially zero.

A standard-deviation threshold would NOT have that property. The dimmest genuine
channels in that scan sit at std 2.1-2.6, and a threshold low enough to stay
clear of them (say 0.5) buys nothing that ``min == max`` does not already catch.
Anything higher starts eating real, faint data — and this is a measurement tool,
so declaring a real frame absent and silently showing the neighbour's pixels in
its place is a much worse failure than leaving a black frame black.

The one thing the rule does catch that is not a sparse acquisition is a
genuinely uniform plane (a flat-field, a fully saturated frame). Neither occurs
in IRM/TIRF microscopy, and both are already unusable as data.
"""
from __future__ import annotations

import numpy as np


#: How many leading samples to test before committing to a full scan. Any
#: difference among them proves the plane is not constant, so the early exit is
#: EXACT, not a heuristic — and it is the branch taken by every dense video,
#: which is almost all of them. Without it this function costs two full linear
#: scans (``min`` and ``max``) per plane on the extraction hot path: ~2500 extra
#: scans of an 8 MB array on a 621-frame 2-channel 2048² ND2.
_EARLY_EXIT_SAMPLES = 4096


def is_blank_plane(plane) -> bool:
    """True when this plane carries no acquisition — see the module docstring.

    An empty array counts as blank: there is nothing there either way, and the
    ``min()`` below would raise on it.
    """
    arr = np.asarray(plane)
    if arr.size == 0:
        return True
    # ``.flat`` rather than ``ravel()``/``reshape``: those copy the WHOLE array
    # when it is not contiguous, which is the opposite of the saving.
    head = arr.flat[:_EARLY_EXIT_SAMPLES]
    if head.min() != head.max():
        return False
    return bool(arr.min() == arr.max())


def plan_sparse_channels(
    blank_by_frame: dict[int, list[bool]],
    channel_count: int,
) -> dict[int, dict]:
    """Work out which channels are sparse, and where each gap reads from.

    ``blank_by_frame`` maps frame index -> one bool per channel (the result of
    :func:`is_blank_plane` on that plane). Returns ``{channel_index: {...}}``
    containing ONLY the sparse channels; a channel absent from the result covers
    every frame and nothing about it changes.

    Each entry is::

        {"coveredFrames": [0, 3, 6, ...],   # frames where the channel is real
         "fillFrames": {1: 0, 2: 0, 4: 3}}  # gap frame -> frame it reads from

    Three rules decide the outcome, in this order:

    1. **A frame whose channels are ALL blank was never acquired.** It is not a
       gap in any one channel; it is a missing timepoint (an aborted run leaves a
       tail of them). Such frames take no part in the analysis: they neither
       count as coverage nor receive a fill, so they keep exactly today's
       behaviour instead of being back-filled with a duplicate of the last real
       frame — which would fabricate data.

    2. **A channel blank on every acquired frame is empty, not sparse.** There is
       no real plane to propagate FROM, and marking it 0%-covered would leave the
       channel unrenderable everywhere. Left alone (the caller logs it).

    3. **A gap reads from the nearest PREVIOUS real frame.** Gaps BEFORE the
       first real frame have no previous one; they read from the first real frame
       instead (a backward fill at the head). The alternative — leaving the head
       black — would mean a video whose IRM starts at frame 4 opens on a black
       channel, which is the bug being fixed. The head fill is the same picture
       the user sees one frame later, and it is recorded in ``fillFrames`` like
       any other gap, so nothing downstream has to guess whether a frame is real.
    """
    if channel_count <= 0:
        return {}

    acquired = sorted(
        t for t, blanks in blank_by_frame.items() if not all(blanks)
    )
    if len(acquired) < 2:
        # One usable timepoint (or none): a single frame cannot be sparse, and a
        # channel absent from it is just absent.
        return {}

    out: dict[int, dict] = {}
    for c in range(channel_count):
        covered = [t for t in acquired if not blank_by_frame[t][c]]
        if not covered or len(covered) == len(acquired):
            continue  # empty (rule 2) or fully covered — nothing to do

        covered_set = set(covered)
        fill: dict[int, int] = {}
        anchor = covered[0]  # head gaps read forward from the first real frame
        for t in acquired:
            if t in covered_set:
                anchor = t
                continue
            fill[t] = anchor
        out[c] = {"coveredFrames": covered, "fillFrames": fill}
    return out


def coverage_payload(plan_entry: dict | None) -> dict:
    """The JSON fragment to merge into one channel's result entry.

    Empty for a fully-covered channel, so the extractor result keeps its exact
    historical shape for every video that is not sparse.

    Only ``fillFrames`` crosses the boundary. The covered set is deliberately
    NOT emitted alongside it: it is exactly "every frame that is not a key of
    this map", and a second encoding of the same fact is a second thing that can
    disagree with the first. Keys are strings because that is what JSON does to
    Python's integer keys anyway; making it explicit keeps both sides reading
    the same shape.
    """
    if not plan_entry:
        return {}
    return {
        "fillFrames": {
            str(k): v for k, v in sorted(plan_entry["fillFrames"].items())
        },
    }
