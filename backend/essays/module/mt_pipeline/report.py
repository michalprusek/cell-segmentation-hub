"""Output writers: results CSV, QC overlay PNGs, polyline annotation JSON.

The CSV is written incrementally (one flush per position) so a long batch run
keeps usable partial results if it is interrupted.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np

# Column order for the results table (one row per microtubule). New columns are
# APPENDED, never inserted: users' downstream scripts index this CSV by column
# position as often as by name.
COLUMNS = [
    "well_id", "position", "mt_id",
    "solution_intensity_median",
    "length_px", "length_um",
    "mt_mean_intensity", "mt_std_intensity", "mt_sum_intensity",
    "bg_mean_intensity", "bg_median_intensity", "bg_sum_intensity",
    "net_mean_intensity",
    "n_px_mt", "n_px_bg",
    "source_file",
    # When the well was recorded on the microscope, ISO-8601 UTC. This is the
    # only run identifier that survives renaming, re-uploading or re-running the
    # folder, which is why it lives in the table and not just in a directory
    # name. Blank when the ND2 carries no timestamp.
    "acquired_at",
    # Added 2026-08-13 with the switch to the shared ImageJ measurement. Appended
    # rather than slotted next to their siblings because scripts index this table
    # by position; the grouping reads worse, the existing scripts keep working.
    "mt_median_intensity",
    # mean(band) - median(ring): what the project export reports as
    # ``signal_minus_background``. ``net_mean_intensity`` above stays
    # mean-minus-MEAN so earlier runs remain interpretable.
    "signal_minus_background",
    # Added 2026-08-30. The MEASURED IRM->TIRF offset for this position, its
    # peak-dominance quality and the outcome reason — a diagnostic, never
    # applied to a pixel (see mt_pipeline/nd2_io.measure_alignment). Expect
    # `implausible_shift` on most rows: IRM and TIRF share no edges, so the gate
    # correctly refuses. A real misalignment would read `ok` at a quality well
    # above 1 with a non-zero offset. Blank when nothing measured it.
    "irm_tirf_dy", "irm_tirf_dx", "irm_tirf_quality", "irm_tirf_reason",
    # Added 2026-08-31. The MEASURED out-of-focus verdict for this position —
    # a diagnostic, never a gate (see mt_pipeline/nd2_io.judge_focus). The two
    # scores are the focus_qc descriptor: area occupied by structure standing
    # more than 5 sigma above the local background, in PIXELS PER 10,000, judged
    # against thresholds of 7.640 (IRM) and 0.184 (fluorescence).
    #
    # Read them as triage, not as an acceptance test. The descriptor conflates
    # focus with field density and fails PERMISSIVE — a dense field keeps enough
    # pixels above 5 sigma when defocused (one validation field dropped only
    # 15.0x -> 11.6x under a 0.5 um defocus where the calibration fields drop by
    # 88 %) — and the published 0.959 balanced accuracy is leave-one-STACK-out
    # within ONE acquisition session, so it does not support a cross-session
    # transfer claim. `focus_reason` carries `out_of_calibration:<channel>` when
    # the acquisition has drifted far enough that the absolute thresholds may
    # not apply at all; that is advisory and never changes `focus_flagged`.
    #
    # A position with NO microtubules produces no row here at all, and so does a
    # position whose segmentation failed. focus_qc.csv carries one row for every
    # position that was read, which is where a badly defocused field shows up.
    #
    # focus_qc.csv also reports each channel's SHARPNESS descriptor, and that is
    # deliberately NOT repeated here. This table is one row per MICROTUBULE, so
    # every per-position column is duplicated across all of a position's
    # filaments; the four below earn that because they carry the verdict, and a
    # number nothing decides on does not. The per-position diagnostic sheet is
    # where a reader goes to threshold it, and it is complete there — it covers
    # the zero-microtubule positions this table cannot represent at all.
    "focus_irm_score", "focus_tirf_score", "focus_flagged", "focus_reason",
]


# One row per well/position the run could not produce. Ships next to results.csv
# so it travels inside the download: before this existed the only record of a
# failed well was a `[warn]` line on the worker's stderr, which is deleted with
# the container — after the 2026-08-11 recreate, the reasons behind two runs'
# 255 and 68 failures were unrecoverable, and the affected wells could only be
# identified by diffing the two result zips.
FAILURE_COLUMNS = [
    "well_id", "position", "source_file",
    # "read" = the ND2 could not be opened (the whole well is absent),
    # "segment" = the model raised on this one position.
    "stage",
    # How many tries it took to give up. > 1 means the retry ran and the error
    # outlived it, which separates a passing squall from a standing problem.
    "attempts",
    "error_type", "error_message",
]


# One row per POSITION the run read, whether or not it produced microtubules.
#
# results.csv is one row per microtubule, so a position with no centerlines
# contributes nothing to it (evaluate.py writes `[]`) and a position whose
# segmentation failed contributes nothing either — and a badly out-of-focus
# field is exactly the kind that yields no microtubules. Without this file the
# focus verdict would be missing precisely where it matters most.
#
# Column order is free here (no downstream script indexes this file by
# position — it is new as of 2026-08-31), but keep the two channel blocks
# parallel: `irm_*` is the channel that was SEGMENTED, `tirf_*` the one whose
# intensity was MEASURED, and naming the channel proves which frame was scored.
FOCUS_COLUMNS = [
    "well_id", "position", "source_file", "acquired_at",
    # The OR verdict over both channels, and why. `reason` is `ok`, or a
    # `;`-joined list of `oof:<channel>`, `unscoreable:<channel>` and
    # `out_of_calibration:<channel>`; the last is advisory and never changes
    # `flagged`. Blank cells mean nothing was measured — see `reason` for which
    # of `detector_unavailable` / `error:<Type>` it was.
    "flagged", "reason",
    # Scores are focus_qc's descriptor: occupied structure area above 5 sigma,
    # in pixels per 10,000. `*_threshold` travels with them so a row stays
    # interpretable after a recalibration changes the thresholds.
    #
    # `*_sharpness` is REPORTED AND NOTHING DECIDES ON IT. It is focus_qc's
    # second descriptor: the mean gradient magnitude over the structure pixels
    # (|rn| > 4 sigma) of the noise-normalised, background-subtracted frame —
    # so its unit is the frame's own noise sigma PER PIXEL, and like the score
    # it is free of camera gain, of a constant offset and of smooth shading.
    #
    # It is here because it is the most acquisition-STABLE number focus_qc
    # computes, and the score is the least. Measured 2026-09-01 over the shipped
    # calibration cache (focus_qc/reference/scores_cache.json — 5 z-stacks x 2
    # channels, 410 real per-plane measurements) against the spec's annotated
    # sharp planes at tolerance 0.3 um / guard 0.1 um. SEPARATION is this
    # project's own margin, p5 of in-focus over p95 of out-of-focus, computed
    # exactly as `test_in_focus_and_out_of_focus_scores_stay_separated` does —
    # below 1.0 the classes are inverted at the tails and no absolute threshold
    # separates them. SPREAD is max/min of the per-stack geometric-midpoint
    # threshold, i.e. how far a threshold fitted on one stack lands from the
    # next one's:
    #
    #   descriptor   IRM sep   IRM spread   TIRF sep   TIRF spread
    #   score          1.97x       2.67x      5.01x       23.50x
    #   sharpness      1.07x       1.46x      0.88x        1.13x
    #
    # (The two score separations are the 1.97x / 5.01x already tabulated in
    # focus_qc/README.md, which is how this reproduction was checked.)
    #
    # So a sharpness threshold fitted on one stack still roughly applies to the
    # next (1.13-1.46x) where a score threshold does not (2.67x, and 23.50x on
    # TIRF) — which is what a user with wells outside the shipped calibration
    # needs, and every 2048x2048 well measured so far is outside it
    # (`out_of_calibration:TIRF 488` on 3/3 positions).
    #
    # And the same table is EXACTLY why sharpness must not become the verdict:
    # 0.88x on TIRF means the classes are inverted at the tails, so no absolute
    # threshold separates them at all — one of the five stacks does not admit a
    # threshold even in-sample — and 1.07x on IRM leaves nothing like the
    # score's margin. Stable and unable to decide are not in tension: one says
    # the number travels, the other says what it cannot be used for.
    #
    # One caveat that reading has to carry: all 144 NaNs in that cache are TIRF,
    # and 143 of them sit on OUT-OF-FOCUS planes — a badly defocused
    # fluorescence frame usually has too little structure to measure sharpness
    # on at all. The figures above are over the planes that do have a number.
    # Counting a NaN as zero instead only moves TIRF from 0.88x to 1.06x while
    # blowing its spread out to 38.03x, so neither reading yields a threshold.
    # Anyone who wants to promote this to a flag has to re-measure both columns
    # first, on their own data.
    #
    # Blank — not 0 — when the descriptor declined to measure: fewer than
    # MIN_STRUCTURE_PX = 50 structure pixels in the frame (focus_qc/metrics.py),
    # which can happen on a frame that scored perfectly well.
    #
    # Slotted beside the noise it is expressed in rather than appended, which
    # the rule above this list allows and results.csv's does not: this file has
    # no positional readers, and appending would have split the `irm_*` block
    # that the same rule requires to stay parallel with `tirf_*`.
    "irm_channel", "irm_score", "irm_flag", "irm_threshold",
    "irm_sharpness", "irm_noise_sigma", "irm_background",
    "tirf_channel", "tirf_score", "tirf_flag", "tirf_threshold",
    "tirf_sharpness", "tirf_noise_sigma", "tirf_background",
]

#: Scores span ~0.0 to ~800 px/10,000 on real wells; four decimals keeps the
#: tail of a nearly-empty channel readable without pretending to more precision
#: than a pixel count has.
_SCORE_DECIMALS = 4


def cell(value):
    """A CSV cell: blank for a value that was never measured.

    `None` and `0` are different claims — "nothing ran" versus "it ran and found
    zero" — and these tables' whole point is telling them apart. Lives here
    rather than in evaluate.py because every writer that needs it is in this
    module, and a second copy would eventually disagree with this one.
    """
    return "" if value is None else value


def _rounded(value, decimals: int = _SCORE_DECIMALS):
    return None if value is None else round(float(value), decimals)


def _flag_cell(value) -> str | int:
    """1/0 for a measured boolean, blank for one that was never measured."""
    return "" if value is None else int(bool(value))


class FocusLog:
    """The out-of-focus verdict for every position the run read.

    Written even when nothing is flagged, for the same reason ``FailureLog`` is:
    a header-only file states "every position was judged and none was refused",
    whereas a missing file cannot be told apart from a writer that never ran.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.path, "w", newline="")
        self._w = csv.DictWriter(self._fh, fieldnames=FOCUS_COLUMNS,
                                 extrasaction="ignore")
        self._w.writeheader()
        self._fh.flush()
        self.n_rows = 0
        self.n_flagged = 0
        #: Positions the check could not judge at all. Counted separately and
        #: reported separately: without it a run whose detector never loaded
        #: prints "0/900 flagged", which is the reassuring reading of a blank —
        #: exactly the confusion every other column here is built to prevent,
        #: and this line is the only summary an operator sees.
        self.n_unmeasured = 0

    def record(self, *, well_id: str, position: int, source_file: str,
               acquired_at: str | None, focus) -> None:
        """Log one position's verdict.

        ``focus`` is a ``mt_pipeline.nd2_io.FocusQuality`` or None. Taken as an
        object rather than eighteen keyword arguments, and duck-typed rather
        than imported, so this module stays free of the reader it writes for.
        """
        row = {
            "well_id": well_id,
            "position": position,
            "source_file": source_file,
            "acquired_at": cell(acquired_at),
            "flagged": _flag_cell(focus.flagged if focus else None),
            # A position with no verdict at all still gets a row, and says so.
            "reason": focus.reason if focus else "",
        }
        for prefix, channel in (("irm", focus.irm if focus else None),
                                ("tirf", focus.tirf if focus else None)):
            row[f"{prefix}_channel"] = channel.name if channel else ""
            row[f"{prefix}_score"] = cell(_rounded(channel.score) if channel else None)
            row[f"{prefix}_flag"] = _flag_cell(channel.flagged if channel else None)
            # Verbatim, not rounded: this is the fitted constant a score was
            # compared against, so a reader must be able to reproduce the
            # comparison exactly. Rounding 7.64036346269919 to 7.6404 would
            # decide a score that lands between them the other way.
            row[f"{prefix}_threshold"] = cell(channel.threshold if channel else None)
            # Four decimals, like the score and unlike the two acquisition
            # statistics below it: this is a descriptor a user is expected to
            # threshold themselves, so it keeps the resolution the number the
            # shipped threshold is applied to gets.
            row[f"{prefix}_sharpness"] = cell(
                _rounded(channel.sharpness) if channel else None)
            row[f"{prefix}_noise_sigma"] = cell(
                _rounded(channel.noise_sigma, 3) if channel else None)
            row[f"{prefix}_background"] = cell(
                _rounded(channel.background, 3) if channel else None)
        self._w.writerow(row)
        self.n_rows += 1
        verdict = focus.flagged if focus else None
        if verdict is None:
            self.n_unmeasured += 1
        elif verdict:
            self.n_flagged += 1
        # Flush per row, like FailureLog: a batch that dies mid-run must still
        # hand over the verdicts it already reached.
        self._fh.flush()

    def close(self) -> None:
        self._fh.close()


