"""Command line entry points: calibrate thresholds from z-stacks, then flag frames.

    python -m focus_qc.cli calibrate --dataset spec.json --out calibration.json
    python -m focus_qc.cli detect --calibration calibration.json --input movie.nd2
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Mapping

import numpy as np

from .calibration import Calibration, DomainRange, evaluate, pick_threshold
from .detect import ChannelSpec, judge_frame, score_frame
from .metrics import BG_SIZE, GRAD_SIGMA, K_SIGMA, POLARITY, FrameStats
from .zstack import IN_FOCUS, OUT_OF_FOCUS, iter_stack_planes, label_planes, pooled, score_stack

#: Exit code for "ran fine, but the result should not be trusted as-is".
EXIT_UNTRUSTWORTHY = 3


def _load_spec(path: str) -> dict:
    spec = json.loads(Path(path).read_text())
    spec["channels"] = [ChannelSpec(**c) for c in spec["channels"]]
    return spec


def _fingerprint(spec: dict) -> dict:
    """Everything a cached score depends on, so a stale cache cannot be reused.

    Without this, editing a channel's modality or a descriptor constant and
    re-running with ``--cache`` refits thresholds onto scores the current code
    would never produce -- silently, with a healthy-looking validation report.
    """
    return {
        "descriptor": {"BG_SIZE": BG_SIZE, "K_SIGMA": K_SIGMA, "GRAD_SIGMA": GRAD_SIGMA,
                       "POLARITY": dict(POLARITY)},
        "channels": [[c.name, c.modality] for c in spec["channels"]],
        "stacks": [s["path"] for s in spec["stacks"]],
    }


def _encode(stats: FrameStats) -> dict:
    """One ``FrameStats`` as JSON, with NaN written as ``null``.

    ``json.dumps`` emits the bare token ``NaN`` by default, which is not valid
    JSON and silently breaks every non-Python reader -- ``cmd_calibrate`` passes
    ``allow_nan=False`` for ``calibration.json`` for exactly that reason. The
    cache needs it just as much: ``sharpness`` is NaN on any plane holding fewer
    than ``MIN_STRUCTURE_PX`` structure pixels, which is 144 of the 410 entries
    in the committed reference cache.
    """
    return {k: (None if isinstance(v, float) and not np.isfinite(v) else v)
            for k, v in vars(stats).items()}


def _decode(d: Mapping) -> FrameStats:
    """The inverse. ``null`` comes back as NaN, and so does a bare ``NaN``.

    Both spellings are accepted on purpose: the reference cache in this
    repository predates ``_encode`` and still carries bare ``NaN`` tokens, which
    Python's own parser reads happily.
    """
    return FrameStats(**{k: (float("nan") if v is None else v) for k, v in d.items()})


def _write_cache(path: Path, spec: dict, scored: dict) -> None:
    path.write_text(json.dumps({
        "fingerprint": _fingerprint(spec),
        "scores": {k: {ch: [_encode(s) for s in v] for ch, v in chans.items()}
                   for k, chans in scored.items()},
    }, allow_nan=False))


def _score_all(spec: dict, cache: Path | None) -> dict[str, dict[str, list[FrameStats]]]:
    """Score every stack, reusing a cache only when it provably matches this run."""
    if cache and cache.exists():
        raw = json.loads(cache.read_text())
        want, got = _fingerprint(spec), raw.get("fingerprint")
        if got != want:
            differing = [k for k in want if got is None or got.get(k) != want[k]]
            raise ValueError(
                f"{cache} was written for a different {' and '.join(differing) or 'run'}; "
                "its scores do not match this spec or this descriptor -- delete the cache "
                "and re-run, or point --cache at a fresh file."
            )
        return {k: {ch: [_decode(s) for s in v] for ch, v in chans.items()}
                for k, chans in raw["scores"].items()}
    out = {}
    for stack in spec["stacks"]:
        print(f"  scoring {Path(stack['path']).name} ...", flush=True)
        out[stack["path"]] = score_stack(stack["path"], spec["channels"])
    if cache:
        _write_cache(cache, spec, out)
    return out


def _labels_for(spec, stack, n_planes, tolerance_um, guard_um):
    return label_planes(n_planes, stack["sharp_plane"], spec["z_step_um"], tolerance_um, guard_um)


def _fit(spec, scored, stacks, tolerance_um, guard_um) -> tuple[dict, dict]:
    """Thresholds and acquisition-domain ranges from the given stacks.

    Keyed by modality, which is what makes a calibration transferable between
    acquisitions whose channels are labelled differently. Two channels sharing a
    modality would therefore collide, so that is refused rather than resolved.
    """
    seen: dict[str, str] = {}
    for channel in spec["channels"]:
        if channel.modality in seen:
            raise ValueError(
                f"channels {seen[channel.modality]!r} and {channel.name!r} both declare "
                f"modality {channel.modality!r}; thresholds are keyed by modality, so one "
                "would silently overwrite the other. Calibrate them separately."
            )
        seen[channel.modality] = channel.name

    thresholds, domain = {}, {}
    for channel in spec["channels"]:
        good, bad, sigmas, backgrounds = [], [], [], []
        for stack in stacks:
            stats = scored[stack["path"]][channel.name]
            labels = _labels_for(spec, stack, len(stats), tolerance_um, guard_um)
            scores = np.array([s.score for s in stats])
            good.append(pooled(scores, labels, IN_FOCUS))
            bad.append(pooled(scores, labels, OUT_OF_FOCUS))
            sigmas += [s.noise_sigma for s, l in zip(stats, labels) if l == IN_FOCUS]
            backgrounds += [s.background for s, l in zip(stats, labels) if l == IN_FOCUS]
        thresholds[channel.modality] = pick_threshold(np.concatenate(good), np.concatenate(bad))
        domain[channel.modality] = DomainRange(
            noise_sigma=(float(np.min(sigmas)), float(np.max(sigmas))),
            background=(float(np.min(backgrounds)), float(np.max(backgrounds))),
        )
    return thresholds, domain


def _write_rows(path, rows, on_empty: str) -> None:
    """Write the CSV, refusing *before* truncating anything if there is nothing to write."""
    if not rows:
        raise ValueError(on_empty)
    with open(path, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def cmd_calibrate(args) -> int:
    spec = _load_spec(args.dataset)
    # Checked BEFORE scoring: leave-one-stack-out holds one stack out and fits
    # on the rest, so with a single stack `_fit` reaches np.concatenate([]) and
    # dies with a bare numpy message -- after the user has already paid to score
    # the stack, which is the expensive part.
    if len(spec["stacks"]) < 2:
        print(f"error: {args.dataset} lists {len(spec['stacks'])} stack(s), and "
              "leave-one-stack-out validation needs at least 2 -- it fits the "
              "threshold on the others and tests it on the held-out one. Add "
              "another annotated z-stack.", file=sys.stderr)
        return 2
    cache = Path(args.cache) if args.cache else None
    print("scoring stacks (cached after the first run)")
    scored = _score_all(spec, cache)
    stacks = spec["stacks"]

    lines = ["# focus_qc calibration report", "",
             f"- tolerance: +-{args.tolerance_um} um   guard band: {args.guard_um} um",
             f"- stacks: {len(stacks)}", ""]

    print("\nleave-one-stack-out validation")
    lines += ["## Leave-one-stack-out validation", "",
              "| held-out stack | channel | threshold from others | sensitivity | specificity | balanced acc |",
              "|---|---|---|---|---|---|"]
    per_channel_ba: dict[str, list[float]] = {}
    for held in stacks:
        others = [s for s in stacks if s["path"] != held["path"]]
        thresholds, _ = _fit(spec, scored, others, args.tolerance_um, args.guard_um)
        n = len(scored[held["path"]][spec["channels"][0].name])
        labels = _labels_for(spec, held, n, args.tolerance_um, args.guard_um)
        keep = np.ones(n, bool)
        for channel in spec["channels"]:
            stats = scored[held["path"]][channel.name]
            scores = np.array([s.score for s in stats])
            keep &= scores >= thresholds[channel.modality]
            r = evaluate(scores, labels, thresholds[channel.modality])
            per_channel_ba.setdefault(channel.name, []).append(r["balanced_accuracy"])
            lines.append(f"| {Path(held['path']).stem} | {channel.name} | "
                         f"{thresholds[channel.modality]:.3g} | {r['sensitivity']:.2f} | "
                         f"{r['specificity']:.2f} | {r['balanced_accuracy']:.3f} |")
        r = evaluate(keep.astype(float), labels, threshold=0.5)
        per_channel_ba.setdefault("OR (frame verdict)", []).append(r["balanced_accuracy"])
        lines.append(f"| {Path(held['path']).stem} | **OR rule** | - | {r['sensitivity']:.2f} | "
                     f"{r['specificity']:.2f} | **{r['balanced_accuracy']:.3f}** |")
    lines += ["", "| channel | mean balanced acc | worst fold |", "|---|---|---|"]
    for name, values in per_channel_ba.items():
        lines.append(f"| {name} | {np.mean(values):.3f} | {np.min(values):.3f} |")
        print(f"  {name:22} mean BA={np.mean(values):.3f}  worst={np.min(values):.3f}")

    thresholds, domain = _fit(spec, scored, stacks, args.tolerance_um, args.guard_um)
    calibration = Calibration(
        thresholds=thresholds, domain=domain, tolerance_um=args.tolerance_um,
        notes=args.notes or f"fitted on {len(stacks)} z-stacks",
        metrics={k: {"mean_balanced_accuracy": float(np.mean(v)), "worst_fold": float(np.min(v))}
                 for k, v in per_channel_ba.items()},
    )
    # allow_nan=False so an undefined metric becomes a write-time error rather than
    # the bare token NaN, which is not valid JSON for any non-Python reader.
    Path(args.out).write_text(json.dumps(calibration.to_dict(), indent=2, allow_nan=False))
    lines += ["", "## Final calibration (all stacks)", "",
              "| modality | threshold | noise sigma range | background range |", "|---|---|---|---|"]
    for m, t in thresholds.items():
        d = domain[m]
        lines.append(f"| {m} | {t:.4g} | {d.noise_sigma[0]:.3g} – {d.noise_sigma[1]:.3g} | "
                     f"{d.background[0]:.5g} – {d.background[1]:.5g} |")
    print(f"\nwrote {args.out}")
    if args.report:
        Path(args.report).write_text("\n".join(lines) + "\n")
        print(f"wrote {args.report}")
    return 0


def cmd_detect(args) -> int:
    calibration = Calibration.from_dict(json.loads(Path(args.calibration).read_text()))
    spec = _load_spec(args.dataset) if args.dataset else None
    channels = spec["channels"] if spec else [
        ChannelSpec(name=n, modality=m) for n, m in (args.channel or [])
    ]
    if not channels:
        print("error: give --dataset (for its channels) or one or more --channel NAME MODALITY",
              file=sys.stderr)
        return 2
    missing = sorted({c.modality for c in channels} - set(calibration.thresholds))
    if missing:
        print(f"error: {args.calibration} covers modalities {sorted(calibration.thresholds)}, "
              f"but the channels need {missing}. Recalibrate for these channels.", file=sys.stderr)
        return 2

    rows = []
    for frame_index, plane in enumerate(iter_stack_planes(args.input, channels), start=1):
        verdict = judge_frame(score_frame(plane, channels), channels, calibration)
        row = {"frame": frame_index, "flagged": int(verdict.flagged),
               "unscoreable": ";".join(verdict.unscoreable),
               "out_of_calibration": ";".join(verdict.out_of_calibration)}
        for channel in channels:
            score = verdict.scores[channel.name]
            # Blank, not the literal `nan`: an unscoreable frame produced no
            # measurement, and `nan` in a CSV cell reads as one. The frame is
            # still flagged, and `unscoreable` names the channel.
            row[f"{channel.name}_score"] = ("" if not np.isfinite(score)
                                            else round(score, 4))
            row[f"{channel.name}_flag"] = int(verdict.channel_flags[channel.name])
        rows.append(row)

    _write_rows(args.out, rows,
                on_empty=f"{args.input} yielded no frames, so {args.out} was left untouched")
    flagged = sum(r["flagged"] for r in rows)
    print(f"{flagged}/{len(rows)} frames flagged as out of focus -> {args.out}")

    # The domain guard is worthless if nobody sees it, so surface it here and in the
    # exit code rather than leaving it as a column the user must go looking for.
    drifted = sum(1 for r in rows if r["out_of_calibration"])
    unscoreable = sum(1 for r in rows if r["unscoreable"])
    if unscoreable:
        print(f"WARNING: {unscoreable}/{len(rows)} frames could not be scored at all "
              "(constant, saturated, or non-finite) and were flagged.", file=sys.stderr)
    if drifted:
        print(f"WARNING: {drifted}/{len(rows)} frames sit outside the acquisition domain this "
              "calibration was fitted on. The absolute thresholds may not apply -- recalibrate "
              "for this exposure and camera setting.", file=sys.stderr)
    return EXIT_UNTRUSTWORTHY if (drifted or unscoreable) else 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="focus_qc")
    sub = parser.add_subparsers(dest="command", required=True)

    c = sub.add_parser("calibrate", help="fit thresholds from annotated z-stacks")
    c.add_argument("--dataset", required=True, help="JSON spec: z_step_um, channels, stacks")
    c.add_argument("--out", required=True)
    c.add_argument("--report")
    c.add_argument("--cache", help="cache scored stacks here to make re-runs instant")
    c.add_argument("--tolerance-um", type=float, default=0.3)
    c.add_argument("--guard-um", type=float, default=0.1)
    c.add_argument("--notes", default="")
    c.set_defaults(func=cmd_calibrate)

    d = sub.add_parser("detect", help="flag out-of-focus frames in an ND2 file")
    d.add_argument("--calibration", required=True)
    d.add_argument("--input", required=True)
    d.add_argument("--out", default="focus_flags.csv")
    d.add_argument("--dataset", help="reuse the channel list from a calibration spec")
    d.add_argument("--channel", nargs=2, action="append", metavar=("NAME", "MODALITY"))
    d.set_defaults(func=cmd_detect)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
