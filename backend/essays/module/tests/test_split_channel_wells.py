"""A well recorded as one file PER CHANNEL, with a TIRF time series.

Reported from the field 2026-10-06: a 330-file folder produced 330 failures
and an empty results.csv. Its wells were three files each -

    WellD04_ChannelIRM_Seq0000.nd2          (P=4,      Y, X)
    WellD04_ChannelTIRF_488_Seq0001.nd2     (P=4, T=5, Y, X)
    WellD04_Channel488_InSol_Seq0002.nd2    (P=4,      Y, X)

- and every file was read as a whole well that lacked "the other" channels.

What can go wrong here is all about WHICH pixels meet WHICH: the centerlines
come from one file and are laid over another, so a mix-up of files, positions
or frames produces plausible numbers from the wrong place. Every fake frame
therefore carries a value that encodes its file, position and frame, and the
tests read that value back.

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
from mt_pipeline import nd2_io  # noqa: E402
from mt_pipeline.nd2_io import (Position, WellSource, group_wells,  # noqa: E402
                                iter_positions)

IRM, TIRF, SOL = "IRM", "TIRF 488", "488 InSol"
#: Stage XY of the four fields of a well, in microns. Real values, from the
#: first folder recorded this way.
FIELDS = [(34433.8, -19540.0), (33116.6, -19752.5),
          (33798.5, -20317.1), (33810.6, -21055.5)]


def _value(base: int, position: int, frame: int = 0) -> int:
    """A pixel value that says where it came from: file, position, frame."""
    return base + 100 * position + frame


class FakeND2:
    """Enough of ``nd2.ND2File`` for the reader, with real axis semantics."""

    def __init__(self, channels, *, base, positions=4, frames=1, size=6,
                 stage=FIELDS, extra_axis=None):
        self.channel_names = list(channels)
        self._stage = list(stage)[:positions]
        self._positions, self._frames = positions, frames
        self._axes = (["P"] + (["T"] if frames > 1 else [])
                      + (["C"] if len(channels) > 1 else [])
                      + ([extra_axis] if extra_axis else []) + ["Y", "X"])
        shape = {"P": positions, "T": frames, "C": len(channels),
                 "Y": size, "X": size, extra_axis: 3}
        self.data = np.zeros([shape[a] for a in self._axes], dtype=np.uint16)
        for p in range(positions):
            for t in range(frames):
                for c in range(len(channels)):
                    index = tuple({"P": p, "T": t, "C": c, extra_axis: slice(None),
                                   "Y": slice(None), "X": slice(None)}[a]
                                  for a in self._axes)
                    # Channel c of a multi-channel file sits 10 000 apart.
                    self.data[index] = _value(base + 10_000 * c, p, t)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def sizes(self):
        return dict(zip(self._axes, self.data.shape))

    @property
    def metadata(self):
        return types.SimpleNamespace(channels=[
            types.SimpleNamespace(channel=types.SimpleNamespace(name=n))
            for n in self.channel_names])

    def voxel_size(self):
        return types.SimpleNamespace(x=0.0722, y=0.0722, z=1.0)

    @property
    def experiment(self):
        points = [types.SimpleNamespace(
            stagePositionUm=types.SimpleNamespace(x=x, y=y))
            for x, y in self._stage]
        loop = type("XYPosLoop", (), {})()
        loop.parameters = types.SimpleNamespace(points=points)
        return [loop]

    @property
    def attributes(self):
        return types.SimpleNamespace(
            sequenceCount=self._positions * self._frames)

    def frame_metadata(self, index):
        # 0.2 s between the frames of a position, 4 s between positions.
        position, frame = divmod(index, self._frames)
        seconds = 4.0 * position + 0.2 * frame
        return types.SimpleNamespace(channels=[types.SimpleNamespace(
            time=types.SimpleNamespace(
                absoluteJulianDayNumber=2461180.0 + seconds / 86400.0))])

    @property
    def text_info(self):
        return {}

    def asarray(self):
        return self.data


@pytest.fixture
def folder(monkeypatch):
    """A fake folder: ``add(name, FakeND2)`` then read it through the module."""
    files: dict[str, FakeND2] = {}
    opened: list[str] = []

    def _open(path):
        name = Path(path).name
        opened.append(name)
        return files[name]

    monkeypatch.setattr(nd2_io.nd2, "ND2File", _open)
    # The two diagnostics have their own suites; here they would only add
    # noise (and a real phase correlation over 6x6 constant frames).
    monkeypatch.setattr(nd2_io, "measure_alignment", lambda a, b: None)
    monkeypatch.setattr(nd2_io, "judge_focus", lambda *a, **k: None)

    def add(name, fake):
        files[name] = fake
        return Path("/data") / name

    return types.SimpleNamespace(add=add, opened=opened, files=files)


def _split_well(folder, well="D04", seq=0, *, tirf_frames=5, **overrides):
    """The three files of one well in the per-channel layout."""
    spec = {"irm": {}, "tirf": {"frames": tirf_frames}, "sol": {}}
    for role, extra in overrides.items():
        spec[role].update(extra)
    return [
        folder.add(f"Well{well}_ChannelIRM_Seq{seq:04d}.nd2",
                   FakeND2([IRM], base=1000, **spec["irm"])),
        folder.add(f"Well{well}_ChannelTIRF_488_Seq{seq + 1:04d}.nd2",
                   FakeND2([TIRF], base=2000, **spec["tirf"])),
        folder.add(f"Well{well}_Channel488_InSol_Seq{seq + 2:04d}.nd2",
                   FakeND2([SOL], base=3000, **spec["sol"])),
    ]


# --------------------------------------------------------------------------
# Grouping: which files are one well
# --------------------------------------------------------------------------

def test_a_well_on_one_file_is_not_even_opened(folder):
    """Every folder recorded before 2026-10 must take exactly its old path."""
    files = [folder.add(f"Well{w}_ChannelIRM_TIRF_488_Seq{i:04d}.nd2",
                        FakeND2([IRM, SOL, TIRF], base=1000))
             for i, w in enumerate(("D03", "D04", "E11"))]

    wells = group_wells(files)

    assert [w.files for w in wells] == [(f,) for f in files]
    assert [w.well_id for w in wells] == ["D03", "D04", "E11"]
    assert folder.opened == []


def test_three_per_channel_files_become_one_well(folder):
    d04, d05 = _split_well(folder, "D04", 0), _split_well(folder, "D05", 3)

    wells = group_wells(sorted(d04 + d05))

    assert [w.well_id for w in wells] == ["D04", "D05"]
    assert all(w.problem is None for w in wells)
    assert set(wells[0].files) == set(d04) and set(wells[1].files) == set(d05)


def test_the_same_well_recorded_twice_stays_two_wells(folder):
    """Two COMPLETE files that share a well name are two recordings."""
    first = folder.add("WellD04_ChannelIRM_TIRF_488_Seq0000.nd2",
                       FakeND2([IRM, SOL, TIRF], base=1000))
    second = folder.add("WellD04_ChannelIRM_TIRF_488_Seq0009.nd2",
                        FakeND2([IRM, SOL, TIRF], base=1000))

    wells = group_wells([first, second])

    assert [w.files for w in wells] == [(first,), (second,)]


def test_two_channels_in_one_file_and_the_third_in_another(folder):
    """The roles need not be one per file - only one file per role."""
    pair = folder.add("WellD04_ChannelIRM_TIRF_488_Seq0000.nd2",
                      FakeND2([IRM, TIRF], base=1000))
    solution = folder.add("WellD04_Channel488_InSol_Seq0001.nd2",
                          FakeND2([SOL], base=3000))

    (well,) = group_wells([pair, solution])
    position = next(iter_positions(well))

    assert well.problem is None and set(well.files) == {pair, solution}
    assert int(position.irm.flat[0]) == _value(1000, 0)
    assert int(position.tirf.flat[0]) == _value(11_000, 0)   # channel 1
    assert int(position.solution.flat[0]) == _value(3000, 0)


def test_two_files_for_one_role_is_refused_not_guessed(folder):
    files = _split_well(folder)
    files.append(folder.add("WellD04_ChannelIRM_Seq0007.nd2",
                            FakeND2([IRM], base=9000)))

    (well,) = group_wells(files)

    assert "2 files with a IRM channel" in well.problem
    assert "WellD04_ChannelIRM_Seq0000.nd2" in well.problem
    assert "WellD04_ChannelIRM_Seq0007.nd2" in well.problem
    # It fails where wells fail, with that message - not silently, not here.
    with pytest.raises(ValueError, match="2 files with a IRM channel"):
        list(iter_positions(well))


def test_a_missing_role_is_named(folder):
    irm, tirf, _solution = _split_well(folder)

    (well,) = group_wells([irm, tirf])

    assert "no file with a solution channel" in well.problem


def test_the_role_names_are_the_ones_the_run_was_given(folder):
    """``--irm-name`` and friends decide what counts as each role."""
    files = [folder.add("WellD04_a.nd2", FakeND2(["Reflection"], base=1000)),
             folder.add("WellD04_b.nd2", FakeND2(["GFP"], base=2000)),
             folder.add("WellD04_c.nd2", FakeND2(["Dye"], base=3000))]

    assert group_wells(files)[0].problem is not None
    (well,) = group_wells(files, irm_match=("reflection",),
                          tirf_match=("gfp",), solution_match=("dye",))
    assert well.problem is None


# --------------------------------------------------------------------------
# Reading: which pixels meet which
# --------------------------------------------------------------------------

def test_each_role_is_read_from_its_own_file_at_the_same_position(folder):
    (well,) = group_wells(_split_well(folder))

    positions = list(iter_positions(well))

    assert [p.position for p in positions] == [0, 1, 2, 3]
    for p in positions:
        assert int(p.irm.flat[0]) == _value(1000, p.position)
        assert int(p.tirf.flat[0]) == _value(2000, p.position)
        assert int(p.solution.flat[0]) == _value(3000, p.position)
        assert p.well_id == "D04"
        assert p.irm_file == "WellD04_ChannelIRM_Seq0000.nd2"
        assert p.tirf_file == "WellD04_ChannelTIRF_488_Seq0001.nd2"
        assert p.solution_file == "WellD04_Channel488_InSol_Seq0002.nd2"


def test_every_tirf_frame_of_a_position_is_handed_on_in_order(folder):
    (well,) = group_wells(_split_well(folder, tirf_frames=5))

    positions = list(iter_positions(well))

    for p in positions:
        assert p.tirf_frames.shape == (5, 6, 6)
        assert [int(f.flat[0]) for f in p.tirf_frames] == [
            _value(2000, p.position, t) for t in range(5)]
        # `tirf` - what the diagnostics see - is frame 0, not a blend.
        assert np.array_equal(p.tirf, p.tirf_frames[0])
        assert p.tirf_times_s == (0.0, 0.2, 0.4, 0.6, 0.8)


def test_a_single_tirf_frame_is_one_frame_and_no_stack(folder):
    (well,) = group_wells(_split_well(folder, tirf_frames=1))

    position = next(iter_positions(well))

    assert position.tirf_stack is None
    assert position.tirf_frames.shape == (1, 6, 6)
    assert position.tirf_times_s == (0.0,)


def test_a_bare_path_still_reads_a_single_file_well(folder):
    path = folder.add("WellD03_ChannelIRM_TIRF_488_Seq0000.nd2",
                      FakeND2([IRM, SOL, TIRF], base=1000, positions=3))

    positions = list(iter_positions(path))

    assert len(positions) == 3
    assert int(positions[2].irm.flat[0]) == _value(1000, 2)
    assert int(positions[2].solution.flat[0]) == _value(11_000, 2)
    assert int(positions[2].tirf.flat[0]) == _value(21_000, 2)
    assert positions[0].irm_file == positions[0].tirf_file == path.name


def test_files_with_different_position_counts_are_refused(folder):
    (well,) = group_wells(_split_well(folder, tirf={"positions": 3}))

    with pytest.raises(ValueError, match="has 3 position.*has 4"):
        list(iter_positions(well))


def test_files_showing_different_fields_are_refused(folder):
    """Same count, same order, different PLACES: never pair those."""
    elsewhere = [FIELDS[0], (FIELDS[1][0] + 250.0, FIELDS[1][1])] + FIELDS[2:]
    (well,) = group_wells(_split_well(folder, tirf={"stage": elsewhere}))

    with pytest.raises(ValueError, match="position 1 .*do not show the same"):
        list(iter_positions(well))


def test_a_stage_that_returned_within_a_micron_is_the_same_field(folder):
    nudged = [(x + 0.4, y - 0.3) for x, y in FIELDS]
    (well,) = group_wells(_split_well(folder, tirf={"stage": nudged}))

    assert len(list(iter_positions(well))) == 4


def test_tirf_frames_of_another_size_are_refused(folder):
    (well,) = group_wells(_split_well(folder, tirf={"size": 8}))

    with pytest.raises(ValueError, match="8x8 px.*6x6 px"):
        list(iter_positions(well))


def test_solution_frames_of_another_size_are_refused_too(folder):
    """Only a median is read from it - but it is another acquisition's median."""
    (well,) = group_wells(_split_well(folder, sol={"size": 8}))

    with pytest.raises(ValueError, match="InSol.*8x8 px.*6x6 px"):
        list(iter_positions(well))