def focus_result_cells(focus) -> dict:
    """The four ``focus_*`` cells results.csv carries, for one position.

    Built here beside ``COLUMNS`` so the row keys and the header cannot drift
    apart, and shared by every microtubule row of the position — results.csv is
    one row per microtubule and the verdict belongs to the frame pair they were
    measured on.
    """
    return {
        "focus_irm_score": cell(_rounded(focus.irm.score) if focus else None),
        "focus_tirf_score": cell(_rounded(focus.tirf.score) if focus else None),
        "focus_flagged": _flag_cell(focus.flagged if focus else None),
        "focus_reason": focus.reason if focus else "",
    }


class CsvWriter:
    """Append-as-you-go CSV writer with a fixed header."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.path, "w", newline="")
        self._w = csv.DictWriter(self._fh, fieldnames=COLUMNS, extrasaction="ignore")
        self._w.writeheader()
        self._fh.flush()
        self.n_rows = 0

    def write_rows(self, rows: list[dict]) -> None:
        for r in rows:
            self._w.writerow(r)
        self.n_rows += len(rows)
        self._fh.flush()

    def close(self) -> None:
        self._fh.close()


class FailureLog:
    """Names every well the run failed to produce, and why.

    Written even when nothing fails: a header-only file states "no well was
    lost", whereas a missing file cannot be told apart from a writer that never
    ran. A run's results are only trustworthy if its gaps are enumerable.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.path, "w", newline="")
        self._w = csv.DictWriter(self._fh, fieldnames=FAILURE_COLUMNS,
                                 extrasaction="ignore")
        self._w.writeheader()
        self._fh.flush()
        self.n_rows = 0

    def record(self, *, well_id: str, position: int | str, source_file: str,
               stage: str, attempts: int, error_type: str,
               error_message: str) -> None:
        """Name one lost well.

        Takes the error as *text*, never as an exception object: on the
        segmentation path the caller must already have dropped the exception,
        because its traceback pins the failed forward pass on the GPU (see
        ``_ErrorInfo`` in evaluate.py). Accepting an exception here would invite
        callers to keep one alive just to reach this line.
        """
        self._w.writerow({
            "well_id": well_id,
            "position": position,
            "source_file": source_file,
            "stage": stage,
            "attempts": attempts,
            "error_type": error_type,
            # Newlines would break the row apart in a naive CSV reader, and a
            # torch OOM message is multi-line.
            "error_message": " ".join(error_message.split()),
        })
        self.n_rows += 1
        # Flush per row: a batch that dies mid-run must still hand over the
        # failures it already knew about.
        self._fh.flush()

    def close(self) -> None:
        self._fh.close()


