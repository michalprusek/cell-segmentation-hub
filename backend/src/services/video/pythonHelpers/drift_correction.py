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
measures nothing at all, 119 times in a row, while the stack really moves 10 px.
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
  cost is small and bounded: 17 px of drift on a 1300 px frame blanks 1.3% of
  the width.

* **Fiji's 10 px cap.** ``Correct_3D_drift.py`` has a live bug —
  ``addNumericField("Max_shift_x [pixels]:", 10, imp.getWidth())`` passes the
  image width as the DECIMAL PLACES argument, so the default cap is 10 px and
  anything larger is silently clamped. Our budget is a real one (see
  ``DRIFT_MAX_SHIFT_PX``).

Runs inside the backend container: numpy only.
"""

from __future__ import annotations

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

#: Fiji's schedule, verbatim: a consecutive pass, then ascending powers of three
#: (`dts = [3,9,27,81,243,729,dt_max]`).
_LAG_BASE = 3

#: Decimation used for the CONSECUTIVE (dt=1) pass when ``fast`` is on.
#:
#: That pass exists to catch ABRUPT displacements — a knock, a stage jump —
#: which are by definition large and therefore survive decimation. It cannot
#: see slow drift at any resolution (that is the whole premise of this module),
#: so running it at full resolution buys nothing while costing more than every
#: other pass combined: 52 s of the 211 s a 120-frame 1392² stack took.
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
    while dt < dt_max:
        lags.append(dt)
        dt *= _LAG_BASE
    lags.append(dt_max)
    return lags


def estimate_drift_trajectory(
    frames,
    multi_scale: bool = True,
    max_shift_px: int = DRIFT_MAX_SHIFT_PX,
    fast: bool = True,
) -> list[tuple[float, float]]:
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

    ``fast`` (default) trades a little accuracy for a 7x speedup, and is the
    one place this module departs from Fiji. Fiji measures every ``t`` at every
    lag at full resolution; that is ~6N correlations of a full frame, which on
    a 120-frame 1392² production stack took **211 s** — and the same stack has
    301-frame siblings, i.e. ~9 minutes, inside an upload that is a single
    blocking POST. ``fast`` changes only WHICH PAIRS ARE MEASURED, never the
    residual-and-ramp arithmetic:

      * the ``dt=1`` pass runs decimated (see ``_FAST_SHORT_LAG_DECIMATION``);
      * longer lags step by ``dt`` (non-overlapping baselines) instead of by 1,
        plus the final frame so the end of the stack is always anchored.

    Measured against the faithful schedule on two real production stacks: the
    final correction was IDENTICAL on both, and intermediate frames differed by
    at most 1.26 px — the same order as the ±0.5 px that rounding to whole
    pixels costs anyway (see :func:`apply_drift`), against the 5-13 px of drift
    being removed. Pass ``fast=False`` for Fiji's exact schedule.
    """
    n = len(frames)
    if n == 0:
        return []
    if n == 1:
        return [(0.0, 0.0)]

    # Absolute displacement of each frame relative to frame 0, built up pass by
    # pass. Sign convention: this holds the DISPLACEMENT; the correction we
    # return at the end is its negation.
    shifts = np.zeros((n, 2), dtype=np.float64)

    lags = [1] + (multi_scale_lags(n) if multi_scale else [])
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
            if est.reason != REASON_OK:
                # Nothing trustworthy to add. Leaving the trajectory alone is
                # the whole point of having a quality gate: a refused pair is
                # not evidence of zero motion, it is absence of evidence, and
                # writing a guess here would ramp that guess across the tail of
                # the stack.
                continue

            # `estimate_translation_detailed` returns the shift that REGISTERS
            # frames[t] onto frames[t-dt], i.e. the negation of how far the
            # content moved between them. Flip it to get displacement.
            # Scale a decimated estimate back into full-resolution pixels.
            measured = np.array(
                [-est.dy * decim, -est.dx * decim], dtype=np.float64
            )

            # What the trajectory already believes happened over this interval.
            believed = shifts[t] - shifts[t - dt]
            residual = measured - believed
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
    return [(float(dy), float(dx)) for dy, dx in corrections]


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
    flight, and a trajectory needs pairs up to a lag of 243 apart. Buffering
    those in memory would undo the bound the extractor exists to maintain.
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

    trajectory = estimate_drift_trajectory(
        _DiskFrames(frames_dir, source_channel, indices)
    )
    if not drift_is_worth_correcting(trajectory, min_px=min_px):
        return None

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
                continue
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
