"""The IRM<->TIRF alignment diagnostic: measured, reported, never applied.

WHY THIS IS A DIAGNOSTIC AND NOT A CORRECTION. Measured 2026-08-30 over 180
production wells: the estimator recovers an injected (5, -3) from IRM against
SHIFTED IRM 15/15 times at quality ~7000, and from TIRF against shifted TIRF
15/15 times -- but IRM against shifted TIRF is accepted only 6/15 times, and
every accepted answer is wrong by 1-2 px ((-5,2), (-6,2), (-3,2) where the truth
is (-5,3)), at quality 0.5-2.9. The two channels do not share edges: IRM is
interference contrast off the surface, TIRF is fluorescence from the filaments.

So applying a shift here would reproduce the 2026-08 registration defect -- a
noise peak written into the data -- while the real offset measures 0 or 1 px.
The numbers are recorded instead, so an acquisition that genuinely IS misaligned
becomes visible (reason `ok` with a quality well above 1 and a non-zero offset)
without any run's pixels or intensities changing.

Run with: pytest tests/ (no GPU, no checkpoint, no ND2 file needed).
"""

from __future__ import annotations

import csv
import sys
import types
from pathlib import Path

import numpy as np
import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

import mt_pipeline  # noqa: E402
from mt_pipeline.nd2_io import ChannelAlignment, Position  # noqa: E402
from mt_pipeline.report import COLUMNS  # noqa: E402

IRM_VALUE, TIRF_VALUE, SOLUTION_VALUE = 11, 22, 33
ALIGNMENT_COLUMNS = [
    "irm_tirf_dy", "irm_tirf_dx", "irm_tirf_quality", "irm_tirf_reason",
]


def _frame(value: int) -> np.ndarray:
    return np.full((8, 8), value, dtype=np.uint16)


def _position(alignment: ChannelAlignment | None) -> Position:
    return Position(
        well_id="D03", position=0,
        irm=_frame(IRM_VALUE), tirf=_frame(TIRF_VALUE),
        solution=_frame(SOLUTION_VALUE),
        px_um=0.0722, acquired_at="2026-05-19T21:48:02Z",
        alignment=alignment,
    )


@pytest.fixture
def run_evaluate(tmp_path, monkeypatch):
    """Drive ``evaluate.main()`` with one Position carrying a given alignment."""
    import evaluate

    class _FakeModel:
        def load_weights(self, weights, device):
            return self

        def predict(self, frame, seed_threshold=0.5):
            return {"centerlines_rc": [np.array([[1.0, 1.0], [1.0, 4.0],
                                                 [1.0, 6.0]])]}

    monkeypatch.setitem(sys.modules, "microtubule",
                        types.SimpleNamespace(MicrotubuleModel=_FakeModel))
    monkeypatch.setattr(evaluate, "resolve_device", lambda requested: "cpu")
    monkeypatch.setattr(evaluate, "ensure_weights", lambda w: Path(w))
    monkeypatch.setattr(mt_pipeline, "measure_frame",
                        lambda frame, centerlines, **kw: [
                            {"mt_id": 1, "length_px": 5.0},
                            {"mt_id": 2, "length_px": 6.0},
                        ])
    monkeypatch.setattr(mt_pipeline, "save_overlay", lambda *a, **k: None)

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    fake_nd2 = data_dir / "WellD03_ChannelIRM_TIRF_488_Seq0000.nd2"
    fake_nd2.touch()
    monkeypatch.setattr(mt_pipeline, "find_nd2_files", lambda p: [fake_nd2])
    out_dir = tmp_path / "out"

    def _run(alignment):
        monkeypatch.setattr(mt_pipeline, "iter_positions",
                            lambda path, **kw: iter([_position(alignment)]))
        monkeypatch.setattr(sys, "argv", [
            "evaluate.py", "--data", str(data_dir), "--out", str(out_dir),
            "--weights", str(tmp_path / "fake.pt"), "--device", "cpu",
            "--no-json",
        ])
        assert evaluate.main() == 0
        with open(out_dir / "results.csv", newline="") as fh:
            return list(csv.DictReader(fh))

    return _run


def test_measured_alignment_reaches_results_csv(run_evaluate):
    """The wiring: what the reader measured is what the user receives."""
    rows = run_evaluate(ChannelAlignment(dy=-1, dx=2, quality=1.73, reason="ok"))

    assert len(rows) == 2, "one row per microtubule"
    for row in rows:
        # Per-position value, repeated on every MT row of that position.
        assert row["irm_tirf_dy"] == "-1"
        assert row["irm_tirf_dx"] == "2"
        assert float(row["irm_tirf_quality"]) == pytest.approx(1.73)
        assert row["irm_tirf_reason"] == "ok"


def test_a_refused_alignment_is_reported_as_refused_not_as_zero(run_evaluate):
    """A rejected estimate must not read as `aligned`.

    This is the whole point of carrying `reason`: on production wells the gate
    refuses roughly three quarters of positions, and a bare (0, 0) would be
    indistinguishable from a genuine perfect alignment -- the exact ambiguity
    that let the 2026-08 mis-registrations run unnoticed for months.
    """
    rows = run_evaluate(
        ChannelAlignment(dy=0, dx=0, quality=0.77, reason="implausible_shift"))

    assert rows[0]["irm_tirf_reason"] == "implausible_shift"
    assert float(rows[0]["irm_tirf_quality"]) == pytest.approx(0.77)


def test_a_position_without_a_measurement_leaves_the_cells_blank(run_evaluate):
    """No measurement is not the same as a measurement of zero."""
    rows = run_evaluate(None)

    for column in ALIGNMENT_COLUMNS:
        assert rows[0][column] == "", f"{column} must be blank, not 0"


