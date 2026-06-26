"""Blob-motion detection + velocity estimation on a kymograph.

Pure NumPy / SciPy post-processing on the intensity matrix that the
``/kymograph`` endpoint already samples (one row per frame, one column per
arc-length-uniform position along the microtubule). A moving particle is a
diagonal streak whose slope ``dx/dt`` is its velocity; this module finds
*every* such streak and measures each one's speed.

Pipeline (AMTraK / TrackMate paradigm, validated against KIF14 motility data):

1. **Detect** — per-row sub-pixel peaks on a DoG band-pass response, gated by a
   global ~k·sigma threshold (sigma from MAD of the UNCLIPPED DoG field — a
   clip-before-MAD collapses the estimate to zero on sparse signals).
2. **Link** — frame-to-frame assignment (Hungarian / ``linear_sum_assignment``)
   with constant-velocity prediction so two blobs keep identity through a
   crossing, plus short gap-closing.
3. **Stitch** — segment-linking pass that merges collinear track fragments
   (end of A + its velocity ≈ start of B across a small time gap) into one
   continuous motor run.
4. **Filter** — reject speckle-noise tracks by length + amplitude SNR.
5. **Segment** — split each track's x(t) into runs vs pauses; the slope of each
   run (with its standard error) is a local velocity in px/frame.

Velocity stays in *px/frame* here; the Node backend converts to µm/s with the
container's persisted ``pixelSizeUm`` / ``frameIntervalMs`` calibration.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import numpy as np


def _subpixel_peak(row: np.ndarray, j: int, width: int) -> float:
    """3-point parabolic interpolation on log-intensity around index ``j``."""
    if 1 <= j < width - 1 and row[j - 1] > 0 and row[j + 1] > 0:
        a, b, c = (
            np.log(row[j - 1] + 1e-9),
            np.log(row[j] + 1e-9),
            np.log(row[j + 1] + 1e-9),
        )
        den = a - 2 * b + c
        if abs(den) > 1e-9:
            return float(j + np.clip(0.5 * (a - c) / den, -1.0, 1.0))
    return float(j)


def _vel_tail(track: Dict[str, Any], n: int = 5) -> float:
    """Mean velocity over a track's last ``n`` points (robust for stitching)."""
    m = min(n, len(track["x"]))
    dt = track["t"][-1] - track["t"][-m]
    return (track["x"][-1] - track["x"][-m]) / dt if dt > 0 else track["v"]


def _segment_runs(
    t: np.ndarray, x: np.ndarray, pause_thresh: float
) -> List[Dict[str, float]]:
    """Split a trajectory into directed runs ≥6 frames; fit a slope per run.

    A run is a contiguous span whose smoothed velocity stays above
    ``pause_thresh`` in one direction AND lasts at least 6 grid frames. Pauses
    *and* sub-6-frame directed flickers are excluded — so the aggregated
    ``total_run_*`` totals undercount very short directed segments by design.
    """
    from scipy.ndimage import gaussian_filter1d

    grid = np.arange(int(t[0]), int(t[-1]) + 1)
    xg = np.interp(grid, t, x)
    xs = gaussian_filter1d(xg, 2.5)
    vel = np.gradient(xs)
    state = np.where(np.abs(vel) > pause_thresh, np.sign(vel), 0).astype(int)

    runs: List[Dict[str, float]] = []
    i = 0
    while i < len(grid):
        j = i
        while j + 1 < len(grid) and state[j + 1] == state[i]:
            j += 1
        if state[i] != 0 and (j - i + 1) >= 6:
            gt = grid[i : j + 1].astype(np.float64)
            gx = xs[i : j + 1]
            design = np.vstack([gt, np.ones_like(gt)]).T
            coef = np.linalg.lstsq(design, gx, rcond=None)[0]
            runs.append(
                {"v_pxframe": float(coef[0]), "t0": int(gt[0]), "t1": int(gt[-1])}
            )
        i = j + 1
    return runs


def net_velocity_threshold(
    min_net_velocity_um_s: float,
    frame_interval_ms: float,
    pixel_size_um: float,
    px_per_column: float,
) -> float:
    """Convert a µm/s net-velocity cut-off to a kymograph-column/frame cut-off.

    Track velocities are measured in kymograph **columns** per frame, and one
    column spans ``px_per_column`` image pixels (≈1 for short MTs, >1 once the
    arc length exceeds ``target_width`` and the column axis is compressed). The
    exact inverse of the display conversion (column/frame → µm/s) is::

        v_um_s = v_colframe · px_per_column · pixel_size_um / (frame_interval_ms/1000)

    so the column/frame threshold below is its algebraic inverse — a track is
    kept iff ``|v_colframe| >= threshold``.
    """
    return (
        min_net_velocity_um_s
        * (frame_interval_ms / 1000.0)
        / (pixel_size_um * px_per_column)
    )