def test_a_shorter_list_of_stage_positions_is_refused(folder):
    """Four images but three recorded stage points: `zip` would compare three
    and wave the fourth through."""
    files = _split_well(folder)
    tirf = folder.files["WellD04_ChannelTIRF_488_Seq0001.nd2"]
    tirf._stage = tirf._stage[:3]              # the pixels still hold 4 fields

    (well,) = group_wells(files)

    with pytest.raises(ValueError, match="lists 3 stage position.*lists 4"):
        list(iter_positions(well))


def test_an_unknown_axis_is_refused_by_name(folder):
    path = folder.add("WellD03_ChannelIRM_TIRF_488_Seq0000.nd2",
                      FakeND2([IRM, SOL, TIRF], base=1000, extra_axis="Z"))

    with pytest.raises(ValueError, match=r"unsupported ND2 axes \['Z'\]"):
        list(iter_positions(path))


def test_a_time_series_in_irm_uses_the_first_frame_and_says_so(folder, capsys):
    (well,) = group_wells(_split_well(folder, irm={"frames": 3}))

    position = next(iter_positions(well))

    assert int(position.irm.flat[0]) == _value(1000, 0, 0)
    assert "IRM channel has 3 frames per position" in capsys.readouterr().err


# --------------------------------------------------------------------------
# The run: one segmentation, one row per microtubule per TIRF frame
# --------------------------------------------------------------------------

