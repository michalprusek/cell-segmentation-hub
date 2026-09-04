"""Unit tests for ``drift_correction.py``.

Stage drift in a time-lapse, corrected the way Fiji's **Correct 3D Drift**
corrects it: a pairwise pass, then residual passes at lags of ascending powers
of three, each spreading what it measures as a linear ramp.

WHY THE MULTI-SCALE PART IS THE WHOLE POINT. Measured on production
(2026-08-29): consecutive frames of a drifting acquisition estimate to exactly
``(0, 0)`` — the real step is 0.084 px/frame and integer estimation floors it —
while the same stack has moved 16-20 px by its last frame. So the failure is
NON-DETECTION, not error accumulation, and no amount of anchoring or global
least-squares over *consecutive* pairs can recover it: every one of those
measurements is genuinely zero. Only a long baseline sees the motion at all.
That is exactly what the ascending lags buy.

Pure numpy, pytest-collectable, and runnable directly:

  docker exec spheroseg-backend python3 \
    backend/src/services/video/pythonHelpers/tests/test_drift_correction.py
"""
from __future__ import annotations

import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
from contextlib import contextmanager, redirect_stderr

import numpy as np

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from PIL import Image  # noqa: E402

from channel_registration import _MAX_SHIFT_PX, shift_frame  # noqa: E402

import drift_correction  # noqa: E402
from drift_correction import (  # noqa: E402
    _MAX_TOTAL_DRIFT_FRACTION,
    DRIFT_MAX_SHIFT_PX,
    REASON_ESTIMATION_FAILED,
    REASON_OVER_LIMIT,
    REASON_STILL,
    REASON_UNANCHORED,
    REASON_UNMATCHABLE,
    apply_drift,
    compose_into_registration_offsets,
    correct_drift_in_place,
    drift_is_worth_correcting,
    estimate_drift_trajectory_detailed,
    multi_scale_lags,
)


def _corrections(frames, **kw):
    """The trajectory alone. The counts are what production reads, so the
    module returns them; a test that only places pixels wants the list."""
    return estimate_drift_trajectory_detailed(frames, **kw).corrections


def _filament_field(seed: int = 0, n: int = 384) -> np.ndarray:
    """Sparse bright filaments — the structure phase correlation locks onto."""
    rng = np.random.RandomState(seed)
    img = np.zeros((n, n), dtype=np.float64)
    for _ in range(12):
        y, x = rng.randint(50, n - 50), rng.randint(50, n - 50)
        ang = rng.uniform(0, np.pi)
        for t in range(rng.randint(90, 200)):
            yy, xx = int(y + t * np.sin(ang)), int(x + t * np.cos(ang))
            if 0 <= yy < n - 1 and 0 <= xx < n - 1:
                img[yy:yy + 2, xx:xx + 2] = 1.0
    return img


def _stack_along(path, seed: int = 0, size: int = 384):
    """A stack whose content sits at ``path[t] == (dy, dx)`` on frame ``t``.

    Rendered with bilinear weights so the motion is genuinely SUB-PIXEL: a
    stack built with ``np.roll`` alone would move in whole-pixel jumps and the
    detection problem under test would not exist.
    """
    base = _filament_field(seed, size)
    rng = np.random.RandomState(seed + 100)
    out = []
    for dy, dx in path:
        fy, fx = int(np.floor(dy)), int(np.floor(dx))
        wy, wx = dy - fy, dx - fx
        a = np.roll(np.roll(base, fy, 0), fx, 1)
        b = np.roll(np.roll(base, fy, 0), fx + 1, 1)
        c = np.roll(np.roll(base, fy + 1, 0), fx, 1)
        d = np.roll(np.roll(base, fy + 1, 0), fx + 1, 1)
        img = (1 - wy) * ((1 - wx) * a + wx * b) + wy * ((1 - wx) * c + wx * d)
        out.append(
            (img * 9000 + rng.normal(4000, 120, base.shape))
            .clip(0, 65535)
            .astype(np.uint16)
        )
    return out


def _drifting_stack(
    n_frames: int, per_frame=(0.0, 0.084), seed: int = 0, size: int = 384
):
    """A stack whose content translates by ``per_frame`` px per frame."""
    return _stack_along(
        [(f * per_frame[0], f * per_frame[1]) for f in range(n_frames)], seed, size
    )


