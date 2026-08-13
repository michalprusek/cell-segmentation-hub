"""A transient GPU failure must not silently delete a well from the results.

Reported from the field 2026-08-12: the same folder, re-run a week apart,
produced 255 failed wells one time and 68 the other. Diffing the two result
zips showed the failure sets were *disjoint* — every position that failed in one
run succeeded in the other, and both runs attempted all 720 positions. So the
input was never the problem.

Measured cause (production container, RTX A5000): one 2048x2048 position peaks
at 13.37 GiB reserved against a 14.13 GiB per-process cap
(``ESSAYS_GPU_MEM_FRACTION=0.6`` of a 23.56 GiB card, applied by
``sitecustomize.py``). The card is shared with the interactive ``ml`` service and
with Maptimize, so when a co-tenant spikes, ``model.predict`` raises
``torch.OutOfMemoryError`` — and ``evaluate.main()`` caught it, counted it and
moved on. Failures arrived in contiguous 5-9 minute bursts, which is how a
single co-tenant job cost ~85 wells in one go.

Two things were wrong and both are asserted here:

  * a *recoverable* error permanently dropped a well (no retry), and
  * the reason existed only as a ``[warn]`` line on the worker's stderr, which
    dies with the container — after the 2026-08-11 recreate neither run's
    reasons could be recovered at all.

These tests drive ``evaluate.main()`` rather than the retry helper in isolation:
a helper test would pass while the call site still swallowed the exception.

Run with: pytest tests/ (no GPU, no checkpoint, no ND2 file needed).
"""

from __future__ import annotations

import csv
import gc
import sys
import types
import weakref
from pathlib import Path

import numpy as np
import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

import mt_pipeline  # noqa: E402
from mt_pipeline.nd2_io import Position  # noqa: E402

WELL_ID = "K06"
N_POSITIONS = 3


class _Boom(RuntimeError):
    """Stands in for torch.OutOfMemoryError, which needs no torch to model."""


# evaluate.main() materialises every Position of a file before predicting any of
# them, so a call-order counter cannot identify which position a predict() call
# is for. The index rides on the pixel values instead.
_IRM_BASE = 100


def _position(index: int) -> Position:
    irm = np.full((8, 8), _IRM_BASE + index, dtype=np.uint16)
    other = np.full((8, 8), 11, dtype=np.uint16)
    return Position(well_id=WELL_ID, position=index, irm=irm, tirf=other,
                    solution=other, px_um=0.0722,
                    acquired_at="2026-06-01T20:14:53Z")


@pytest.fixture
def run_evaluate(tmp_path, monkeypatch):
    """Drive ``evaluate.main()`` with a model whose failures the test scripts.

    ``fail_plan`` maps a position index to the number of consecutive attempts
    that must raise before it succeeds; ``inf`` never succeeds. The CSV writers
    are the real ones — what the user receives is the thing under test.
    """
    import evaluate

    slept: list[float] = []
    monkeypatch.setattr(evaluate.time, "sleep", slept.append)

    fail_plan: dict[int, float] = {}
    attempts: dict[int, int] = {}
    read_fails: set[str] = set()
    # Whether the previous attempt's exception was still reachable when the next
    # attempt began — see test_previous_failure_is_released_before_the_retry.
    prev_alive: list[bool] = []
    last_raised: list[object] = []

    class _FakeModel:
        def load_weights(self, weights, device):
            return self

        def predict(self, frame, seed_threshold=0.5):
            idx = int(np.asarray(frame).flat[0]) - _IRM_BASE
            attempts[idx] = attempts.get(idx, 0) + 1
            if last_raised:
                gc.collect()  # tracebacks cycle; refcounting alone won't do
                prev_alive.append(last_raised.pop()() is not None)
            if attempts[idx] <= fail_plan.get(idx, 0):
                exc = _Boom(f"CUDA out of memory. Tried to allocate 3.00 GiB "
                            f"(pos {idx}, attempt {attempts[idx]})")
                last_raised.append(weakref.ref(exc))
                raise exc
            return {"centerlines_rc": [np.array([[1.0, 1.0], [1.0, 4.0]])]}

    monkeypatch.setitem(sys.modules, "microtubule",
                        types.SimpleNamespace(MicrotubuleModel=_FakeModel))
    monkeypatch.setattr(evaluate, "resolve_device", lambda requested: "cpu")
    monkeypatch.setattr(evaluate, "ensure_weights", lambda w: Path(w))

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    nd2 = data_dir / f"Well{WELL_ID}_ChannelIRM_TIRF_488_Seq0141.nd2"
    nd2.touch()

    def _fake_iter_positions(path, **kwargs):
        if Path(path).name in read_fails:
            raise OSError("ND2 header unreadable")
        for i in range(N_POSITIONS):
            yield _position(i)

    monkeypatch.setattr(mt_pipeline, "find_nd2_files", lambda p: [nd2])
    monkeypatch.setattr(mt_pipeline, "iter_positions", _fake_iter_positions)
    monkeypatch.setattr(mt_pipeline, "measure_frame",
                        lambda frame, centerlines, **kw: [
                            {"mt_id": 1, "length_px": 5.0, "n_px_mt": 10}])
    monkeypatch.setattr(mt_pipeline, "save_overlay", lambda *a, **k: None)

    out_dir = tmp_path / "out"

    def _run(plan=None, fail_read=False, *extra_args, capsys=None):
        if plan:
            fail_plan.update(plan)
        if fail_read:
            read_fails.add(nd2.name)
        monkeypatch.setattr(sys, "argv",
                            ["evaluate.py", "--data", str(data_dir),
                             "--out", str(out_dir), "--weights",
                             str(tmp_path / "fake.pt"), "--device", "cpu",
                             "--no-json", *extra_args])
        assert evaluate.main() == 0
        return types.SimpleNamespace(out_dir=out_dir, attempts=attempts,
                                     slept=slept, prev_alive=prev_alive)

    return _run


