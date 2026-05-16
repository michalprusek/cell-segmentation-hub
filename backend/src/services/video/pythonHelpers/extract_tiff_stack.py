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


def _to_png_dtype(arr: np.ndarray) -> np.ndarray:
    """Coerce to a dtype PIL can write losslessly to PNG, preserving bit depth.

    PNG supports 8- and 16-bit unsigned grayscale natively.
    - uint8/uint16 → as-is (Pillow picks 'L' / 'I;16')
    - int16 → shift into uint16 range with the same offset; reversible
    - other (float, int32, …) → rescale to uint16 per-frame
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


def _detect_pixel_size_um(tf) -> float | None:
    """Best-effort extraction of isotropic pixel size in micrometers.

    Tries three sources, each unit-checked before returning:
      1. OME-XML ``<Pixels PhysicalSizeX PhysicalSizeXUnit>``
      2. ImageJ ``imagej_metadata`` dedicated keys, then regex over the
         multi-line ``info`` block — unit comes from ``unit`` / ``xunit``
         on the metadata dict (or an inline unit captured from the regex).
      3. Raw TIFF ``XResolution`` (rational pixels/unit) combined with
         ``ResolutionUnit`` (1=none, 2=inch, 3=cm).

    Returns ``None`` whenever the unit is unknown or absent — the
    µm-typed field downstream must never carry an ambiguous value.
    Parse failures are non-fatal but emit a one-line stderr warning so
    ops can spot regressions in tifffile metadata shapes.
    """
    # Helper: convert a value in `unit` to micrometers. Returns None for
    # unknown / unsupported units rather than letting an ambiguous value
    # pollute the µm-typed field downstream.
    def _to_um(value: float, unit: str | None) -> float | None:
        u = (unit or "").strip().lower()
        if u in ("", "µm", "um", "micron", "microns", "micrometer", "micrometers"):
            return value  # OME default + microscopy convention
        if u in ("nm", "nanometer", "nanometers"):
            return value / 1000.0
        if u in ("mm", "millimeter", "millimeters"):
            return value * 1000.0
        if u in ("cm", "centimeter", "centimeters"):
            return value * 10_000.0
        if u in ("inch", "inches", "in"):
            return value * 25_400.0
        return None  # unknown unit — caller can still ask user to override

    # 1. OME-XML
    try:
        ome = getattr(tf, "ome_metadata", None)
        if isinstance(ome, str) and "<Pixels" in ome:
            import re
            m = re.search(r'PhysicalSizeX="([0-9.eE+-]+)"', ome)
            unit_m = re.search(r'PhysicalSizeXUnit="([^"]+)"', ome)
            if m:
                val = float(m.group(1))
                # OME default unit is µm when PhysicalSizeXUnit is absent.
                converted = _to_um(val, unit_m.group(1) if unit_m else None)
                if converted is not None:
                    return converted
    except Exception as exc:
        sys.stderr.write(f"OME-XML pixel-size parse failed: {exc}\n")

    # 2. ImageJ metadata. Prefer explicit numeric keys; fall back to
    # regex over the multi-line "info" string. In all cases consult the
    # unit metadata before returning so an nm-calibrated STORM TIFF
    # isn't silently reported as µm (off by 1000×).
    try:
        meta = getattr(tf, "imagej_metadata", None)
        if isinstance(meta, dict):
            ij_unit = (
                meta.get("unit")
                or meta.get("xunit")
                or meta.get("Unit")
                or meta.get("xUnit")
            )
            for key in ("PhysicalSizeX", "pixel_width", "pixelWidth"):
                v = meta.get(key)
                if isinstance(v, (int, float)) and v > 0:
                    converted = _to_um(float(v), ij_unit)
                    if converted is not None:
                        return converted
            info = meta.get("info") or meta.get("Info")
            if isinstance(info, str):
                import re
                # Look for an inline unit on the same line as the value.
                for pat in (
                    r"PixelWidth\s*[:=]\s*([0-9.eE+-]+)\s*([A-Za-zµ]*)",
                    r"pixel_width\s*[:=]\s*([0-9.eE+-]+)\s*([A-Za-zµ]*)",
                    r"spatial_resolution\s*[:=]\s*([0-9.eE+-]+)\s*([A-Za-zµ]*)",
                ):
                    m = re.search(pat, info)
                    if m:
                        try:
                            val = float(m.group(1))
                        except ValueError:
                            continue
                        inline_unit = m.group(2) if m.lastindex >= 2 else None
                        converted = _to_um(val, inline_unit or ij_unit)
                        if converted is not None:
                            return converted
    except Exception as exc:
        sys.stderr.write(f"ImageJ pixel-size parse failed: {exc}\n")

    # 3. Raw TIFF resolution tags (XResolution, ResolutionUnit).
    try:
        page = tf.pages[0] if tf.pages else None
        if page is not None:
            tags = page.tags
            x_res = tags.get("XResolution")
            unit_tag = tags.get("ResolutionUnit")
            if x_res is not None and x_res.value:
                # XResolution is a rational (numerator, denominator) giving
                # pixels per unit. We want unit per pixel.
                num, den = x_res.value
                if num > 0 and den > 0:
                    pixels_per_unit = num / den
                    if pixels_per_unit > 0:
                        unit_per_pixel = 1.0 / pixels_per_unit
                        # ResolutionUnit: 1=none, 2=inch, 3=cm. Unknown maps to none.
                        unit_code = (
                            unit_tag.value if unit_tag is not None else 1
                        )
                        if unit_code == 2:  # inch
                            return unit_per_pixel * 25_400.0  # → µm
                        if unit_code == 3:  # cm
                            return unit_per_pixel * 10_000.0  # → µm
                        # ResolutionUnit == 1 ("none") — value is in
                        # arbitrary units; safer to surface as missing.
                        return None
    except Exception as exc:
        sys.stderr.write(f"Raw-TIFF resolution parse failed: {exc}\n")

    return None


def _imagej_label_to_seconds(label: str) -> float | None:
    """Parse a single ImageJ slice ``Labels`` entry to a timestamp in
    seconds. ImageJ stores annotations like:
      ``"t=0.5s"``         (most common explicit)
      ``"Time=0.5 s"``
      ``"0.500"``           (bare seconds — common in MicroManager)
      ``"0.5 min"`` / ``"1 h"``  (rare but legal)
    Returns ``None`` when the label carries no time-like token. Keep the
    parser conservative so unrelated metadata (channel names, Z indices)
    doesn't accidentally produce a spurious timestamp.
    """
    if not isinstance(label, str):
        return None
    patterns = (
        re.compile(r"\bt\s*=\s*([0-9.]+)\s*([smhSMH]?)", re.IGNORECASE),
        re.compile(r"\btime\s*[:=]\s*([0-9.]+)\s*([smhSMH]?)", re.IGNORECASE),
        # Bare numeric value (assume seconds) — only when the entire
        # label is a number; rejects "z=2" / channel names.
        re.compile(r"^\s*([0-9]+(?:\.[0-9]+)?)\s*([smhSMH]?)\s*$"),
    )
    for pat in patterns:
        m = pat.search(label)
        if not m:
            continue
        try:
            value = float(m.group(1))
        except ValueError:
            continue
        unit = (m.group(2) if m.lastindex and m.lastindex >= 2 else "") or ""
        u = unit.lower()
        if u in ("", "s"):
            return value
        if u == "m":
            return value * 60.0
        if u == "h":
            return value * 3600.0
        # ms not listed because ImageJ Labels almost always use seconds;
        # fall through and try the next pattern.
    return None


def _detect_frame_interval_ms(tf) -> float | None:
    """Best-effort frame-interval extraction in milliseconds.

    Sources tried, in order:
      1. OME-XML ``<Plane DeltaT="..." DeltaTUnit="...">`` — per-frame
         timestamps, median of consecutive Δs (robust to dropped frames,
         mirrors the ND2 ``Time [s]`` events branch in ``extract_nd2``).
      2. OME-XML ``<Pixels TimeIncrement TimeIncrementUnit>`` — single
         declared interval (fallback when no per-frame planes carry DeltaT).
      3. ImageJ per-slice ``Labels`` timestamps (``t=0.5s`` / ``0.5`` / …),
         median Δ same as #1.
      4. ImageJ ``finterval`` (seconds per frame) or ``fps``.

    Returns ``None`` when no time metadata is present — caller decides
    whether to fall back to a Node-side ffmpeg estimate.
    """
    # 1+2. OME-XML.
    try:
        ome = getattr(tf, "ome_metadata", None)
        if isinstance(ome, str):
            # Per-frame Plane DeltaT first. Loop through every <Plane>
            # tag, collect (DeltaT, optional DeltaTUnit). When multiple
            # channels are present each (T,C) gets its own plane; using
            # the sorted set of distinct values across planes is enough
            # for an even Δ because the channel acquisitions for the
            # same T share a DeltaT.
            plane_re = re.compile(
                r'<Plane\b([^>]*)\bDeltaT="([0-9.eE+-]+)"', re.IGNORECASE
            )
            unit_re = re.compile(r'\bDeltaTUnit="([^"]+)"', re.IGNORECASE)
            timestamps_s: list[float] = []
            for m in plane_re.finditer(ome):
                attrs = m.group(1)
                try:
                    value = float(m.group(2))
                except ValueError:
                    continue
                unit_m = unit_re.search(attrs)
                u = (unit_m.group(1).lower() if unit_m else "s")
                if u in ("s", "sec", "second", "seconds"):
                    timestamps_s.append(value)
                elif u in ("ms", "millisecond", "milliseconds"):
                    timestamps_s.append(value / 1000.0)
                elif u in ("min", "minute", "minutes"):
                    timestamps_s.append(value * 60.0)
                else:
                    timestamps_s.append(value)  # default seconds per OME spec
            if len(timestamps_s) >= 2:
                timestamps_s.sort()
                # Deduplicate near-equal entries (multichannel duplicates
                # share a DeltaT but tifffile may serialise them with
                # tiny float noise).
                deltas = np.diff(np.asarray(timestamps_s, dtype=np.float64))
                pos = deltas[deltas > 1e-9]
                if pos.size > 0:
                    return float(np.median(pos)) * 1000.0

            if "<Pixels" in ome:
                m = re.search(r'TimeIncrement="([0-9.eE+-]+)"', ome)
                unit_m = re.search(r'TimeIncrementUnit="([^"]+)"', ome)
                if m:
                    val = float(m.group(1))
                    u = (unit_m.group(1).lower() if unit_m else "s")
                    if u in ("s", "sec", "second", "seconds"):
                        return val * 1000.0
                    if u in ("ms", "millisecond", "milliseconds"):
                        return val
                    if u in ("min", "minute", "minutes"):
                        return val * 60_000.0
                    # OME spec default for TimeIncrement is seconds.
                    return val * 1000.0
    except Exception as exc:
        sys.stderr.write(f"OME-XML time parse failed: {exc}\n")

    # 3+4. ImageJ metadata.
    try:
        meta = getattr(tf, "imagej_metadata", None)
        if isinstance(meta, dict):
            # 3. Per-slice Labels timestamps — promised in the original
            # docstring but never implemented. Same median-Δ pattern as
            # ND2 (robust to a dropped frame).
            labels = meta.get("Labels")
            if isinstance(labels, (list, tuple)) and len(labels) >= 2:
                ts = []
                for label in labels:
                    seconds = _imagej_label_to_seconds(label)
                    if seconds is not None:
                        ts.append(seconds)
                if len(ts) >= 2:
                    ts.sort()
                    deltas = np.diff(np.asarray(ts, dtype=np.float64))
                    pos = deltas[deltas > 1e-9]
                    if pos.size > 0:
                        return float(np.median(pos)) * 1000.0

            # 4. `finterval` is seconds per frame; `fps` is the alternate.
            v = meta.get("finterval")
            if isinstance(v, (int, float)) and v > 0:
                return float(v) * 1000.0
            fps = meta.get("fps")
            if isinstance(fps, (int, float)) and fps > 0:
                return 1000.0 / float(fps)
    except Exception as exc:
        sys.stderr.write(f"ImageJ time-increment parse failed: {exc}\n")

    return None


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
        # Pixel calibration + frame interval. Priority chain:
        #   1. OME-XML (most precise when present)
        #   2. ImageJ metadata (most common in microscopy)
        #   3. Raw TIFF resolution tags (last resort, unit may be unclear)
        pixel_size_um = _detect_pixel_size_um(tf)
        frame_interval_ms = _detect_frame_interval_ms(tf)

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

    # Approximate duration from the (constant) frame interval when we
    # have it. TIFFs don't carry per-frame timestamps, so this is an
    # extrapolation, not a measurement.
    duration_ms = (
        int(round(frame_interval_ms * (T - 1)))
        if frame_interval_ms is not None and T > 1
        else None
    )

    result = {
        "frameCount": int(T),
        "durationMs": duration_ms,
        "frameIntervalMs": frame_interval_ms,
        "pixelSizeUm": pixel_size_um,
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
