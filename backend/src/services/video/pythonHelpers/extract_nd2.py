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
        # Genuine flat-fields exist but are rare; far more likely the
        # decoder returned an empty/uniform array. Surface on stderr
        # (stdout is reserved for the PROGRESS / result-JSON protocol).
        print(
            f"WARNING: frame has min==max ({lo}); writing black PNG",
            file=sys.stderr,
        )
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


class UnsupportedND2(ValueError):
    """Raised for ND2 layouts we deliberately reject with a user-facing
    message (rather than silently mis-extracting)."""


def normalize_to_tcyx(arr: np.ndarray, axes: str) -> np.ndarray:
    """Reshape an ND2 array to canonical ``(T, C, Y, X)``.

    Handles the real-world axis layouts we see in the wild:

    - ``Z`` (focus stack)            → max-intensity projection (singleton Z
      is simply squeezed).
    - singleton loop axes (``P``     → squeezed away. NIS-Elements often
      position, ``S`` sample, …)        exports per-field files that still
                                        carry a length-1 ``P`` axis, which
                                        the old ``TCYX``-only path rejected.
    - missing ``T`` and/or ``C``     → inserted as length-1 so ``arr[t, c]``
                                        indexing downstream always works.

    A genuine multi-position acquisition (a ``P`` / other loop axis with
    size > 1) has no single-video meaning, so it is rejected with an
    actionable :class:`UnsupportedND2` message instead of silently
    exporting only the first position.

    ``axes`` is the dimension-name string aligned with ``arr`` (e.g.
    ``"PTCYX"``); ``len(axes) == arr.ndim``.
    """
    ax = list(axes)

    if "Z" in ax:
        zi = ax.index("Z")
        arr = arr.max(axis=zi) if arr.shape[zi] > 1 else np.squeeze(arr, axis=zi)
        ax.pop(zi)

    # Drop non-core axes. Singletons squeeze cleanly; a size>1 loop axis is
    # multi-position content we can't fold into one video.
    i = 0
    while i < len(ax):
        a = ax[i]
        if a in ("T", "C", "Y", "X"):
            i += 1
            continue
        if arr.shape[i] == 1:
            arr = np.squeeze(arr, axis=i)
            ax.pop(i)
            continue
        raise UnsupportedND2(
            f"Multi-position ND2 not supported: this file has {arr.shape[i]} "
            f"positions ('{a}' axis). In NIS-Elements split the points into "
            f"separate single-field files and re-upload one per video."
        )

    if "Y" not in ax or "X" not in ax:
        raise UnsupportedND2(
            f"Unsupported ND2 axes '{''.join(ax)}' shape={arr.shape}: "
            f"no Y/X image plane found."
        )

    # Insert any missing leading dims so the canonical order is complete.
    if "T" not in ax:
        arr = arr[None, ...]
        ax.insert(0, "T")
    if "C" not in ax:
        ci = ax.index("Y")
        arr = np.expand_dims(arr, axis=ci)
        ax.insert(ci, "C")

    perm = [ax.index(a) for a in ("T", "C", "Y", "X")]
    return np.transpose(arr, perm)


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
        axes = "".join(f.sizes.keys())  # e.g. "TCYX", "TZCYX", "PTCYX"

        # Normalize to canonical (T, C, Y, X) — squeezes singleton loop axes
        # (e.g. a length-1 P from per-field NIS exports), max-projects Z, and
        # rejects genuine multi-position files with a user-facing message.
        try:
            arr = normalize_to_tcyx(arr, axes)
        except UnsupportedND2 as exc:
            print(str(exc), file=sys.stderr)
            return 4

        # Trust the post-normalization shape over the raw `sizes` (which may
        # have included the squeezed/projected axes).
        T, C, H, W = (
            int(arr.shape[0]),
            int(arr.shape[1]),
            int(arr.shape[2]),
            int(arr.shape[3]),
        )

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

        # Duration and frame interval. duration_ms = end−start span;
        # frame_interval_ms = median Δ of consecutive timestamps (more
        # robust to a single dropped frame than the simple average).
        duration_ms = None
        frame_interval_ms = None
        try:
            events = f.events()
            if events and "Time [s]" in events[0]:
                ts = [e["Time [s]"] for e in events if "Time [s]" in e]
                if len(ts) >= 2:
                    duration_ms = int((ts[-1] - ts[0]) * 1000)
                    deltas = np.diff(np.asarray(ts, dtype=np.float64))
                    pos = deltas[deltas > 0]  # drop clock-glitch negatives
                    if pos.size > 0:
                        frame_interval_ms = float(np.median(pos) * 1000.0)
        except Exception as exc:
            sys.stderr.write(f"ND2 events parse failed: {exc}\n")

        # Pixel calibration. `voxel_size()` returns (x, y, z) in µm; we
        # pick x. Log a stderr warning when y differs noticeably so an
        # anisotropic acquisition doesn't silently get x-only treatment.
        pixel_size_um = None
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
