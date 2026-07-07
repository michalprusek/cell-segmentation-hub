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
    """Best-effort ImageJ per-slice channel label extraction.

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
    except Exception as exc:
        # Match the file's convention: every metadata parser emits a one-line
        # stderr diagnostic before degrading, so a genuine parse bug isn't
        # indistinguishable from "no labels present".
        sys.stderr.write(f"ImageJ channel-label parse failed: {exc}\n")
        return [None] * count


def _all_distinct(names: list[str | None]) -> bool:
    """True only when every entry is a non-empty string AND all are unique.
    Used to reject the two failure modes that made every channel look the
    same: a shared concatenated label ("… - a/b") and a per-slice label
    that is just the source filename repeated for each channel."""
    if not names or any(not (isinstance(n, str) and n.strip()) for n in names):
        return False
    return len({n.strip() for n in names}) == len(names)


def _metamorph_wave_names(info: str, count: int) -> list[str] | None:
    """Parse per-channel names from a MetaMorph ImageJ ``Info`` block.

    MetaMorph stores the real per-wavelength names as
      ``WaveName1 = "WD_LED_IRM"``
      ``WaveName2 = "TIRF_491"``
    which — unlike the per-slice ``Labels`` — are genuinely distinct per
    channel. Returns ``None`` unless all ``count`` names are present and
    distinct (so the caller keeps looking for another source)."""
    if not isinstance(info, str) or not info:
        return None
    names: list[str | None] = []
    for i in range(1, count + 1):
        m = re.search(
            rf'^\s*WaveName{i}\s*=\s*"?([^"\r\n]+?)"?\s*$', info, re.MULTILINE
        )
        names.append(m.group(1).strip() if m else None)
    return names if _all_distinct(names) else None


def _split_shared_label(labels: list[str | None], count: int) -> list[str] | None:
    """Recover per-channel names from ImageJ's shared concatenated label.

    Bio-Formats / MetaMorph hyperstacks write the SAME label to every
    slice, concatenating all wavelength names after the last `` - ``:
      ``"c:1/2 t:1/61 - WD_LED_IRM/TIRF_491"``
    The channel names are the ``"/"``-separated tokens of that suffix, in
    channel order. Returns ``None`` unless the split yields exactly
    ``count`` distinct, non-empty tokens."""
    if not labels or not isinstance(labels[0], str) or " - " not in labels[0]:
        return None
    suffix = labels[0].rsplit(" - ", 1)[1]
    parts = [p.strip() for p in suffix.split("/")]
    return parts if len(parts) == count and _all_distinct(parts) else None


def _resolve_channel_names(tf, count: int) -> list[str | None]:
    """Best-effort DISTINCT per-channel names, tried most-reliable first.

    Order matters — the earlier sources carry the true per-wavelength
    identity, the later ones are progressively more degenerate:
      1. MetaMorph ``WaveNameN`` from the ImageJ ``Info`` block.
      2. The shared ``"… - a/b"`` per-slice label split by ``"/"``.
      3. Genuinely distinct per-slice ``Labels`` used verbatim.
    When none yields ``count`` distinct names (e.g. an ImageJ-registered
    stack whose only label is the source filename, repeated per channel)
    we return all-``None`` so the caller falls back to ``"Channel N"`` —
    two channels named ``"Channel 1"``/``"Channel 2"`` are far more useful
    than two identical names the user can't tell apart."""
    try:
        meta = getattr(tf, "imagej_metadata", None)
        info = ""
        if isinstance(meta, dict):
            info = meta.get("Info") or meta.get("info") or ""

        wave = _metamorph_wave_names(info, count)
        if wave:
            return wave

        labels = _imagej_channel_labels(tf, count)
        split = _split_shared_label(labels, count)
        if split:
            return split
        if _all_distinct(labels):
            return labels
    except Exception as exc:
        # A regex/type/index bug in the helpers above would otherwise be
        # indistinguishable from "no metadata" and silently collapse every
        # channel to wavelengthNm=null → all typed IRM (wrong segmentation
        # source). Surface it like the other parsers in this file.
        sys.stderr.write(f"channel-name resolution failed: {exc}\n")
    return [None] * count


