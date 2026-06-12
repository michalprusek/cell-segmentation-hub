#!/usr/bin/env python3
"""Nikon ND2 frame extractor.

Uses the ``nd2`` package (Apache-2.0, pure Python, no JVM) to decode
Nikon NIS-Elements ND2 files and write per-frame per-channel PNGs.

Two output modes, chosen automatically from the file's position (``P``)
axis:

- **Single position** (no ``P`` axis, or ``P`` == 1): writes
  ``<dest>/frames/<TTTT>/<channel>.png`` and prints one result JSON —
  the historical contract. Frame layout and result-JSON shape are
  unchanged, so existing callers and single-field uploads are unaffected
  (the ``PROGRESS`` line cadence differs slightly but is parsed
  position-independently by the Node side).
- **Multi position** (``P`` > 1 — well-plate / multipoint acquisitions):
  each XY position is a *distinct field of view*, not a time frame, so we
  split it into its own ``<dest>/pos_<PPPP>/frames/<TTTT>/<channel>.png``
  subtree and print ``{"positions": [...]}``. The Node orchestrator then
  creates one independent video container per position. Position labels
  and stage coordinates are read from the ND2 ``XYPosLoop`` metadata so a
  named well (e.g. ``"D03_0000"``) survives into the container name.

Stdout protocol: ``PROGRESS <0..1>`` lines during the loop, then a single
result-JSON object on its own line.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np


# A 1536-well plate is the practical ceiling for microscopy; anything past
# this many positions is far more likely a misread axis than a real intent
# to spawn that many containers. Reject loudly instead of melting the DB.
MAX_POSITIONS = 1536


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
    """Raised for ND2 layouts we deliberately reject — either with a
    user-facing message (bad axes, no Y/X plane, too many positions) or as
    an internal guard (an unsplit multi-position array reaching the
    single-position normalizer), rather than silently mis-extracting."""


def normalize_to_tcyx(arr: np.ndarray, axes: str) -> np.ndarray:
    """Reshape a *single-position* ND2 array to canonical ``(T, C, Y, X)``.

    Handles the real-world axis layouts we see in the wild:

    - ``Z`` (focus stack)            → max-intensity projection (singleton Z
      is simply squeezed).
    - singleton loop axes (``P``     → squeezed away. NIS-Elements often
      position, ``S`` sample, …)        exports per-field files that still
                                        carry a length-1 ``P`` axis.
    - missing ``T`` and/or ``C``     → inserted as length-1 so ``arr[t, c]``
                                        indexing downstream always works.

    A loop axis with size > 1 (a genuine multi-position file) is rejected
    here on purpose: the caller must split positions with
    :func:`select_position` *before* normalizing, since each position
    becomes its own video container. Reaching this with ``P`` > 1 is a
    programming error, so the guard stays.

    ``axes`` is the dimension-name string aligned with ``arr`` (e.g.
    ``"TCYX"``); ``len(axes) == arr.ndim``.
    """
    if len(axes) != arr.ndim:
        raise UnsupportedND2(
            f"ND2 axis metadata '{axes}' ({len(axes)} dims) does not match "
            f"array ndim {arr.ndim} — cannot map to (T, C, Y, X)."
        )
    ax = list(axes)

    if "Z" in ax:
        zi = ax.index("Z")
        arr = arr.max(axis=zi) if arr.shape[zi] > 1 else np.squeeze(arr, axis=zi)
        ax.pop(zi)

    # Drop non-core axes. Singletons squeeze cleanly; a size>1 loop axis is
    # multi-position content the caller should have split off already.
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
            f"normalize_to_tcyx received an unsplit multi-position array: "
            f"axis '{a}' has size {arr.shape[i]}. Call select_position first."
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


# Position loop axes, in preference order. ``P`` is NIS multipoint; ``S``
# (series/scene) appears in a few converters. Both mean "distinct field of
# view" and get one container each.
_POSITION_AXES = ("P", "S")


def position_axis(axes: str) -> str | None:
    """Return the position-loop axis name present in ``axes``, or None."""
    return next((a for a in _POSITION_AXES if a in axes), None)


def select_position(arr: np.ndarray, axes: str, position: int):
    """Slice a single XY position out of a multi-position ND2 array.

    Returns ``(sub_arr, sub_axes)`` with the position axis removed, so
    ``sub_axes`` is a normal single-position layout that
    :func:`normalize_to_tcyx` accepts. Pure function over numpy arrays —
    unit-tested without an ND2 file.
    """
    if len(axes) != arr.ndim:
        raise UnsupportedND2(
            f"ND2 axis metadata '{axes}' ({len(axes)} dims) does not match "
            f"array ndim {arr.ndim}."
        )
    pos_axis = position_axis(axes)
    if pos_axis is None:
        raise UnsupportedND2(
            f"select_position called but axes '{axes}' have no P/S axis."
        )
    i = axes.index(pos_axis)
    n = arr.shape[i]
    if not 0 <= position < n:
        raise UnsupportedND2(
            f"position {position} out of range 0..{n - 1} for axis '{pos_axis}'."
        )
    sub = np.take(arr, position, axis=i)
    return sub, axes[:i] + axes[i + 1 :]


def _build_channel_meta(f, count: int) -> list[dict]:
    """Per-channel name + emission wavelength. Channels are identical across
    positions, so this is read once. ``name`` is the path-safe filename form;
    ``displayName`` is the human label (ND2 name or ``"Channel N"``)."""
    channel_meta: list[dict] = []
    for c in range(count):
        try:
            ch = f.metadata.channels[c]
            raw_name = getattr(ch.channel, "name", None)
            emission = None
            em_info = getattr(ch.channel, "emissionLambdaNm", None)
            if isinstance(em_info, (int, float)):
                emission = float(em_info)
        except (IndexError, AttributeError, KeyError, TypeError):
            raw_name = None
            emission = None
        has_raw = isinstance(raw_name, str) and raw_name.strip() != ""
        display = raw_name if has_raw else f"Channel {c + 1}"
        channel_meta.append(
            {
                "displayName": display,
                "name": _sanitize_name(raw_name, f"Channel_{c + 1}"),
                "wavelengthNm": emission,
            }
        )
    return channel_meta


def _read_pixel_size_um(f) -> float | None:
    """Isotropic XY pixel size in µm from ``voxel_size().x`` (constant across
    positions). Warns to stderr on anisotropic XY rather than silently
    x-only."""
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
                sys.stderr.write(f"ND2 anisotropic XY: x={x_um} y={y_um}, using x\n")
            return float(x_um)
    except Exception as exc:
        sys.stderr.write(f"ND2 voxel_size read failed: {exc}\n")
    return None


def _event_timestamps_s(f) -> list[float]:
    """Per-frame acquisition timestamps in seconds (``events()['Time [s]']``),
    in sequence order. Empty list when the file carries no event timing."""
    try:
        events = f.events()
        if events and "Time [s]" in events[0]:
            return [e["Time [s]"] for e in events if "Time [s]" in e]
    except Exception as exc:
        sys.stderr.write(f"ND2 events parse failed: {exc}\n")
    return []


def _median_interval_ms(timestamps_s: list[float]) -> float | None:
    """Median Δ (ms) between consecutive ascending timestamps; drops
    clock-glitch non-positive deltas. None when < 2 usable points."""
    if len(timestamps_s) < 2:
        return None
    arr = np.asarray(sorted(timestamps_s), dtype=np.float64)
    deltas = np.diff(arr)
    pos = deltas[deltas > 0]
    if pos.size == 0:
        return None
    return float(np.median(pos) * 1000.0)


def _read_position_meta(f, p_count: int) -> list[dict]:
    """Label + stage coordinates per position from the ND2 ``XYPosLoop``.

    NIS names well-plate points (e.g. ``"D03_0000"``); those are the most
    meaningful labels and are preserved verbatim. Unnamed multipoint scans
    leave the name ``None`` — the caller then falls back to a 1-based
    ordinal, keeping the stage µm coordinates for traceability.

    Returns a list of length ``p_count`` of
    ``{"name": str|None, "stageXUm": float|None, "stageYUm": float|None}``.
    """
    meta = [
        {"name": None, "stageXUm": None, "stageYUm": None} for _ in range(p_count)
    ]
    try:
        for loop in f.experiment or []:
            if getattr(loop, "type", "") != "XYPosLoop":
                continue
            params = getattr(loop, "parameters", None)
            points = getattr(params, "points", None) or []
            # If the point list doesn't line up 1:1 with the P axis, names
            # could be paired with the wrong field of view. Frames are still
            # sliced correctly by axis index (labels are cosmetic), but warn
            # so a mislabeled well isn't mistaken for ground truth.
            if len(points) != p_count:
                sys.stderr.write(
                    f"WARNING: XYPosLoop has {len(points)} point(s) but the P "
                    f"axis has {p_count} position(s); position labels may be "
                    f"unreliable\n"
                )
            for i, pt in enumerate(points[:p_count]):
                name = getattr(pt, "name", None)
                if isinstance(name, str) and name.strip():
                    meta[i]["name"] = name.strip()
                sp = getattr(pt, "stagePositionUm", None)
                if sp is not None:
                    x = getattr(sp, "x", None)
                    y = getattr(sp, "y", None)
                    meta[i]["stageXUm"] = (
                        float(x) if isinstance(x, (int, float)) else None
                    )
                    meta[i]["stageYUm"] = (
                        float(y) if isinstance(y, (int, float)) else None
                    )
    except Exception as exc:
        sys.stderr.write(f"ND2 position metadata read failed: {exc}\n")
    return meta


def _time_is_outer(f) -> bool | None:
    """Whether the time loop is outer relative to the position loop.

    ``f.experiment`` lists loops outermost→innermost. With T outer / P
    inner the sequence is ``t*P + p``; with P outer / T inner it is
    ``p*T + t``. Returns None when both loops can't be located (caller then
    skips per-position timing)."""
    t_idx = p_idx = None
    try:
        for i, loop in enumerate(f.experiment or []):
            kind = getattr(loop, "type", "")
            if kind in ("NETimeLoop", "TimeLoop") and t_idx is None:
                t_idx = i
            elif kind == "XYPosLoop" and p_idx is None:
                p_idx = i
    except Exception:
        return None
    if t_idx is None or p_idx is None:
        return None
    return t_idx < p_idx


def _position_interval_ms(
    timestamps_s: list[float],
    position: int,
    t_count: int,
    p_count: int,
    time_outer: bool | None,
) -> float | None:
    """Median frame interval (ms) for one position, picking that position's
    timestamps out of the flat per-frame event list using the loop nesting
    order. Returns None unless the event count exactly matches ``T*P`` (a
    partial / unexpected list is not worth guessing from)."""
    if t_count < 2 or time_outer is None:
        return None
    if len(timestamps_s) != t_count * p_count:
        return None
    if time_outer:
        idx = [t * p_count + position for t in range(t_count)]
    else:
        idx = [position * t_count + t for t in range(t_count)]
    return _median_interval_ms([timestamps_s[i] for i in idx])


def _write_frames(arr_tcyx: np.ndarray, frames_root: Path, channel_names: list[str],
                  on_frame=None) -> None:
    """Write one PNG per (frame, channel) under ``frames_root/<TTTT>/``.
    ``on_frame()`` is called after each frame for progress accounting."""
    T = arr_tcyx.shape[0]
    C = arr_tcyx.shape[1]
    for t in range(T):
        frame_dir = frames_root / f"{t:04d}"
        frame_dir.mkdir(parents=True, exist_ok=True)
        for c in range(C):
            _save_png(arr_tcyx[t, c], frame_dir / f"{channel_names[c]}.png")
        if on_frame is not None:
            on_frame()


def _progress(done: int, total: int) -> None:
    if total > 0 and (done % 5 == 0 or done == total):
        sys.stdout.write(f"PROGRESS {done / total:.4f}\n")
        sys.stdout.flush()


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
        sizes = dict(f.sizes)
        axes = "".join(sizes.keys())
        pos_axis = position_axis(axes)
        p_count = int(sizes.get(pos_axis, 1)) if pos_axis else 1

        # Metadata shared across positions — read once.
        # Channel count: post-normalization C, but here we only need a count
        # for channel metadata; ``sizes['C']`` (or 1) is correct pre-split.
        c_count = int(sizes.get("C", 1) or 1)
        channel_meta = _build_channel_meta(f, c_count)
        channel_names = [m["name"] for m in channel_meta]
        channels_out = [
            {
                "name": m["name"],
                "displayName": m["displayName"],
                "wavelengthNm": m["wavelengthNm"],
            }
            for m in channel_meta
        ]
        pixel_size_um = _read_pixel_size_um(f)
        timestamps = _event_timestamps_s(f)

        # Lazy access keeps peak memory to one position at a time for big
        # multipoint files (the decoded array is P× one position's size).
        # Fall back to a full in-RAM array if dask isn't available — this
        # materializes the whole P×T×C×Y×X array, so log at warn with the
        # position count so an OOM on a large multipoint file is diagnosable
        # rather than a bare "python helper exited" downstream.
        try:
            darr = f.to_dask()
            use_dask = True
        except Exception as exc:
            sys.stderr.write(
                f"WARNING: ND2 to_dask failed ({exc}); falling back to a full "
                f"in-RAM asarray for {p_count} position(s) — may OOM on large "
                f"multipoint files\n"
            )
            darr = None
            use_dask = False

        # ---- Single-position path (historical contract, unchanged) -------
        if p_count <= 1:
            arr = np.asarray(darr) if use_dask else f.asarray()
            arr = normalize_to_tcyx(arr, axes)
            T, C, H, W = (int(arr.shape[0]), int(arr.shape[1]),
                          int(arr.shape[2]), int(arr.shape[3]))

            done = 0
            def _tick():
                nonlocal done
                done += 1
                _progress(done, T)
            _write_frames(arr, dest / "frames", channel_names, on_frame=_tick)

            duration_ms = None
            frame_interval_ms = _median_interval_ms(timestamps)
            if len(timestamps) >= 2:
                duration_ms = int((timestamps[-1] - timestamps[0]) * 1000)
            elif frame_interval_ms is not None and T > 1:
                duration_ms = int(round(frame_interval_ms * (T - 1)))

            print(json.dumps({
                "frameCount": int(T),
                "durationMs": duration_ms,
                "frameIntervalMs": frame_interval_ms,
                "pixelSizeUm": pixel_size_um,
                "width": int(W),
                "height": int(H),
                "channels": channels_out,
            }))
            return 0

        # ---- Multi-position path: one container per XY position ----------
        if p_count > MAX_POSITIONS:
            print(
                f"ND2 has {p_count} positions, exceeding the {MAX_POSITIONS} "
                f"limit — refusing to create that many videos. Split the file "
                f"in NIS-Elements and re-upload.",
                file=sys.stderr,
            )
            return 4

        pos_meta = _read_position_meta(f, p_count)
        time_outer = _time_is_outer(f)
        t_count = int(sizes.get("T", 1) or 1)
        p_axis_idx = axes.index(pos_axis)
        sub_axes = axes[:p_axis_idx] + axes[p_axis_idx + 1 :]

        # Pre-load once for the non-dask fallback (avoid re-reading per pos).
        full_arr = None if use_dask else f.asarray()

        # Estimate total frame-writes for a monotonic progress fraction.
        total_writes = max(1, p_count * max(1, t_count))
        done = 0
        positions_out = []

        for p in range(p_count):
            if use_dask:
                idx = tuple(
                    p if k == p_axis_idx else slice(None) for k in range(len(axes))
                )
                sub = np.asarray(darr[idx])
            else:
                sub = np.take(full_arr, p, axis=p_axis_idx)
            norm = normalize_to_tcyx(sub, sub_axes)
            T, C, H, W = (int(norm.shape[0]), int(norm.shape[1]),
                          int(norm.shape[2]), int(norm.shape[3]))

            subdir = f"pos_{p:04d}"

            def _tick():
                nonlocal done
                done += 1
                _progress(done, total_writes)
            _write_frames(norm, dest / subdir / "frames", channel_names,
                          on_frame=_tick)

            frame_interval_ms = _position_interval_ms(
                timestamps, p, t_count, p_count, time_outer
            )
            duration_ms = (
                int(round(frame_interval_ms * (T - 1)))
                if frame_interval_ms is not None and T > 1
                else None
            )

            positions_out.append({
                "index": p,
                "name": pos_meta[p]["name"],
                "stageXUm": pos_meta[p]["stageXUm"],
                "stageYUm": pos_meta[p]["stageYUm"],
                "framesSubdir": subdir,
                "frameCount": int(T),
                "durationMs": duration_ms,
                "frameIntervalMs": frame_interval_ms,
                "pixelSizeUm": pixel_size_um,
                "width": int(W),
                "height": int(H),
                "channels": channels_out,
            })

        print(json.dumps({"positions": positions_out}))
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
