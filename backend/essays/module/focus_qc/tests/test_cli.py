"""Tests for the command-line layer.

These exist because every silent-wrong-result path found in review lived here:
a cache trusted without provenance, thresholds keyed so two channels collide,
and an output file truncated before the error that prevents writing it.
"""
import argparse
import csv
import json

import numpy as np
import pytest

from focus_qc import cli
from focus_qc.detect import ChannelSpec
from focus_qc.metrics import FrameStats


def _spec(channels=(("IRM", "irm"), ("TIRF 488", "fluor")), stacks=("/a.nd2",)):
    return {
        "z_step_um": 0.1,
        "channels": [ChannelSpec(n, m) for n, m in channels],
        "stacks": [{"path": p, "sharp_plane": 21} for p in stacks],
    }


def _scores(spec, n=41):
    """Plausible per-plane stats: a peak at the sharp plane for every channel."""
    out = {}
    for stack in spec["stacks"]:
        per = {}
        for channel in spec["channels"]:
            per[channel.name] = [
                FrameStats(score=100.0 / (1 + abs(z - 20) ** 2), sharpness=2.0,
                           noise_sigma=25.0, background=16500.0)
                for z in range(n)
            ]
        out[stack["path"]] = per
    return out


class TestCacheProvenance:
    """A cache is only reusable if it was produced by this spec and this descriptor."""

    def _write(self, path, spec):
        cli._write_cache(path, spec, _scores(spec))

    def test_reuses_a_cache_written_for_the_same_spec(self, tmp_path):
        spec = _spec()
        cache = tmp_path / "c.json"
        self._write(cache, spec)
        assert set(cli._score_all(spec, cache)) == {"/a.nd2"}

    def test_refuses_a_cache_written_with_different_channel_modalities(self, tmp_path):
        """Swapping modalities re-keys correct scores onto the wrong polarity."""
        cache = tmp_path / "c.json"
        self._write(cache, _spec())
        swapped = _spec(channels=(("IRM", "fluor"), ("TIRF 488", "irm")))
        with pytest.raises(ValueError, match="cache"):
            cli._score_all(swapped, cache)

    def test_refuses_a_cache_written_for_a_different_stack_list(self, tmp_path):
        cache = tmp_path / "c.json"
        self._write(cache, _spec())
        with pytest.raises(ValueError, match="cache"):
            cli._score_all(_spec(stacks=("/b.nd2",)), cache)

    def test_refuses_a_cache_written_by_a_different_descriptor(self, tmp_path):
        """Changing K_SIGMA or BG_SIZE invalidates every cached score."""
        cache = tmp_path / "c.json"
        spec = _spec()
        self._write(cache, spec)
        raw = json.loads(cache.read_text())
        raw["fingerprint"]["descriptor"]["K_SIGMA"] = 2.0
        cache.write_text(json.dumps(raw))
        with pytest.raises(ValueError, match="descriptor"):
            cli._score_all(spec, cache)

    def test_the_error_says_how_to_recover(self, tmp_path):
        cache = tmp_path / "c.json"
        self._write(cache, _spec())
        with pytest.raises(ValueError, match="delete"):
            cli._score_all(_spec(stacks=("/b.nd2",)), cache)


class TestCacheIsValidJson:
    """`json.dumps` writes the bare token `NaN` by default, which is not JSON.

    `cmd_calibrate` already passes `allow_nan=False` for calibration.json for
    that reason; the cache used to skip it, and `sharpness` is NaN on any plane
    with fewer than MIN_STRUCTURE_PX structure pixels -- 144 of the 410 entries
    in the committed reference cache. A cache only Python can read is a cache no
    other tool can check.
    """

    def _strict(self, text):
        """json.loads that refuses NaN/Infinity, the way every other parser does."""
        def refuse(token):
            raise ValueError(f"not valid JSON: bare {token}")
        return json.loads(text, parse_constant=refuse)

    def _spec_with_nan(self):
        spec = _spec()
        scores = _scores(spec)
        for per_channel in scores.values():
            for stats in per_channel.values():
                stats[0] = FrameStats(score=stats[0].score, sharpness=float("nan"),
                                      noise_sigma=25.0, background=16500.0)
        return spec, scores

    def test_a_cache_holding_nan_is_still_parseable_json(self, tmp_path):
        spec, scores = self._spec_with_nan()
        cache = tmp_path / "c.json"
        cli._write_cache(cache, spec, scores)

        parsed = self._strict(cache.read_text())

        assert parsed["scores"]["/a.nd2"]["IRM"][0]["sharpness"] is None

    def test_a_null_sharpness_reads_back_as_not_a_number(self, tmp_path):
        """`null` must not become `None` in a FrameStats -- "declined to measure"
        is NaN everywhere else in this package, and None would compare wrong."""
        spec, scores = self._spec_with_nan()
        cache = tmp_path / "c.json"
        cli._write_cache(cache, spec, scores)

        back = cli._score_all(spec, cache)

        assert np.isnan(back["/a.nd2"]["IRM"][0].sharpness)
        assert back["/a.nd2"]["IRM"][1].sharpness == 2.0

    def test_a_cache_written_before_this_fix_still_loads(self, tmp_path):
        """The committed reference cache carries bare `NaN`; Python reads it."""
        spec = _spec()
        cache = tmp_path / "c.json"
        cli._write_cache(cache, spec, _scores(spec))
        raw = json.loads(cache.read_text())
        raw["scores"]["/a.nd2"]["IRM"][0]["sharpness"] = float("nan")
        cache.write_text(json.dumps(raw))          # allow_nan default: bare NaN

        back = cli._score_all(spec, cache)

        assert np.isnan(back["/a.nd2"]["IRM"][0].sharpness)


