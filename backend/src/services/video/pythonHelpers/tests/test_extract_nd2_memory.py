"""Memory-bound regression tests for ``extract_nd2._write_frames``.

WHY THIS FILE EXISTS
--------------------
A 2-channel 2048x2048 ND2 time series OOM-killed the backend container against
its 4 GiB cgroup limit after 27 minutes. Nothing in the code materialised the
whole video — the dask path was lazy and ``nd2.ND2File.to_dask()`` chunks one
timepoint per chunk — yet peak RSS still reached ~4 GB. Two things multiplied
out:

1. ``_write_frames`` built a whole ``max(workers*2, 4)``-frame batch list before
   submitting any of it, and the outgoing list stayed alive while the next one
   was built: up to ``4 * workers`` decoded frames at once.
2. every one of the ``workers`` encoder threads could be inside
   ``estimate_translation`` simultaneously, and one such call ran the whole
   phase correlation in full-frame float64/complex128 — a measured **386 MB of
   RSS for a single 2048x2048 frame**, ~48x the 8 MB uint16 plane it aligns.
   Reg-on minus reg-off at ``workers=4`` accounted for 1.45 GB of the peak.

Both are now bounded (see the MEMORY BUDGET note on ``_write_frames``); the
workspace itself was also tightened to exactly 6 full-frame float64 planes
(290 MB RSS at 2048²) without touching the arithmetic. These
tests pin the two bounds STRUCTURALLY — by counting live frame objects and
concurrent registrations — rather than by asserting a megabyte number, so they
fail deterministically on any host instead of flaking on allocator behaviour.
The one RSS test that does look at bytes asserts T-INDEPENDENCE, which is the
property a whole-stack regression breaks by construction.

Pure numpy + stdlib — no pytest / dask needed, so it runs in the backend
container with a plain interpreter:

  docker exec spheroseg-backend python3 \
    backend/src/services/video/pythonHelpers/tests/test_extract_nd2_memory.py

It is also pytest-collectable (``test_*`` functions).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import weakref
from pathlib import Path

import numpy as np

HERE = os.path.dirname(__file__)
HELPERS_DIR = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HELPERS_DIR)

import extract_nd2  # noqa: E402
from extract_nd2 import (  # noqa: E402
    _registration_workers,
    _write_frames,
)


def _frame(t: int, c_count: int, y: int, x: int) -> np.ndarray:
    """One synthetic ``(C, Y, X)`` timepoint with real edges (so phase
    correlation locks on) that still PNG-compresses fast."""
    rng = np.random.default_rng(1000 + t)
    small = rng.integers(2000, 60000, size=(max(1, y // 32), max(1, x // 32)),
                         dtype=np.uint16)
    base = np.kron(small, np.ones((32, 32), dtype=np.uint16))[:y, :x]
    planes = [base] + [
        np.roll(base, (3 * c, -5 * c), axis=(0, 1)) for c in range(1, c_count)
    ]
    return np.stack(planes, axis=0)


class LazyStack:
    """Minimal stand-in for the lazy ``(T, C, Y, X)`` array ``_write_frames``
    consumes — a dask array in production, but the only thing the function uses
    is ``.shape`` and ``arr[t]``.

    Every frame it hands out is a FRESH ndarray registered in ``self._live``, so
    the test can ask "how many decoded frames were alive at the same time?".
    Using a fake rather than a real dask array keeps the bound test free of a
    dask dependency and makes the count exact: nothing but ``_write_frames``
    holds a reference.
    """

    def __init__(self, T: int, C: int, Y: int, X: int):
        self.shape = (T, C, Y, X)
        self._live: list[weakref.ref] = []
        self.max_live = 0
        self.reads = 0

    def __getitem__(self, t: int) -> np.ndarray:
        arr = _frame(t, self.shape[1], self.shape[2], self.shape[3])
        # Prune dead refs first so the count reflects frames still in memory.
        self._live = [r for r in self._live if r() is not None]
        self._live.append(weakref.ref(arr))
        self.max_live = max(self.max_live, len(self._live))
        self.reads += 1
        return arr


def _run(T, C=2, Y=128, X=128, workers=2, register=False):
    """Drive ``_write_frames`` over a ``LazyStack``; return the stack."""
    stack = LazyStack(T, C, Y, X)
    dest = Path(tempfile.mkdtemp(prefix="nd2mem_"))
    prev = os.environ.get("ND2_EXTRACT_WORKERS")
    os.environ["ND2_EXTRACT_WORKERS"] = str(workers)
    try:
        offsets = _write_frames(
            stack, dest / "frames", [f"ch{c}" for c in range(C)],
            register=register,
        )
        assert len(offsets) == T, f"expected {T} offset rows, got {len(offsets)}"
        assert stack.reads == T, f"expected {T} frame reads, got {stack.reads}"
    finally:
        if prev is None:
            os.environ.pop("ND2_EXTRACT_WORKERS", None)
        else:
            os.environ["ND2_EXTRACT_WORKERS"] = prev
        shutil.rmtree(dest, ignore_errors=True)
    return stack


# --------------------------------------------------------------------------
# Bound 1: decoded frames in flight.


def test_frames_in_flight_bounded_by_workers():
    """At most ``workers`` frames are materialised at once (+1 slack for the
    window between a task finishing and the executor dropping its work item).

    This is the assertion the pre-fix code failed: it kept ``max(workers*2, 4)``
    frames per batch and up to two batches during the hand-over, i.e. 16 frames
    at ``workers=2`` — five times this bound.
    """
    workers = 2
    stack = _run(T=40, workers=workers)
    assert stack.max_live <= workers + 1, (
        f"{stack.max_live} frames were alive at once with workers={workers}; "
        f"the budget is {workers + 1}. Something re-introduced batched "
        f"materialisation."
    )


def test_frames_in_flight_does_not_scale_with_T():
    """The bound must be a constant, not a fraction of the video length.

    A whole-stack materialisation (``np.asarray(arr)`` / ``f.asarray()``) or a
    batch sized from ``T`` would make the long run's count grow; a constant
    number of frames in flight makes the two runs agree exactly.
    """
    short = _run(T=8, workers=2)
    long = _run(T=200, workers=2)
    assert long.max_live == short.max_live, (
        f"frames in flight grew with T: {short.max_live} at T=8 vs "
        f"{long.max_live} at T=200 — peak memory is no longer T-independent."
    )


def test_single_worker_holds_at_most_two_frames():
    """Degenerate but load-bearing: a 1-worker extract must not need a batch."""
    stack = _run(T=25, workers=1)
    assert stack.max_live <= 2, stack.max_live


# --------------------------------------------------------------------------
# Bound 2: concurrent registration workspaces.


def test_concurrent_registrations_are_capped():
    """No more than ``_registration_workers(workers)`` estimates run at once.

    One 2048x2048 estimate needs ~290 MB of float64/complex128 workspace, so
    this cap — not the frame buffers — is what keeps the extract inside a 4 GiB
    container on a many-core host. PNG encoding still uses all ``workers``
    threads; only the FFT-heavy estimate is gated.
    """
    workers = 6
    cap = _registration_workers(workers)
    assert cap < workers, "test is vacuous unless the cap actually binds"

    real = extract_nd2.estimate_translation
    lock = threading.Lock()
    state = {"now": 0, "max": 0}

    def counting(ref, mov):
        with lock:
            state["now"] += 1
            state["max"] = max(state["max"], state["now"])
        try:
            return real(ref, mov)
        finally:
            with lock:
                state["now"] -= 1

    extract_nd2.estimate_translation = counting
    try:
        _run(T=30, C=2, Y=128, X=128, workers=workers, register=True)
    finally:
        extract_nd2.estimate_translation = real

    assert state["max"] > 0, "registration never ran — test would be vacuous"
    assert state["max"] <= cap, (
        f"{state['max']} registrations ran concurrently with workers={workers}; "
        f"the cap is {cap}. Peak memory now scales with the host's core count."
    )


def test_registration_workers_defaults_and_env():
    """The cap defaults to 2, never exceeds the pool, and honours the override
    (clamped to the pool, so an override can't outrun the thread count)."""
    prev = os.environ.pop("ND2_REGISTER_WORKERS", None)
    try:
        assert _registration_workers(1) == 1
        assert _registration_workers(2) == 2
        assert _registration_workers(4) == 2
        assert _registration_workers(32) == 2

        os.environ["ND2_REGISTER_WORKERS"] = "3"
        assert _registration_workers(8) == 3
        assert _registration_workers(2) == 2  # clamped down to the pool

        os.environ["ND2_REGISTER_WORKERS"] = "not-a-number"
        assert _registration_workers(4) == 2  # bad value → default
    finally:
        os.environ.pop("ND2_REGISTER_WORKERS", None)
        if prev is not None:
            os.environ["ND2_REGISTER_WORKERS"] = prev


# --------------------------------------------------------------------------
# Bound 3: measured peak RSS is T-independent.

# Child driver: reports its own high-water RSS for one _write_frames run. It
# runs out-of-process because ru_maxrss is a per-process high-water mark that
# never comes back down — one process can only measure one configuration.
_CHILD = textwrap.dedent(
    """
    import os, resource, shutil, sys, tempfile
    from pathlib import Path
    sys.path.insert(0, {helpers!r})
    import numpy as np
    from extract_nd2 import _write_frames

    T, C, Y, X = int(sys.argv[1]), 2, 512, 512
    os.environ["ND2_EXTRACT_WORKERS"] = "4"

    def frame(t):
        rng = np.random.default_rng(1000 + t)
        s = rng.integers(2000, 60000, (Y // 32, X // 32), dtype=np.uint16)
        a = np.kron(s, np.ones((32, 32), dtype=np.uint16))
        return np.stack([a, np.roll(a, (3, -5), axis=(0, 1))], axis=0)

    class Lazy:
        shape = (T, C, Y, X)
        def __getitem__(self, t):
            return frame(t)

    def maxrss():
        v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return v if sys.platform == "darwin" else v * 1024  # bytes vs kB

    dest = Path(tempfile.mkdtemp(prefix="nd2rss_"))
    try:
        before = maxrss()
        _write_frames(Lazy(), dest / "frames", ["a", "b"], register=False)
        print(maxrss() - before)
    finally:
        shutil.rmtree(dest, ignore_errors=True)
    """
)


def _child_peak(T: int) -> int:
    out = subprocess.run(
        [sys.executable, "-c", _CHILD.format(helpers=HELPERS_DIR), str(T)],
        capture_output=True, text=True, check=True,
    )
    return int(out.stdout.strip().splitlines()[-1])


def test_peak_rss_does_not_scale_with_T():
    """Peak RSS for a 4x-longer video must not grow by anything like the frames
    that video adds.

    Frame here is 512x512x2ch uint16 = 1 MiB, so T=48 -> T=192 adds 144 MiB of
    frame data. Holding the stack (or a batch sized from T) shows up as a
    proportional jump; a constant number of frames in flight shows up as
    allocator drift, which is far smaller. The threshold is a quarter of the
    added frame bytes: comfortably above the observed drift (a few MiB) and
    comfortably below any regression that starts retaining frames.
    """
    frame_bytes = 2 * 512 * 512 * 2
    small, big = 48, 192
    peak_small = _child_peak(small)
    peak_big = _child_peak(big)
    added = (big - small) * frame_bytes
    growth = peak_big - peak_small
    assert growth < added // 4, (
        f"peak RSS grew {growth / 2**20:.1f} MiB going from T={small} to "
        f"T={big}, which adds {added / 2**20:.1f} MiB of frame data. Peak "
        f"memory is tracking the video length again."
    )
    # And the absolute peak stays far below the whole stack, for either length.
    assert peak_big < big * frame_bytes // 2, (
        f"peak RSS {peak_big / 2**20:.1f} MiB is more than half the "
        f"{big * frame_bytes / 2**20:.1f} MiB the full stack would take."
    )


