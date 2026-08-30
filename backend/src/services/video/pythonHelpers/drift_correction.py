"""Stage-drift correction for a time-lapse, the way Fiji's Correct 3D Drift does it.

WHAT DRIFTS AND WHY THE OBVIOUS METHOD FAILS
--------------------------------------------
A microscope stage creeps over a long acquisition: thermal expansion, focus
drift, a stick-slip nudge. The field slides a little every frame, so a movie
that should hold still wanders, and a measurement taken at frame 200 is not
taken where the one at frame 0 was.

The obvious correction — register each frame to the one before it and add the
steps up — does not work here, and the reason is worth stating precisely
because it is the opposite of the usual complaint about pairwise registration.
The usual complaint is error ACCUMULATION: independent per-pair errors random-
walk, so the total wanders as sqrt(N). That is real, but it is not what breaks
this. What breaks it is NON-DETECTION.

Measured on production frames, 2026-08-29:

* ``20260820_1_ch1_biotin AB-_MB BRB80_GMPCPP``, 241 frames: the drift is
  **0.084 px/frame** in x, straight enough that a line fits it with a maximum
  residual of 0.47 px, and it reaches **+16.4 px** by frame 200.
* Estimated between CONSECUTIVE frames, that same stack reports ``(0, 0)``
  for every single pair. 8 of the 9 longest production videos do.

A step of 0.084 px cannot be seen by an integer estimator: it rounds to zero.
So the accumulated trajectory is not noisy, it is FLAT — the pairwise pass
measures nothing at all, 240 times in a row, while that stack really moves
20 px.
Anchoring, or a global least-squares over all *consecutive* pairs, cannot
rescue that: every measurement being summed is genuinely, correctly zero.

Only a LONG BASELINE sees the motion. Over 81 frames the same drift is 6.8 px,
which any estimator resolves comfortably.

THE ALGORITHM (Fiji's ``multi_time_scale``)
-------------------------------------------
``Correct_3D_drift.py`` runs a consecutive pass and then further passes at lags
of ascending powers of three, ``[3, 9, 27, 81, 243, 729, dt_max]``. Each pass
measures, for each ``t``, the shift between the raw frames ``t-dt`` and ``t``,
subtracts what the trajectory already claims for that interval, and spreads the
**residual** as a linear ramp: zero at ``t-dt``, the full residual at ``t``, and
continuing to grow past ``t`` to the end of the stack. Later, finer passes then
correct that extrapolation.

The final pass at ``dt_max`` compares frame 0 with the last frame directly.
That is the re-anchoring step, and it is what stops the trajectory drifting away
from its own origin.

WHAT WE DELIBERATELY DO NOT COPY
--------------------------------
* **Sub-pixel interpolation.** Fiji offers it, off by default; with it off the
  shifts are rounded and applied as a plain pixel blit. We always do that, and
  it is not a shortcut — it is a requirement. These PNGs are the measurement
  surface: ``mt_measure`` reads raw 16-bit ADU off them for intensity, and an
  interpolated pixel is a fabricated sample. Rounding leaves at most 0.5 px of
  residual placement error against the 16-20 px it removes, a 40x improvement
  for exactly zero corruption of the values.

  Note the estimates themselves are still fractional, because the ``i/dt`` ramp
  divides a measured residual across a span. Only the APPLICATION rounds.

* **A growing canvas.** Fiji enlarges the canvas so nothing is cropped. Our
  frames are one PNG per (frame, channel) with a shape recorded in the DB and
  assumed constant by the editor, the exporter and the segmenter; changing it
  per container is a far larger change than this correction is worth. We keep
  the frame size and zero-fill the vacated border, exactly as
  ``channel_registration.shift_frame`` already does for channel offsets. The
  cost is small and bounded: 19 px of drift on a 1300 px frame blanks 1.5% of
  the width.

* **Fiji's 10 px default cap**, which would be far too small here. It is not
  too small THERE, and the difference is the reason our budget has to be 96:
  Fiji shifts the ROI by the accumulated trajectory before extracting each
  frame (``roi1 = shift_roi(imp, roi, shifts[t-dt])``), so every correlation
  only ever searches a small RESIDUAL. We correlate the raw pair, so the
  search has to cover the whole accumulated displacement. See
  ``DRIFT_MAX_SHIFT_PX``. (Separately, that field's third argument is the
  decimal-places count and is passed ``imp.getWidth()`` — a cosmetic bug in
  the dialog, not the source of the 10.)

Runs inside the backend container. numpy throughout; PIL only where frames
are read back off disk (:class:`_DiskFrames`, :func:`correct_drift_in_place`).
"""

