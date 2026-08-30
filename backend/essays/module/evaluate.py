#!/usr/bin/env python3
"""Batch microtubule analysis of ND2 well recordings.

Point this at a folder of ``.nd2`` well recordings (one file per well, several
positions, channels IRM / 488-in-solution / TIRF 488). Microtubules are
**segmented on the IRM channel** — the one the checkpoint was trained on —
and the intensities are then **read off the TIRF channel** along the resulting
centerlines. Per microtubule it produces a row in ``results.csv`` with:

  * the well's solution concentration (median of the 488-in-solution channel),
  * the microtubule's length,
  * the mean / std / sum TIRF intensity along the microtubule (a 5-px band),
  * the mean / median / sum TIRF intensity of the surrounding background ring,
  * the acquisition timestamp of the recording (``acquired_at``, ISO-8601 UTC),

plus QC overlay PNGs (one per channel) and polyline annotation JSON.

Quick start
-----------
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    python evaluate.py --data /path/to/well_recordings --out results/

The v5H checkpoint is a complete ``state_dict`` with no frozen backbone, so
**no HuggingFace token, download or network access is required** at any point.

The 535 MB checkpoint itself is not stored in git; stage it once with
``scripts/download-microtubule-weights.sh`` (or pass ``--weights /path/to.pth``).
"""
from __future__ import annotations

import argparse
import gc
import os
import sys
import time
from pathlib import Path
from typing import NamedTuple

import numpy as np

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from _mt_package import (  # noqa: E402  (needs _HERE on sys.path)
    default_weights, ensure_on_path, missing_weights_message,
)

DEFAULT_WEIGHTS = default_weights()

# A position that fails on the GPU is usually a passing squall rather than a
# verdict on the data. The card (RTX A5000, 23.56 GiB) is shared with the
# interactive `ml` service and Maptimize, so a co-tenant's spike can make the
# next allocation raise OutOfMemoryError. For the current working set and cap
# see sitecustomize.py's docstring — this comment used to quote v7's numbers
# (13.37 GiB against a 14.13 GiB cap), which the v5H swap superseded on
# 2026-08-17 and which would send anyone debugging an essays OOM after the
# wrong ceiling. The
# failures arrived in contiguous 5-9 minute bursts, and re-running the same
# folder a week later failed on a *disjoint* set of positions: every well that
# was lost one time came back the next. Waiting a burst out costs minutes;
# dropping the well costs the well, silently, from a scientific table.
RETRY_BACKOFF_S = (30, 120, 300)

# ...but a GPU that is broken rather than merely busy would otherwise turn a
# 20 h job into a week of sleeping (720 positions x 7.5 min each). This is a
# run-wide stop-loss: once this much has been spent waiting, the remaining
# failures are recorded straight away and the batch finishes on time.
RETRY_WAIT_BUDGET_S = 3600.0


class _RetryBudget:
    """Run-wide allowance for time spent waiting on a transient GPU failure."""

    def __init__(self, total_s: float):
        self.remaining = total_s

    def take(self, seconds: float) -> bool:
        """Consume ``seconds``; False once the run's allowance is spent.

        Deliberately allows the final wait to overshoot rather than refusing a
        retry that a nearly-exhausted budget could almost afford — the point is
        to bound the damage, not to meter it exactly.
        """
        if self.remaining <= 0:
            return False
        self.remaining -= seconds
        return True


class _ErrorInfo(NamedTuple):
    """What a failed attempt leaves behind — text only, never the exception.

    A caught exception owns its ``__traceback__``, which owns every frame of the
    failed call, which owns their locals: for an OOM inside the model that is
    the entire forward pass, still resident on the GPU. Keeping the exception
    alive across the backoff makes ``empty_cache()`` a no-op and the retry
    hopeless — measured 2026-08-13, a first cut that held the exception saw all
    three positions burn all four attempts although the 3 GiB that squeezed them
    out had been freed 40 s earlier: the process's own usage sat at 14.2 GiB of
    its 14.13 GiB cap the whole time.
    """

    type_name: str
    message: str


