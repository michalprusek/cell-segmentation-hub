"""Segmentation reads IRM, the intensity readout reads TIRF — and never swap.

Reported from the field 2026-07-31: every run since the pipeline existed had
segmented the **TIRF** channel. The checkpoint is trained and validated on IRM,
so TIRF input produced confident centerlines that were simply wrong — and
because the QC overlay was *also* drawn on TIRF, they looked right.

Nothing about that failure is visible in a shape or a dtype: both channels are
(Y, X) uint16 frames of the same well. The only thing that distinguishes them is
which array reaches which function, so that is what these tests assert. They
deliberately test the **wiring in evaluate.main()**, not a helper in isolation —
a helper test would have passed happily throughout the entire regression.

Run with: pytest tests/ (no GPU, no checkpoint, no ND2 file needed).
"""

from __future__ import annotations

import csv
import json
import sys
import types
from pathlib import Path

import numpy as np
import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

import mt_pipeline  # noqa: E402
from mt_pipeline.nd2_io import Position, read_acquisition_time  # noqa: E402

# Constant-valued frames, one distinct value per channel: any mix-up shows up as
# a wrong number rather than as a shape error that a fake could accidentally
# satisfy.
IRM_VALUE, TIRF_VALUE, SOLUTION_VALUE = 11, 22, 33
ACQUIRED_AT = "2026-05-19T21:48:02Z"


def _frame(value: int) -> np.ndarray:
    return np.full((8, 8), value, dtype=np.uint16)


def _position(index: int = 0) -> Position:
    return Position(
        well_id="D03",
        position=index,
        irm=_frame(IRM_VALUE),
        tirf=_frame(TIRF_VALUE),
        solution=_frame(SOLUTION_VALUE),
        px_um=0.0722,
        acquired_at=ACQUIRED_AT,
    )


class _Recorder:
    """Collects the first argument of every call, so tests can assert on it."""

    def __init__(self):
        self.frames: list[np.ndarray] = []
        self.paths: list[Path] = []

    def __call__(self, frame, centerlines, out_path):
        self.frames.append(np.asarray(frame))
        self.paths.append(Path(out_path))

    def values(self) -> list[int]:
        return [int(f.flat[0]) for f in self.frames]


@pytest.fixture
def run_evaluate(tmp_path, monkeypatch):
    """Drive ``evaluate.main()`` end-to-end with every heavy dependency faked.

    Returns a callable taking extra CLI args and giving back the recorded calls.
    Only torch, the checkpoint and the ND2 reader are replaced; the CSV writer
    and the annotation writer are the real ones, because their output is what
    the user actually receives.
    """
    import evaluate

    # `from microtubule import MicrotubuleModel` inside main() would import torch.
    predicted: list[np.ndarray] = []

    class _FakeModel:
        def load_weights(self, weights, device):
            return self

        def predict(self, frame, seed_threshold=0.5):
            predicted.append(np.asarray(frame))
            # A 3-point centerline; measure_frame is faked, so geometry is moot.
            return {"centerlines_rc": [np.array([[1.0, 1.0], [1.0, 4.0],
                                                 [1.0, 6.0]])]}

    monkeypatch.setitem(sys.modules, "microtubule",
                        types.SimpleNamespace(MicrotubuleModel=_FakeModel))
    monkeypatch.setattr(evaluate, "resolve_device", lambda requested: "cpu")
    monkeypatch.setattr(evaluate, "ensure_weights", lambda w: Path(w))

    measured: list[np.ndarray] = []

    def _fake_measure_frame(frame, centerlines, **kw):
        measured.append(np.asarray(frame))
        return [{"mt_id": 1, "length_px": 5.0, "length_um": 0.36,
                 "mt_mean_intensity": 1.0, "n_px_mt": 10, "n_px_bg": 20}]

    overlay = _Recorder()
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    fake_nd2 = data_dir / "WellD03_ChannelIRM_TIRF_488_Seq0000.nd2"
    fake_nd2.touch()

    iter_kwargs: dict = {}

    def _fake_iter_positions(path, **kwargs):
        iter_kwargs.update(kwargs)
        yield _position(0)

    monkeypatch.setattr(mt_pipeline, "find_nd2_files", lambda p: [fake_nd2])
    monkeypatch.setattr(mt_pipeline, "iter_positions", _fake_iter_positions)
    monkeypatch.setattr(mt_pipeline, "measure_frame", _fake_measure_frame)
    monkeypatch.setattr(mt_pipeline, "save_overlay", overlay)

    out_dir = tmp_path / "out"

    def _run(*extra_args: str):
        argv = ["evaluate.py", "--data", str(data_dir), "--out", str(out_dir),
                "--weights", str(tmp_path / "fake.pt"), "--device", "cpu",
                *extra_args]
        monkeypatch.setattr(sys, "argv", argv)
        assert evaluate.main() == 0
        return types.SimpleNamespace(
            predicted=predicted, measured=measured, overlay=overlay,
            out_dir=out_dir, iter_kwargs=iter_kwargs)

    return _run


