"""Stable acquisition-time ordering of extracted video frames.

The ND2 / TIFF extractors already parse per-frame acquisition timestamps (ND2
``events()['Time [s]']``, TIFF OME ``DeltaT`` / ImageJ slice labels) but only
used them to derive a median frame interval. ``frame_time_order`` turns those
timestamps into a stable permutation so the on-disk ``frames/<rank>/`` order —
and therefore the DB ``frameIndex`` every downstream consumer sorts by — is the
true acquisition-time rank.

Pure, stdlib-only (``math``), so it is trivially unit-testable and shared by
both extractors.
"""
from __future__ import annotations

import math
from typing import Sequence


def frame_time_order(
    timestamps_s: Sequence[float] | None, n_frames: int
) -> list[int]:
    """Return a stable permutation ``order`` of length ``n_frames`` such that
    writing source frame ``order[rank]`` into output slot ``rank`` yields
    ascending-acquisition-time order.

    Returns the identity ``[0, 1, ..., n_frames-1]`` (i.e. NO reorder) whenever
    the timestamps cannot be trusted to define a total order over the frames:

      * absent / empty,
      * a different length than ``n_frames`` (partial metadata), or
      * containing any non-finite (NaN/inf) or non-numeric value.

    This makes it a pure correctness guarantee — it can only *fix* a genuinely
    out-of-order container, never corrupt a good one from bad metadata. The sort
    is stable, so equal timestamps and already-monotonic inputs keep their
    original relative order (the common case is a byte-for-byte no-op).
    """
    identity = list(range(n_frames))
    if not timestamps_s or len(timestamps_s) != n_frames:
        return identity
    try:
        ts = [float(t) for t in timestamps_s]
    except (TypeError, ValueError):
        return identity
    if any(not math.isfinite(t) for t in ts):
        return identity
    # Stable argsort: order ranks by (timestamp, original index). The secondary
    # key makes ties deterministic and preserves input order for equal times.
    return sorted(identity, key=lambda i: (ts[i], i))