# --------------------------------------------------------------------------
# The registration workspace itself.


def test_hann_window_is_cached_and_immutable():
    """The Hann window is a pure function of the frame shape, so it is built
    once per shape instead of once per (frame, channel) — a full-frame float64
    array (32 MB at 2048x2048) that used to be allocated on every estimate.
    It is shared across encoder threads, hence read-only."""
    from channel_registration import _hann2d

    a = _hann2d((64, 96))
    b = _hann2d((64, 96))
    assert a is b, "Hann window is no longer cached — one 32 MB alloc per call"
    assert not a.flags.writeable, "shared window must not be mutable"
    assert np.array_equal(a, np.outer(np.hanning(64), np.hanning(96)))


def test_estimate_translation_does_not_mutate_inputs():
    """The in-place buffer reuse inside ``estimate_translation_detailed`` must
    stay confined to its own temporaries — the caller's frames (and, for
    channel 0, the reference plane reused across channels) are read-only to it.
    """
    from channel_registration import estimate_translation_detailed

    ref = _frame(3, 2, 128, 128)[0]
    mov = np.roll(ref, (4, -2), axis=(0, 1))
    ref_copy, mov_copy = ref.copy(), mov.copy()
    est = estimate_translation_detailed(ref, mov)
    assert (est.dy, est.dx) == (-4, 2), est
    assert np.array_equal(ref, ref_copy), "reference frame was mutated"
    assert np.array_equal(mov, mov_copy), "moving frame was mutated"


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
