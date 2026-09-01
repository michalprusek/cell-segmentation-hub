"""The per-frame out-of-focus check: measured, reported, never a gate.

WHY THIS IS A DIAGNOSTIC AND NOT AN ACCEPTANCE TEST. The focus_qc descriptor
counts the area occupied by structure standing more than 5 sigma above the local
background, so it conflates focus with FIELD DENSITY and fails in the permissive
direction: in the method's own validation one dense field dropped only
15.0x -> 11.6x under a 0.5 um defocus, where the calibration fields drop by 88 %.
Its published 0.959 balanced accuracy is leave-one-STACK-out inside a single
acquisition session, which validates the threshold *value* out of fold and not
the threshold rule, the descriptor constants, or the +-0.3 um tolerance -- all
chosen while looking at those same five stacks.

And the domain guard fires on real data that is perfectly in focus: measured
2026-08-31 on `WellD03_ChannelIRM_TIRF_488_Seq0000.nd2` (2048x2048, 3 positions),
every position scores far above threshold on both channels, yet TIRF 488 reads
`out_of_calibration` on 3/3 (noise sigma 27.8-33.1 against a fitted 5.79-5.89,
background 296-347 against 110-111). Wiring any of that to a non-zero exit would
make `essays_api.py` mark the job failed and withhold the entire download, so
these tests pin the opposite: the verdict reaches the CSVs and changes nothing
else.

The other thing pinned here is the gap that made a naive design useless. A
position with NO microtubules writes no row to results.csv at all -- and an
out-of-focus field is exactly the kind that yields none -- so the verdict for
the positions that need it most would have had nowhere to live. `focus_qc.csv`
carries one row per position that was READ, including positions whose
segmentation later failed.

The SHARPNESS column (added 2026-09-01) is the same bargain taken one step
further: reported, and deliberately not a decision input. Measured over the
shipped calibration cache (focus_qc/reference/scores_cache.json, 410 real
per-plane measurements, tolerance 0.3 um / guard 0.1 um), the geometric-midpoint
threshold moves 1.46x (IRM) / 1.13x (TIRF) between stacks against the score's
2.67x / 23.50x -- the most acquisition-stable number focus_qc has, which is what
a user outside the shipped calibration needs. But its separation (p5 in-focus /
p95 out-of-focus, this project's own margin) is 1.07x on IRM and 0.88x on TIRF,
and below 1.0 the classes are inverted at the tails, so no absolute threshold
exists at all. Hence: a column, never a flag.

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
from mt_pipeline.nd2_io import ChannelFocus, FocusQuality, Position  # noqa: E402
from mt_pipeline.report import COLUMNS, FOCUS_COLUMNS  # noqa: E402

#: Appended 2026-08-31, and the LAST four of results.csv until something else is
#: appended after them. Named here so the wiring tests and the position test
#: cannot disagree about what the group is.
FOCUS_RESULT_COLUMNS = [
    "focus_irm_score", "focus_tirf_score", "focus_flagged", "focus_reason",
]

#: The shipped calibration's thresholds (focus_qc/reference/calibration.json).
IRM_THRESHOLD = 7.640363462699190
FLUOR_THRESHOLD = 0.184418486195967


def _channel(name, score, flagged, threshold, sigma=25.0, background=16500.0,
             sharpness=2.0):
    return ChannelFocus(name=name, score=score, flagged=flagged,
                        threshold=threshold, sharpness=sharpness,
                        noise_sigma=sigma, background=background)


def _in_focus() -> FocusQuality:
    return FocusQuality(
        irm=_channel("IRM", 461.3776, False, IRM_THRESHOLD, 195.228, 14936.0,
                     sharpness=2.2971),
        tirf=_channel("TIRF 488", 70.6173, False, FLUOR_THRESHOLD, 7.902, 121.0,
                      sharpness=1.9845),
        reason="ok")


def _out_of_focus() -> FocusQuality:
    """A real one: WellD04 pos0's TIRF scored exactly 0.0 against a 0.184 cut.

    Its sharpness is None for the reason that pairing is worth pinning: a TIRF
    frame defocused enough to score 0.0 usually holds fewer than the 50
    structure pixels the descriptor needs, so it declines to measure. 143 of the
    144 NaN sharpness values in the shipped calibration cache are exactly this.
    """
    return FocusQuality(
        irm=_channel("IRM", 679.2653, False, IRM_THRESHOLD, 196.260, 14399.0,
                     sharpness=1.8235),
        tirf=_channel("TIRF 488", 0.0, True, FLUOR_THRESHOLD, 6.792, 116.0,
                      sharpness=None),
        reason="oof:TIRF 488")


def _position(focus, index: int = 0) -> Position:
    return Position(
        well_id="D04", position=index,
        irm=np.full((8, 8), 11, np.uint16), tirf=np.full((8, 8), 22, np.uint16),
        solution=np.full((8, 8), 33, np.uint16),
        px_um=0.0722, acquired_at="2026-05-19T21:48:02Z",
        focus=focus,
    )


@pytest.fixture
def run_evaluate(tmp_path, monkeypatch):
    """Drive ``evaluate.main()`` over positions carrying given focus verdicts.

    The CSV writers are the real ones: what the user receives is the thing under
    test, exactly as in test_failure_resilience.py.
    """
    import evaluate

    monkeypatch.setattr(evaluate.time, "sleep", lambda _s: None)
    monkeypatch.setattr(evaluate, "RETRY_BACKOFF_S", ())

    state = {"n_mt": 1, "explode": False}

    class _FakeModel:
        def load_weights(self, weights, device):
            return self

        def predict(self, frame, seed_threshold=0.5):
            if state["explode"]:
                raise RuntimeError("CUDA out of memory. Tried to allocate 3.00 GiB")
            line = np.array([[1.0, 1.0], [1.0, 4.0], [1.0, 6.0]])
            return {"centerlines_rc": [line] * state["n_mt"]}

    monkeypatch.setitem(sys.modules, "microtubule",
                        types.SimpleNamespace(MicrotubuleModel=_FakeModel))
    monkeypatch.setattr(evaluate, "resolve_device", lambda requested: "cpu")
    monkeypatch.setattr(evaluate, "ensure_weights", lambda w: Path(w))
    monkeypatch.setattr(mt_pipeline, "measure_frame",
                        lambda frame, centerlines, **kw: [
                            {"mt_id": i + 1, "length_px": 5.0}
                            for i in range(len(centerlines))])
    monkeypatch.setattr(mt_pipeline, "save_overlay", lambda *a, **k: None)

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    fake_nd2 = data_dir / "WellD04_ChannelIRM_488_InSol_TIRF_488_Seq0000.nd2"
    fake_nd2.touch()
    monkeypatch.setattr(mt_pipeline, "find_nd2_files", lambda p: [fake_nd2])
    out_dir = tmp_path / "out"

    def _run(*focuses, n_mt: int = 1, explode: bool = False, no_json: bool = True):
        state["n_mt"] = n_mt
        state["explode"] = explode
        positions = [_position(f, i) for i, f in enumerate(focuses)]
        monkeypatch.setattr(mt_pipeline, "iter_positions",
                            lambda path, **kw: iter(positions))
        argv = ["evaluate.py", "--data", str(data_dir), "--out", str(out_dir),
                "--weights", str(tmp_path / "fake.pt"), "--device", "cpu"]
        if no_json:
            argv.append("--no-json")
        monkeypatch.setattr(sys, "argv", argv)
        exit_code = evaluate.main()

        def _read(name):
            with open(out_dir / name, newline="") as fh:
                return list(csv.DictReader(fh))

        return types.SimpleNamespace(exit_code=exit_code, out_dir=out_dir,
                                     results=_read("results.csv"),
                                     focus=_read("focus_qc.csv"),
                                     failures=_read("failures.csv"))

    return _run


# --------------------------------------------------------------------------
# results.csv: the verdict reaches the table the user actually opens
# --------------------------------------------------------------------------

def test_the_measured_verdict_reaches_results_csv(run_evaluate):
    """The wiring: what the reader measured is what the user receives."""
    run = run_evaluate(_in_focus(), n_mt=2)

    assert len(run.results) == 2, "one row per microtubule"
    for row in run.results:
        # Per-position value, repeated on every MT row of that position.
        assert float(row["focus_irm_score"]) == pytest.approx(461.3776)
        assert float(row["focus_tirf_score"]) == pytest.approx(70.6173)
        assert row["focus_flagged"] == "0"
        assert row["focus_reason"] == "ok"


def test_a_flagged_position_says_which_channel_and_does_not_fail_the_run(run_evaluate):
    """Flagged is a label on a row, not a verdict on the job.

    `essays_api.py` treats a non-zero exit as a failed job and withholds the
    whole zip, so a permissive detector deciding an exit code would cost the
    user 180 wells of real measurements over a heuristic.
    """
    run = run_evaluate(_out_of_focus())

    assert run.exit_code == 0, "a flagged position must not fail the batch"
    assert run.results[0]["focus_flagged"] == "1"
    assert run.results[0]["focus_reason"] == "oof:TIRF 488"
    # The scores are still reported: a flag without the number behind it cannot
    # be checked, and 0.0 here is a MEASUREMENT of an empty channel.
    assert float(run.results[0]["focus_tirf_score"]) == 0.0
    assert run.failures == [], "an out-of-focus position is not a failure"


def test_out_of_calibration_is_reported_without_flagging_the_position(run_evaluate):
    """The domain guard is advisory -- it never changes the verdict.

    This is not hypothetical: on the 2048x2048 well every position is in focus
    on both channels and every one reads `out_of_calibration` on TIRF 488.
    """
    drifted = FocusQuality(
        irm=_channel("IRM", 151.72, False, IRM_THRESHOLD, 199.262, 23127.0),
        tirf=_channel("TIRF 488", 490.8752, False, FLUOR_THRESHOLD, 27.815, 296.0),
        reason="out_of_calibration:TIRF 488")
    run = run_evaluate(drifted)

    assert run.exit_code == 0
    assert run.results[0]["focus_flagged"] == "0"
    assert run.results[0]["focus_reason"] == "out_of_calibration:TIRF 488"
    assert run.focus[0]["flagged"] == "0"
    assert run.focus[0]["reason"] == "out_of_calibration:TIRF 488"


def test_a_position_without_a_verdict_leaves_the_cells_blank(run_evaluate):
    """No measurement is not the same as a measurement of zero.

    A blank `focus_flagged` must not read as "checked, and it was fine" -- that
    is the same confusion the alignment columns exist to avoid.
    """
    run = run_evaluate(None)

    for column in FOCUS_RESULT_COLUMNS:
        assert run.results[0][column] == "", f"{column} must be blank, not 0"


def test_an_unavailable_detector_reports_no_numbers_at_all(run_evaluate):
    """The reachable no-measurement path, unlike the None above.

    `iter_positions` always attaches a verdict, so `focus is None` is
    effectively unreachable in production while THIS is what a broken
    deployment writes -- a missing calibration file, or focus_qc dropped from
    the image. The reason is the only thing that distinguishes it from a frame
    that scored zero.
    """
    from mt_pipeline.nd2_io import REASON_FOCUS_UNAVAILABLE, _unmeasured

    run = run_evaluate(FocusQuality(_unmeasured("IRM"), _unmeasured("TIRF 488"),
                                    REASON_FOCUS_UNAVAILABLE))

    assert run.results[0]["focus_reason"] == "detector_unavailable"
    assert run.results[0]["focus_irm_score"] == ""
    assert run.results[0]["focus_tirf_score"] == ""
    assert run.results[0]["focus_flagged"] == ""


def test_a_run_that_measured_nothing_does_not_report_zero_flagged(
        run_evaluate, capsys):
    """`0/N flagged` is the reassuring reading of a blank, and this line is the
    only summary an operator sees.

    A deployment where focus_qc or its calibration never loaded writes
    `detector_unavailable` on every row and blank in every number — and the one
    `[warn]` explaining it is hundreds of lines earlier, in a log that dies with
    the container. The summary has to say the check did not run.
    """
    from mt_pipeline.nd2_io import REASON_FOCUS_UNAVAILABLE, _unmeasured

    unmeasured = FocusQuality(_unmeasured("IRM"), _unmeasured("TIRF 488"),
                              REASON_FOCUS_UNAVAILABLE)
    run_evaluate(unmeasured, unmeasured)
    out = capsys.readouterr().out

    assert "0/2 positions flagged" in out, "the reassuring half is still there"
    assert "2/2 positions could not be judged at all" in out
    assert "blank is NOT `in focus`" in out


def test_a_run_that_judged_everything_says_nothing_about_unmeasured(
        run_evaluate, capsys):
    """...and the warning must not fire on a healthy run, or it is noise."""
    run_evaluate(_in_focus(), _out_of_focus())
    out = capsys.readouterr().out

    assert "1/2 positions flagged" in out
    assert "could not be judged" not in out


def test_focus_columns_are_appended_never_inserted():
    """Downstream scripts index this CSV by column POSITION.

    `report.COLUMNS` says so itself. Slotting the focus columns next to their
    siblings would read better and would silently shift every later column in
    every user's script.
    """
    assert COLUMNS[-4:] == FOCUS_RESULT_COLUMNS
    assert COLUMNS.index("irm_tirf_reason") < COLUMNS.index("focus_irm_score")
    # The 23 columns that existed before this change keep their indices.
    assert len(COLUMNS) == 27
    assert COLUMNS[18] == "signal_minus_background"
    assert COLUMNS[19:23] == ["irm_tirf_dy", "irm_tirf_dx",
                              "irm_tirf_quality", "irm_tirf_reason"]


# --------------------------------------------------------------------------
# focus_qc.csv: the positions results.csv cannot carry
# --------------------------------------------------------------------------

def test_a_position_with_no_microtubules_still_gets_a_focus_row(run_evaluate):
    """THE gap this file exists to close.

    `measure_frame` returns [] for a frame with no centerlines and
    `write_rows([])` writes nothing, so the position vanishes from results.csv
    -- and a badly defocused field is exactly the kind that produces none. Its
    verdict would have been lost precisely where it was worth having.
    """
    run = run_evaluate(_out_of_focus(), n_mt=0)

    assert run.results == [], "fixture must actually produce no MT rows"
    assert len(run.focus) == 1
    assert run.focus[0]["position"] == "0"
    assert run.focus[0]["flagged"] == "1"
    assert run.focus[0]["reason"] == "oof:TIRF 488"
    assert float(run.focus[0]["tirf_score"]) == 0.0


def test_a_position_whose_segmentation_failed_still_gets_a_focus_row(run_evaluate):
    """failures.csv says the well was lost; this says the frame was defocused.

    Which is often WHY. The verdict was measured when the frames were read, so
    it survives a failure on the GPU that happens later -- but only because the
    row is written before the segmentation attempt.
    """
    run = run_evaluate(_out_of_focus(), explode=True)

    assert run.results == []
    assert len(run.failures) == 1 and run.failures[0]["stage"] == "segment"
    assert len(run.focus) == 1
    assert run.focus[0]["flagged"] == "1"


def test_focus_qc_csv_is_written_even_when_nothing_is_flagged(run_evaluate):
    """A header-only file states "every position was judged"; a missing one
    cannot be told apart from a writer that never ran -- the same reason
    failures.csv is opened unconditionally."""
    run = run_evaluate(_in_focus(), _in_focus(), n_mt=1)

    assert (run.out_dir / "focus_qc.csv").is_file()
    assert [r["flagged"] for r in run.focus] == ["0", "0"]
    assert [r["position"] for r in run.focus] == ["0", "1"]


def test_focus_qc_csv_carries_what_a_recalibration_would_need(run_evaluate):
    """The threshold, the noise and the background travel with every row.

    `out_of_calibration` tells the user to recalibrate; these are the numbers
    that say for WHAT, and they must not need the run's log (deleted with the
    container) to be interpretable.
    """
    row = run_evaluate(_in_focus()).focus[0]

    assert row["irm_channel"] == "IRM" and row["tirf_channel"] == "TIRF 488"
    assert float(row["irm_threshold"]) == pytest.approx(IRM_THRESHOLD)
    assert float(row["tirf_threshold"]) == pytest.approx(FLUOR_THRESHOLD)
    assert float(row["irm_noise_sigma"]) == pytest.approx(195.228)
    assert float(row["tirf_background"]) == pytest.approx(121.0)
    assert row["source_file"].endswith(".nd2")
    assert row["acquired_at"] == "2026-05-19T21:48:02Z"
    assert list(row) == FOCUS_COLUMNS


def test_focus_qc_csv_reports_the_sharpness_descriptor(run_evaluate):
    """The second descriptor reaches the sheet, ADVISORY and rounded like a score.

    It is here because it is the only acquisition-stable number focus_qc has.
    Measured 2026-09-01 over the shipped calibration cache (410 real per-plane
    measurements, tolerance 0.3 um / guard 0.1 um), the geometric-midpoint
    threshold moves 1.46x (IRM) / 1.13x (TIRF) between stacks where the score's
    moves 2.67x / 23.50x -- so a user whose wells are outside the shipped
    calibration (every 2048x2048 well so far) has something they can threshold
    per batch. What they must NOT do is let it decide, and the same cache says
    why: separation is 1.07x on IRM and 0.88x on TIRF, the latter meaning the
    classes are inverted at the tails.
    """
    row = run_evaluate(_in_focus()).focus[0]

    assert float(row["irm_sharpness"]) == pytest.approx(2.2971)
    assert float(row["tirf_sharpness"]) == pytest.approx(1.9845)
    # ...and it changed nothing. Sharpness is not an input to any of these.
    assert row["flagged"] == "0" and row["reason"] == "ok"
    assert row["irm_flag"] == "0" and row["tirf_flag"] == "0"


def test_a_sharpness_that_was_declined_is_blank_not_zero(run_evaluate):
    """"Too little structure to measure" is not "sharpness zero".

    The descriptor returns NaN below MIN_STRUCTURE_PX = 50 structure pixels
    (focus_qc/metrics.py), on frames it scored perfectly well -- 143 of the 144
    NaNs in the shipped cache are out-of-focus TIRF planes. A 0.0 in this cell
    would read as the sharpest-possible claim about a frame nobody measured,
    and would drag any average a user takes over the column towards zero.
    """
    run = run_evaluate(_out_of_focus())

    assert run.focus[0]["tirf_sharpness"] == "", "blank, not 0"
    # The channel is otherwise fully measured: this is a declined DESCRIPTOR,
    # not an unscoreable frame.
    assert run.focus[0]["tirf_score"] == "0.0"
    assert float(run.focus[0]["tirf_noise_sigma"]) == pytest.approx(6.792)
    assert float(run.focus[0]["irm_sharpness"]) == pytest.approx(1.8235)


def test_sharpness_sits_beside_the_noise_it_is_expressed_in():
    """Named columns, and the two channel blocks stay parallel and contiguous.

    `FOCUS_COLUMNS` explicitly allows an insertion (nothing indexes this file by
    position) and explicitly requires the blocks to stay parallel, so appending
    would have split `irm_*`. `COLUMNS` allows neither, which is what
    `test_focus_columns_are_appended_never_inserted` pins.
    """
    for prefix in ("irm", "tirf"):
        assert (FOCUS_COLUMNS.index(f"{prefix}_sharpness")
                == FOCUS_COLUMNS.index(f"{prefix}_noise_sigma") - 1)
    irm = [c for c in FOCUS_COLUMNS if c.startswith("irm_")]
    tirf = [c for c in FOCUS_COLUMNS if c.startswith("tirf_")]
    assert [c[4:] for c in irm] == [c[5:] for c in tirf], "blocks must stay parallel"
    # Contiguous: the irm block is not interrupted by a later append.
    first = FOCUS_COLUMNS.index(irm[0])
    assert FOCUS_COLUMNS[first:first + len(irm)] == irm


def test_sharpness_is_not_repeated_in_results_csv():
    """results.csv is one row per MICROTUBULE.

    A per-position number nothing decides on would be duplicated across every
    filament of the position for no reader's benefit, and the four focus columns
    there are the verdict. The diagnostic sheet is where sharpness lives, and it
    is complete there -- it also covers the zero-microtubule positions that get
    no results.csv row at all.
    """
    assert not [c for c in COLUMNS if "sharp" in c]


def test_a_position_without_a_verdict_leaves_the_focus_row_blank(run_evaluate):
    """One row per position READ, even when nothing judged it."""
    row = run_evaluate(None).focus[0]

    assert row["position"] == "0", "the row exists"
    for column in ("flagged", "reason", "irm_score", "irm_flag",
                   "tirf_score", "tirf_flag", "irm_channel"):
        assert row[column] == "", f"{column} must be blank, not 0"


def test_the_annotation_json_carries_the_verdict(run_evaluate):
    """`num_microtubules: 0` alone does not say whether the field was empty or
    out of focus, and that position has no results.csv row to say it either."""
    run = run_evaluate(_out_of_focus(), n_mt=0, no_json=False)

    payload = json.loads((run.out_dir / "annotations" / "D04_pos0.json").read_text())
    assert payload["num_microtubules"] == 0
    assert payload["focus"]["flagged"] is True
    assert payload["focus"]["reason"] == "oof:TIRF 488"
    assert payload["focus"]["tirf"]["channel"] == "TIRF 488"
    assert payload["focus"]["tirf"]["score"] == 0.0


# --------------------------------------------------------------------------
# The reader: the wiring the faked-reader tests above cannot see
# --------------------------------------------------------------------------

def _irm_frame(blur: float = 0.0, seed: int = 11) -> np.ndarray:
    """Dark filaments on a bright field, at the reference acquisition's levels.

    Background and noise are chosen to land INSIDE the shipped calibration's IRM
    domain (background 16401-16748, noise sigma 165.7-170.0), so this exercises
    the same branch a real well does rather than the domain-guard branch.
    """
    from scipy import ndimage as ndi

    rng = np.random.default_rng(seed)
    lines = np.zeros((256, 256), np.float32)
    for k in range(14):
        lines[18 + k * 17: 20 + k * 17, 20:236] = 1.0
    if blur:
        lines = ndi.gaussian_filter(lines, blur)
    frame = 16500.0 - 4000.0 * lines + rng.normal(0, 167.0, lines.shape)
    return np.clip(np.round(frame), 0, 65535).astype(np.uint16)


def _tirf_frame(blur: float = 0.0, seed: int = 12) -> np.ndarray:
    """Bright filaments on a dark field, inside the fluor domain (bg 110-111,
    sigma 5.79-5.89)."""
    from scipy import ndimage as ndi

    rng = np.random.default_rng(seed)
    lines = np.zeros((256, 256), np.float32)
    for k in range(14):
        lines[18 + k * 17: 20 + k * 17, 20:236] = 1.0
    if blur:
        lines = ndi.gaussian_filter(lines, blur)
    frame = 110.0 + 220.0 * lines + rng.normal(0, 5.84, lines.shape)
    return np.clip(np.round(frame), 0, 65535).astype(np.uint16)


class _FakeND2:
    """An ND2 whose three channels are IRM / solution / TIRF, in that order."""

    def __init__(self, irm, tirf, solution):
        self.data = np.stack([irm, solution, tirf])[None]   # (P=1, C=3, Y, X)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    @property
    def metadata(self):
        return types.SimpleNamespace(channels=[
            types.SimpleNamespace(channel=types.SimpleNamespace(name=n))
            for n in ("IRM", "488 InSol", "TIRF 488")])

    def voxel_size(self):
        return types.SimpleNamespace(x=0.0722, y=0.0722, z=1.0)

    def frame_metadata(self, i):
        raise AttributeError("no timestamp")

    def asarray(self):
        return self.data

    text_info: dict = {}


def _read_one(monkeypatch, tmp_path, irm, tirf, solution):
    holder = _FakeND2(irm, tirf, solution)
    monkeypatch.setattr(mt_pipeline.nd2_io.nd2, "ND2File", lambda _p: holder)
    positions = list(mt_pipeline.iter_positions(tmp_path / "WellD04_x.nd2"))
    assert len(positions) == 1
    return positions[0], holder


def test_iter_positions_judges_the_irm_tirf_pair(monkeypatch, tmp_path):
    """The wiring inside the reader, which every faked-reader test above misses.

    They all replace `iter_positions` wholesale, so the call that actually
    produces the verdict would survive their removal.
    """
    pos, _ = _read_one(monkeypatch, tmp_path, _irm_frame(), _tirf_frame(),
                       np.full((256, 256), 3900, np.uint16))

    assert pos.focus is not None, "iter_positions must attach the verdict"
    assert pos.focus.irm.name == "IRM"
    assert pos.focus.tirf.name == "TIRF 488"
    assert pos.focus.reason == "ok", pos.focus
    assert pos.focus.flagged is False
    # Both channels well clear of the shipped thresholds.
    assert pos.focus.irm.score > IRM_THRESHOLD * 5
    assert pos.focus.tirf.score > FLUOR_THRESHOLD * 5


def test_a_defocused_irm_frame_is_flagged_through_the_reader(monkeypatch, tmp_path):
    """The instrument works end to end, on the SHIPPED calibration.

    Same photons, spread over a wider profile: the descriptor's whole claim is
    that the 5-sigma count collapses, and this is the only test here that puts
    the real thresholds, the real descriptor and the real reader in one line.
    """
    sharp, _ = _read_one(monkeypatch, tmp_path, _irm_frame(), _tirf_frame(),
                         np.full((256, 256), 3900, np.uint16))
    blurred, _ = _read_one(monkeypatch, tmp_path, _irm_frame(blur=4.0),
                           _tirf_frame(), np.full((256, 256), 3900, np.uint16))

    assert sharp.focus.irm.score > 20 * blurred.focus.irm.score
    assert blurred.focus.flagged is True
    assert "oof:IRM" in blurred.focus.reason
    # The channel that is still sharp must not be blamed for it.
    assert blurred.focus.tirf.flagged is False


def test_a_drifted_acquisition_is_reported_but_not_flagged(monkeypatch, tmp_path):
    """The domain guard is ADVISORY, through the real detector this time.

    Reproduces what the 2048x2048 well does: a TIRF channel far outside the
    calibrated noise/background domain (fitted sigma 5.79-5.89, background
    110-111) that is nonetheless sharp and scores hundreds of times over the
    0.184 cut. Letting `out_of_calibration` decide the verdict would flag 3/3
    perfectly in-focus positions -- and the tests above cannot see that, because
    they inject a verdict instead of computing one.
    """
    rng = np.random.default_rng(21)
    lines = np.zeros((256, 256), np.float32)
    for k in range(14):
        lines[18 + k * 17: 20 + k * 17, 20:236] = 1.0
    drifted = np.clip(np.round(
        300.0 + 1200.0 * lines + rng.normal(0, 30.0, lines.shape)),
        0, 65535).astype(np.uint16)

    pos, _ = _read_one(monkeypatch, tmp_path, _irm_frame(), drifted,
                       np.full((256, 256), 3900, np.uint16))

    assert "out_of_calibration:TIRF 488" in pos.focus.reason, pos.focus
    assert pos.focus.tirf.score > FLUOR_THRESHOLD * 100, "sharp, and far over"
    assert pos.focus.tirf.flagged is False, "advisory must not become a verdict"
    assert pos.focus.flagged is False


def test_the_solution_channel_is_never_scored(monkeypatch, tmp_path):
    """Uniform dye has no structure, and it measured 0.01 and 0.00 on two real
    positions of WellD04 -- both below the 0.184 fluorescence cut. Folding it
    into the OR would flag every row of every well."""
    solution = np.full((256, 256), 3900, np.uint16)
    solution[::2] += 1                       # scoreable, but structureless
    pos, _ = _read_one(monkeypatch, tmp_path, _irm_frame(), _tirf_frame(), solution)

    assert pos.focus.reason == "ok"
    assert "InSol" not in pos.focus.reason
    assert {pos.focus.irm.name, pos.focus.tirf.name} == {"IRM", "TIRF 488"}


def test_judging_does_not_move_a_single_pixel(monkeypatch, tmp_path):
    """The core promise, shared with the alignment diagnostic: measured, never
    applied. If this fails, every intensity the assay reports has changed."""
    irm, tirf = _irm_frame(), _tirf_frame()
    solution = np.full((256, 256), 3900, np.uint16)
    pos, holder = _read_one(monkeypatch, tmp_path, irm, tirf, solution)
    raw = holder.asarray()

    assert pos.focus.reason == "ok", "fixture must actually reach a verdict"
    assert np.array_equal(pos.irm, raw[0, 0]), "IRM was modified"
    assert np.array_equal(pos.solution, raw[0, 1]), "solution was modified"
    assert np.array_equal(pos.tirf, raw[0, 2]), "TIRF was modified"


def test_one_channel_in_both_roles_is_judged_under_both_polarities():
    """The degenerate `--irm-name == --tirf-name` case must not cross the wires.

    `iter_positions` warns about it and continues (someone may genuinely have
    one usable channel), so it reaches this function. `focus_qc`'s `score_frame`
    and `judge_frame` key their dicts by channel NAME, so scoring both roles in
    one call collapses them onto one entry: the fluorescence-polarity count --
    the POSITIVE tail -- ends up published as `focus_irm_score` and compared
    against the IRM threshold. On the frame below that is 142.67 reported where
    the negative-tail count belongs.

    Judging each role separately keeps the two polarities apart, which is the
    whole point of `modality`.
    """
    from mt_pipeline.nd2_io import judge_focus
    from focus_qc.metrics import focus_score

    frame = _irm_frame()
    got = judge_focus(frame, frame, irm_name="IRM", tirf_name="IRM")

    assert got.irm.score == pytest.approx(focus_score(frame, "irm").score)
    assert got.tirf.score == pytest.approx(focus_score(frame, "fluor").score)
    assert got.irm.score != got.tirf.score, "one frame, two tails, two numbers"
    # Dark filaments on a bright field: the negative tail is full, the positive
    # tail all but empty. Crossed wires would put them the other way round.
    assert got.irm.score > IRM_THRESHOLD and got.irm.flagged is False
    assert got.tirf.score < got.irm.score
    # ...and the reason names the channel once, not twice.
    assert got.reason.count("IRM") == got.reason.count(":")


def test_the_reader_publishes_the_descriptor_s_own_sharpness():
    """The wiring, on the real detector: `stats.sharpness` reaches `ChannelFocus`.

    The CSV tests above inject a `FocusQuality`, so the call that actually
    produces the number would survive their removal -- and a column populated
    from the wrong field, or not populated at all, is exactly the failure they
    cannot see.
    """
    from mt_pipeline.nd2_io import judge_focus
    from focus_qc.metrics import focus_score

    irm, tirf = _irm_frame(), _tirf_frame()
    got = judge_focus(irm, tirf, irm_name="IRM", tirf_name="TIRF 488")

    assert got.irm.sharpness == pytest.approx(focus_score(irm, "irm").sharpness)
    assert got.tirf.sharpness == pytest.approx(focus_score(tirf, "fluor").sharpness)
    # Not accidentally a copy of a neighbouring field.
    assert got.irm.sharpness not in (got.irm.score, got.irm.noise_sigma,
                                     got.irm.background, got.irm.threshold)


def test_a_frame_with_too_little_structure_reports_no_sharpness_at_all():
    """SCORED, and yet no sharpness -- the case a 0.0 would misreport.

    Pure noise inside the IRM domain: the noise floor is measurable, so the
    frame is scored (and correctly flagged out of focus), but fewer than
    MIN_STRUCTURE_PX = 50 pixels clear 4 sigma, so the descriptor declines. This
    is not the unscoreable path below -- everything else about the channel is
    measured -- and it is the majority case on defocused fluorescence: 143 of
    the 144 NaN sharpness values in the shipped calibration cache are exactly
    this, all of them on TIRF out-of-focus planes.
    """
    from mt_pipeline.nd2_io import judge_focus

    rng = np.random.default_rng(31)
    noise = np.clip(np.round(rng.normal(16500.0, 167.0, (256, 256))),
                    0, 65535).astype(np.uint16)
    got = judge_focus(noise, noise, irm_name="IRM", tirf_name="TIRF 488")

    assert got.irm.score is not None, "the frame WAS scored"
    assert got.irm.noise_sigma is not None and got.irm.background is not None
    assert "unscoreable" not in got.reason, got.reason
    assert got.irm.sharpness is None, "declined to measure is not measured zero"
    assert got.tirf.sharpness is None


def test_judge_focus_never_raises_into_the_run():
    """A diagnostic must not be able to fail a well.

    A constant frame is refused by the descriptor rather than scored -- dividing
    by a near-zero sigma would report a blank frame as maximally in focus -- and
    that refusal has to arrive as a reason, not as an exception.
    """
    from mt_pipeline.nd2_io import judge_focus

    got = judge_focus(np.full((64, 64), 111, np.uint16),
                      np.full((64, 64), 111, np.uint16),
                      irm_name="IRM", tirf_name="TIRF 488")

    assert got.flagged is True, "an unscoreable frame fails safe: it is flagged"
    assert "unscoreable:IRM" in got.reason, got.reason
    # ...and nothing is reported as a number: NaN in a cell reads as a
    # measurement, blank reads as the refusal it was.
    assert got.irm.score is None and got.irm.noise_sigma is None
    assert got.irm.sharpness is None


def test_a_measurement_failure_is_reported_not_raised(monkeypatch):
    """The systematic-failure path: it must degrade to a reason, once per type."""
    from mt_pipeline import nd2_io

    monkeypatch.setattr(nd2_io, "_FOCUS", nd2_io._UNSET)
    # Its OWN report set, not the alignment diagnostic's: sharing one would let
    # whichever failed first swallow the other's only log line for that type.
    monkeypatch.setattr(nd2_io, "_REPORTED_FOCUS_ERRORS", set())
    detector = nd2_io._load_focus_detector()
    assert detector is not None
    monkeypatch.setattr(nd2_io, "_FOCUS", detector._replace(
        score_frame=lambda *a, **k: (_ for _ in ()).throw(MemoryError("no room"))))

    got = nd2_io.judge_focus(np.zeros((8, 8), np.uint16), np.zeros((8, 8), np.uint16),
                             irm_name="IRM", tirf_name="TIRF 488")

    assert got.reason == "error:MemoryError", got
    assert got.flagged is None, "nothing ran, so there is no verdict to report"
    assert got.irm.score is None and got.tirf.score is None


def test_a_calibration_that_does_not_cover_both_channels_is_reported_not_raised(
        monkeypatch, tmp_path):
    """A hand-supplied calibration is the reachable way to break the detector.

    `ESSAYS_FOCUS_CALIBRATION` lets an operator drop in a recalibration without
    a rebuild, and a file covering only one modality is an easy mistake to make.
    `judge_frame` raises KeyError on it -- correctly; it will not guess a
    threshold -- and that has to arrive as a reason on every row rather than as
    a dead batch at the first position of the first well.

    (Mutation-tested 2026-08-31: moving the FocusQuality assembly back outside
    the `try` leaves this GREEN, because the KeyError comes from `judge_frame`,
    which is inside it either way. The assembly's position is unfalsifiable
    insurance and this test does not pretend to cover it -- see the comment
    there. What it does cover is that a broken calibration degrades the
    diagnostic instead of ending the run.)
    """
    from mt_pipeline import nd2_io

    irm_only = tmp_path / "irm_only.json"
    irm_only.write_text(json.dumps({
        "thresholds": {"irm": 7.64},
        "domain": {"irm": {"noise_sigma": [165.7, 170.0],
                           "background": [16401.0, 16748.0]}},
        "tolerance_um": 0.3,
    }))
    monkeypatch.setenv(nd2_io.FOCUS_CALIBRATION_ENV, str(irm_only))
    monkeypatch.setattr(nd2_io, "_FOCUS", nd2_io._UNSET)
    monkeypatch.setattr(nd2_io, "_REPORTED_FOCUS_ERRORS", set())

    got = nd2_io.judge_focus(_irm_frame(), _tirf_frame(),
                             irm_name="IRM", tirf_name="TIRF 488")

    assert got.reason == "error:KeyError", got
    assert got.flagged is None


def test_the_detector_is_the_vendored_focus_qc_not_a_copy():
    """One implementation, as with the model, the metrics and the estimator.

    A second copy is how `mt_measure` and the model wrapper drifted apart for
    months; the focus descriptor must not repeat it.
    """
    from mt_pipeline import nd2_io

    detector = nd2_io._load_focus_detector()
    assert detector is not None, "the vendored detector must be importable"
    module = sys.modules[detector.score_frame.__module__]
    assert Path(module.__file__).parent.name == "focus_qc"
    assert Path(module.__file__).parent.parent == PKG_ROOT

    stray = [p for p in PKG_ROOT.rglob("metrics.py")
             if p.parent.name != "focus_qc"]
    assert stray == [], f"a second copy of the descriptor appeared: {stray}"


def test_the_shipped_calibration_is_the_one_that_is_loaded():
    """Thresholds are keyed by MODALITY, not by channel name -- that is what
    makes one calibration transferable between acquisitions whose channels are
    labelled differently. Pinned by value so a swapped file is visible."""
    from mt_pipeline import nd2_io

    detector = nd2_io._load_focus_detector()
    assert detector.source == PKG_ROOT / "focus_qc" / "reference" / "calibration.json"
    assert detector.calibration.thresholds["irm"] == pytest.approx(IRM_THRESHOLD)
    assert detector.calibration.thresholds["fluor"] == pytest.approx(FLUOR_THRESHOLD)


def test_a_recalibration_can_be_supplied_without_rebuilding_the_image(
        monkeypatch, tmp_path):
    """`out_of_calibration` fires on real 2048x2048 wells, and the documented
    remedy is to recalibrate. That remedy is worthless if applying it needs a
    new image built and deployed."""
    from mt_pipeline import nd2_io

    fresh = tmp_path / "recalibrated.json"
    fresh.write_text(json.dumps({
        "thresholds": {"irm": 1.0, "fluor": 2.0},
        "domain": {"irm": {"noise_sigma": [1.0, 2.0], "background": [1.0, 2.0]},
                   "fluor": {"noise_sigma": [1.0, 2.0], "background": [1.0, 2.0]}},
        "tolerance_um": 0.3,
    }))
    monkeypatch.setenv(nd2_io.FOCUS_CALIBRATION_ENV, str(fresh))
    monkeypatch.setattr(nd2_io, "_FOCUS", nd2_io._UNSET)

    detector = nd2_io._load_focus_detector()

    assert detector.source == fresh
    assert detector.calibration.thresholds == {"irm": 1.0, "fluor": 2.0}
