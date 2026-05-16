#!/usr/bin/env python3
"""Metadata-only extractor for an existing ND2 or multi-page TIFF on disk.

The full extractors (``extract_nd2.py``, ``extract_tiff_stack.py``) do
the frame-writing pass AND the metadata pass in one shot. For
backfilling calibration on already-extracted containers, we only need
the metadata — re-writing every frame would rewrite existing PNGs
and invalidate cached thumbnails for no benefit.

This helper reuses the pure metadata helpers from the existing
extractors via direct imports (no PNG output, no full array load).

Stdout protocol (one JSON line on its own):
  {"pixelSizeUm": <float|null>, "frameIntervalMs": <float|null>}
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def _extract_nd2(path: Path) -> dict:
    """ND2 metadata via the `nd2` Python library. Mirrors the
    `voxel_size().x` + median Δ over `Time [s]` events logic in
    `extract_nd2.py` but skips the per-frame PNG pass entirely.
    """
    import nd2  # type: ignore
    import numpy as np

    pixel_size_um: float | None = None
    frame_interval_ms: float | None = None

    with nd2.ND2File(str(path)) as f:
        # Pixel calibration — isotropic, X axis, with anisotropy warning.
        try:
            v = f.voxel_size()
            x_um = getattr(v, "x", None) if v is not None else None
            y_um = getattr(v, "y", None) if v is not None else None
            if isinstance(x_um, (int, float)) and x_um > 0:
                if (
                    isinstance(y_um, (int, float))
                    and y_um > 0
                    and abs(x_um - y_um) / x_um > 0.01
                ):
                    sys.stderr.write(
                        f"ND2 anisotropic XY: x={x_um} y={y_um}, using x\n"
                    )
                pixel_size_um = float(x_um)
        except Exception as exc:
            sys.stderr.write(f"ND2 voxel_size read failed: {exc}\n")

        # Frame interval — median Δ over per-event Time [s].
        try:
            events = f.events()
            if events and "Time [s]" in events[0]:
                ts = [e["Time [s]"] for e in events if "Time [s]" in e]
                if len(ts) >= 2:
                    deltas = np.diff(np.asarray(ts, dtype=np.float64))
                    pos = deltas[deltas > 0]
                    if pos.size > 0:
                        frame_interval_ms = float(np.median(pos) * 1000.0)
        except Exception as exc:
            sys.stderr.write(f"ND2 events parse failed: {exc}\n")

    return {
        "pixelSizeUm": pixel_size_um,
        "frameIntervalMs": frame_interval_ms,
    }


def _extract_tiff(path: Path) -> dict:
    """TIFF metadata via the helpers in ``extract_tiff_stack.py``.

    Mirrors ``_extract_nd2``'s per-step exception isolation: a parser
    raising on one of the two values should leave the other intact, so
    a partially-readable TIFF still backfills what it can. Errors are
    logged to stderr (the agreed logging channel for this script) and
    the offending field is left as ``None``.
    """
    import tifffile  # type: ignore

    from extract_tiff_stack import (
        _detect_pixel_size_um,
        _detect_frame_interval_ms,
    )

    pixel_size_um: float | None = None
    frame_interval_ms: float | None = None

    with tifffile.TiffFile(str(path)) as tf:
        try:
            pixel_size_um = _detect_pixel_size_um(tf)
        except Exception as exc:
            sys.stderr.write(f"TIFF pixel-size detect failed: {exc}\n")
        try:
            frame_interval_ms = _detect_frame_interval_ms(tf)
        except Exception as exc:
            sys.stderr.write(f"TIFF frame-interval detect failed: {exc}\n")

    return {
        "pixelSizeUm": pixel_size_um,
        "frameIntervalMs": frame_interval_ms,
    }


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: extract_metadata_only.py <src>", file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    if not src.is_file():
        print(f"file not found: {src}", file=sys.stderr)
        return 3

    ext = src.suffix.lower()
    try:
        if ext == ".nd2":
            result = _extract_nd2(src)
        elif ext in (".tif", ".tiff"):
            result = _extract_tiff(src)
        else:
            print(f"unsupported extension: {ext}", file=sys.stderr)
            return 4
    except Exception as exc:
        # Surface the underlying error to stderr so the Node caller's
        # backfill log shows WHY this container couldn't be calibrated.
        print(f"extraction failed: {exc}", file=sys.stderr)
        return 5

    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