def test_segmentation_receives_the_irm_channel(run_evaluate):
    """The regression itself: predict() must see IRM, never TIRF."""
    result = run_evaluate()
    assert len(result.predicted) == 1
    assert int(result.predicted[0].flat[0]) == IRM_VALUE


def test_readout_receives_the_tirf_channel(run_evaluate):
    """The other half: intensities are integrated on TIRF, not on IRM."""
    result = run_evaluate()
    assert len(result.measured) == 1
    assert int(result.measured[0].flat[0]) == TIRF_VALUE


def test_channel_name_flags_reach_the_reader(run_evaluate):
    """``--irm-name`` is plumbed through, so a differently-named channel works."""
    result = run_evaluate("--irm-name", "reflect", "--tirf-name", "epi")
    assert result.iter_kwargs["irm_match"] == ("reflect",)
    assert result.iter_kwargs["tirf_match"] == ("epi",)


def test_one_overlay_per_channel(run_evaluate):
    """QC must show both the segmented frame and the measured frame."""
    result = run_evaluate()
    names = sorted(p.name for p in result.overlay.paths)
    assert names == ["D03_pos0_irm.png", "D03_pos0_tirf.png"]
    by_name = dict(zip((p.name for p in result.overlay.paths),
                       result.overlay.values()))
    assert by_name["D03_pos0_irm.png"] == IRM_VALUE
    assert by_name["D03_pos0_tirf.png"] == TIRF_VALUE


def test_results_csv_carries_the_acquisition_timestamp(run_evaluate):
    """A run is identifiable from the CSV alone, without the folder name."""
    result = run_evaluate()
    rows = list(csv.DictReader((result.out_dir / "results.csv").read_text()
                               .splitlines()))
    assert len(rows) == 1
    assert rows[0]["acquired_at"] == ACQUIRED_AT
    assert rows[0]["source_file"] == "WellD03_ChannelIRM_TIRF_488_Seq0000.nd2"


def test_annotation_json_carries_the_acquisition_timestamp(run_evaluate):
    result = run_evaluate()
    payload = json.loads(
        (result.out_dir / "annotations" / "D03_pos0.json").read_text())
    assert payload["acquired_at"] == ACQUIRED_AT


# --- acquisition timestamp ------------------------------------------------

class _FakeTime:
    def __init__(self, jd):
        self.absoluteJulianDayNumber = jd


class _FakeND2:
    """Just enough of nd2.ND2File for read_acquisition_time()."""

    def __init__(self, jd=None, date=None, raise_on_frame=False):
        self._jd = jd
        self._date = date
        self._raise = raise_on_frame

    def frame_metadata(self, index):
        if self._raise:
            raise RuntimeError("no per-frame metadata in this file")
        return types.SimpleNamespace(
            channels=[types.SimpleNamespace(time=_FakeTime(self._jd))])

    @property
    def text_info(self):
        return {"date": self._date} if self._date else {}


def test_julian_day_becomes_iso_utc():
    """Measured against the real file the bug was reported on.

    ``WellD03_ChannelIRM_TIRF_488_Seq0000.nd2`` carries JD 2461180.4083588193
    and a ``text_info`` date of ``5/19/2026  23:48:04`` — the same instant in
    CEST. The Julian day is the one with no timezone or locale in it.
    """
    assert read_acquisition_time(_FakeND2(jd=2461180.4083588193)) == ACQUIRED_AT