class _Attempt(NamedTuple):
    """Outcome of one position: exactly one of ``result`` / ``error`` is set."""

    result: dict | None
    attempts: int
    error: _ErrorInfo | None


def _release_gpu_memory() -> None:
    """Hand this process's cached-but-unused VRAM back before a retry.

    ``gc.collect()`` first and not for tidiness: a traceback and its frames
    reference each other, so the failed attempt's tensors sit in a reference
    cycle that plain refcounting will not break, and ``empty_cache()`` can only
    return blocks that nothing still points at.
    """
    gc.collect()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception as e:  # noqa: BLE001 — cleanup must never end the run
        print(f"[warn] could not release GPU memory before retry: {e}")


def _predict_with_retry(model, image, threshold: float, label: str,
                        budget: _RetryBudget) -> _Attempt:
    """Segment one position, riding out a transient failure.

    Retries on ANY exception rather than on OutOfMemoryError alone: OOM is the
    failure mode we measured, but the cost of retrying something unrecoverable
    is bounded by ``budget`` while the cost of not retrying is a missing well.
    """
    last: _ErrorInfo | None = None
    attempt = 1
    for attempt in range(1, len(RETRY_BACKOFF_S) + 2):
        try:
            return _Attempt(model.predict(image, seed_threshold=threshold),
                            attempt, None)
        except Exception as e:  # noqa: BLE001 — the budget decides, not the type
            # Take the text and nothing else; see _ErrorInfo. Everything below
            # deliberately sits OUTSIDE this block, because `e` — and with it
            # the failed forward pass — only becomes collectable once it ends.
            last = _ErrorInfo(type(e).__name__, str(e))

        if attempt > len(RETRY_BACKOFF_S):
            break
        wait = RETRY_BACKOFF_S[attempt - 1]
        if not budget.take(wait):
            print(f"[warn] {label}: {last.type_name}: {last.message} — run's "
                  f"retry budget is spent, giving up on this position")
            break
        print(f"[warn] {label}: {last.type_name}: {last.message} — retrying in "
              f"{wait}s (attempt {attempt + 1}/{len(RETRY_BACKOFF_S) + 1})")
        _release_gpu_memory()
        time.sleep(wait)
    return _Attempt(None, attempt, last)


def resolve_device(requested: str) -> str:
    import torch
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        print("[warn] CUDA requested but unavailable; using CPU.")
        return "cpu"
    if requested == "mps":
        if not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
            print("[warn] MPS requested but unavailable; using CPU.")
            return "cpu"
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        print("[warn] MPS is experimental for this model; verify vs CPU.")
        return "mps"
    return requested


def ensure_weights(weights: Path) -> Path:
    """Return the checkpoint path, or fail with instructions to stage it."""
    weights = Path(weights)
    if weights.exists():
        return weights
    raise FileNotFoundError(missing_weights_message(weights))


def build_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(
        description="Batch microtubule analysis of ND2 well recordings.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--data", required=True, type=Path,
                    help="Folder of .nd2 well recordings (searched recursively), "
                         "or a single .nd2 file.")
    ap.add_argument("--out", type=Path, default=Path("results"),
                    help="Output directory (results.csv, overlays/, annotations/).")
    ap.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS,
                    help="Path to microtubule_v5h.pth (staged out-of-band; see README).")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu", "mps"],
                    help="Compute device.")
    ap.add_argument("--threshold", type=float, default=None,
                    help="Foreground probability cut. Default: the fitted value "
                         "from params_v5h.json (0.97). The generic 0.5 other "
                         "models use would flood the instancer.")
    # Measurement geometry. Shared with the project export's /mt-metrics
    # endpoint (models/mt_measure.py), so these two flags mean exactly what
    # ``thickness_px`` and ``margin_multiplier`` mean there. The former
    # --bg-gap / --bg-width pair described a different ring and is gone with the
    # implementation that read it.
    ap.add_argument("--mt-width", type=int, default=5,
                    help="Width of the on-MT band across the centerline (px); "
                         "the ImageJ line-ROI stroke width.")
    ap.add_argument("--bg-margin", type=float, default=2.0,
                    help="Background ring reach as a multiple of --mt-width "
                         "(2.0 = out to 10 px for a 5 px band). The ring "
                         "excludes every microtubule's band.")
    # Channel name matching. The two roles are deliberately separate flags: the
    # model segments IRM (that is what it was trained on) and the intensities
    # are read off TIRF.
    ap.add_argument("--irm-name", default="irm",
                    help="Substring identifying the IRM channel (segmented).")
    ap.add_argument("--tirf-name", default="tirf",
                    help="Substring identifying the TIRF channel (measured).")
    ap.add_argument("--solution-name", default="insol,in sol,solution",
                    help="Comma-separated substrings identifying the solution channel.")
    # Output toggles / subsetting.
    ap.add_argument("--no-overlays", action="store_true", help="Skip overlay PNGs.")
    ap.add_argument("--no-json", action="store_true", help="Skip annotation JSON.")
    ap.add_argument("--limit-wells", type=int, default=0,
                    help="Process at most N wells (0 = all). Useful for a test run.")
    return ap.parse_args()