def edge_touch(
    points: List[List[float]], n_samples: int, tol: float = 2.0
) -> str:
    """Flag whether a trajectory reaches the left/right end of the kymograph.

    Position is the kymograph's horizontal axis (column 0 = microtubule start,
    ``n_samples - 1`` = microtubule end). A motor that walks to either end
    continues onto MT that is outside the imaged segment, so its run length is
    truncated by the field of view rather than by the motor detaching — the
    biologist needs to know which measurements are right-censored.

    Returns ``"left"``, ``"right"``, ``"both"`` or ``"none"``.
    """
    if not points:
        return "none"
    xs = [p[1] for p in points]
    left = min(xs) <= tol
    right = max(xs) >= (n_samples - 1) - tol
    if left and right:
        return "both"
    if left:
        return "left"
    if right:
        return "right"
    return "none"


def track_intensity(
    kymo: np.ndarray,
    points: List[List[float]],
    width: int,
    *,
    bg_gap: int = 2,
    bg_width: Optional[int] = None,
) -> Dict[str, Optional[float]]:
    """Background-subtracted signal intensity along a kymograph trajectory.

    Mirrors the MT-metrics convention (mean signal − **median** background): for
    each trajectory sample ``(t, x)`` read a centred signal band of ``2·⌊(width-1)/2⌋+1``
    columns (i.e. ``width`` for odd widths, ``width-1`` for even) plus two
    background bands of ``width`` columns offset ``bg_gap`` columns beyond it on
    either side. Values come straight from the raw (un-normalised) kymograph
    matrix, so the result is in the same units as the source channel's pixels —
    directly comparable to the per-MT intensity metric.

    Returns ``{intensity_signal, intensity_background, intensity_minus_bg}``.
    ``intensity_background`` (and hence ``intensity_minus_bg``) is ``None`` only
    when *no* sample had room for a background band on *either* side — i.e. the
    kymograph is narrower than ``signal_band + gap + bg_band`` — not merely when
    a track hugs one edge (the opposite side still contributes).
    """
    empty = {
        "intensity_signal": None,
        "intensity_background": None,
        "intensity_minus_bg": None,
    }
    if kymo.ndim != 2 or not points:
        return empty
    T, X = kymo.shape
    half = max(0, (width - 1) // 2)
    bw = width if bg_width is None else bg_width
    sig_vals: List[float] = []
    bg_vals: List[float] = []
    for fr, x in points:
        t = int(round(fr))
        if t < 0 or t >= T:
            continue
        xc = int(round(x))
        row = kymo[t]
        lo, hi = max(0, xc - half), min(X, xc + half + 1)
        if hi > lo:
            sig_vals.extend(row[lo:hi].tolist())
        # left background band: [xc-half-gap-bw, xc-half-gap)
        bl1, bl2 = max(0, xc - half - bg_gap - bw), max(0, xc - half - bg_gap)
        if bl2 > bl1:
            bg_vals.extend(row[bl1:bl2].tolist())
        # right background band: [xc+half+1+gap, xc+half+1+gap+bw)
        br1 = min(X, xc + half + 1 + bg_gap)
        br2 = min(X, xc + half + 1 + bg_gap + bw)
        if br2 > br1:
            bg_vals.extend(row[br1:br2].tolist())
    signal = float(np.mean(sig_vals)) if sig_vals else None
    background = float(np.median(bg_vals)) if bg_vals else None
    minus_bg = (
        signal - background
        if (signal is not None and background is not None)
        else None
    )
    return {
        "intensity_signal": signal,
        "intensity_background": background,
        "intensity_minus_bg": minus_bg,
    }


def detect_blobs(
    kymo: np.ndarray,
    *,
    blob_sigma: float = 1.6,
    k_sigma: float = 5.0,
    max_jump: float = 8.0,
    max_gap: int = 12,
    stitch_gap: int = 14,
    min_span: int = 12,
    min_points: int = 8,
    min_snr: float = 2.3,
    pause_thresh: float = 0.10,
) -> List[Dict[str, Any]]:
    """Detect moving blobs on a kymograph and measure each one's velocity.

    Args:
        kymo: ``(F, X)`` float array — F frames (time, top = first) × X
            arc-length positions. The raw sampled intensity, NOT normalised.

    Returns:
        One dict per detected track, sorted fastest-net-velocity first::

            {
              "points":      [[frame, x], ...]   # sub-pixel, time-ordered; x in
                                                 #   kymograph COLUMNS (not px)
              "net_pxframe": float               # (x_last-x_first)/t span, col/frame
              "snr":         float
              "total_run_time_frames":    float  # Σ directed-run durations (≥6 fr)
              "total_run_displacement_px": float # Σ |slope|·duration, in COLUMNS
            }

        ``net_pxframe`` / ``total_run_displacement_px`` are in kymograph columns,
        NOT image pixels — the Node backend scales by px-per-column (= arc length
        / (n_samples-1)) before applying the µm calibration.

        Per-run detail is intentionally NOT exposed — the run segmentation is an
        internal step used only to aggregate the two totals above. ``total_run_time``
        counts only directed runs of ≥6 frames; pauses AND sub-6-frame directed
        flickers are excluded.
    """
    from scipy.ndimage import gaussian_filter
    from scipy.optimize import linear_sum_assignment
    from scipy.signal import find_peaks

    if kymo.ndim != 2 or kymo.shape[0] < 4 or kymo.shape[1] < 4:
        return []
    T, X = kymo.shape
    kymo = kymo.astype(np.float32, copy=False)

    # --- preprocess: per-row baseline (removes frame-brightness drift; do NOT
    #     subtract a per-column temporal median — that erases dwelling blobs),
    #     then a DoG band-pass that enhances blob-sized features. -----------
    S = kymo - np.median(kymo, axis=1, keepdims=True)
    dog = gaussian_filter(S, blob_sigma) - gaussian_filter(S, 3.0 * blob_sigma)
    sig_dog = 1.4826 * np.median(np.abs(dog - np.median(dog))) + 1e-9
    thr = float(np.median(dog) + k_sigma * sig_dog)
    resid = S - gaussian_filter(S, (2.0, 2.0))
    sig_i = 1.4826 * np.median(np.abs(resid - np.median(resid))) + 1e-9

    # --- 1) per-row detections (x_subpixel, background-subtracted amplitude)
    dets: List[List[tuple]] = []
    for row_idx in range(T):
        resp = dog[row_idx]
        peaks, _ = find_peaks(
            resp, height=thr, distance=3, prominence=thr * 0.5
        )
        dets.append(
            [(_subpixel_peak(resp, j, X), float(S[row_idx, j])) for j in peaks]
        )

    # --- 2) frame-to-frame linking (Hungarian + constant-velocity predict) --
    tracks: List[Dict[str, Any]] = []
    for t in range(T):
        obs = dets[t]
        active = [tr for tr in tracks if tr["alive"]]
        if obs and active:
            cost = np.full((len(active), len(obs)), 1e6)
            for i, tr in enumerate(active):
                pred = tr["lx"] + tr["v"]
                for j, (x, _a) in enumerate(obs):
                    if abs(pred - x) <= max_jump + abs(tr["v"]):
                        cost[i, j] = abs(pred - x)
            ri, cj = linear_sum_assignment(cost)
            used = set()
            for i, j in zip(ri, cj):
                if cost[i, j] < 1e5:
                    tr = active[i]
                    x, a = obs[j]
                    tr["v"] = 0.5 * tr["v"] + 0.5 * (x - tr["lx"]) / (t - tr["lt"])
                    tr["t"].append(t)
                    tr["x"].append(x)
                    tr["a"].append(a)
                    tr["lt"], tr["lx"], tr["gap"] = t, x, 0
                    used.add(j)
            for j, (x, a) in enumerate(obs):
                if j not in used:
                    tracks.append(_new_track(t, x, a))
        elif obs:
            for x, a in obs:
                tracks.append(_new_track(t, x, a))
        for tr in active:
            if tr["lt"] != t:
                tr["gap"] += 1
                if tr["gap"] > max_gap:
                    tr["alive"] = False

    # --- 3) stitch collinear fragments into continuous runs -----------------
    ordered = sorted(tracks, key=lambda z: z["t"][0])
    merged = True
    while merged:
        merged = False
        for a_tr in ordered:
            if a_tr is None:
                continue
            best, best_d = None, 1e9
            for idx, b_tr in enumerate(ordered):
                if b_tr is None or b_tr is a_tr or b_tr["t"][0] <= a_tr["t"][-1]:
                    continue
                gap = b_tr["t"][0] - a_tr["t"][-1]
                if gap > stitch_gap:
                    continue
                pred = a_tr["x"][-1] + _vel_tail(a_tr) * gap
                d = abs(pred - b_tr["x"][0])
                if d <= 4 + abs(_vel_tail(a_tr)) and d < best_d:
                    best, best_d = idx, d
            if best is not None:
                b_tr = ordered[best]
                z = sorted(
                    zip(
                        a_tr["t"] + b_tr["t"],
                        a_tr["x"] + b_tr["x"],
                        a_tr["a"] + b_tr["a"],
                    )
                )
                a_tr["t"], a_tr["x"], a_tr["a"] = (list(q) for q in zip(*z))
                ordered[best] = None
                merged = True
    ordered = [tr for tr in ordered if tr is not None]

    # --- 4) quality filter + 5) per-track run segmentation ------------------
    out: List[Dict[str, Any]] = []
    for tr in ordered:
        span = tr["t"][-1] - tr["t"][0] + 1
        if span < min_span or len(tr["t"]) < min_points:
            continue
        if np.median(tr["a"]) / sig_i < min_snr:
            continue
        t_arr = np.asarray(tr["t"], dtype=np.float64)
        x_arr = np.asarray(tr["x"], dtype=np.float64)
        net = float((x_arr[-1] - x_arr[0]) / (t_arr[-1] - t_arr[0]))
        # Segment into directed runs (internal only), then aggregate into the
        # two per-trajectory totals we actually report. _segment_runs emits only
        # directed segments of ≥6 frames, so run TIME excludes both pauses and
        # sub-6-frame flickers; run LENGTH is the summed directed distance
        # (|slope| × duration per run), in kymograph columns.
        segs = _segment_runs(t_arr, x_arr, pause_thresh)
        total_run_time_frames = float(sum(s["t1"] - s["t0"] for s in segs))
        total_run_displacement_px = float(
            sum(abs(s["v_pxframe"]) * (s["t1"] - s["t0"]) for s in segs)
        )
        out.append(
            {
                "points": [[int(t), float(x)] for t, x in zip(tr["t"], tr["x"])],
                "net_pxframe": net,
                "snr": float(np.median(tr["a"]) / sig_i),
                "total_run_time_frames": total_run_time_frames,
                "total_run_displacement_px": total_run_displacement_px,
            }
        )
    out.sort(key=lambda r: -abs(r["net_pxframe"]))
    return out


def _new_track(t: int, x: float, a: float) -> Dict[str, Any]:
    return {
        "t": [t],
        "x": [x],
        "a": [a],
        "lt": t,
        "lx": x,
        "v": 0.0,
        "gap": 0,
        "alive": True,
    }


# Direction-coded overlay colours (match the frontend modal palette).
_ANTERO = (248, 113, 113)  # net position increasing (+)
_RETRO = (56, 189, 248)  # net position decreasing (-)
_STATIC = (163, 163, 163)


def _track_color(net_pxframe: float) -> tuple:
    if abs(net_pxframe) < 0.02:
        return _STATIC
    return _ANTERO if net_pxframe > 0 else _RETRO


def render_overlay(
    base_rgb: np.ndarray,
    tracks: List[Dict[str, Any]],
    *,
    y_scale: int = 3,
) -> bytes:
    """Draw detected tracks onto the kymograph as a standalone PNG.

    ``base_rgb`` is the already-rendered (F, X, 3) uint8 kymograph. Each track
    is drawn as a direction-coloured polyline. The image is stretched
    vertically by ``y_scale`` so the (usually short) time axis is readable —
    the same trick the offline prototype used. Returns PNG bytes.
    """
    import io

    from PIL import Image as PILImage
    from PIL import ImageDraw

    T, X = base_rgb.shape[:2]
    img = PILImage.fromarray(base_rgb, "RGB").resize(
        (X, T * y_scale), PILImage.NEAREST
    )
    draw = ImageDraw.Draw(img)
    for tr in tracks:
        color = _track_color(tr["net_pxframe"])
        pts = [(float(x), float(t) * y_scale) for t, x in tr["points"]]
        if len(pts) > 1:
            draw.line(pts, fill=color, width=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
