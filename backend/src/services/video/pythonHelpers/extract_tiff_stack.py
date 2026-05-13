#!/usr/bin/env python3
"""Multi-page TIFF stack frame extractor.

Reads a TIFF stack (typical microscopy time-lapse) and writes one PNG per
(frame, channel) tuple to ``<dest>/frames/<TTTT>/<channel>.png``.  Emits a
single JSON object on stdout describing the detected channels and shape.

The expected input axes are (in TIFF dimension priority):
  T C Y X     # 4D, multi-channel time-lapse
  T Y X       # 3D, single-channel time-lapse
  T Z C Y X   # 5D, max-projected over Z

Anything else falls through to a single-frame interpretation.

Stdout protocol:
  "PROGRESS <0..1>"             # streamed during the loop
  '{"frameCount": ..., ...}'    # final result, one JSON object on its own line
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import numpy as np


def _sanitize_name(raw: str | None, fallback: str) -> str:
    """Reduce to alnum + underscore + dash so the name is filesystem-safe
    and survives the backend's CHANNEL_NAME_RE whitelist."""
    if not raw:
        return fallback
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", raw).strip("_")
    return safe or fallback


def _imagej_channel_labels(tf, count: int) -> list[str | None]:
    """Best-effort ImageJ channel name extraction.

    `tifffile` exposes ImageJ's tagged metadata as ``tf.imagej_metadata``.
    The conventional location for per-channel labels is ``'Labels'`` —
    a list. Sometimes ImageJ writes one label per slice (T×C entries);
    we slice to the first C. If `Labels` isn't present we return
    all-None and the caller falls back to `"Channel N"`.

    Crashes during metadata parsing must NOT crash the extractor; a
    broken TIFF header is a far worse outcome than unnamed channels.
    """
    try:
        meta = getattr(tf, "imagej_metadata", None)
        if not isinstance(meta, dict):
            return [None] * count
        labels = meta.get("Labels")
        if not isinstance(labels, (list, tuple)) or len(labels) < count:
            return [None] * count
        # ImageJ often writes per-slice labels (one per T×C); the first
        # C entries are the channel names for the first time-point.
        return [labels[i] if isinstance(labels[i], str) else None for i in range(count)]
    except Exception:
        return [None] * count


def _normalize_to_uint8(arr: np.ndarray) -> np.ndarray:
    """Percentile-normalise a 2D array to uint8 PNG-friendly range.

    Microscopy frames are typically 12-16 bit; clipping at the 1st/99.5th
    percentiles matches the convention used by the v7 microtubule model
    so the extracted PNGs look the same as what the model "sees".
    """
    if arr.dtype == np.uint8:
        return arr
    lo, hi = np.percentile(arr, [1.0, 99.5])
    if hi <= lo:
        hi = lo + 1.0
    out = np.clip((arr.astype(np.float32) - lo) / (hi - lo), 0.0, 1.0)
    return (out * 255.0).astype(np.uint8)


def _save_png(arr: np.ndarray, path: Path) -> None:
    from PIL import Image
    Image.fromarray(_normalize_to_uint8(arr)).save(path, format="PNG", optimize=True)


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: extract_tiff_stack.py <src.tif> <dest_dir>", file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    dest.mkdir(parents=True, exist_ok=True)

    try:
        import tifffile
    except ImportError:
        print("tifffile not installed in this Python env", file=sys.stderr)
        return 3

    with tifffile.TiffFile(str(src)) as tf:
        arr = tf.asarray()
        axes = (tf.series[0].axes if tf.series else "").upper()
        # Capture metadata before exiting the `with` — channel-name
        # detection needs the open file object. The actual lookup
        # tolerates absent/broken metadata.
        _C_for_meta = (
            arr.shape[axes.index("C")]
            if "C" in axes
            else (arr.shape[0] if axes.startswith("C") else 1)
        )
        raw_channel_labels = _imagej_channel_labels(tf, _C_for_meta)

    # Resolve into (T, C, Y, X) by inserting unit dims for missing axes.
    if "Z" in axes and arr.ndim >= 3:
        z_idx = axes.index("Z")
        arr = arr.max(axis=z_idx)
        axes = axes.replace("Z", "")

    if axes == "TCYX" and arr.ndim == 4:
        T, C, H, W = arr.shape
    elif axes == "CYXT" and arr.ndim == 4:
        arr = arr.transpose(3, 0, 1, 2)
        T, C, H, W = arr.shape
    elif axes == "TYX" and arr.ndim == 3:
        T, H, W = arr.shape
        C = 1
        arr = arr[:, None, :, :]
    elif arr.ndim == 3 and arr.shape[0] > 1 and arr.shape[-1] not in (3, 4):
        # Heuristic: leading axis is time, single channel.
        T, H, W = arr.shape
        C = 1
        arr = arr[:, None, :, :]
    elif arr.ndim == 2:
        # Single image masquerading as a stack — treat as one frame.
        T, C, H, W = 1, 1, arr.shape[0], arr.shape[1]
        arr = arr[None, None, :, :]
    else:
        print(
            f"Cannot interpret TIFF axes='{axes}' shape={arr.shape}; "
            "expected T[Z]CYX / TYX",
            file=sys.stderr,
        )
        return 4

    # If `_C_for_meta` was guessed before C was known, align it now.
    if len(raw_channel_labels) != C:
        raw_channel_labels = (raw_channel_labels + [None] * C)[:C]

    # Two parallel names per channel:
    #  - `name`        : path-safe, used in URLs + PNG filenames
    #  - `display_name`: human-readable, shown in the UI
    # When metadata gives us a label, use it for both (sanitised in `name`).
    # When no metadata is present, fall back to "Channel N" (1-based) so
    # the UI doesn't surface implementation-y identifiers like "ch0".
    channel_names: list[str] = []
    display_names: list[str] = []
    for i in range(C):
        raw = raw_channel_labels[i]
        display = raw if (isinstance(raw, str) and raw.strip()) else f"Channel {i + 1}"
        display_names.append(display)
        channel_names.append(_sanitize_name(raw, f"Channel_{i + 1}"))

    for t in range(T):
        frame_dir = dest / "frames" / f"{t:04d}"
        frame_dir.mkdir(parents=True, exist_ok=True)
        for c in range(C):
            _save_png(arr[t, c], frame_dir / f"{channel_names[c]}.png")
        if t % 5 == 0 or t == T - 1:
            sys.stdout.write(f"PROGRESS {(t + 1) / T:.4f}\n")
            sys.stdout.flush()

    result = {
        "frameCount": int(T),
        "durationMs": None,  # TIFFs don't carry timing in a standard place
        "width": int(W),
        "height": int(H),
        "channels": [
            {
                "name": channel_names[i],
                "displayName": display_names[i],
                "wavelengthNm": None,
            }
            for i in range(C)
        ],
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
