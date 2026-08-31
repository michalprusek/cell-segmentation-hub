"""Per-frame focus verdict: score each channel, threshold it, combine by OR.

A frame is flagged when *any* declared channel falls below its threshold: any
bad channel spoils the frame, so recall of usable frames is deliberately traded
for precision.  A channel whose score could not be measured at all is flagged
too -- the fail-safe direction is to reject, never to accept.

The calibrated-domain check is advisory: it names channels whose noise or
background have drifted far enough that the absolute threshold may no longer
apply, without overriding the verdict.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np

from .calibration import Calibration
from .metrics import POLARITY, FrameStats, UnscoreableFrame, focus_score


@dataclass(frozen=True)
class ChannelSpec:
    """A channel of the acquisition and which modality's polarity it follows."""

    name: str
    modality: str

    def __post_init__(self):
        if self.modality not in POLARITY:
            raise ValueError(
                f"unknown modality {self.modality!r} for channel {self.name!r}; "
                f"expected one of {sorted(POLARITY)}"
            )


@dataclass(frozen=True)
class FrameVerdict:
    """Outcome for one frame across all channels.

    ``flagged`` is derived, not stored, so the OR rule cannot be contradicted by
    construction.
    """

    channel_flags: dict[str, bool]
    out_of_calibration: list[str]
    unscoreable: list[str]
    stats: dict[str, FrameStats]

    @property
    def flagged(self) -> bool:
        return any(self.channel_flags.values())

    @property
    def scores(self) -> dict[str, float]:
        return {name: s.score for name, s in self.stats.items()}


def score_frame(
    images: Mapping[str, np.ndarray], specs: Sequence[ChannelSpec]
) -> dict[str, FrameStats]:
    """Compute focus statistics for every declared channel of one frame.

    A channel that cannot be scored yields all-NaN statistics rather than raising,
    so one bad channel in a long movie does not abort the run.  NaN propagates to
    a flagged verdict downstream.
    """
    missing = [s.name for s in specs if s.name not in images]
    if missing:
        raise KeyError(f"frame is missing declared channel(s): {missing}")
    out = {}
    for spec in specs:
        try:
            out[spec.name] = focus_score(images[spec.name], spec.modality)
        except UnscoreableFrame:
            nan = float("nan")
            out[spec.name] = FrameStats(nan, nan, nan, nan)
    return out


def judge_frame(
    stats: Mapping[str, FrameStats], specs: Sequence[ChannelSpec], calibration: Calibration
) -> FrameVerdict:
    """Apply the per-channel thresholds and combine them with the OR rule."""
    flags, drifted, unscoreable = {}, [], []
    for spec in specs:
        if spec.modality not in calibration.thresholds:
            raise KeyError(
                f"channel {spec.name!r} needs modality {spec.modality!r}, but this "
                f"calibration only covers {sorted(calibration.thresholds)}; recalibrate "
                "for this channel or pass a matching calibration"
            )
        s = stats[spec.name]
        # Stated as `not (>=)` so a NaN score -- an unmeasurable frame -- flags rather
        # than slipping through, which `score < threshold` would let it do.
        flags[spec.name] = not (s.score >= calibration.thresholds[spec.modality])
        if not np.isfinite(s.score):
            unscoreable.append(spec.name)
        elif not calibration.in_domain(spec.modality, s.noise_sigma, s.background):
            drifted.append(spec.name)
    return FrameVerdict(
        channel_flags=flags,
        out_of_calibration=drifted,
        unscoreable=unscoreable,
        stats=dict(stats),
    )