WELL = "D04"


@pytest.fixture
def run_evaluate(tmp_path, monkeypatch):
    """Drive ``evaluate.main()`` over fake positions; the writers are real."""
    import evaluate

    segmented: list[int] = []
    measured: list[int] = []

    class _FakeModel:
        def load_weights(self, weights, device):
            return self

        def predict(self, frame, seed_threshold=0.5):
            segmented.append(int(np.asarray(frame).flat[0]))
            return {"centerlines_rc": [np.array([[1.0, 1.0], [1.0, 4.0]]),
                                       np.array([[3.0, 1.0], [3.0, 4.0]])]}

    monkeypatch.setitem(sys.modules, "microtubule",
                        types.SimpleNamespace(MicrotubuleModel=_FakeModel))
    monkeypatch.setattr(evaluate, "resolve_device", lambda requested: "cpu")
    monkeypatch.setattr(evaluate, "ensure_weights", lambda w: Path(w))

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    nd2_path = data_dir / f"Well{WELL}_ChannelIRM_Seq0000.nd2"
    nd2_path.touch()

    def _measure(frame, centerlines, **kw):
        value = int(np.asarray(frame).flat[0])
        measured.append(value)
        # The measured value IS the frame's marker, so a row says which
        # frame it was read from.
        return [{"mt_id": i + 1, "length_px": 3.0, "length_um": 0.2166,
                 "mt_mean_intensity": value}
                for i in range(len(centerlines))]

    monkeypatch.setattr(mt_pipeline, "find_nd2_files", lambda p: [nd2_path])
    monkeypatch.setattr(mt_pipeline, "measure_frame", _measure)
    monkeypatch.setattr(mt_pipeline, "save_overlay", lambda *a, **k: None)

    out_dir = tmp_path / "out"

    def _run(positions):
        monkeypatch.setattr(mt_pipeline, "iter_positions",
                            lambda source, **kw: iter(positions))
        monkeypatch.setattr(sys, "argv", [
            "evaluate.py", "--data", str(data_dir), "--out", str(out_dir),
            "--weights", str(tmp_path / "fake.pt"), "--device", "cpu"])
        assert evaluate.main() == 0
        with open(out_dir / "results.csv", newline="") as fh:
            rows = list(csv.DictReader(fh))
        return types.SimpleNamespace(rows=rows, segmented=segmented,
                                     measured=measured, out_dir=out_dir)

    return _run


