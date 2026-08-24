"""Unit tests for ``channel_registration.py``.

Translation-only multimodal channel registration: pin the contract that a
refactor could silently break — shift recovery (sign + magnitude), the
lossless integer shift, the confidence/plausibility guards that keep a
low-signal frame from injecting jitter, and the single-channel no-op.

Pure numpy — no pytest / scipy / skimage dependency, so it runs in the backend
container with a plain interpreter:

  docker exec spheroseg-backend python3 \
    backend/src/services/video/pythonHelpers/tests/test_channel_registration.py

It is also pytest-collectable (``test_*`` functions).
"""
from __future__ import annotations

import os
import sys

import numpy as np

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

from channel_registration import (  # noqa: E402
    _MAX_SHIFT_FRACTION,
    _MIN_CONFIDENCE,
    estimate_translation,
    estimate_translation_detailed,
    shift_frame,
    register_stack_to_first_channel,
    write_registration_sidecar,
)


def _synthetic_frame(seed: int = 0) -> np.ndarray:
    """A 128x128 frame with sparse bright filament-like structure + noise —
    enough edges for phase correlation to lock onto, like a real MT frame."""
    rng = np.random.RandomState(seed)
    img = rng.rand(128, 128).astype(np.float64) * 500.0  # background noise
    # a few bright diagonal streaks (microtubule-ish)
    for k in range(6):
        y = 15 + k * 18
        for x in range(10, 110):
            yy = y + (x - 60) // 8
            if 0 <= yy < 128:
                img[yy, x] += 6000.0
    return img


def _grad_ncc(a: np.ndarray, b: np.ndarray) -> float:
    def g(x):
        gy, gx = np.gradient(x)
        m = np.hypot(gx, gy)
        return m - m.mean()
    ga, gb = g(a), g(b)
    return float((ga * gb).sum() / (np.sqrt((ga * ga).sum() * (gb * gb).sum()) + 1e-12))


def test_recovers_known_shift_exactly():
    ref = _synthetic_frame()
    for dy0, dx0 in [(6, -4), (-9, 3), (0, 5), (11, 0)]:
        moving = shift_frame(ref, dy0, dx0)
        dy, dx, conf = estimate_translation(ref, moving)
        # estimate must be the *inverse* offset that re-aligns moving onto ref
        assert (dy, dx) == (-dy0, -dx0), f"got ({dy},{dx}) for shift ({dy0},{dx0})"
        assert conf > 3.0


def test_applying_estimate_realigns():
    ref = _synthetic_frame(1)
    moving = shift_frame(ref, 7, -5)
    dy, dx, _ = estimate_translation(ref, moving)
    registered = shift_frame(moving, dy, dx)
    m = 14  # ignore zero-filled borders
    assert _grad_ncc(ref[m:-m, m:-m], registered[m:-m, m:-m]) > 0.98


def test_shift_frame_is_lossless_on_overlap():
    # Every retained pixel keeps its EXACT value (integer shift, no interp).
    arr = (np.arange(64 * 64, dtype=np.uint16)).reshape(64, 64)
    out = shift_frame(arr, 3, -2)
    # the interior that came from real data must match the source exactly
    assert np.array_equal(out[3:64, 0:62], arr[0:61, 2:64])
    # vacated border is zero-filled
    assert (out[0:3, :] == 0).all()
    assert (out[:, 62:64] == 0).all()


def test_zero_shift_is_identity():
    arr = _synthetic_frame(2).astype(np.uint16)
    assert np.array_equal(shift_frame(arr, 0, 0), arr)


def test_rejects_implausibly_large_shift():
    # Two unrelated random frames → no real common structure; any peak found
    # must be rejected (implausible / low confidence) rather than applied.
    a = np.random.RandomState(3).rand(128, 128) * 1000
    b = np.random.RandomState(99).rand(128, 128) * 1000
    dy, dx, _ = estimate_translation(a, b)
    assert (dy, dx) == (0, 0)


def test_low_signal_frame_falls_back_to_zero():
    ref = _synthetic_frame(4)
    flat = np.full_like(ref, 200.0)  # dark/flat channel: no edges to match
    dy, dx, conf = estimate_translation(ref, flat)
    assert (dy, dx) == (0, 0)


def test_multimodal_contrast_inversion():
    # Different-modality proxy: invert the contrast + rescale. Edges coincide,
    # intensities don't — gradient-based correlation must still find the shift.
    ref = _synthetic_frame(5)
    other = (ref.max() - ref) * 0.3 + 50.0  # inverted, different dynamic range
    moving = shift_frame(other, 5, -6)
    dy, dx, conf = estimate_translation(ref, moving)
    assert (dy, dx) == (-5, 6), f"got ({dy},{dx})"
    assert conf > 3.0


def test_register_stack_first_channel_is_reference():
    ref = _synthetic_frame(6)
    c1 = shift_frame(ref, 4, -3)
    c2 = shift_frame(ref, -6, 2)
    frames = [[ref, c1, c2]]  # one frame, three channels
    registered, offsets = register_stack_to_first_channel(frames)
    # channel 0 never moves
    assert offsets[0][0] == (0, 0)
    assert np.array_equal(registered[0][0], ref)
    # the other channels get the inverse of their injected shift
    assert offsets[0][1] == (-4, 3)
    assert offsets[0][2] == (6, -2)