def _wavelength_from_name(name: str | None) -> int | None:
    """Parse an emission wavelength (nm) embedded in a channel name, e.g.
    ``"TIRF_491"`` → 491, ``"w2-561"`` → 561. Only 3–4 digit tokens inside
    the visible/NIR band (350–900 nm) count — this both distinguishes
    fluorescence channels (which carry a λ) from label-free IRM/BF ones
    (which don't) downstream in ``isIrmChannel``, and derives a default
    display color. Returns ``None`` for label-free names like
    ``"WD_LED_IRM"`` that carry no wavelength token."""
    if not isinstance(name, str):
        return None
    for m in re.finditer(r"\d{3,4}", name):
        v = int(m.group())
        if not (350 <= v <= 900):
            continue
        # Reject an exposure-time token like ``"IRM_500ms"`` — a digit run
        # immediately followed by ``ms`` is a duration, not an emission λ,
        # and would otherwise mis-type a label-free channel as fluorescent.
        # ``"491nm"`` (n) and a bare ``"491"`` still count.
        if name[m.end() : m.end() + 2].lower() == "ms":
            continue
        return v
    return None


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
        # Unit captured but unrecognised (e.g. ms suffix on Labels which
        # the rest of the parser doesn't support). Keep walking the
        # remaining patterns — the next one may match cleanly.
    return None