def _terminal_error(traj, n_frames, per_frame):
    """How far the last frame is still displaced after applying ``traj``."""
    true_dy = (n_frames - 1) * per_frame[0]
    true_dx = (n_frames - 1) * per_frame[1]
    dy, dx = traj[-1]
    # traj is the correction, i.e. the negation of the displacement.
    return max(abs(-dy - true_dy), abs(-dx - true_dx))


def test_schedule_is_identical_to_fiji_s_at_every_stack_length():
    """`multi_scale_lags` must reproduce Correct_3D_drift.py exactly.

    Fiji's is a literal `dts = [3,9,27,81,243,729,dt_max]` iterated as
    `if dt < dt_max: run(dt) else: run(dt_max); break` — so the powers stop at
    3^6 and it jumps to the full baseline. An earlier version of this module
    kept multiplying, which diverged from n=2189 (adding a 2187 pass). Nothing
    in production is that long, which is exactly why it needed pinning rather
    than trusting.
    """
    def fiji(n_frames: int) -> list[int]:
        dt_max = n_frames - 1
        out = []
        for dt in [3, 9, 27, 81, 243, 729, dt_max]:
            if dt < dt_max:
                out.append(dt)
            else:
                out.append(dt_max)
                break
        return out

    for n in list(range(2, 300)) + [621, 1000, 2188, 2189, 3000, 5000]:
        assert multi_scale_lags(n) == fiji(n), n

    # The one case outside Fiji's domain: a single frame has no pair, where the
    # reference above would return a degenerate [0].
    assert multi_scale_lags(1) == []


