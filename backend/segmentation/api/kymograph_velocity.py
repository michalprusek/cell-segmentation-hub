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

from typing import Any, Dict, List

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
    """Split a trajectory into directed runs; fit slope ± SE per run."""
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
            resid = gx - design @ coef
            denom = np.sum((gt - gt.mean()) ** 2)
            se = (
                float(np.sqrt(np.sum(resid**2) / max(1, len(gt) - 2) / denom))
                if denom > 0
                else 0.0
            )
            runs.append(
                {
                    "v_pxframe": float(coef[0]),
                    "se_pxframe": se,
                    "t0": int(gt[0]),
                    "t1": int(gt[-1]),
                }
            )
        i = j + 1
    return runs


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
              "points":     [[frame, x], ...]   # sub-pixel, time-ordered
              "net_pxframe": float              # (x_last - x_first)/(t span)
              "snr":         float
              "runs": [ {"v_pxframe","se_pxframe","t0","t1"}, ... ]
            }
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
        out.append(
            {
                "points": [[int(t), float(x)] for t, x in zip(tr["t"], tr["x"])],
                "net_pxframe": net,
                "snr": float(np.median(tr["a"]) / sig_i),
                "runs": _segment_runs(t_arr, x_arr, pause_thresh),
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