from __future__ import annotations

import sys
from typing import NamedTuple

import numpy as np

from channel_registration import (
    _MAX_SHIFT_PX,
    _MIN_PEAK_RATIO,
    REASON_OK,
    estimate_translation_detailed,
    shift_frame,
)

#: How far a drift estimate may reach, in pixels.
#:
#: Much larger than the channel-registration budget (16 px) because the two
#: measure different things. A channel offset is a fixed optical constant; drift
#: ACCUMULATES, so the longer the baseline the further the frames have moved. At
#: the 0.084 px/frame measured on production a 243-frame baseline spans 20 px
#: and a 729-frame one 61 px — both beyond 16 px, where they would be clipped to
#: the window edge and then rejected as low quality.
DRIFT_MAX_SHIFT_PX = 96

#: Fiji's schedule: a consecutive pass, then ascending powers of three, and
#: finally the whole baseline — `dts = [3,9,27,81,243,729,dt_max]`, iterated
#: with `if dt < dt_max: ... else: run dt_max; break`.
_LAG_BASE = 3

#: A composed correction larger than this fraction of the smaller frame
#: dimension is refused outright.
#:
#: ``DRIFT_MAX_SHIFT_PX`` bounds each PAIR; nothing bounds their sum, and the
#: ramp extrapolates to the end of the stack. On a 40-frame 256² stack of pure
#: noise the gate still accepts 9 of 60 pairs and the composed trajectory
#: reaches **396 px — 1.55x the frame width**; applying that rewrites every PNG
#: to a uniform fill, in place, and the extracted pixels are gone. Real data is
#: nowhere near it (12 production containers: 98-100 % of pairs accepted, max
#: correction 19 px = 1.9 % of the frame), so this never fires on a genuine
#: stack — it exists because the operation is automatic, destructive and
#: irreversible, and "every frame is now blank" must not be reported as
#: success.
_MAX_TOTAL_DRIFT_FRACTION = 0.25

#: Fiji stops the powers at 3^6 and jumps straight to the full baseline; its
#: own comment calls the choice arbitrary ("one could also do this with 2^i or
#: 4^i"). Matched here so the schedules are identical rather than merely
#: similar. It never binds on our data anyway: it would first change the
#: schedule at 2189 frames, and the longest stack in production is 621.
_LAG_MAX_POWER = 729

#: Decimation used for the CONSECUTIVE (dt=1) pass when ``fast`` is on.
#:
#: That pass exists to catch ABRUPT displacements — a knock, a stage jump —
#: which are by definition large and therefore survive decimation. It cannot
#: see slow drift at any resolution (that is the whole premise of this module),
#: so running it at full resolution buys nothing while dominating the cost: on
#: a 120-frame 1392² stack it is 119 full-frame correlations, 52 s, against
#: ~27 s for every long-lag pass of the Fiji schedule combined.
_FAST_SHORT_LAG_DECIMATION = 4


def multi_scale_lags(n_frames: int) -> list[int]:
    """The lag schedule for a stack of ``n_frames``.

    Powers of three that fit inside the stack, then the full baseline
    ``n_frames - 1`` — the pass that compares frame 0 with the last frame and
    re-anchors the trajectory to its origin.

    Returns ``[]`` for a stack too short to have a pair, and never repeats a
    lag (on a short stack the full baseline can coincide with a power of three).
    """
    if n_frames < 2:
        return []
    dt_max = n_frames - 1
    lags = []
    dt = _LAG_BASE
    while dt < dt_max and dt <= _LAG_MAX_POWER:
        lags.append(dt)
        dt *= _LAG_BASE
    lags.append(dt_max)
    return lags


class DriftTrajectory(NamedTuple):
    """A trajectory plus how much of it was actually MEASURED.

    Without the counts, a stack every pair of which was refused is
    indistinguishable from one that genuinely holds still: both produce an
    all-zero trajectory. That is the same ambiguity this module's sibling was
    written to end (a stored ``(0, 0)`` meaning either "aligned" or "refused"),
    and it reappears one level up unless the refusals are carried out.

    ``anchored`` is the one that matters most: it says whether the final
    full-baseline pass — frame 0 against the last frame — was accepted. When it
    is False the tail of the stack is pure ramp extrapolation with nothing
    measuring it, which still looks entirely plausible.
    """

    corrections: list[tuple[float, float]]
    measured: int
    accepted: int
    anchored: bool