class TestCalibrateNeedsTwoStacks:
    def test_refuses_a_single_stack_with_a_readable_message(self, tmp_path, capsys):
        """Leave-one-out is undefined with one stack; `_fit` would otherwise die
        in np.concatenate([]) AFTER the expensive scoring pass."""
        dataset = tmp_path / "spec.json"
        dataset.write_text(json.dumps({
            "z_step_um": 0.1,
            "channels": [{"name": "IRM", "modality": "irm"}],
            "stacks": [{"path": "/a.nd2", "sharp_plane": 21}],
        }))
        args = argparse.Namespace(dataset=str(dataset), out=str(tmp_path / "c.json"),
                                  report=None, cache=None, tolerance_um=0.3,
                                  guard_um=0.1, notes="")

        assert cli.cmd_calibrate(args) == 2
        assert "at least 2" in capsys.readouterr().err

    def test_does_not_score_anything_before_refusing(self, tmp_path, monkeypatch):
        """The scoring pass is the expensive part; the refusal must precede it."""
        dataset = tmp_path / "spec.json"
        dataset.write_text(json.dumps({
            "z_step_um": 0.1,
            "channels": [{"name": "IRM", "modality": "irm"}],
            "stacks": [{"path": "/a.nd2", "sharp_plane": 21}],
        }))
        monkeypatch.setattr(cli, "_score_all", lambda *a, **k: pytest.fail(
            "scored the stack before refusing"))
        args = argparse.Namespace(dataset=str(dataset), out=str(tmp_path / "c.json"),
                                  report=None, cache=None, tolerance_um=0.3,
                                  guard_um=0.1, notes="")

        assert cli.cmd_calibrate(args) == 2


class TestUnscoreableScoreIsBlankNotNan:
    def test_an_unmeasurable_score_leaves_the_cell_empty(self, tmp_path, monkeypatch):
        """`nan` in a CSV cell reads as a measurement; the frame produced none.

        Same rule the essays writers follow (`report.cell`, `nd2_io._finite`).
        The frame is still flagged, and `unscoreable` names the channel.
        """
        from focus_qc.calibration import Calibration, DomainRange

        calibration = tmp_path / "cal.json"
        calibration.write_text(json.dumps(Calibration(
            thresholds={"irm": 10.0},
            domain={"irm": DomainRange(noise_sigma=(20.0, 30.0),
                                       background=(16000.0, 17000.0))},
            tolerance_um=0.3).to_dict()))
        blank = np.full((64, 64), 111.0)
        monkeypatch.setattr(cli, "iter_stack_planes",
                            lambda path, channels: iter([{"IRM": blank}]))
        out = tmp_path / "flags.csv"
        args = argparse.Namespace(calibration=str(calibration), dataset=None,
                                  input="/x.nd2", out=str(out),
                                  channel=[["IRM", "irm"]])

        assert cli.cmd_detect(args) == cli.EXIT_UNTRUSTWORTHY

        rows = list(csv.DictReader(out.open(newline="")))
        assert rows[0]["IRM_score"] == "", "an unscoreable frame has no score"
        assert rows[0]["IRM_flag"] == "1", "...and is flagged for it"
        assert rows[0]["unscoreable"] == "IRM"


class TestFitRejectsCollidingModalities:
    def test_refuses_two_channels_that_share_one_modality(self, tmp_path):
        """The second would silently overwrite the first's threshold."""
        spec = _spec(channels=(("TIRF 488", "fluor"), ("TIRF 640", "fluor")))
        with pytest.raises(ValueError, match="fluor"):
            cli._fit(spec, _scores(spec), spec["stacks"], tolerance_um=0.3, guard_um=0.1)

    def test_names_both_colliding_channels(self, tmp_path):
        spec = _spec(channels=(("TIRF 488", "fluor"), ("TIRF 640", "fluor")))
        with pytest.raises(ValueError, match="TIRF 640"):
            cli._fit(spec, _scores(spec), spec["stacks"], tolerance_um=0.3, guard_um=0.1)


class TestDetectOutputSafety:
    def test_does_not_truncate_an_existing_result_when_there_is_nothing_to_write(self, tmp_path):
        """open(..., 'w') used to blank the file before the error that aborts the run."""
        out = tmp_path / "flags.csv"
        out.write_text("frame,flagged\n1,0\n")
        with pytest.raises(ValueError):
            cli._write_rows(out, [], on_empty="nothing to write")
        assert out.read_text() == "frame,flagged\n1,0\n"

    def test_reports_why_nothing_was_written(self, tmp_path):
        out = tmp_path / "flags.csv"
        with pytest.raises(ValueError, match="nothing to write"):
            cli._write_rows(out, [], on_empty="nothing to write")

    def test_writes_the_rows_it_is_given(self, tmp_path):
        out = tmp_path / "flags.csv"
        cli._write_rows(out, [{"frame": 1, "flagged": 0}], on_empty="x")
        assert "frame,flagged" in out.read_text()
