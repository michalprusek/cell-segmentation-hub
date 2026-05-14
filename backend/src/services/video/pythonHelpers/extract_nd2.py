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


def _normalize_to_uint8(arr: np.ndarray) -> np.ndarray:
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

        # Duration + frame interval: ND2 events carry per-frame "Time [s]".
        # Median Δ between consecutive timestamps is more robust than
        # (last-first)/(N-1): a single dropped frame inflates the average.
        # We keep the legacy `duration_ms` (end-start) since downstream
        # code is already wired to it.
        duration_ms = None
        frame_interval_ms = None
        try:
            events = f.events()
            if events and "Time [s]" in events[0]:
                ts = [e["Time [s]"] for e in events if "Time [s]" in e]
                if len(ts) >= 2:
                    duration_ms = int((ts[-1] - ts[0]) * 1000)
                    deltas = np.diff(np.asarray(ts, dtype=np.float64))
                    # Drop non-positive deltas (clock glitches) before median.
                    pos = deltas[deltas > 0]
                    if pos.size > 0:
                        frame_interval_ms = float(np.median(pos) * 1000.0)
        except Exception:
            pass

        # Pixel calibration. `voxel_size()` returns named tuple (x, y, z)
        # in micrometers. ND2 is essentially always isotropic in XY, but
        # we explicitly pick `x` rather than asserting equality so a
        # mildly anisotropic acquisition still produces a single value.
        pixel_size_um = None
        try:
            v = f.voxel_size()
            x_um = getattr(v, "x", None) if v is not None else None
            if isinstance(x_um, (int, float)) and x_um > 0:
                pixel_size_um = float(x_um)
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
        "frameIntervalMs": frame_interval_ms,
        "pixelSizeUm": pixel_size_um,
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