def test_single_channel_passthrough():
    f = _synthetic_frame(7)
    registered, offsets = register_stack_to_first_channel([[f]])
    assert offsets == [[(0, 0)]]
    assert np.array_equal(registered[0][0], f)


def test_sidecar_roundtrip():
    import json
    import tempfile

    d = tempfile.mkdtemp()
    offsets = {0: [[0, 0], [3, -2]], 1: [[0, 0], [4, -1]]}
    write_registration_sidecar(d, ["c0", "c1"], offsets)
    data = json.loads((__import__("pathlib").Path(d) / "registration.json").read_text())
    assert data["referenceChannel"] == "c0"
    assert data["channels"] == ["c0", "c1"]
    assert data["frames"]["0"] == [[0, 0], [3, -2]]
    assert data["frames"]["1"] == [[0, 0], [4, -1]]


def test_sidecar_noop_for_single_channel():
    import tempfile
    from pathlib import Path as _P

    d = tempfile.mkdtemp()
    write_registration_sidecar(d, ["only"], {0: [[0, 0]]})
    assert not (_P(d) / "registration.json").exists()


# ---------------------------------------------------------------------------
# Outcome reasons. estimate_translation returns (0, 0, conf) for two opposite
# outcomes — a genuine zero shift and a peak rejected as implausible — so the
# 3-tuple alone cannot separate a success from a silent failure. The detailed
# variant names the branch that produced the shift.
# ---------------------------------------------------------------------------


def test_detailed_reports_ok_for_an_applied_shift():
    ref = _synthetic_frame(10)
    est = estimate_translation_detailed(ref, shift_frame(ref, 7, -4))
    assert (est.dy, est.dx) == (-7, 4)
    assert est.reason == "ok"
    assert est.confidence >= _MIN_CONFIDENCE
    # On an accepted estimate the raw peak IS the applied shift.
    assert (est.peak_dy, est.peak_dx) == (est.dy, est.dx)


def test_detailed_reports_ok_for_a_genuine_zero_shift():
    # Already aligned: a zero shift that is a SUCCESS, not a rejection.
    ref = _synthetic_frame(11)
    est = estimate_translation_detailed(ref, ref.copy())
    assert (est.dy, est.dx) == (0, 0)
    assert est.reason == "ok"
    assert est.confidence >= _MIN_CONFIDENCE


def test_detailed_reports_implausible_shift_with_high_confidence():
    # A real, sharply-correlating offset that merely exceeds the plausibility
    # cap. Zero shift + high confidence — byte-for-byte the same 3-tuple as
    # "already aligned" above, which is why the reason has to exist.
    ref = _synthetic_frame(12)
    true_dy = int(_MAX_SHIFT_FRACTION * min(ref.shape)) + 20
    est = estimate_translation_detailed(ref, shift_frame(ref, true_dy, 0))
    assert (est.dy, est.dx) == (0, 0)
    assert est.reason == "implausible_shift"
    assert est.confidence >= _MIN_CONFIDENCE
    # The discarded candidate survives so a caller can report WHAT was refused.
    assert (est.peak_dy, est.peak_dx) == (-true_dy, 0)


def test_detailed_reports_low_confidence_on_a_flat_frame():
    ref = _synthetic_frame(13)
    flat = np.full_like(ref, 200.0)
    est = estimate_translation_detailed(ref, flat)
    assert (est.dy, est.dx) == (0, 0)
    assert est.reason == "low_confidence"
    assert est.confidence < _MIN_CONFIDENCE


def test_implausible_beats_low_confidence_when_both_would_fire():
    # Branch ORDER is part of the contract: the plausibility guard runs first,
    # so an estimate that is both far-out AND weak reports implausible_shift.
    # Two unrelated scenes whose peak lands outside the cap.
    a = np.random.RandomState(3).rand(128, 128) * 1000
    b = np.random.RandomState(99).rand(128, 128) * 1000
    est = estimate_translation_detailed(a, b)
    assert (est.dy, est.dx) == (0, 0)
    if abs(est.peak_dy) > _MAX_SHIFT_FRACTION * 128 or abs(
        est.peak_dx
    ) > _MAX_SHIFT_FRACTION * 128:
        assert est.reason == "implausible_shift", (est.reason, est.confidence)
    else:
        assert est.reason == "low_confidence", (est.reason, est.confidence)


def test_wrapper_returns_exactly_the_detailed_numbers():
    # estimate_translation is a thin projection of the detailed result, so the
    # shifts every existing caller sees cannot drift from the reported ones.
    ref = _synthetic_frame(14)
    for dy0, dx0 in [(6, -4), (0, 0), (40, 0)]:
        mov = shift_frame(ref, dy0, dx0)
        triple = estimate_translation(ref, mov)
        est = estimate_translation_detailed(ref, mov)
        assert triple == (est.dy, est.dx, est.confidence)
        assert repr(triple[2]) == repr(est.confidence)


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