def test_a_two_frame_stack_does_not_run_the_consecutive_pass_twice():
    # `multi_scale_lags(2) == [1]`, and the trajectory prepends its own dt=1,
    # so without de-duplication the only pair in the stack is correlated twice.
    #
    # The COUNT is the only observable: the second pass measures a residual of
    # zero and `if not np.any(residual): continue` swallows it, so asserting on
    # the trajectory passes with the de-duplication removed. Mutation-checked.
    frames = _drifting_stack(2, (0.0, 3.0))
    calls = []
    real = drift_correction.estimate_translation_prepared

    def counting(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    drift_correction.estimate_translation_prepared = counting
    try:
        traj = _corrections(frames, multi_scale=True)
    finally:
        drift_correction.estimate_translation_prepared = real

    assert len(calls) == 1, f"the stack's only pair was correlated {len(calls)}x"
    assert len(traj) == 2
    assert traj[0] == (0.0, 0.0)


def test_a_pass_prepares_each_frame_once_not_twice():
    # Every pass walks a CHAIN of pairs, so frame t is the moving frame of one
    # and the reference of the next. Without the one-slot cache each frame is
    # decoded and Fourier-transformed twice — measured at 2048², ~38% of the
    # estimation pass spent recomputing what the previous pair just produced.
    #
    # n=10 so every long-lag pass tiles the stack exactly: with `(n-1) % dt`
    # non-zero the schedule appends a final `n-1` step whose reference is NOT
    # the previous pair's moving frame, which legitimately costs one extra
    # preparation and would make the exact count below depend on the stack
    # length rather than on the cache.
    n = 10
    frames = _drifting_stack(n, (0.0, 0.6))
    prepares, pairs = [], []
    real_prepare = drift_correction.prepare_frame
    real_pair = drift_correction.estimate_translation_prepared

    def counting_prepare(arr):
        prepares.append(1)
        return real_prepare(arr)

    def counting_pair(*args, **kwargs):
        pairs.append(1)
        return real_pair(*args, **kwargs)

    drift_correction.prepare_frame = counting_prepare
    drift_correction.estimate_translation_prepared = counting_pair
    try:
        estimate_drift_trajectory_detailed(frames)
    finally:
        drift_correction.prepare_frame = real_prepare
        drift_correction.estimate_translation_prepared = real_pair

    # One preparation per pair, plus one to open each pass's chain. Derived
    # from the observed pair count rather than from a second copy of the
    # schedule, so this cannot drift away from `multi_scale_lags`.
    passes = len(dict.fromkeys([1] + multi_scale_lags(n)))
    assert len(prepares) == len(pairs) + passes, (
        f"{len(prepares)} preparations for {len(pairs)} pairs over {passes} "
        f"passes — the chain cache is not hitting (uncached: {2 * len(pairs)})"
    )


def test_consecutive_only_estimation_cannot_see_sub_pixel_drift():
    # The bug this module exists for, pinned as a fact about the data rather
    # than an opinion: with 0.084 px/frame every consecutive estimate is 0, so
    # a pairwise-only trajectory stays flat while the stack really moves 10 px.
    n, per = 120, (0.0, 0.084)
    frames = _drifting_stack(n, per)
    flat = _corrections(frames, multi_scale=False)
    assert all(dy == 0 and dx == 0 for dy, dx in flat), (
        "consecutive pairs are expected to measure nothing here — if this "
        "fails the premise of the multi-scale pass has changed"
    )
    assert _terminal_error(flat, n, per) > 8.0


def test_multi_scale_recovers_sub_pixel_drift_the_pairwise_pass_misses():
    n, per = 120, (0.0, 0.084)
    frames = _drifting_stack(n, per)
    traj = _corrections(frames, multi_scale=True)
    assert len(traj) == n
    assert traj[0] == (0.0, 0.0), "frame 0 is the origin and never moves"
    err = _terminal_error(traj, n, per)
    assert err < 1.0, f"terminal error {err:.2f} px"


def test_trajectory_is_monotonic_for_a_monotonic_drift():
    # A stage that only ever moves one way must not produce a correction that
    # doubles back: non-monotonicity here means a pass mis-measured and the
    # ramp spread the error backwards.
    n = 90
    frames = _drifting_stack(n, (0.0, 0.1))
    xs = [dx for _, dx in _corrections(frames, multi_scale=True)]
    diffs = np.diff(xs)
    assert (diffs <= 1e-9).all(), f"correction reverses direction: {xs[:12]}"


def test_two_axis_drift_is_recovered_on_both_axes():
    n, per = 100, (0.05, -0.07)
    frames = _drifting_stack(n, per)
    traj = _corrections(frames, multi_scale=True)
    assert _terminal_error(traj, n, per) < 1.0


def test_a_static_stack_yields_no_correction():
    # The common case. A stack that does not move must be left exactly alone —
    # a correction invented here would zero-fill borders for nothing.
    frames = _drifting_stack(40, (0.0, 0.0))
    traj = _corrections(frames, multi_scale=True)
    assert all(abs(dy) < 0.5 and abs(dx) < 0.5 for dy, dx in traj)


def test_search_budget_exceeds_what_a_long_baseline_needs():
    # At the production rate of 0.084 px/frame a 243-frame baseline has moved
    # 20 px and a 729-frame one 61 px. The channel-registration window is 16 px
    # and would clip both to its edge, then reject them as low quality.
    assert DRIFT_MAX_SHIFT_PX >= 64
    assert DRIFT_MAX_SHIFT_PX > _MAX_SHIFT_PX


def test_apply_drift_is_lossless_and_integer():
    # The reason we can bake the correction into the stored 16-bit PNGs at all:
    # the shift is rounded and applied as a pure slice, so every retained
    # sample keeps its exact value. `mt_measure` reads raw ADU off these
    # frames, and an interpolated pixel would be a fabricated measurement.
    arr = (np.arange(64 * 64, dtype=np.uint16)).reshape(64, 64)
    out = apply_drift(arr, 2.4, -1.6)  # rounds to (2, -2)
    assert out.dtype == arr.dtype
    assert np.array_equal(out[2:64, 0:62], arr[0:62, 2:64])
    assert (out[0:2, :] == 0).all()
    # Every value present in the output must be a value that was in the input:
    # interpolation would synthesise intermediate ones.
    assert set(np.unique(out)).issubset(set(np.unique(arr)) | {0})


def test_apply_drift_zero_is_identity():
    arr = _filament_field(3, 160).astype(np.uint16)
    assert np.array_equal(apply_drift(arr, 0.0, 0.0), arr)
    # ...and a shift that rounds to zero must also be a no-op, not a copy that
    # silently shaves a border.
    assert np.array_equal(apply_drift(arr, 0.4, -0.4), arr)


def test_frames_that_cannot_be_matched_do_not_corrupt_the_trajectory():
    # An acquisition that goes blank part-way (an aborted run leaves a tail of
    # them; production has several) must not drag the correction with it. The
    # blank frames get *a* value, but the frames before them keep the drift
    # that was actually measured.
    n = 60
    frames = _drifting_stack(n, (0.0, 0.1))
    for t in range(40, n):
        frames[t] = np.zeros_like(frames[t])
    traj = _corrections(frames, multi_scale=True)
    assert len(traj) == n
    good_dx = traj[35][1]
    assert abs(-good_dx - 35 * 0.1) < 1.5, f"pre-blank drift lost: {good_dx}"
    assert all(np.isfinite(dy) and np.isfinite(dx) for dy, dx in traj)


def test_the_ramp_corrects_intermediate_frames_not_just_the_endpoints():
    # The linear ramp is the heart of Fiji's method and the easiest part to
    # drop without noticing: the final full-baseline pass fixes the LAST frame
    # whatever happens in between, so an endpoint-only assertion passes even if
    # the residual is dumped entirely onto frame t. Check the middle.
    n, per = 120, (0.0, 0.084)
    frames = _drifting_stack(n, per)
    traj = _corrections(frames, multi_scale=True)

    worst = 0.0
    for t in range(10, n, 10):
        expected = t * per[1]          # true displacement at frame t
        got = -traj[t][1]              # correction is its negation
        worst = max(worst, abs(got - expected))
    # The ramp holds these to ~0.01 px. Dumping the residual onto frame t
    # instead (the mutant this pins) leaves 1.04 px, because a frame between
    # two long-baseline measurements then gets no share of what they found.
    assert worst < 0.6, (
        f"intermediate frames are off by up to {worst:.2f} px — the residual "
        "is not being spread across the interval it was measured over"
    )


def test_drift_is_worth_correcting_skips_a_still_stack():
    # Zero-filling a border costs real data, so a stack that never moves must
    # be left byte-identical rather than "corrected" by nothing.
    assert not drift_is_worth_correcting([(0.0, 0.0), (0.2, -0.3), (0.4, 0.1)])
    assert drift_is_worth_correcting([(0.0, 0.0), (0.2, -0.3), (0.0, 4.0)])


def test_fast_schedule_agrees_with_fiji_s_exact_one():
    # `fast` changes only WHICH PAIRS are measured, never the arithmetic. If it
    # ever starts disagreeing materially, the speedup has stopped being free
    # and the default should be revisited.
    n, per = 100, (0.03, 0.084)
    frames = _drifting_stack(n, per)
    faithful = _corrections(frames, fast=False)
    quick = _corrections(frames, fast=True)

    end = max(
        abs(faithful[-1][0] - quick[-1][0]), abs(faithful[-1][1] - quick[-1][1])
    )
    assert end < 0.6, f"final correction differs by {end:.2f} px"

    worst = max(
        max(abs(a - b), abs(c - d))
        for (a, c), (b, d) in zip(faithful, quick)
    )
    # Production measurement was 1.26 px on a 1392² stack; the bound here is
    # deliberately close to it so a real regression is not absorbed.
    assert worst < 2.0, f"intermediate frames differ by {worst:.2f} px"

    # ...and it must still actually correct the drift, not merely agree.
    assert _terminal_error(quick, n, per) < 1.0


def _write_stack(root, frames_by_channel):
    """Write {channel: [frame arrays]} as the extractors do: frames/NNNN/<ch>.png."""

    n = len(next(iter(frames_by_channel.values())))
    for t in range(n):
        d = root / f"{t:04d}"
        d.mkdir(parents=True, exist_ok=True)
        for ch, arrs in frames_by_channel.items():
            Image.fromarray(arrs[t]).save(d / f"{ch}.png", format="PNG")


@contextmanager
def _staged(frames_by_channel, sub=""):
    """A throwaway container directory holding one written stack.

    ``sub="frames"`` stages it as a real container (``<root>/frames/NNNN/``),
    which is what the CLI and the sidecar composition see; the bare form is
    the frames directory itself, which is what ``correct_drift_in_place``
    takes.
    """
    with tempfile.TemporaryDirectory() as d:
        root = pathlib.Path(d)
        _write_stack(root / sub if sub else root, frames_by_channel)
        yield root


def _png_bytes(root, n, channel="IRM"):
    """The on-disk bytes of one channel, for a byte-identity comparison."""
    return [(root / f"{t:04d}" / f"{channel}.png").read_bytes() for t in range(n)]


def test_in_place_correction_de_drifts_every_channel_from_one_estimate():
    # The channels are simultaneous views of one field. A per-channel
    # trajectory would pull them out of the alignment channel_registration
    # just established, so ONE channel drives and all of them get that shift —
    # Fiji's hyperstack rule.
    n, per = 40, (0.0, 0.3)   # 11.7 px by the last frame
    drive = _drifting_stack(n, per, seed=5)
    # A second channel carrying different structure but the SAME motion.
    other = _drifting_stack(n, per, seed=6)

    with _staged({"IRM": drive, "TIRF": other}) as root:
        before = np.asarray(Image.open(root / "0039" / "TIRF.png"))

        sidecar = correct_drift_in_place(root, ["IRM", "TIRF"], "IRM")

        assert sidecar is not None, "an 11 px drift must be corrected"
        assert sidecar["sourceChannel"] == "IRM"
        assert sidecar["method"] == "fiji_correct_3d_drift_multi_time_scale"
        assert sidecar["applied"]["0"] == [0, 0], "frame 0 is the origin"

        dy, dx = sidecar["applied"]["39"]
        assert abs(-dx - 39 * per[1]) < 1.5, f"last frame corrected by {dx}"

        # The non-driving channel moved by the SAME amount, and losslessly:
        # every value in the shifted frame came from the original.
        after = np.asarray(Image.open(root / "0039" / "TIRF.png"))
        assert after.shape == before.shape, "frame size must not change"
        assert set(np.unique(after)).issubset(set(np.unique(before)) | {0})
        assert np.array_equal(
            shift_frame(before, dy, dx), after
        ), "the second channel did not receive the driving channel's shift"


def test_a_still_stack_is_left_byte_identical_on_disk():
    # Correction costs a blanked border, so a stack that does not move must not
    # be touched at all — not rewritten with a zero shift, not re-encoded.
    n = 20
    frames = _drifting_stack(n, (0.0, 0.0), seed=7)
    with _staged({"IRM": frames}) as root:
        raw = _png_bytes(root, n)

        out = correct_drift_in_place(root, ["IRM"], "IRM")
        assert (out["corrected"], out["reason"]) == (False, REASON_STILL)

        after = _png_bytes(root, n)
        assert raw == after, "a still stack must not be rewritten"


def test_drift_is_folded_into_the_registration_offsets():
    # registration.json is not a log: mtMetricsExporter and the kymograph path
    # use it to sample the RAW original in the same space as the stored frames.
    # Drift correction moves the stored frames and does NOT move the original,
    # so a drift that is not folded in here means every intensity measured on a
    # drifted frame is read from the wrong pixels — silently, by exactly the
    # drift. This is the highest-consequence line in the module.
    offsets = {
        0: [[0, 0], [3, -2]],
        1: [[0, 0], [3, -2]],
        2: [[0, 0], [3, -2]],
    }
    drift = {"applied": {"0": [0, 0], "1": [-1, -4], "2": [-2, -9]}}

    out = compose_into_registration_offsets(offsets, drift)

    # Frame 0: no drift, so the channel offsets are untouched.
    assert out[0] == [[0, 0], [3, -2]]
    # The drift applies to EVERY channel — one field, one stage — and adds to
    # whatever the channel offset already was.
    assert out[1] == [[-1, -4], [2, -6]]
    assert out[2] == [[-2, -9], [1, -11]]


def test_composition_matches_what_applying_both_shifts_actually_does():
    # The addition above is only correct because two integer translations of the
    # same plane compose. Prove it against the real pixels rather than asserting
    # the arithmetic twice.
    raw = _filament_field(11, 128).astype(np.uint16)
    ch, dr = (3, -2), (-1, -4)

    stepwise = shift_frame(shift_frame(raw, *ch), *dr)
    composed = shift_frame(raw, ch[0] + dr[0], ch[1] + dr[1])

    # They agree everywhere except the border each fills differently, which is
    # why the interior is compared: a composed shift blanks one border, the
    # stepwise pair blanks a corner of it twice.
    m = 8
    assert np.array_equal(stepwise[m:-m, m:-m], composed[m:-m, m:-m])



def test_a_composed_correction_larger_than_the_frame_is_refused():
    # DRIFT_MAX_SHIFT_PX bounds each PAIR; nothing bounds their sum, and the
    # ramp extrapolates to the end of the stack. Applying a runaway trajectory
    # rewrites every PNG to a uniform fill, IN PLACE, and the pixels are gone.
    #
    # REACHING this guard takes a NON-MONOTONIC excursion, and the earlier
    # version of this test never did. The search radius is
    # min(DRIFT_MAX_SHIFT_PX, min(h,w)//4) and the limit is 0.25*min(h,w), so on
    # any frame up to 384 px the two are EQUAL: a monotonic drift past the limit
    # also puts the last frame outside the window, the full-baseline pass finds
    # no match, and the ANCHOR guard declines first. (Mutation-checked: with the
    # old pure-noise fixture, setting _MAX_TOTAL_DRIFT_FRACTION to 1e9 left the
    # test green — it was pinning the anchor guard under this guard's name.)
    #
    # A stage that wanders out and returns anchors on its endpoint while the
    # interior peak runs away, which is the one shape that reaches here.
    n, amp, size = 40, 85, 256
    frames = _stack_along(
        [(0.0, amp * (1 - abs(2 * t / (n - 1) - 1))) for t in range(n)],
        seed=5,
        size=size,
    )
    limit = _MAX_TOTAL_DRIFT_FRACTION * size

    est = estimate_drift_trajectory_detailed(frames)
    peak = max(max(abs(dy), abs(dx)) for dy, dx in est.corrections)
    assert est.anchored, "fixture must reach the LIMIT guard, not the anchor one"
    assert peak > limit, (
        f"fixture no longer exceeds the limit ({peak:.0f} px vs {limit:.0f}) — "
        "the guard below would pass vacuously"
    )

    with _staged({"IRM": frames}) as root:
        raw = _png_bytes(root, n)

        err = io.StringIO()
        with redirect_stderr(err):
            out = correct_drift_in_place(root, ["IRM"], "IRM")
        assert (out["corrected"], out["reason"]) == (False, REASON_OVER_LIMIT)

        # WHICH refusal it was. `is None` alone is satisfied by four different
        # declines, which is exactly how this guard went untested.
        assert f"limit {limit:.0f} px" in err.getvalue(), err.getvalue()
        assert _png_bytes(root, n) == raw, "a refusal must not touch the frames"


def test_a_stack_with_nothing_matchable_is_not_reported_as_still():
    # Every pair refused produces an all-zero trajectory, byte-identical to a
    # stack that genuinely holds still. Both decline to correct — so the ONLY
    # thing separating them is what gets said, and that is what this asserts.
    # (`drift_is_worth_correcting` returns False either way, so a test that
    # only checked the return value would pass with the distinction removed.)
    frames = [np.zeros((128, 128), dtype=np.uint16) for _ in range(12)]
    est = estimate_drift_trajectory_detailed(frames)
    assert est.measured > 0
    assert est.accepted == 0
    assert not est.anchored

    with _staged({"IRM": frames}) as root:
        blank = io.StringIO()
        with redirect_stderr(blank):
            out = correct_drift_in_place(root, ["IRM"], "IRM")
        assert (out["corrected"], out["reason"]) == (False, REASON_UNMATCHABLE)
        # The counts travel with the decline: an all-zero trajectory from a
        # refused stack and one from a still stack are otherwise identical.
        assert out["pairsMeasured"] > 0 and out["pairsAccepted"] == 0
        said = blank.getvalue()

        still = _drifting_stack(12, (0.0, 0.0), seed=7)
        _write_stack(root, {"IRM": still})
        quiet = io.StringIO()
        with redirect_stderr(quiet):
            out = correct_drift_in_place(root, ["IRM"], "IRM")
        assert (out["corrected"], out["reason"]) == (False, REASON_STILL)

    assert "no measurable structure" in said, (
        "a stack nothing could be matched on must say so; it is otherwise "
        f"indistinguishable from one that holds still. Got: {said!r}"
    )
    assert "no measurable structure" not in quiet.getvalue()


def test_the_detailed_estimate_reports_what_it_measured():
    n, per = 60, (0.0, 0.2)
    est = estimate_drift_trajectory_detailed(_drifting_stack(n, per))
    assert est.measured > 0
    assert est.accepted > 0
    assert est.anchored, "the full-baseline pass must have been accepted here"
    # The thin wrapper is exactly this projection, so callers cannot drift.
    assert _corrections(_drifting_stack(n, per)) == est.corrections


def test_the_sidecar_records_how_much_was_measured():
    frames = _drifting_stack(40, (0.0, 0.3), seed=5)
    with _staged({"IRM": frames}) as root:
        side = correct_drift_in_place(root, ["IRM"], "IRM")
    assert side is not None
    assert side["pairsAccepted"] > 0
    assert side["pairsAccepted"] <= side["pairsMeasured"]
    assert side["anchored"] is True


def test_a_missing_channel_png_is_fatal_rather_than_silently_skipped():
    # Skipping would leave that frame's channels in DIFFERENT coordinate
    # spaces while `applied` claims every channel got the shift. Unreachable
    # from the extractors; reachable from any future backfill.
    n = 30
    drive = _drifting_stack(n, (0.0, 0.4), seed=5)
    other = _drifting_stack(n, (0.0, 0.4), seed=6)
    with _staged({"IRM": drive, "TIRF": other}) as root:
        (root / f"{n - 1:04d}" / "TIRF.png").unlink()
        try:
            correct_drift_in_place(root, ["IRM", "TIRF"], "IRM")
        except FileNotFoundError as exc:
            assert "different spaces" in str(exc)
        else:
            raise AssertionError("a missing channel PNG must not be skipped")


def test_an_unreadable_source_channel_declines_instead_of_aborting():
    # Estimation reads and mutates nothing. A failure there must not cost the
    # upload: `extractVideoSafe` deletes the whole destination directory —
    # including the original just moved into it — when the helper exits
    # non-zero.
    frames = _drifting_stack(20, (0.0, 0.4), seed=5)
    with _staged({"IRM": frames}) as root:
        (root / "0005" / "IRM.png").write_bytes(b"not a png")
        err = io.StringIO()
        with redirect_stderr(err):
            out = correct_drift_in_place(root, ["IRM"], "IRM")

        # A CRASH, not a decline -- and the two must not look alike.
        # Asserting only "declined" let a mutant that replaced the whole
        # except body with a silent `return None` pass the ENTIRE suite
        # (mutation-checked 2026-08-30). A rename that broke estimation
        # would then stop drift correction across production, visible only
        # as one warn line per upload.
        assert out["corrected"] is False
        assert out["reason"] == REASON_ESTIMATION_FAILED, out
        assert "UnidentifiedImageError" in out["error"], out
        assert "estimation failed" in err.getvalue()



def test_a_failure_AFTER_the_rewrite_exits_with_the_fatal_code():
    """The pixels have moved; the map has not. That must not read as a decline.

    The rewrite itself is fatal, but everything after it — writing drift.json,
    reading the sidecar, composing, writing it back — runs with the frames
    ALREADY de-drifted. A plain non-zero exit there is indistinguishable from a
    bad-arguments exit, so the caller logs a warning and finalises a container
    whose stored frames and registration map disagree by exactly the drift.

    Provoked by making `registration.json` a DIRECTORY, so the composed sidecar
    cannot be written.
    """
    n = 24
    frames = _drifting_stack(n, (0.0, 0.4), seed=5)
    with _staged({"IRM": frames}, sub="frames") as root:
        (root / "registration.json").mkdir()

        proc = subprocess.run(
            [sys.executable, str(pathlib.Path(HELPERS_DIR) / "correct_drift.py"),
             str(root), "IRM", "IRM"],
            capture_output=True, text=True,
        )

        assert proc.returncode == 4, (
            f"a post-rewrite failure must exit with the FATAL code so the "
            f"upload rolls back, got {proc.returncode}: {proc.stderr}"
        )
        assert "must not be kept" in proc.stderr, proc.stderr
        # And it really had rewritten frames before failing, or this test would
        # be pinning the wrong path.
        assert "rewritten" in proc.stderr or "composed" in proc.stderr, proc.stderr


def _result_json(stdout: str) -> dict:
    """The helper's result object, read the way the real caller reads it.

    ``correct_drift.py`` streams ``PROGRESS <0..1>`` lines while it works, so
    the result is the last line that is NOT one — exactly the rule
    ``pythonExtractor.runHelper`` applies. Parsing the whole of stdout as JSON
    would pass only for as long as the helper stayed silent.
    """
    lines = [
        line.strip()
        for line in stdout.splitlines()
        if line.strip() and not line.startswith("PROGRESS ")
    ]
    assert lines, f"no result JSON in stdout: {stdout!r}"
    return json.loads(lines[-1])


def test_correct_drift_cli_folds_the_shift_into_the_registration_sidecar():
    """End to end through the CLI the backend actually invokes.

    This is the seam the whole feature hangs on: the module can be perfect and
    the pixels still get measured in the wrong place if the sidecar is not
    updated, or is updated after being written. Asserts the composed invariant
    directly — for every (frame, channel), the recorded offset must equal the
    channel's own offset plus that frame's drift.
    """
    n, per = 40, (0.0, 0.3)
    drive = _drifting_stack(n, per, seed=5)
    other = _drifting_stack(n, per, seed=6)
    chan_offset = {"IRM": [0, 0], "TIRF": [3, -2]}

    with _staged({"IRM": drive, "TIRF": other}, sub="frames") as root:
        # A container that already went through channel registration.
        (root / "registration.json").write_text(
            json.dumps(
                {
                    "version": 2,
                    "method": "phase_correlation_gradient_translation",
                    "referenceChannel": "IRM",
                    "channels": ["IRM", "TIRF"],
                    "frames": {
                        str(t): [chan_offset["IRM"], chan_offset["TIRF"]]
                        for t in range(n)
                    },
                }
            )
        )

        proc = subprocess.run(
            [sys.executable, str(pathlib.Path(HELPERS_DIR) / "correct_drift.py"),
             str(root), "IRM", "IRM,TIRF"],
            capture_output=True, text=True,
        )
        assert proc.returncode == 0, proc.stderr
        summary = _result_json(proc.stdout)
        assert summary["corrected"] is True
        assert summary["sourceChannel"] == "IRM"

        drift = json.loads((root / "drift.json").read_text())
        reg = json.loads((root / "registration.json").read_text())

    for t in range(n):
        ddy, ddx = drift["applied"][str(t)]
        assert reg["frames"][str(t)] == [
            [chan_offset["IRM"][0] + ddy, chan_offset["IRM"][1] + ddx],
            [chan_offset["TIRF"][0] + ddy, chan_offset["TIRF"][1] + ddx],
        ], f"frame {t} offset does not carry the drift"


def test_correct_drift_cli_creates_a_sidecar_when_registration_never_ran():
    # A single-channel container has no channel-to-channel offset, so no
    # sidecar exists — but it can still have drifted, and without the map
    # `mtMetricsExporter` samples the untouched original.
    n = 40
    with _staged({"IRM": _drifting_stack(n, (0.0, 0.3), seed=5)}, sub="frames") as root:
        assert not (root / "registration.json").exists()

        proc = subprocess.run(
            [sys.executable, str(pathlib.Path(HELPERS_DIR) / "correct_drift.py"),
             str(root), "IRM", "IRM"],
            capture_output=True, text=True,
        )
        assert proc.returncode == 0, proc.stderr

        reg = json.loads((root / "registration.json").read_text())
        drift = json.loads((root / "drift.json").read_text())

    assert reg["channels"] == ["IRM"]
    for t, (ddy, ddx) in drift["applied"].items():
        assert reg["frames"][t] == [[ddy, ddx]], t


def test_correct_drift_cli_rejects_a_source_channel_it_was_not_given():
    # The caller resolves the driving channel; a typo must fail loudly rather
    # than silently falling back to channel 0, which is the whole reason this
    # is passed in instead of guessed.
    with _staged({"IRM": _drifting_stack(6, (0.0, 0.3))}, sub="frames") as root:
        proc = subprocess.run(
            [sys.executable, str(pathlib.Path(HELPERS_DIR) / "correct_drift.py"),
             str(root), "TIRF", "IRM"],
            capture_output=True, text=True,
        )
    assert proc.returncode == 2
    assert "not among" in proc.stderr



def test_a_trajectory_whose_anchor_was_refused_is_not_applied():
    """Content that moves independently of the stage must not be de-drifted.

    On a motility assay every filament glides at once, so correlating that
    channel measures the gliding and calls it drift. What separates it from a
    genuine drift is the FULL-BASELINE pass: real stage drift leaves frame 0
    and frame N sharing their static structure; gliding does not.

    Observed live on production 2026-08-30 — a stack gliding 2 px/frame got 74
    of 75 pairs accepted and a 97 px "correction", with only this anchor
    refusing. Free on real data: four production stacks carrying genuine drift
    all anchor at 100 % of pairs.
    """
    n = 40
    base = _filament_field(4, 384)
    rng = np.random.RandomState(9)
    frames = []
    for f in range(n):
        # Whole-field motion of 3 px/frame: consecutive pairs match perfectly,
        # but frame 0 and frame 39 are 117 px apart and share nothing.
        img = np.roll(base, f * 3, axis=0)
        frames.append(
            (img * 9000 + rng.normal(4000, 120, base.shape))
            .clip(0, 65535)
            .astype(np.uint16)
        )

    est = estimate_drift_trajectory_detailed(frames)
    assert est.accepted > 0, "fixture must produce accepted pairs"
    assert not est.anchored, "fixture must lose the full-baseline anchor"

    with _staged({"IRM": frames}) as root:
        raw = _png_bytes(root, n)
        err = io.StringIO()
        with redirect_stderr(err):
            out = correct_drift_in_place(root, ["IRM"], "IRM")
        assert (out["corrected"], out["reason"]) == (False, REASON_UNANCHORED)
        after = _png_bytes(root, n)

    assert raw == after, "a refused trajectory must not touch the frames"
    assert "full-baseline pass found no match" in err.getvalue()


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception as exc:  # noqa: BLE001 - report all, exit non-zero
                failures += 1
                print(f"FAIL {name}: {exc}")
    print(f"\n{'OK' if failures == 0 else f'{failures} FAILED'}")
    sys.exit(1 if failures else 0)
