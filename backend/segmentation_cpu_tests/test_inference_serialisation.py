"""`/segment` must not hold the event loop hostage, and must not run two
inferences at once.

Both halves matter and they pull against each other, which is why they are
tested together.

The event loop half: `segment_image` is `async def`, so while its predict ran
inline the whole worker stopped — GET /health included. That was tolerable at
150 s on a 6657x6664 frame and stopped being tolerable when a 498 Mpx frame
started completing in 22 minutes instead of running out of memory (#535).
Measured on production 2026-09-10: 359 and 335 `Exceeded concurrency limit` in
single minutes, and a container marked unhealthy, while one frame ran.

The serialisation half: hopping to a threadpool without a lock is worse than
the stall. The queue worker dispatches up to four concurrent /segment calls, so
real concurrency would sum GPU peaks instead of maxing them, on a card shared
with the essays worker and Maptimize.

These import the REAL `api.routes`, so a change to the dispatch is what these
tests see — not a copy of it living here.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
import threading
import time
import types
from pathlib import Path

import pytest

_SEG = Path(__file__).resolve().parents[1] / 'segmentation'

# CI installs no torch (see requirements-pytest-ci.txt) and this suite needs
# none of it, but `routes` reads `torch.cuda.is_available()` and the
# `ml.inference_executor` it imports annotates `torch.cuda.Stream`. So: use the
# real torch wherever there is one — stubbing over it would test a fiction —
# and stand in only where the import genuinely fails.
try:  # pragma: no cover - depends on the environment, not the code
    import torch  # noqa: F401
except ImportError:  # pragma: no cover
    _torch = types.ModuleType('torch')
    _torch.cuda = types.SimpleNamespace(
        is_available=lambda: False,
        Stream=object,
        current_stream=lambda *a, **k: None,
    )
    _torch.Tensor = object
    sys.modules['torch'] = _torch

sys.path.insert(0, str(_SEG))
routes = importlib.import_module('api.routes')


class _StubLoader:
    """Stands in for ModelLoader, recording overlap rather than segmenting."""

    def __init__(self, duration: float = 0.4):
        self.duration = duration
        self.concurrent = 0
        self.max_concurrent = 0
        self._guard = threading.Lock()

    def _work(self):
        with self._guard:
            self.concurrent += 1
            self.max_concurrent = max(self.max_concurrent, self.concurrent)
        try:
            time.sleep(self.duration)
        finally:
            with self._guard:
                self.concurrent -= 1
        return {'polygons': [], 'polylines': []}

    # every branch of the dispatch funnels into the same recorder
    def predict(self, *a, **k):
        return self._work()

    def predict_microtubule(self, *a, **k):
        return self._work()

    def predict_neurite_soma(self, *a, **k):
        return self._work()

    def predict_batch(self, *a, **k):
        return [self._work()]


def test_executor_has_exactly_one_slot():
    # The slot count IS the serialisation for work that goes through it; a
    # second worker would let two frames onto the card together.
    assert routes._INFERENCE_EXECUTOR._max_workers == 1


def test_dispatch_completes_and_does_not_deadlock():
    # `_dispatch_inference` takes `_inference_lock`, and the branches inside it
    # must NOT take it again: `threading.Lock` is not reentrant, so a second
    # acquisition would hang here forever rather than fail.
    loader = _StubLoader(duration=0.01)
    result = routes._dispatch_inference(loader, 'microtubule', None, 0.5, True)
    assert result == {'polygons': [], 'polylines': []}
    assert not routes._inference_lock.locked()


def test_the_event_loop_keeps_running_during_inference():
    """The reported failure, as a test.

    A coroutine scheduled beside the inference must actually get to run. If the
    predict were called inline on the loop — the state before this change — the
    ticker below could not advance at all, because the loop would be inside the
    predict.
    """
    loader = _StubLoader(duration=0.4)

    async def scenario():
        loop = asyncio.get_running_loop()
        inference = loop.run_in_executor(
            routes._INFERENCE_EXECUTOR,
            routes._dispatch_inference,
            loader,
            'neurite_soma',
            None,
            0.5,
            True,
        )
        ticks = 0
        while not inference.done():
            await asyncio.sleep(0.01)
            ticks += 1
        await inference
        return ticks

    ticks = asyncio.run(scenario())
    # 0.4 s of inference against a 10 ms tick. Asserting a low bound rather
    # than a count keeps this off wall-clock precision under CI load.
    assert ticks >= 5, f'event loop advanced only {ticks} times during inference'


def test_two_inferences_never_overlap():
    """Single frames and batches share one executor and one lock."""
    loader = _StubLoader(duration=0.2)

    async def scenario():
        loop = asyncio.get_running_loop()
        await asyncio.gather(
            loop.run_in_executor(
                routes._INFERENCE_EXECUTOR,
                routes._dispatch_inference,
                loader, 'microtubule', None, 0.5, True,
            ),
            loop.run_in_executor(
                routes._INFERENCE_EXECUTOR,
                routes._dispatch_batch_inference,
                loader, [None], 'hrnet', 1, 0.5, True,
            ),
            loop.run_in_executor(
                routes._INFERENCE_EXECUTOR,
                routes._dispatch_inference,
                loader, 'neurite_soma', None, 0.5, True,
            ),
        )

    asyncio.run(scenario())
    assert loader.max_concurrent == 1, (
        f'{loader.max_concurrent} inferences ran at once; GPU peaks would sum'
    )


def test_frap_shares_the_same_lock_object():
    # `/frap/targets` is a plain `def`, so Starlette runs it on its own
    # threadpool — beside the event loop and beside the executor. A second lock
    # object there would serialise nothing.
    frap = importlib.import_module('api.frap_targets')
    assert frap._inference_lock is routes._inference_lock


def test_a_frap_style_caller_cannot_overlap_the_executor():
    """The case the LOCK exists for, which the executor's single slot cannot
    cover on its own.

    `/frap/targets` is a plain `def`, so Starlette runs it on its own 40-slot
    threadpool — not the event loop and not `_INFERENCE_EXECUTOR`. Work arriving
    from there is only kept off the card by `_inference_lock`, so this starts an
    inference the way frap does (a bare thread taking that lock) while the
    executor is busy.

    Without the lock the executor still serialises its OWN queue and every other
    test here still passes, which is exactly why this one is separate.
    """
    loader = _StubLoader(duration=0.25)

    def frap_style():
        # mirrors api/frap_targets.py: take the shared lock, then predict
        with routes._inference_lock:
            loader.predict_microtubule(None)

    async def scenario():
        loop = asyncio.get_running_loop()
        inference = loop.run_in_executor(
            routes._INFERENCE_EXECUTOR,
            routes._dispatch_inference,
            loader, 'neurite_soma', None, 0.5, True,
        )
        await asyncio.sleep(0.05)  # let the executor take the lock first
        thread = threading.Thread(target=frap_style)
        thread.start()
        await inference
        await loop.run_in_executor(None, thread.join)

    asyncio.run(scenario())
    assert loader.max_concurrent == 1, (
        f'{loader.max_concurrent} inferences ran at once; a frap request and a '
        'queued segmentation would put two working sets on the card'
    )


def test_frap_waits_for_the_lock_with_a_bound():
    """`/frap/targets` must not block forever on the shared lock.

    Since the lock went loader-wide this route can queue behind any model,
    including a neurite frame that runs for 22 minutes. Its caller is a person
    at a microscope who writes the response into a one-line `frap_status.txt`,
    so an nginx timeout mid-wait gives them an empty line and no instruction.
    """
    frap = importlib.import_module('api.frap_targets')

    assert frap._LOCK_WAIT_SECONDS > 0
    # Long enough for the models it realistically queues behind (a 1024^2
    # neurite frame is ~2 min), short enough not to outlast the operator.
    assert 30.0 <= frap._LOCK_WAIT_SECONDS <= 600.0

    # The bound only exists if the acquisition is the timed form. A plain
    # `with _inference_lock:` waits forever, which is what this replaced.
    source = Path(frap.__file__).read_text(encoding='utf-8')
    assert 'with _inference_lock:' not in source, (
        'frap acquires the shared lock without a timeout'
    )
    assert '_inference_lock.acquire(timeout=' in source


def test_frap_releases_the_lock_when_inference_raises():
    """A predict that throws must not strand the lock for every other route."""
    frap = importlib.import_module('api.frap_targets')
    source = Path(frap.__file__).read_text(encoding='utf-8')
    acquire_at = source.index('_inference_lock.acquire(timeout=')
    tail = source[acquire_at:acquire_at + 600]
    assert 'finally:' in tail and '_inference_lock.release()' in tail, (
        'the release is not on a finally, so a raising predict would keep it'
    )