def _frame(value: int) -> np.ndarray:
    return np.full((6, 6), value, dtype=np.uint16)


def _position(index, *, frames):
    stack = np.stack([_frame(_value(2000, index, t)) for t in range(frames)])
    return Position(
        well_id=WELL, position=index, irm=_frame(_value(1000, index)),
        tirf=stack[0], solution=_frame(_value(3000, index)), px_um=0.0722,
        acquired_at="2026-10-02T16:45:58Z",
        tirf_stack=stack if frames > 1 else None,
        tirf_times_s=tuple(round(0.2 * t, 3) for t in range(frames)),
        irm_file=f"Well{WELL}_ChannelIRM_Seq0000.nd2",
        tirf_file=f"Well{WELL}_ChannelTIRF_488_Seq0001.nd2",
        solution_file=f"Well{WELL}_Channel488_InSol_Seq0002.nd2")


def test_each_position_is_segmented_once_and_measured_on_every_frame(run_evaluate):
    run = run_evaluate([_position(0, frames=3), _position(1, frames=3)])

    # IRM, once per position - not once per TIRF frame.
    assert run.segmented == [_value(1000, 0), _value(1000, 1)]
    # Every TIRF frame, in order, and nothing else.
    assert run.measured == [_value(2000, p, t) for p in (0, 1) for t in range(3)]


