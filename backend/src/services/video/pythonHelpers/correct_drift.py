"""CLI: remove stage drift from an already-extracted container's frames.

WHY THIS IS A SEPARATE STEP AND NOT PART OF THE EXTRACTOR
---------------------------------------------------------
The estimate has to be driven by the channel the measurements live on — the
label-free/IRM one for a microtubule assay. Two reasons, and the second is the
serious one:

1. It is the channel the segmenter runs on, so it is where the polylines sit.
2. **A fluorescence channel of a motility assay is not measuring the stage.**
   In a gliding assay every filament moves at once; correlating that channel
   frame to frame measures motility and calls it drift, and subtracting it
   would cancel exactly the signal the experiment exists to record. This is the
   same trap `mt_geometry_cost.estimate_drift` documents on the geometry side.

Which channel that is, is decided by `isIrmChannel` in `video/types.ts`, on the
TypeScript side, AFTER the extractor has returned its channel list. Teaching
this script the same rule would put one contract in two languages — the exact
split that produced the 2026-08-26 channel-name incident, where the Python
writer and the TypeScript reader disagreed about what a legal name was and
nine containers became unreadable.

So the caller, which already knows the answer, passes it in.

Measured cost of getting it wrong (2026-08-30): across 65 production
microtubule containers the segmentation source is channel 0 on 45 of them,
channel 1 on 14 and channel 2 on 6. On seven containers where channel 0 is
`TIRF_488` and the source is `IRM`, the two trajectories disagree by up to
**27.8 px**, and on two of them the choice flips whether any correction happens
at all.

Usage:

    correct_drift.py <container_dir> <source_channel> <ch1,ch2,...>

Reads ``<container_dir>/frames/<NNNN>/<channel>.png``, rewrites them in place
with the rounded correction, writes ``<container_dir>/drift.json``, and folds
the correction into ``<container_dir>/registration.json`` — see
``drift_correction.compose_into_registration_offsets`` for why that last step
is not optional. Prints one JSON object on stdout.

WHICH channel drives the estimate is decided on the TypeScript side by
``resolveSegmentationSource`` (video/types.ts): the channel the extractor marked
via ``isIrmChannel``, else channel 0. That fallback is NOT a guarantee — a stack
whose channels cannot be typed (every plain multi-page TIFF carries no
wavelength) gets no IRM mark and drives the estimate from channel 0, which on
seven production containers is TIRF. The user can override it per container.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from channel_registration import (
    REASON_NOT_REGISTERED,
    read_registration_sidecar,
    write_registration_sidecar,
)
from drift_correction import compose_into_registration_offsets, correct_drift_in_place

#: The rewrite failed after moving pixels. Distinct from any other non-zero
#: exit so the caller can tell "declined, nothing touched" from "half-written".
EXIT_REWRITE_FAILED = 4


def main() -> int:
    argv = sys.argv[1:]
    if len(argv) < 3:
        print(
            "usage: correct_drift.py <container_dir> <source_channel> "
            "<ch1,ch2,...>",
            file=sys.stderr,
        )
        return 2

    container = Path(argv[0])
    source_channel = argv[1]
    channel_names = [c for c in argv[2].split(",") if c]
    frames_dir = container / "frames"

    if source_channel not in channel_names:
        print(
            f"source channel {source_channel!r} is not among {channel_names}",
            file=sys.stderr,
        )
        return 2
    if not frames_dir.is_dir():
        print(f"no frames directory at {frames_dir}", file=sys.stderr)
        return 2

    # A raise from here means the REWRITE failed part-way: some frames are
    # de-drifted and some are not, and `registration.json` was never composed.
    # That is not a decline, it is a corrupted container, and it exits with a
    # distinct code so the caller can roll the upload back instead of logging a
    # warning and finalising it. Declines return normally with a reason.
    # ``PROGRESS <0..1>`` on stdout is the protocol `pythonExtractor.runHelper`
    # already parses (see `extract_nd2.py`). Drift correction is silent for tens
    # of seconds on a long stack — 48 s on the 300-frame ND2 that prompted this
    # — and that silence used to reach the user as a frozen progress bar.
    def _progress(fraction: float) -> None:
        sys.stdout.write(f"PROGRESS {max(0.0, min(1.0, fraction)):.4f}\n")
        sys.stdout.flush()

    try:
        drift = correct_drift_in_place(
            frames_dir, channel_names, source_channel, on_progress=_progress
        )
    except Exception as exc:  # noqa: BLE001 - re-raised as a distinct exit code
        print(
            f"drift: REWRITE FAILED PART-WAY on {frames_dir} "
            f"({type(exc).__name__}: {exc}). Frames are in MIXED coordinate "
            f"spaces (some de-drifted, some not) and registration.json was not "
            f"composed; this container must not be kept.",
            file=sys.stderr,
        )
        return EXIT_REWRITE_FAILED

    if not drift["corrected"]:
        print(json.dumps(drift))
        return 0

    # From here the PIXELS HAVE MOVED. Composing the sidecar is what keeps the
    # stored frames and the raw file in the same space, so a failure in any of
    # the steps below leaves exactly the state
    # `compose_into_registration_offsets` exists to prevent: de-drifted PNGs
    # measured against an un-composed map, silently, by exactly the drift.
    # Same exit code as a failed rewrite, for the same reason — the container
    # must not be kept.
    try:
        return _finish(container, channel_names, source_channel, drift)
    except Exception as exc:  # noqa: BLE001 - re-raised as a distinct exit code
        print(
            f"drift: frames were rewritten but the sidecar could not be "
            f"composed on {container} ({type(exc).__name__}: {exc}). The stored "
            f"frames are de-drifted and registration.json does not say so; this "
            f"container must not be kept.",
            file=sys.stderr,
        )
        return EXIT_REWRITE_FAILED


def _finish(container, channel_names, source_channel, drift) -> int:
    """Persist the provenance and fold the drift into the registration map."""

    (container / "drift.json").write_text(json.dumps(drift))

    # Fold into the channel-registration offsets so the map that samples the
    # RAW original stays true. Both are integer translations of one plane, so
    # they compose by addition. When registration never ran there is no sidecar
    # to extend, and one is created carrying the drift alone — without it
    # `mtMetricsExporter` reads the untouched original and every intensity is
    # off by exactly the drift.
    existing = read_registration_sidecar(container)
    if existing is not None:
        names, offsets, reasons = existing
    else:
        offsets = {
            int(t): [[0, 0] for _ in channel_names] for t in drift["applied"]
        }
        # Drift ran, channel registration did not — so these offsets carry the
        # drift alone. `ok` would claim an estimate that never happened.
        reasons = {
            int(t): [REASON_NOT_REGISTERED] * len(channel_names)
            for t in drift["applied"]
        }
        names = channel_names

    compose_into_registration_offsets(offsets, drift)
    write_registration_sidecar(container, names, offsets, reasons)

    print(
        json.dumps(
            {
                "corrected": True,
                "sourceChannel": source_channel,
                "pairsMeasured": drift["pairsMeasured"],
                "pairsAccepted": drift["pairsAccepted"],
                "anchored": drift["anchored"],
                "maxApplied": max(
                    max(abs(dy), abs(dx)) for dy, dx in drift["applied"].values()
                ),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
