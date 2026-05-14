#!/usr/bin/env python3
"""Nikon ND2 frame extractor.

Uses the ``nd2`` package (Apache-2.0, pure Python, no JVM) to decode
Nikon NIS-Elements ND2 files and write per-frame per-channel PNGs.

Stdout protocol: same as extract_tiff_stack.py.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np


def _to_png_dtype(arr: np.ndarray) -> np.ndarray:
    """Coerce to a dtype PIL can write losslessly to PNG, preserving bit depth.

    PNG supports 8- and 16-bit unsigned grayscale natively.
    - uint8/uint16 → as-is (Pillow picks 'L' / 'I;16')
    - int16 → shift into uint16 range with the same offset; reversible
    - other (float, int32, …) → rescale to uint16 per-frame; warned, since
      microscopy float frames lose absolute scale across the sequence.
    """
    if arr.dtype in (np.uint8, np.uint16):
        return arr
    if arr.dtype == np.int16:
        return (arr.astype(np.int32) + 32768).astype(np.uint16)
    lo, hi = float(arr.min()), float(arr.max())
    if hi <= lo:
        return np.zeros(arr.shape, dtype=np.uint16)
    out = (arr.astype(np.float64) - lo) / (hi - lo) * 65535.0
    return np.clip(out, 0.0, 65535.0).astype(np.uint16)


def _save_png(arr: np.ndarray, path: Path) -> None:
    from PIL import Image
    Image.fromarray(_to_png_dtype(arr)).save(path, format="PNG", optimize=True)


def _sanitize_name(name: str | None, fallback: str) -> str:
    if not name:
        return fallback
    # Filesystem-safe: alnum + underscore + dash only.
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return safe or fallback


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: extract_nd2.py <src.nd2> <dest_dir>", file=sys.stderr)
        return 2
    src = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    dest.mkdir(parents=True, exist_ok=True)

    try:
        import nd2
    except ImportError:
        print("nd2 not installed in this Python env (pip install nd2)", file=sys.stderr)
        return 3

    with nd2.ND2File(str(src)) as f:
        # sizes is an OrderedDict: {'T': N, 'C': N, 'Y': N, 'X': N} typically.
        sizes = dict(f.sizes)
        T = sizes.get("T", 1)
        C = sizes.get("C", 1)
        Z = sizes.get("Z", 1)
        H = sizes.get("Y", 0)
        W = sizes.get("X", 0)

        arr = f.asarray()
        axes = "".join(f.sizes.keys())  # e.g. "TCYX" or "TZCYX"

        # Reduce Z via max projection if present.
        if "Z" in axes and Z > 1:
            z_idx = axes.index("Z")
            arr = arr.max(axis=z_idx)
            axes = axes.replace("Z", "")
            Z = 1

        # Normalize axes order to TCYX.
        if axes == "CYX" and arr.ndim == 3:
            arr = arr[None, ...]  # add T dim
            T = 1
        elif axes == "YX" and arr.ndim == 2:
            arr = arr[None, None, ...]
            T, C = 1, 1
        elif axes == "TYX" and arr.ndim == 3:
            arr = arr[:, None, :, :]
            C = 1
        elif axes != "TCYX":
            # Try to reorder via numpy einsum-style transpose.
            try:
                target = "TCYX"
                perm = [axes.index(ax) for ax in target if ax in axes]
                arr = np.transpose(arr, perm)
            except ValueError:
                print(
                    f"Unsupported ND2 axes='{axes}' shape={arr.shape}",
                    file=sys.stderr,
                )
                return 4

        # Channel metadata: name + emission wavelength.
        # `displayName` is the human-friendly label (ND2 metadata name, or
        # "Channel N" 1-based fallback). `name` is the path-safe form
        # used for the PNG filename and URLs.
        channel_meta = []
        for c in range(C):
            try:
                ch = f.metadata.channels[c]
                raw_name = getattr(ch.channel, "name", None)
                emission = None
                em_info = getattr(ch.channel, "emissionLambdaNm", None)
                if isinstance(em_info, (int, float)):
                    emission = float(em_info)
            except Exception:
                raw_name = None
                emission = None
            has_raw = isinstance(raw_name, str) and raw_name.strip() != ""
            display = raw_name if has_raw else f"Channel {c + 1}"
            channel_meta.append({
                "rawName": raw_name,
                "displayName": display,
                "name": _sanitize_name(raw_name, f"Channel_{c + 1}"),
                "wavelengthNm": emission,
            })

        # Duration: nd2 sometimes exposes frame intervals.
        duration_ms = None
        try:
            events = f.events()
            if events and "Time [s]" in events[0]:
                start = events[0]["Time [s]"]
                end = events[-1]["Time [s]"]
                duration_ms = int((end - start) * 1000)
        except Exception:
            pass

    for t in range(T):
        frame_dir = dest / "frames" / f"{t:04d}"
        frame_dir.mkdir(parents=True, exist_ok=True)
        for c in range(C):
            _save_png(arr[t, c], frame_dir / f"{channel_meta[c]['name']}.png")
        if t % 5 == 0 or t == T - 1:
            sys.stdout.write(f"PROGRESS {(t + 1) / T:.4f}\n")
            sys.stdout.flush()

    result = {
        "frameCount": int(T),
        "durationMs": duration_ms,
        "width": int(W),
        "height": int(H),
        "channels": [
            {
                "name": ch["name"],
                "displayName": ch["displayName"],
                "wavelengthNm": ch["wavelengthNm"],
            }
            for ch in channel_meta
        ],
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
