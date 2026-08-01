#!/usr/bin/env python3
"""Batch microtubule analysis of ND2 well recordings.

Point this at a folder of ``.nd2`` well recordings (one file per well, several
positions, channels IRM / 488-in-solution / TIRF 488). Microtubules are
**segmented on the IRM channel** — the one the v7 checkpoint was trained on —
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

The bundled v7 checkpoint is fully self-contained (it carries the DINOv3
backbone weights), so **no HuggingFace token or download is required** — the
backbone is rebuilt from the bundled config at ``config/dinov3_vitl16``.

The 1.2 GB checkpoint itself is not stored in git; it is fetched once from the
repository's GitHub Release on first run (or pass ``--weights /path/to.pt``).
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import traceback
from pathlib import Path

import numpy as np

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

DEFAULT_WEIGHTS = _HERE / "weights" / "microtubule_v7.pt"
BUNDLED_BACKBONE_CONFIG = _HERE / "config" / "dinov3_vitl16"


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
    """Make sure the checkpoint exists locally, downloading it if necessary."""
    weights = Path(weights)
    if weights.exists():
        return weights
    print(f"[info] checkpoint not found at {weights}; attempting download...")
    from scripts.download_weights import download_weights
    return download_weights(weights)


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
                    help="Path to microtubule_v7.pt (auto-downloaded if missing).")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu", "mps"],
                    help="Compute device.")
    ap.add_argument("--threshold", type=float, default=0.5,
                    help="Seed-probability threshold for the segmentation model.")
    # Measurement geometry (pixels).
    ap.add_argument("--mt-width", type=int, default=5,
                    help="Width of the on-MT band across the centerline (px).")
    ap.add_argument("--bg-gap", type=int, default=1,
                    help="Gap between the MT band and the background ring (px).")
    ap.add_argument("--bg-width", type=int, default=5,
                    help="Width of the background ring (px).")
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
    ap.add_argument("--online-backbone", action="store_true",
                    help="Download the gated DINOv3 backbone from HuggingFace "
                         "instead of rebuilding it offline from the bundled config "
                         "(needs HF_TOKEN). Not normally required.")
    return ap.parse_args()


def main() -> int:
    args = build_args()

    # Default to the fully-offline, no-token backbone path.
    if not args.online_backbone:
        if not BUNDLED_BACKBONE_CONFIG.exists():
            print(f"[error] bundled backbone config missing at "
                  f"{BUNDLED_BACKBONE_CONFIG}", file=sys.stderr)
            return 2
        os.environ["MT_BACKBONE_CONFIG"] = str(BUNDLED_BACKBONE_CONFIG)
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

    from mt_pipeline import (iter_positions, find_nd2_files, measure_frame,
                             CsvWriter, save_overlay, save_annotation_json)

    files = find_nd2_files(args.data)
    if not files:
        print(f"[error] no .nd2 files found under {args.data}", file=sys.stderr)
        return 2
    if args.limit_wells:
        files = files[:args.limit_wells]
    print(f"[info] {len(files)} well file(s) to process from {args.data}")

    weights = ensure_weights(args.weights)
    device = resolve_device(args.device)
    print(f"[info] device={device}  threshold={args.threshold}  "
          f"mt_width={args.mt_width} bg_gap={args.bg_gap} bg_width={args.bg_width}")
    # Say out loud which channel plays which role. A run that segments the wrong
    # channel produces plausible-looking numbers, so the log has to be the place
    # you can check it afterwards without re-deriving it from the code.
    print(f"[info] segmenting channel ~{args.irm_name!r}, "
          f"measuring intensity on channel ~{args.tirf_name!r}, "
          f"solution channel ~{args.solution_name!r}")

    from microtubule import MicrotubuleModel
    t0 = time.time()
    model = MicrotubuleModel().load_weights(str(weights), device)
    print(f"[info] model loaded in {time.time() - t0:.1f}s")

    out = Path(args.out)
    csvw = CsvWriter(out / "results.csv")
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
            print(f"[warn] ({fi}/{len(files)}) failed to read {f.name}: {e}")
            continue

        well = positions[0].well_id if positions else "?"
        for pos in positions:
            ti = time.time()
            solution_median = float(np.median(pos.solution))
            try:
                # IRM, not TIRF: the v7 checkpoint was trained on IRM frames
                # (see microtubule/segment_mt.py). Feeding it TIRF produced
                # confident, wrong centerlines for every run before 2026-08.
                seg = model.predict(pos.irm, seed_threshold=args.threshold)
                centerlines = seg["centerlines_rc"]
            except Exception as e:
                n_fail += 1
                print(f"[warn] segmentation failed {well} pos{pos.position}: {e}")
                continue

            # ...and TIRF for the readout: the centerlines come from IRM, the
            # intensities integrated along them are the TIRF signal.
            rows = measure_frame(pos.tirf, centerlines,
                                 mt_width=args.mt_width, bg_gap=args.bg_gap,
                                 bg_width=args.bg_width, px_um=pos.px_um)
            for r in rows:
                r["well_id"] = pos.well_id
                r["position"] = pos.position
                r["solution_intensity_median"] = round(solution_median, 3)
                r["source_file"] = f.name
                r["acquired_at"] = pos.acquired_at
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
    dt = time.time() - t_start
    print(f"\n[done] {n_pos} positions, {n_mt} microtubules, {n_fail} failures "
          f"in {dt/60:.1f} min")
    print(f"[done] results -> {csvw.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