def estimate_drift_trajectory(
    frames,
    multi_scale: bool = True,
    max_shift_px: int = DRIFT_MAX_SHIFT_PX,
    fast: bool = True,
) -> list[tuple[float, float]]:
    """The corrections alone — see :func:`estimate_drift_trajectory_detailed`.

    A thin projection, so callers that only place pixels stay simple while the
    ones that must report on the estimate get the counts.
    """
    return estimate_drift_trajectory_detailed(
        frames, multi_scale, max_shift_px, fast
    ).corrections


def estimate_drift_trajectory_detailed(
    frames,
    multi_scale: bool = True,
    max_shift_px: int = DRIFT_MAX_SHIFT_PX,
    fast: bool = True,
) -> DriftTrajectory:
    """Per-frame correction ``(dy, dx)`` that puts every frame back onto frame 0.

    ``frames`` is a sequence of 2-D arrays, all the same shape — one channel of
    one acquisition, in time order. Apply the result with :func:`apply_drift`.

    Frame 0 is the origin and always returns ``(0.0, 0.0)``.

    The returned values are the CORRECTION (the negation of the measured
    displacement), so a stack whose content slides right gets a left-shifting
    correction. They are floats: the ramp divides a measured residual across a
    span. :func:`apply_drift` rounds at the point of application.

    Set ``multi_scale=False`` for the consecutive-only pass. That is not a
    lighter approximation of the full method — on sub-pixel-per-frame drift it
    measures nothing at all (see the module docstring); it exists so the tests
    can pin that fact, and for a stack whose motion is known to be per-frame
    large.

    An estimate that the quality gate refuses contributes nothing rather than
    contributing a guess, so a blank or unmatchable frame cannot drag the
    trajectory: the ramp simply does not fire for it.

    ``fast`` (the default) is the schedule to use, and — despite the name —
    it is the one that FOLLOWS Fiji. Its long-lag branch is
    ``compute_and_update_frame_translations_dt`` line for line::

        for t in range(dt, nt+dt, dt):    # step by dt
          if t > nt-1: t = nt-1           # ...clamping the last frame

    ``fast=False`` measures every ``t`` at every lag instead. That is DENSER
    than Fiji, not more faithful to it — Fiji never runs it — and it exists
    only as a reference schedule the tests compare against. On a 120-frame
    1392² production stack it costs 480 correlations and **211 s**, against
    ~30 s for the Fiji schedule; the same stack has 301-frame siblings, inside
    an upload that is a single blocking POST.

    So the sole genuine departure from Fiji here is the ``dt=1`` pass running
    decimated (see ``_FAST_SHORT_LAG_DECIMATION``). Neither switch touches the
    residual-and-ramp arithmetic — only which pairs are measured.

    Measured between the two schedules on two real production stacks: the final
    correction was IDENTICAL on both, and intermediate frames differed by at
    most 1.26 px — the same order as the ±0.5 px that rounding to whole pixels
    costs anyway (see :func:`apply_drift`), against the 16-20 px of drift being
    removed on the stacks those figures come from.
    """
    n = len(frames)
    if n == 0:
        return DriftTrajectory([], 0, 0, False)
    if n == 1:
        return DriftTrajectory([(0.0, 0.0)], 0, 0, False)

    # Absolute displacement of each frame relative to frame 0, built up pass by
    # pass. Sign convention: this holds the DISPLACEMENT; the correction we
    # return at the end is its negation.
    shifts = np.zeros((n, 2), dtype=np.float64)

    # dict.fromkeys de-duplicates while keeping order: on a 2-frame stack
    # `multi_scale_lags` returns [1] (its full baseline IS 1), which would
    # otherwise run the consecutive pass twice for a guaranteed-zero residual.
    lags = list(dict.fromkeys([1] + (multi_scale_lags(n) if multi_scale else [])))
    anchor_lag = lags[-1] if multi_scale else None
    measured = accepted = 0
    anchored = False
    for dt in lags:
        if fast and dt == 1:
            steps = range(1, n)
            decim = _FAST_SHORT_LAG_DECIMATION
        elif fast:
            # Non-overlapping baselines, plus the last frame so the tail of the
            # stack is always measured rather than only extrapolated into.
            steps = list(range(dt, n, dt))
            if (n - 1) % dt:
                steps.append(n - 1)
            decim = 1
        else:
            steps = range(dt, n)
            decim = 1
        budget = max(8, max_shift_px // decim)

        for t in steps:
            a, b = frames[t - dt], frames[t]
            if decim > 1:
                a, b = a[::decim, ::decim], b[::decim, ::decim]
            est = estimate_translation_detailed(a, b, max_shift_px=budget)
            measured += 1
            if est.reason != REASON_OK:
                # Nothing trustworthy to add. Leaving the trajectory alone is
                # the whole point of having a quality gate: a refused pair is
                # not evidence of zero motion, it is absence of evidence, and
                # writing a guess here would ramp that guess across the tail of
                # the stack.
                continue

            accepted += 1
            if dt == anchor_lag:
                anchored = True

            # `estimate_translation_detailed` returns the shift that REGISTERS
            # frames[t] onto frames[t-dt], i.e. the negation of how far the
            # content moved between them. Flip it to get displacement.
            # Scale a decimated estimate back into full-resolution pixels.
            displacement = np.array(
                [-est.dy * decim, -est.dx * decim], dtype=np.float64
            )

            # What the trajectory already believes happened over this interval.
            believed = shifts[t] - shifts[t - dt]
            residual = displacement - believed
            if not np.any(residual):
                continue

            # Spread the residual as a linear ramp: 0 at t-dt, the full amount
            # at t, and CONTINUING past t to the end of the stack. The
            # extrapolation is deliberate (it is what carries a slow drift
            # forward into frames no long baseline has reached yet); later,
            # finer passes correct it where it overshoots.
            span = np.arange(n - (t - dt), dtype=np.float64) / dt
            shifts[t - dt:] += span[:, None] * residual

    corrections = -shifts
    corrections[0] = 0.0  # the origin, exactly, whatever rounding did above
    return DriftTrajectory(
        [(float(dy), float(dx)) for dy, dx in corrections],
        measured,
        accepted,
        anchored,
    )


def apply_drift(frame: np.ndarray, dy: float, dx: float, fill: int = 0) -> np.ndarray:
    """``frame`` translated by ``(dy, dx)``, ROUNDED to whole pixels.

    Lossless by construction: the rounded shift is a slice, so every retained
    sample keeps its exact 16-bit value and no intermediate value is invented.
    That is what makes it safe to bake this into the stored frames of a
    measurement tool — see the module docstring.

    A shift that rounds to zero returns the frame unchanged rather than a copy
    with a shaved border.
    """
    idy, idx = int(round(dy)), int(round(dx))
    if idy == 0 and idx == 0:
        return frame
    return shift_frame(frame, idy, idx, fill=fill)


def drift_is_worth_correcting(
    trajectory, min_px: float = 1.0
) -> bool:
    """Whether ``trajectory`` moves far enough to be worth zero-filling borders.

    A stack that never moves more than a pixel gains nothing from correction and
    would pay a blanked border for it, so the caller skips it entirely and the
    stored frames stay byte-identical to the uncorrected extract.
    """
    return any(
        abs(dy) >= min_px or abs(dx) >= min_px for dy, dx in trajectory
    )


class _DiskFrames:
    """The written PNGs of one channel, read on demand.

    Estimation touches at most two frames at once, so a stack of any length
    costs two frames of RAM. That is the reason drift correction runs as a pass
    over the ALREADY-WRITTEN frames rather than inside the extractor loop: the
    ND2 path streams deliberately, holding only a bounded number of frames in
    flight, and the final pass correlates frame 0 against the LAST frame, so
    the pair can be the whole stack apart. Buffering that in memory would undo
    the bound the extractor exists to maintain. (The TIFF extractor already
    holds the array; it shares this path so there is one implementation, not
    because it needs the saving.)

    Frames are re-decoded on each access rather than cached: at 2048² a decode
    is ~0.08 s against ~0.38 s for the correlation it feeds, so a cache would
    save under a fifth of the pass for a per-frame RAM cost the streaming above
    exists to avoid.
    """

    def __init__(self, frames_dir, channel: str, indices):
        self._dir = frames_dir
        self._channel = channel
        self._indices = list(indices)

    def __len__(self):
        return len(self._indices)

    def __getitem__(self, i):
        from PIL import Image

        path = self._dir / f"{self._indices[i]:04d}" / f"{self._channel}.png"
        with Image.open(path) as im:
            return np.asarray(im)


def correct_drift_in_place(
    frames_dir,
    channel_names: list[str],
    source_channel: str,
    indices=None,
    min_px: float = 1.0,
) -> dict | None:
    """Estimate stage drift from ``source_channel`` and de-drift EVERY channel.

    One channel drives the estimate and all of them receive the same shift —
    the same rule Fiji's hyperstack path follows, and the only correct one: the
    channels are simultaneous views of one field, so a per-channel trajectory
    would silently pull them out of the registration that
    ``channel_registration`` just established.

    Rewrites the PNGs in place with the ROUNDED shift (lossless — see
    :func:`apply_drift`) and returns the sidecar dict, or ``None`` when the
    stack does not move far enough to be worth blanking a border for. Frames
    whose shift rounds to zero are not rewritten at all.
    """
    from pathlib import Path

    from PIL import Image

    frames_dir = Path(frames_dir)
    if indices is None:
        indices = sorted(
            int(p.name) for p in frames_dir.iterdir()
            if p.is_dir() and p.name.isdigit()
        )
    if len(indices) < 2:
        return None

    # ESTIMATION reads and mutates nothing, so a failure here must not cost the
    # upload. `extractVideoSafe` deletes the whole destination directory —
    # including the original that was just moved into it — when the helper
    # exits non-zero, and losing an hour of ND2 extraction to an optional
    # post-process is the wrong trade. The rewrite below is the opposite case
    # and is deliberately left fatal: a half-corrected stack is worse than an
    # uncorrected one.
    try:
        est = estimate_drift_trajectory_detailed(
            _DiskFrames(frames_dir, source_channel, indices)
        )
    except Exception as exc:  # noqa: BLE001 - report and decline, never abort
        sys.stderr.write(
            f"drift: estimation failed on channel '{source_channel}' "
            f"({type(exc).__name__}: {exc}); frames left uncorrected\n"
        )
        return None

    trajectory = est.corrections
    peak = max(
        (max(abs(dy), abs(dx)) for dy, dx in trajectory), default=0.0
    )

    if est.measured and not est.accepted:
        # Every pair refused. The all-zero trajectory that produces is NOT
        # evidence the stack holds still, and must not be reported as such.
        sys.stderr.write(
            f"drift: no measurable structure on channel '{source_channel}' "
            f"(0 of {est.measured} frame pairs matched); left uncorrected\n"
        )
        return None

    if not est.anchored:
        # The final pass — frame 0 against the LAST frame — was refused, so the
        # trajectory's tail rests on ramp extrapolation with nothing measuring
        # it. That is not a small loss of confidence; it is the signature of a
        # stack whose content changes independently of the stage, and on a
        # motility assay the "drift" such a stack reports IS the motility.
        #
        # Observed live, 2026-08-30: a 50-frame stack whose driving channel
        # held filaments gliding at 2 px/frame produced 74 of 75 pairs
        # accepted, a 97 px correction, and this anchor refused — the only
        # signal separating it from a genuine 10 px drift. Subtracting it would
        # have cancelled the signal the experiment records and blanked 19 % of
        # every frame.
        #
        # Free on real data: all four production stacks carrying genuine drift
        # anchor with 100 % of pairs accepted (181/181, 62/62).
        sys.stderr.write(
            f"drift: refusing on channel '{source_channel}' — the "
            f"full-baseline pass found no match, so the trajectory "
            f"({peak:.0f} px) is extrapolation, not measurement; "
            f"left uncorrected\n"
        )
        return None

    if not drift_is_worth_correcting(trajectory, min_px=min_px):
        return None

    # Nothing bounds the SUM of the per-pair estimates, and the ramp
    # extrapolates to the end of the stack — see _MAX_TOTAL_DRIFT_FRACTION.
    with Image.open(
        frames_dir / f"{indices[0]:04d}" / f"{source_channel}.png"
    ) as im:
        limit = _MAX_TOTAL_DRIFT_FRACTION * min(im.size)
    if peak > limit:
        sys.stderr.write(
            f"drift: refusing a {peak:.0f} px correction on channel "
            f"'{source_channel}' (limit {limit:.0f} px, "
            f"{est.accepted}/{est.measured} pairs matched); left uncorrected\n"
        )
        return None

    sys.stderr.write(
        f"drift: channel '{source_channel}', {len(indices)} frames, "
        f"{est.accepted}/{est.measured} pairs matched"
        f"{'' if est.anchored else ', FULL-BASELINE ANCHOR REFUSED'}, "
        f"max applied {peak:.0f} px\n"
    )

    applied = []
    for pos, t in enumerate(indices):
        dy, dx = trajectory[pos]
        idy, idx = int(round(dy)), int(round(dx))
        applied.append([idy, idx])
        if idy == 0 and idx == 0:
            continue
        for channel in channel_names:
            path = frames_dir / f"{t:04d}" / f"{channel}.png"
            if not path.exists():
                # Deliberately fatal, matching `_DiskFrames.__getitem__`: the
                # alternative is this frame's channels ending up in DIFFERENT
                # coordinate spaces — some corrected, one not — while
                # `applied` records the shift as though every channel got it.
                # Unreachable from the extractors (they write every
                # (frame, channel) PNG, blank planes included) but reachable
                # from any future backfill, which is exactly when a silent
                # skip would be worst.
                raise FileNotFoundError(
                    f"drift correction: {path} is missing; refusing to leave "
                    f"frame {t} with its channels in different spaces"
                )
            with Image.open(path) as im:
                arr = np.asarray(im)
            # No `mode=`: it is deprecated in Pillow 12 and removed in 13, and
            # it was never needed — the dtype already determines the mode, and
            # `shift_frame` preserves it. Saved exactly as `_save_png` does.
            Image.fromarray(shift_frame(arr, idy, idx)).save(
                path, format="PNG", optimize=True
            )

    return {
        "version": 1,
        "method": "fiji_correct_3d_drift_multi_time_scale",
        "sourceChannel": source_channel,
        # How much of the trajectory was measured rather than extrapolated.
        # `anchored` false means the final full-baseline pass was refused and
        # the tail rests on the ramp alone.
        "pairsMeasured": est.measured,
        "pairsAccepted": est.accepted,
        "anchored": est.anchored,
        # frameIndex -> the [dy, dx] actually written into the pixels.
        "applied": {str(t): applied[i] for i, t in enumerate(indices)},
        # The sub-pixel estimate before rounding, so a later pass can tell a
        # frame that was left alone from one whose correction rounded to zero.
        "estimated": {
            str(t): [round(trajectory[i][0], 3), round(trajectory[i][1], 3)]
            for i, t in enumerate(indices)
        },
    }


def compose_into_registration_offsets(offsets: dict, drift: dict) -> dict:
    """Fold the applied drift into the per-frame channel-registration offsets.

    WHY THIS IS NOT OPTIONAL. ``registration.json`` is not a log — it is the
    map ``mtMetricsExporter`` and the kymograph path use to sample the RAW
    file (``original.nd2`` / ``.tif``) in the same space as the stored frames.
    Drift correction moves the stored PNGs and does not touch the original, so
    without this the polygons a user draws on a de-drifted frame would be
    measured against un-drifted pixels, silently, by exactly the drift. That is
    a corrupted intensity measurement, not a cosmetic mismatch.

    Both corrections are integer translations of the same plane, so they
    compose by addition: ``stored = shift(shift(raw, channel), drift)``.

    ``offsets`` is ``{frameIndex: [[dy, dx], ...]}`` per channel (mutated and
    returned); ``drift`` is the sidecar from :func:`correct_drift_in_place`.
    The drift applies to EVERY channel of a frame — one field, one stage.
    """
    applied = drift.get("applied", {})
    # The unguarded direction is an `applied` entry with no matching `offsets`
    # row: the PNG would have been moved and the map that says so left
    # un-updated, which is exactly the silent mis-measurement this function
    # exists to prevent. Both maps are built from the same frame set inside one
    # call, so a mismatch is a programming error, not a data condition.
    missing = set(applied) - {str(t) for t in offsets}
    if missing:
        raise ValueError(
            f"drift recorded for frames with no registration row: "
            f"{sorted(missing)[:5]}"
        )
    for t, rows in offsets.items():
        ddy, ddx = applied.get(str(t), (0, 0))
        if not ddy and not ddx:
            continue
        for row in rows:
            row[0] += ddy
            row[1] += ddx
    return offsets


__all__ = [
    "compose_into_registration_offsets",
    "DRIFT_MAX_SHIFT_PX",
    "apply_drift",
    "correct_drift_in_place",
    "drift_is_worth_correcting",
    "estimate_drift_trajectory",
    "multi_scale_lags",
]