def test_a_microtubule_has_one_row_per_tirf_frame(run_evaluate):
    run = run_evaluate([_position(0, frames=3)])

    assert len(run.rows) == 2 * 3                       # 2 MTs x 3 frames
    for row in run.rows:
        frame = int(row["tirf_frame"])
        # The row's intensity came from the frame the row says it did.
        assert int(row["mt_mean_intensity"]) == _value(2000, 0, frame)
        assert row["tirf_frames"] == "3"
        assert float(row["tirf_frame_time_s"]) == pytest.approx(0.2 * frame)
        assert row["source_file"] == f"Well{WELL}_ChannelTIRF_488_Seq0001.nd2"
        assert row["segmentation_source_file"] == (
            f"Well{WELL}_ChannelIRM_Seq0000.nd2")
        # Per-position values repeat across the frames.
        assert float(row["solution_intensity_median"]) == _value(3000, 0)
    assert sorted((r["mt_id"], r["tirf_frame"]) for r in run.rows) == sorted(
        (str(m), str(t)) for m in (1, 2) for t in range(3))


def test_frame_zero_rows_are_the_old_one_row_per_microtubule_table(run_evaluate):
    run = run_evaluate([_position(0, frames=3)])

    first = [r for r in run.rows if r["tirf_frame"] == "0"]

    assert [r["mt_id"] for r in first] == ["1", "2"]


def test_a_plain_recording_still_has_one_row_per_microtubule(run_evaluate):
    run = run_evaluate([_position(0, frames=1)])

    assert len(run.rows) == 2
    assert {(r["tirf_frame"], r["tirf_frames"]) for r in run.rows} == {("0", "1")}


def test_the_run_counts_microtubules_not_rows(run_evaluate, capsys):
    """The job runner sums the ``N MT`` of every ``[ok]`` line as mtCount."""
    run_evaluate([_position(0, frames=5), _position(1, frames=5)])

    out = capsys.readouterr().out
    assert f"{WELL}_pos0: 2 MT" in out and f"{WELL}_pos1: 2 MT" in out
    assert "2 positions, 4 microtubules, 0 failures" in out


def test_the_annotation_lists_each_microtubule_once(run_evaluate):
    import json

    run = run_evaluate([_position(0, frames=5)])

    payload = json.loads(
        (run.out_dir / "annotations" / f"{WELL}_pos0.json").read_text())
    assert payload["num_microtubules"] == 2
    assert [p["mt_id"] for p in payload["polylines"]] == [1, 2]
    assert payload["source_file"] == f"Well{WELL}_ChannelIRM_Seq0000.nd2"


def test_an_unassemblable_well_is_recorded_as_a_failed_well(tmp_path, monkeypatch,
                                                           folder):
    """Through the real reader: the message reaches failures.csv."""
    import evaluate

    files = _split_well(folder)
    files.append(folder.add("WellD04_ChannelIRM_Seq0007.nd2",
                            FakeND2([IRM], base=9000)))
    monkeypatch.setitem(sys.modules, "microtubule", types.SimpleNamespace(
        MicrotubuleModel=type("M", (), {
            "load_weights": lambda self, w, d: self})))
    monkeypatch.setattr(evaluate, "resolve_device", lambda requested: "cpu")
    monkeypatch.setattr(evaluate, "ensure_weights", lambda w: Path(w))
    # If the well were ever read after all, the model below has no `predict`
    # and the run would sit out the real retry back-off (30 + 120 + 300 s per
    # position). The test must fail at once instead - it did not, the first
    # time a mutation removed the refusal.
    monkeypatch.setattr(evaluate.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(mt_pipeline, "find_nd2_files", lambda p: sorted(files))
    out_dir = tmp_path / "out"
    monkeypatch.setattr(sys, "argv", [
        "evaluate.py", "--data", "/data", "--out", str(out_dir),
        "--weights", str(tmp_path / "fake.pt"), "--device", "cpu"])

    assert evaluate.main() == 0

    with open(out_dir / "failures.csv", newline="") as fh:
        (failure,) = list(csv.DictReader(fh))
    assert failure["well_id"] == "D04" and failure["stage"] == "read"
    assert "2 files with a IRM channel" in failure["error_message"]
    # All four files are named, so none of them has silently gone missing.
    assert failure["source_file"].count(".nd2") == 4