def _backoff() -> tuple:
    import evaluate
    return evaluate.RETRY_BACKOFF_S


def _rows(path: Path) -> list[dict]:
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


# --------------------------------------------------------------------------
# The headline defect: a transient error must cost a retry, not the well.
# --------------------------------------------------------------------------

def test_transient_failure_is_retried_and_the_well_is_kept(run_evaluate):
    """Position 1 fails twice then succeeds — it must still reach results.csv."""
    result = run_evaluate({1: 2})

    positions = {int(r["position"]) for r in _rows(result.out_dir / "results.csv")}
    assert positions == {0, 1, 2}, "a recoverable position was dropped"
    assert result.attempts[1] == 3, "the failing position was not retried"


def test_a_retried_well_is_not_counted_as_a_failure(run_evaluate, capsys):
    """The [done] count the worker parses must report *final* failures only."""
    run_evaluate({1: 2})
    assert "0 failures" in capsys.readouterr().out


def test_retry_waits_between_attempts(run_evaluate):
    """Backoff, not a tight loop: a co-tenant spike lasts minutes, not ms."""
    result = run_evaluate({1: 2})
    assert result.slept[:2] == list(_backoff()[:2])


def test_previous_failure_is_released_before_the_retry(run_evaluate):
    """Holding the exception across the backoff makes the retry pointless.

    A caught exception owns its ``__traceback__``, which owns every frame of the
    failed call, which owns their locals — for an OOM inside the model that is
    the whole forward pass still resident on the GPU. Keeping a reference to it
    while waiting turns ``empty_cache()`` into a no-op, so the retry meets the
    same wall it was supposed to outlast.

    Measured against the real model on 2026-08-13: a first cut of this retry
    held ``last = e``, and all three positions burned all four attempts even
    though the co-tenant's 3 GiB had been released 40 s earlier — the process's
    own usage never dropped below 14.2 GiB of its 14.13 GiB cap. Only the text
    of the error may outlive the ``except`` block.
    """
    result = run_evaluate({0: 2})

    assert result.attempts[0] == 3
    assert result.prev_alive == [False, False], (
        "a previous attempt's exception was still reachable when the next "
        "attempt started — its traceback pins the GPU tensors the retry needs"
    )


# --------------------------------------------------------------------------
# The reason must survive the run — it used to live only on the worker's stderr.
# --------------------------------------------------------------------------

def test_exhausted_position_is_recorded_in_failures_csv(run_evaluate):
    """A position that never recovers is named, with the reason, in the zip."""
    result = run_evaluate({1: float("inf")})

    rows = _rows(result.out_dir / "failures.csv")
    assert len(rows) == 1
    row = rows[0]
    assert row["well_id"] == WELL_ID
    assert row["position"] == "1"
    assert row["stage"] == "segment"
    assert row["error_type"] == "_Boom"
    assert "out of memory" in row["error_message"]
    assert int(row["attempts"]) == len(_backoff()) + 1
    assert row["source_file"].endswith(".nd2")


def test_unreadable_file_is_recorded_too(run_evaluate):
    """The other failure site: a well whose ND2 cannot be opened at all."""
    result = run_evaluate(fail_read=True)

    rows = _rows(result.out_dir / "failures.csv")
    assert len(rows) == 1
    assert rows[0]["stage"] == "read"
    assert rows[0]["error_type"] == "OSError"
    assert "unreadable" in rows[0]["error_message"]


def test_failures_csv_exists_and_is_empty_on_a_clean_run(run_evaluate):
    """Absence of the file would be ambiguous; a header-only file is a claim."""
    result = run_evaluate()
    assert _rows(result.out_dir / "failures.csv") == []


# --------------------------------------------------------------------------
# A permanently broken GPU must not turn a 20 h job into a week of sleeping.
# --------------------------------------------------------------------------

def test_retry_waiting_is_bounded_across_the_run(run_evaluate, monkeypatch):
    """Once the budget is spent, failures are recorded without further waiting."""
    import evaluate
    monkeypatch.setattr(evaluate, "RETRY_WAIT_BUDGET_S", 1.0)

    result = run_evaluate({i: float("inf") for i in range(N_POSITIONS)})

    assert sum(result.slept) <= evaluate.RETRY_BACKOFF_S[0] + 1.0
    assert len(_rows(result.out_dir / "failures.csv")) == N_POSITIONS
    # The later positions gave up immediately rather than re-paying the backoff.
    assert result.attempts[N_POSITIONS - 1] == 1