def _median_interval_ms(timestamps_s: list[float]) -> float | None:
    """Compute the median Δ (in milliseconds) between consecutive entries
    of a per-frame timestamp list.

    Robustness rules — these reflect concrete failure modes observed in
    real microscopy files:
      - Sort ascending so out-of-order entries don't poison the result.
      - Dedupe **timestamps**, not deltas, via `np.unique` with a 1 µs
        tolerance. Multichannel OME files emit one ``<Plane>`` per (T,C);
        consecutive channels typically share a DeltaT-per-T and serialise
        with float noise. Deduping after `np.diff` (the previous
        implementation) would conflate "legitimate zero-Δ paused frame"
        with "channel duplicate" and skew the median upward.
      - Drop non-positive deltas after dedupe (paranoia — sort + unique
        already guarantee strictly increasing).

    Returns ``None`` if fewer than two distinct timestamps remain.
    """
    if len(timestamps_s) < 2:
        return None
    arr = np.asarray(sorted(timestamps_s), dtype=np.float64)
    # Cluster near-duplicates using a relative tolerance proportional to
    # the typical frame duration. 1 µs absolute is well below any plausible
    # microscopy frame rate (10 kHz cameras are 100 µs/frame) and matches
    # the float noise that tifffile / OME writers commonly introduce.
    deduped = arr[np.concatenate(([True], np.diff(arr) > 1e-6))]
    if deduped.size < 2:
        return None
    deltas = np.diff(deduped)
    deltas = deltas[deltas > 0]
    if deltas.size == 0:
        return None
    return float(np.median(deltas)) * 1000.0


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
    # Stage 1+2: OME-XML.
    try:
        ome = getattr(tf, "ome_metadata", None)
        if isinstance(ome, str):
            # Per-frame Plane DeltaT first. Multichannel files emit one
            # `<Plane>` per (T,C) — channel acquisitions for the same T
            # share a DeltaT, so duplicates collapse via the dedupe in
            # `_median_interval_ms`. Unknown unit attributes return None
            # rather than silently defaulting to seconds (an off-by-1000
            # nm→µm-style mistake has shipped in this repo before; same
            # principle applies here).
            # Two-stage match: locate each `<Plane>` tag, then search the
            # tag's attribute substring for DeltaT and DeltaTUnit
            # independently. The previous one-shot regex assumed
            # `DeltaTUnit` precedes `DeltaT`, which is wrong for OME
            # writers that emit attributes in canonical order (DeltaT,
            # then DeltaTUnit) — exposed by regression tests.
            plane_tag_re = re.compile(r"<Plane\b([^>]*)>", re.IGNORECASE)
            delta_t_re = re.compile(
                r'\bDeltaT="([0-9.eE+-]+)"', re.IGNORECASE
            )
            unit_re = re.compile(r'\bDeltaTUnit="([^"]+)"', re.IGNORECASE)
            timestamps_s: list[float] = []
            unknown_units_seen: set[str] = set()
            for tag in plane_tag_re.finditer(ome):
                attrs = tag.group(1)
                dt = delta_t_re.search(attrs)
                if dt is None:
                    continue
                try:
                    value = float(dt.group(1))
                except ValueError:
                    continue
                unit_m = unit_re.search(attrs)
                if unit_m is None:
                    # Attribute absent — OME spec defaults to seconds.
                    timestamps_s.append(value)
                    continue
                u = unit_m.group(1).lower()
                if u in ("s", "sec", "second", "seconds"):
                    timestamps_s.append(value)
                elif u in ("ms", "millisecond", "milliseconds"):
                    timestamps_s.append(value / 1000.0)
                elif u in ("min", "minute", "minutes"):
                    timestamps_s.append(value * 60.0)
                else:
                    # Explicit but unrecognised unit — refuse to guess.
                    unknown_units_seen.add(u)
            if unknown_units_seen:
                sys.stderr.write(
                    "OME-XML DeltaT carried unrecognised units "
                    f"{sorted(unknown_units_seen)} — dropped those planes "
                    "rather than guess seconds\n"
                )
            interval_ms = _median_interval_ms(timestamps_s)
            if interval_ms is not None:
                return interval_ms

            if "<Pixels" in ome:
                m = re.search(r'TimeIncrement="([0-9.eE+-]+)"', ome)
                unit_m = re.search(r'TimeIncrementUnit="([^"]+)"', ome)
                if m:
                    val = float(m.group(1))
                    if unit_m is None:
                        return val * 1000.0  # spec default: seconds
                    u = unit_m.group(1).lower()
                    if u in ("s", "sec", "second", "seconds"):
                        return val * 1000.0
                    if u in ("ms", "millisecond", "milliseconds"):
                        return val
                    if u in ("min", "minute", "minutes"):
                        return val * 60_000.0
                    sys.stderr.write(
                        f"OME-XML TimeIncrement unrecognised unit '{u}' — "
                        "dropping value rather than guessing seconds\n"
                    )
    except Exception as exc:
        sys.stderr.write(f"OME-XML time parse failed: {exc}\n")

    # Stage 3+4: ImageJ metadata.
    try:
        meta = getattr(tf, "imagej_metadata", None)
        if isinstance(meta, dict):
            # ImageJ Labels carry per-slice annotations for time-series
            # acquisitions. We require at least 75 % of the labels to
            # parse as time AND a strictly increasing sequence; this
            # rejects interleaved channel/time labels like
            # `["DAPI", "0.5s", "GFP", "1.0s"]` which would otherwise
            # yield a median Δ that's wrong by the channel-count
            # multiplier.
            labels = meta.get("Labels")
            if isinstance(labels, (list, tuple)) and len(labels) >= 2:
                parsed = [_imagej_label_to_seconds(label) for label in labels]
                ts = [v for v in parsed if v is not None]
                density = len(ts) / len(labels)
                strictly_increasing = all(
                    ts[i] < ts[i + 1] for i in range(len(ts) - 1)
                )
                if len(ts) >= 2 and density >= 0.75 and strictly_increasing:
                    interval_ms = _median_interval_ms(ts)
                    if interval_ms is not None:
                        return interval_ms
                elif len(ts) >= 2:
                    # Some labels parsed but density too low / not
                    # monotonic — refuse to guess.
                    sys.stderr.write(
                        f"ImageJ Labels: {len(ts)}/{len(labels)} parsed as time "
                        f"(density {density:.2f}, increasing={strictly_increasing}); "
                        "ignoring — likely interleaved with non-time labels\n"
                    )

            # `finterval` is seconds per frame; `fps` is the alternate.
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
        raw_channel_labels = _resolve_channel_names(tf, _C_for_meta)
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
    elif axes == "CYX" and arr.ndim == 3:
        # Single time-point, multi-channel (e.g. a 2-channel IRM+TIRF frame
        # exported as one ImageJ slice per channel). Without this explicit
        # case the leading-axis heuristic below misreads the C channels as
        # C separate time frames — destroying the channel split and turning
        # a still into a bogus "video" the browser can't display.
        C, H, W = arr.shape
        T = 1
        arr = arr[None, :, :, :]
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

    # Final safety net: guarantee the channels are DISTINGUISHABLE. If the
    # resolver couldn't produce distinct names (collision after realignment,
    # or a degenerate source), drop to all-``None`` so every channel gets a
    # unique ``"Channel N"`` below — never two identical names.
    if not _all_distinct(raw_channel_labels):
        raw_channel_labels = [None] * C

    # Two parallel names per channel:
    #  - `name`        : path-safe, used in URLs + PNG filenames
    #  - `display_name`: human-readable, shown in the UI
    # When metadata gives us a label, use it for both (sanitised in `name`).
    # When no metadata is present, fall back to "Channel N" (1-based) so
    # the UI doesn't surface implementation-y identifiers like "ch0".
    # `wavelengthNm` is parsed from the resolved name (e.g. "TIRF_491"→491)
    # so fluorescence channels type correctly downstream; label-free names
    # (IRM/BF) yield None and stay IRM.
    channel_names: list[str] = []
    display_names: list[str] = []
    wavelengths: list[int | None] = []
    for i in range(C):
        raw = raw_channel_labels[i]
        display = raw if (isinstance(raw, str) and raw.strip()) else f"Channel {i + 1}"
        display_names.append(display)
        channel_names.append(_sanitize_name(raw, f"Channel_{i + 1}"))
        wavelengths.append(_wavelength_from_name(raw))

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
                "wavelengthNm": wavelengths[i],
            }
            for i in range(C)
        ],
    }
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
