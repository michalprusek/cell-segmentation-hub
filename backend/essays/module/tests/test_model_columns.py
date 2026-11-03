"""results.csv says which model and which decoder drew each row.

The batch follows the interactive model (the owner's rule, 2026-11-03), so one series of
folders can span two models whose counts and lengths are not comparable, and a position
past the L+H arc limit takes another decoder. A log line would not do: it dies with the
container, and the table is what travels with the result.
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
from mt_pipeline.nd2_io import Position  # noqa: E402
from mt_pipeline.report import COLUMNS  # noqa: E402


def _position(index: int) -> Position:
    frame = np.full((8, 8), 11, dtype=np.uint16)
    return Position(well_id="D03", position=index, irm=frame, tirf=frame, solution=frame,
                    px_um=0.0722, acquired_at="2026-05-19T21:48:02Z", alignment=None)


@pytest.fixture
def run_evaluate(tmp_path, monkeypatch):
    """Drive ``evaluate.main()`` over positions whose predictions name the given decoders."""
    import evaluate

    def _run(decoders: list[str]):
        replies = iter(decoders)

        class _FakeModel:
            def load_weights(self, weights, device):
                return self

            def predict(self, frame, seed_threshold=None):
                return {"centerlines_rc": [np.array([[1.0, 1.0], [1.0, 4.0], [1.0, 6.0]])],
                        "decoder": next(replies)}

        monkeypatch.setitem(sys.modules, "microtubule",
                            types.SimpleNamespace(MicrotubuleModel=_FakeModel))
        monkeypatch.setattr(evaluate, "resolve_device", lambda requested: "cpu")
        monkeypatch.setattr(evaluate, "ensure_weights", lambda w: Path(w))
        monkeypatch.setattr(mt_pipeline, "measure_frame",
                            lambda frame, centerlines, **kw: [{"mt_id": 1, "length_px": 5.0}])
        monkeypatch.setattr(mt_pipeline, "save_overlay", lambda *a, **k: None)
        data_dir = tmp_path / "data"
        data_dir.mkdir(exist_ok=True)
        fake_nd2 = data_dir / "WellD03_ChannelIRM_TIRF_488_Seq0000.nd2"
        fake_nd2.touch()
        monkeypatch.setattr(mt_pipeline, "find_nd2_files", lambda p: [fake_nd2])
        monkeypatch.setattr(mt_pipeline, "iter_positions",
                            lambda path, **kw: iter(_position(i) for i in range(len(decoders))))
        out_dir = tmp_path / "out"
        monkeypatch.setattr(sys, "argv", [
            "evaluate.py", "--data", str(data_dir), "--out", str(out_dir),
            "--weights", str(tmp_path / "microtubule_v16_deb_s4_ep040.pth"),
            "--device", "cpu", "--no-json",
        ])
        assert evaluate.main() == 0
        with open(out_dir / "results.csv", newline="") as fh:
            return list(csv.DictReader(fh))

    return _run


def test_every_row_names_its_model_and_decoder(run_evaluate):
    rows = run_evaluate(["lh"])
    assert rows[0]["segmentation_model"] == "microtubule_v16_deb_s4_ep040"
    assert rows[0]["decoder"] == "lh"


def test_a_position_past_the_arc_limit_is_marked_and_counted(run_evaluate, capsys):
    rows = run_evaluate(["lh", "instance_a_fallback", "lh"])
    assert [r["decoder"] for r in rows] == ["lh", "instance_a_fallback", "lh"]
    assert "[done] decoder per position: 1 instance_a_fallback, 2 lh" in capsys.readouterr().out


def test_model_columns_are_appended_never_inserted():
    """Downstream scripts index this CSV by column POSITION."""
    assert COLUMNS[-2:] == ["segmentation_model", "decoder"]
    assert COLUMNS[30] == "segmentation_source_file"