def _normalize_for_display(frame: np.ndarray) -> np.ndarray:
    """Percentile-stretch (1 / 99.5) to uint8 for visualisation."""
    img = frame.astype(np.float32)
    lo, hi = np.percentile(img, [1, 99.5])
    img = np.clip((img - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    return (img * 255).astype(np.uint8)


def save_overlay(frame: np.ndarray, centerlines_rc: list[np.ndarray],
                 out_path: Path) -> None:
    """Render MT centerlines (distinct colour per instance) over ``frame``.

    Called once per channel that is worth eyeballing: over IRM it shows whether
    the segmentation matched what the model actually saw, over TIRF whether the
    measured band sits on the signal being integrated. Drawing only the latter
    is how a whole batch of TIRF-segmented runs looked plausible for weeks.
    """
    import cv2

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gray = _normalize_for_display(frame)
    rgb = np.repeat(gray[:, :, None], 3, axis=2)
    for idx, cl in enumerate(centerlines_rc):
        pts = np.asarray(cl)[:, ::-1].round().astype(np.int32)  # (row,col)->(x,y)
        hue = int((idx * 47) % 180)
        color = cv2.cvtColor(np.uint8([[[hue, 220, 255]]]),
                             cv2.COLOR_HSV2BGR)[0, 0].tolist()
        cv2.polylines(rgb, [pts.reshape(-1, 1, 2)], False, color, 1, cv2.LINE_AA)
    cv2.imwrite(str(out_path), rgb)


def save_annotation_json(well_id: str, position: int, source_file: str,
                         image_shape: tuple[int, int],
                         centerlines_rc: list[np.ndarray], rows: list[dict],
                         out_path: Path, acquired_at: str | None = None,
                         focus=None) -> None:
    """Write MT centerlines as polylines (points are ``{x, y}`` = col, row px).

    ``focus`` (a ``FocusQuality`` or None) rides along so a position's
    annotation stays self-describing: ``num_microtubules: 0`` on its own does
    not say whether the field was empty or out of focus, and that position has
    no row in results.csv to say it either.
    """
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    polylines = []
    for cl, row in zip(centerlines_rc, rows):
        pts = [{"x": float(c), "y": float(r)} for r, c in np.asarray(cl)]
        polylines.append({
            "mt_id": row["mt_id"],
            "class": "microtubule",
            "geometry": "polyline",
            "points": pts,
            "vertices_count": len(pts),
            "length_px": row["length_px"],
            "length_um": row["length_um"],
        })
    payload = {
        "well_id": well_id,
        "position": position,
        "source_file": source_file,
        "acquired_at": acquired_at,
        "image_size": {"width": int(image_shape[1]), "height": int(image_shape[0])},
        "num_microtubules": len(polylines),
        "focus": None if focus is None else {
            "flagged": focus.flagged,
            "reason": focus.reason,
            "irm": {"channel": focus.irm.name, "score": _rounded(focus.irm.score),
                    "flagged": focus.irm.flagged, "threshold": focus.irm.threshold},
            "tirf": {"channel": focus.tirf.name, "score": _rounded(focus.tirf.score),
                     "flagged": focus.tirf.flagged, "threshold": focus.tirf.threshold},
        },
        "polylines": polylines,
    }
    out_path.write_text(json.dumps(payload, indent=2))