def test_falls_back_to_the_raw_date_string_verbatim():
    """``5/19/2026`` is only unambiguous by luck; it is passed through, not parsed."""
    got = read_acquisition_time(
        _FakeND2(date="5/19/2026  23:48:04", raise_on_frame=True))
    assert got == "5/19/2026  23:48:04"


def test_missing_timestamp_is_blank_not_an_error():
    assert read_acquisition_time(_FakeND2(raise_on_frame=True)) is None


# --- channel resolution in iter_positions ---------------------------------

class _FakeND2File(_FakeND2):
    """A whole fake ND2 recording: channel names, pixels, calibration, date."""

    def __init__(self, channel_names, jd=2461180.4083588193):
        super().__init__(jd=jd)
        self.names = channel_names
        # channel i is filled with (i + 1) * 100, so the index each role
        # resolved to is readable straight off the returned array.
        self.data = np.stack([
            np.full((2, 4, 4), (i + 1) * 100, dtype=np.uint16)
            for i in range(len(channel_names))
        ], axis=1)                                  # (P=2, C, Y=4, X=4)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def metadata(self):
        return types.SimpleNamespace(channels=[
            types.SimpleNamespace(channel=types.SimpleNamespace(name=n))
            for n in self.names])

    def voxel_size(self):
        return types.SimpleNamespace(x=0.0722, y=0.0722, z=1.0)

    def asarray(self):
        return self.data


@pytest.fixture
def fake_nd2_reader(monkeypatch):
    def _install(channel_names):
        holder = _FakeND2File(channel_names)
        monkeypatch.setattr(mt_pipeline.nd2_io.nd2, "ND2File",
                            lambda _path: holder)
        return holder

    return _install


def test_iter_positions_maps_real_world_channel_names(fake_nd2_reader,
                                                      tmp_path):
    """``['IRM', 'TIRF 488', '488 InSol']`` — the naming the assay actually uses.

    Worth pinning because ``irm`` and ``tirf`` are matched as substrings and the
    two names share the letters ``irf``; a sloppier match would collapse them.
    """
    fake_nd2_reader(["IRM", "TIRF 488", "488 InSol"])
    positions = list(mt_pipeline.iter_positions(tmp_path / "WellD03_x.nd2"))

    assert len(positions) == 2                      # two fields of view
    p = positions[0]
    assert int(p.irm.flat[0]) == 100                # channel 0
    assert int(p.tirf.flat[0]) == 200               # channel 1
    assert int(p.solution.flat[0]) == 300           # channel 2
    assert p.well_id == "D03"
    assert p.acquired_at == ACQUIRED_AT
    assert p.px_um == pytest.approx(0.0722)


def test_iter_positions_survives_reordered_channels(fake_nd2_reader, tmp_path):
    """Channels are matched by name, so acquisition order must not matter."""
    fake_nd2_reader(["488 InSol", "TIRF 488", "IRM"])
    p = next(iter(mt_pipeline.iter_positions(tmp_path / "WellD03_x.nd2")))
    assert int(p.irm.flat[0]) == 300                # IRM is now channel 2
    assert int(p.tirf.flat[0]) == 200
    assert int(p.solution.flat[0]) == 100


def test_missing_irm_channel_raises_instead_of_substituting(fake_nd2_reader,
                                                            tmp_path):
    """No IRM means no valid segmentation input — fail the well, loudly.

    evaluate.py counts this as a read failure and the essays worker turns a
    non-zero failure count into a partial-run warning. Silently segmenting
    whatever else is present is the behaviour being fixed.
    """
    fake_nd2_reader(["TIRF 488", "488 InSol"])
    with pytest.raises(KeyError, match="irm"):
        list(mt_pipeline.iter_positions(tmp_path / "WellD03_x.nd2"))


def test_overlapping_role_names_warn(fake_nd2_reader, tmp_path, capsys):
    """Pointing both roles at one channel is legal, but never silent."""
    fake_nd2_reader(["TIRF 488", "488 InSol"])
    positions = list(mt_pipeline.iter_positions(tmp_path / "WellD03_x.nd2",
                                                irm_match=("tirf",)))
    assert int(positions[0].irm.flat[0]) == int(positions[0].tirf.flat[0])
    assert "both resolve to channel" in capsys.readouterr().err