def test_alignment_columns_are_appended_never_inserted():
    """Downstream scripts index this CSV by column POSITION.

    `report.COLUMNS` says so itself. Inserting the new columns anywhere but the
    end would silently shift every later column in every user's script.
    """
    assert COLUMNS[-4:] == ALIGNMENT_COLUMNS
    assert COLUMNS.index("signal_minus_background") < COLUMNS.index("irm_tirf_dy")


def test_the_estimator_is_the_shared_one_not_a_copy():
    """One implementation of phase correlation, as with the model and metrics.

    A second copy is how `mt_measure` and the model wrapper drifted apart before
    they were unified; the registration estimator must not repeat it.
    """
    from mt_pipeline import nd2_io

    estimator = nd2_io._load_estimator()
    assert estimator is not None, "the shared estimator must be importable"
    assert Path(estimator.__module__ and sys.modules[estimator.__module__].__file__).name \
        == "channel_registration.py"

    stray = [p for p in PKG_ROOT.rglob("channel_registration.py")]
    assert stray == [], f"a local copy of the estimator appeared: {stray}"


def test_measure_alignment_recovers_a_known_shift():
    """The instrument works: an injected offset comes back with its sign flipped.

    Runs on same-channel content, where the estimator is reliable (15/15 on real
    wells). It is the CROSS-channel case that is not, which is why this module
    only ever reports.
    """
    from mt_pipeline.nd2_io import measure_alignment

    rng = np.random.RandomState(4)
    ref = (rng.rand(128, 128) * 500).astype(np.float64)
    for k in range(6):
        y = 15 + k * 18
        ref[y:y + 2, 10:110] += 6000.0

    moved = np.roll(np.roll(ref, 5, axis=0), -3, axis=1)
    got = measure_alignment(ref, moved)

    assert got is not None
    assert got.reason == "ok", got
    assert (got.dy, got.dx) == (-5, 3), got
    assert got.quality > 1.0


def _structured(seed: int, shift=(0, 0)) -> np.ndarray:
    """A frame with edges the correlation can lock onto, optionally translated."""
    rng = np.random.RandomState(seed)
    img = (rng.rand(96, 96) * 400).astype(np.float64)
    for k in range(5):
        y = 12 + k * 16
        img[y:y + 2, 8:88] += 6000.0
    return np.roll(np.roll(img, shift[0], axis=0), shift[1], axis=1).astype(np.uint16)


class _FakeND2WithStructure:
    """An ND2 whose TIRF is its IRM translated by a KNOWN offset."""

    INJECTED = (4, -6)

    def __init__(self):
        irm = _structured(3)
        tirf = _structured(3, self.INJECTED)
        solution = _structured(9)
        self.data = np.stack([irm, tirf, solution])[None]      # (P=1, C=3, Y, X)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def metadata(self):
        return types.SimpleNamespace(channels=[
            types.SimpleNamespace(channel=types.SimpleNamespace(name=n))
            for n in ("IRM", "TIRF 488", "488 InSol")])

    def voxel_size(self):
        return types.SimpleNamespace(x=0.0722, y=0.0722, z=1.0)

    def frame_metadata(self, i):
        raise AttributeError("no timestamp")

    def asarray(self):
        return self.data

    text_info: dict = {}


def test_iter_positions_measures_the_irm_tirf_pair(monkeypatch, tmp_path):
    """The wiring inside the reader, which the faked-reader tests cannot see.

    Every other test in this file replaces `iter_positions` wholesale, so the
    call that actually produces the diagnostic would survive their removal.
    """
    holder = _FakeND2WithStructure()
    monkeypatch.setattr(mt_pipeline.nd2_io.nd2, "ND2File", lambda _p: holder)

    positions = list(mt_pipeline.iter_positions(tmp_path / "WellD03_x.nd2"))

    assert len(positions) == 1
    align = positions[0].alignment
    assert align is not None, "iter_positions must attach the diagnostic"
    assert align.reason == "ok", align
    # The offset that would register TIRF back onto IRM: the injected shift,
    # negated. Getting the PAIR wrong (e.g. measuring IRM vs solution) cannot
    # produce this.
    dy, dx = _FakeND2WithStructure.INJECTED
    assert (align.dy, align.dx) == (-dy, -dx), align


def test_iter_positions_does_not_move_a_single_pixel(monkeypatch, tmp_path):
    """The core promise: measured, never applied.

    If this ever fails, every intensity the assay reports has silently changed
    and no historical run is comparable any more.
    """
    holder = _FakeND2WithStructure()
    monkeypatch.setattr(mt_pipeline.nd2_io.nd2, "ND2File", lambda _p: holder)
    raw = holder.asarray().copy()

    pos = next(iter(mt_pipeline.iter_positions(tmp_path / "WellD03_x.nd2")))

    assert pos.alignment.reason == "ok", "fixture must actually measure a shift"
    assert np.array_equal(pos.irm, raw[0, 0]), "IRM was modified"
    assert np.array_equal(pos.tirf, raw[0, 1]), "TIRF was modified"
    assert np.array_equal(pos.solution, raw[0, 2]), "solution was modified"


def test_measure_alignment_never_raises_into_the_run():
    """A diagnostic must not be able to fail a well.

    The measurement is worth having, but it is worth strictly less than the
    intensities the run exists to produce, so any failure is recorded as a
    reason and the position continues.
    """
    from mt_pipeline import nd2_io

    got = nd2_io.measure_alignment(np.zeros((8, 8)), np.zeros((4, 4)))

    assert got is not None, "a shape mismatch must be reported, not raised"
    assert got.reason != "ok"
    assert (got.dy, got.dx) == (0, 0)