def _cell(value):
    """A CSV cell: blank for a value that was never measured.

    `None` and `0` are different claims — "nothing ran" versus "it ran and found
    zero" — and this table's whole point is telling them apart.
    """
    return "" if value is None else value


def main() -> int:
    args = build_args()

    # v5H's checkpoint is a complete state_dict with no frozen backbone, so
    # there is nothing to fetch and no token to supply. The --online-backbone
    # flag and the bundled DINOv3 config it guarded went with the v7 model.

    from mt_pipeline import (iter_positions, find_nd2_files, measure_frame,
                             CsvWriter, FailureLog, parse_well_id, save_overlay,
                             save_annotation_json)

    files = find_nd2_files(args.data)
    if not files:
        print(f"[error] no .nd2 files found under {args.data}", file=sys.stderr)
        return 2
    if args.limit_wells:
        files = files[:args.limit_wells]
    print(f"[info] {len(files)} well file(s) to process from {args.data}")

    try:
        weights = ensure_weights(args.weights)
    except FileNotFoundError as exc:
        # Same shape as the other operator errors above: a readable message and
        # exit 2, not a traceback. The job runner tails this output into the
        # job's error field, where a stack trace helps nobody.
        print(f"[error] {exc}", file=sys.stderr)
        return 2
    device = resolve_device(args.device)
    thr_label = "fitted (params_v5h.json)" if args.threshold is None else args.threshold
    print(f"[info] device={device}  threshold={thr_label}  "
          f"mt_width={args.mt_width} bg_margin={args.bg_margin}")
    # Say out loud which channel plays which role. A run that segments the wrong
    # channel produces plausible-looking numbers, so the log has to be the place
    # you can check it afterwards without re-deriving it from the code.
    print(f"[info] segmenting channel ~{args.irm_name!r}, "
          f"measuring intensity on channel ~{args.tirf_name!r}, "
          f"solution channel ~{args.solution_name!r}")

    # The model code is shared with the interactive segmentation service rather
    # than copied here; say which copy ran, so a surprising result can be traced
    # to the code that produced it without guessing.
    mt_pkg = ensure_on_path()
    print(f"[info] microtubule package: {mt_pkg / 'microtubule'}")
    from microtubule import MicrotubuleModel
    t0 = time.time()
    model = MicrotubuleModel().load_weights(str(weights), device)
    print(f"[info] model loaded in {time.time() - t0:.1f}s")

    out = Path(args.out)
    csvw = CsvWriter(out / "results.csv")
    # Opened unconditionally: a header-only failures.csv is the run stating that
    # nothing was lost, which a missing file cannot do.
    failures = FailureLog(out / "failures.csv")
    budget = _RetryBudget(RETRY_WAIT_BUDGET_S)
    sol_match = tuple(s.strip() for s in args.solution_name.split(",") if s.strip())

    n_pos = n_mt = n_fail = 0
    t_start = time.time()
    for fi, f in enumerate(files, start=1):
        try:
            positions = list(iter_positions(f, irm_match=(args.irm_name,),
                                            tirf_match=(args.tirf_name,),
                                            solution_match=sol_match))
        except Exception as e:
            n_fail += 1
            # No position list, so no per-position identity to record — the
            # whole well is gone, which is what a blank position column means.
            failures.record(well_id=parse_well_id(f), position="",
                            source_file=f.name, stage="read", attempts=1,
                            error_type=type(e).__name__, error_message=str(e))
            print(f"[warn] ({fi}/{len(files)}) failed to read {f.name}: {e}")
            continue

        well = positions[0].well_id if positions else "?"
        for pos in positions:
            ti = time.time()
            solution_median = float(np.median(pos.solution))
            # IRM, not TIRF: the checkpoint was trained and validated on IRM
            # frames (TIRF is architecturally supported but unvalidated).
            # Feeding it TIRF produced confident, wrong centerlines for every
            # run before 2026-08.
            attempt = _predict_with_retry(model, pos.irm, args.threshold,
                                          f"{well} pos{pos.position}", budget)
            if attempt.error is not None:
                n_fail += 1
                failures.record(well_id=pos.well_id, position=pos.position,
                                source_file=f.name, stage="segment",
                                attempts=attempt.attempts,
                                error_type=attempt.error.type_name,
                                error_message=attempt.error.message)
                print(f"[warn] segmentation failed {well} pos{pos.position} "
                      f"after {attempt.attempts} attempt(s): "
                      f"{attempt.error.type_name}: {attempt.error.message}")
                continue
            centerlines = attempt.result["centerlines_rc"]

            # ...and TIRF for the readout: the centerlines come from IRM, the
            # intensities integrated along them are the TIRF signal.
            rows = measure_frame(pos.tirf, centerlines,
                                 mt_width=args.mt_width,
                                 bg_margin=args.bg_margin, px_um=pos.px_um)
            # Per-POSITION, repeated on each of that position's MT rows:
            # results.csv is one row per microtubule and the alignment belongs
            # to the frame pair they were measured on.
            align = pos.alignment
            for r in rows:
                r["well_id"] = pos.well_id
                r["position"] = pos.position
                r["solution_intensity_median"] = round(solution_median, 3)
                r["source_file"] = f.name
                r["acquired_at"] = pos.acquired_at
                # None renders as a blank cell: an unmeasured offset must not
                # read as a measured zero.
                r["irm_tirf_dy"] = _cell(align and align.dy)
                r["irm_tirf_dx"] = _cell(align and align.dx)
                r["irm_tirf_quality"] = _cell(
                    None if not align or align.quality is None
                    else round(align.quality, 3)
                )
                r["irm_tirf_reason"] = align.reason if align else ""
            csvw.write_rows(rows)

            stem = f"{pos.well_id}_pos{pos.position}"
            if not args.no_overlays:
                # One overlay per role: `_irm` checks the segmentation against
                # its own input, `_tirf` checks the measured band against the
                # signal it integrates.
                save_overlay(pos.irm, centerlines,
                             out / "overlays" / f"{stem}_irm.png")
                save_overlay(pos.tirf, centerlines,
                             out / "overlays" / f"{stem}_tirf.png")
            if not args.no_json:
                save_annotation_json(pos.well_id, pos.position, f.name,
                                     pos.irm.shape, centerlines, rows,
                                     out / "annotations" / f"{stem}.json",
                                     acquired_at=pos.acquired_at)

            n_pos += 1
            n_mt += len(rows)
            print(f"[ok] ({fi}/{len(files)}) {stem}: {len(rows)} MT  "
                  f"solution_median={solution_median:.1f}  ({time.time()-ti:.1f}s)")

    csvw.close()
    failures.close()
    dt = time.time() - t_start
    print(f"\n[done] {n_pos} positions, {n_mt} microtubules, {n_fail} failures "
          f"in {dt/60:.1f} min")
    print(f"[done] results -> {csvw.path}")
    if n_fail:
        print(f"[done] failures -> {failures.path} (one row per lost well, "
              f"with the reason)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
