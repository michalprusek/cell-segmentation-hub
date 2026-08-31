"""Trajectory detection + velocity estimation on a kymograph.

Post-processing on the intensity matrix that the ``/kymograph`` endpoint already
samples (one row per frame, one column per arc-length-uniform position along the
microtubule). A moving particle is a diagonal streak whose slope ``dx/dt`` is its
velocity; this module finds *every* such streak and measures each one's speed.

**Detection is KymoButler** (Jakobs, Dimitracopoulos & Franze, *eLife* 2019;
vendored at ``models/kymobutler``) as of 2026-08-31. It replaced a hand-rolled
DoG-blob detector with a Hungarian frame-to-frame linker and a collinear
stitcher. The two differ in kind, not degree: the DoG detector looked for a
*blob* in each row independently and then had to guess which blob in row t+1 was
the same particle, which is exactly what breaks at a crossing. KymoButler's
U-Net sees the whole (t, x) plane at once and segments the *streak*, so a
crossing is a shape it was trained on rather than an association ambiguity, and
its decision module is consulted at every remaining fork.

Pipeline:

1. **Preprocess** — full-range rescale, polarity detection, per-row mean
   normalisation (``kymobutler.preprocess_array``).
2. **Segment** — a 4-level U-Net emits a trackness map over the whole kymograph.
3. **Track** — binarise, thin, prune; then greedy nearest-neighbour tracing with
   the 124 MB decision module resolving every ambiguity (bidirectional), or
   8-connected components with one entry per frame (unidirectional).
4. **Measure** — amplitude SNR and a sub-pixel column refinement read off the
   RAW matrix, so both stay comparable with what the DoG detector reported.
5. **Segment runs** — split each track's x(t) into runs vs pauses; the slope of
   each run is a local velocity in px/frame.

Velocity stays in *px/frame* here; the Node backend converts to µm/s with the
container's persisted ``pixelSizeUm`` / ``frameIntervalMs`` calibration.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)


def _subpixel_peak(row: np.ndarray, j: int, width: int) -> float:
    """3-point parabolic interpolation on log-intensity around index ``j``.

    Falls back to ``j`` unchanged whenever the three samples cannot define a
    log-parabola with a maximum. Both parts of that guard exist because the
    caller changed: the DoG detector this replaced only ever called it at a
    ``find_peaks`` maximum above a positive height threshold, so a positive
    centre sample and a downward parabola were guaranteed by construction.
    KymoButler hands over a thinned-skeleton column instead, which need not be a
    band-pass maximum at all — so both have to be checked here.

    ``row[j] > 0``: with a negative centre, ``log`` returned NaN, the NaN
    silently failed the acceptance test (every comparison against NaN is False)
    and the function returned ``j`` anyway — but only after a RuntimeWarning per
    sample, on every track, on every kymograph.

    ``den < -1e-9`` rather than ``abs(den) > 1e-9``: ``den = a - 2b + c`` is the
    parabola's second difference, so ``den < 0`` is concave-down (a maximum) and
    ``den > 0`` is concave-UP — a local minimum, where ``0.5·(a-c)/den`` points
    at the bottom of the valley. On ``row = [100, 1, 10]`` at ``j = 1`` the old
    test accepted it and moved the sample to 1.167, i.e. deeper into the DoG
    valley, by up to a full column. That is wrong-direction jitter injected into
    exactly the quantity this refinement exists to protect: the velocity of a
    slow trajectory, which without it is quantised to whole columns per frame.
    """
    if (
        1 <= j < width - 1
        and row[j - 1] > 0
        and row[j] > 0
        and row[j + 1] > 0
    ):
        a, b, c = (
            np.log(row[j - 1] + 1e-9),
            np.log(row[j] + 1e-9),
            np.log(row[j + 1] + 1e-9),
        )
        den = a - 2 * b + c
        if den < -1e-9:
            return float(j + np.clip(0.5 * (a - c) / den, -1.0, 1.0))
    return float(j)


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
    polarity: float = 1.0,
) -> Dict[str, Optional[float]]:
    """Background-subtracted signal intensity along a kymograph trajectory.

    Mirrors the MT-metrics convention (mean signal − **median** background): for
    each trajectory sample ``(t, x)`` read a centred signal band of ``2·⌊(width-1)/2⌋+1``
    columns (i.e. ``width`` for odd widths, ``width-1`` for even) plus two
    background bands of ``width`` columns offset ``bg_gap`` columns beyond it on
    either side. Values come straight from the raw (un-normalised) kymograph
    matrix, so the result is in the same units as the source channel's pixels —
    directly comparable to the per-MT intensity metric.

    ``polarity`` is ``+1`` for a bright-on-dark kymograph and ``-1`` for an
    inverted one (see ``kymograph_polarity``). It signs ``intensity_minus_bg``
    ONLY, so that field always means "contrast above the local background"
    rather than flipping sign with the channel. ``intensity_signal`` and
    ``intensity_background`` stay unsigned raw pixel values — that is their
    documented contract and what keeps them comparable with the per-MT metric.
    The default ``+1`` reproduces the pre-KymoButler behaviour exactly; it
    matters at all only because the detector that replaced the DoG blob finder
    can see dark trajectories, which the old one structurally could not.

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
        polarity * (signal - background)
        if (signal is not None and background is not None)
        else None
    )
    return {
        "intensity_signal": signal,
        "intensity_background": background,
        "intensity_minus_bg": minus_bg,
    }


# Robust-outlier factor for the "too bright" flag: a trajectory whose mean
# signal exceeds ``median + BRIGHT_K · MAD`` of the per-track signals on the same
# kymograph is flagged as an intensity outlier (typically a multi-motor
# aggregate, not a single motor). 3.5·MAD ≈ a 99.9% robust cut-off for a normal
# spread, and unlike mean+std it can't be inflated by the very aggregate it is
# meant to catch.
BRIGHT_K = 3.5


def flag_bright_outliers(
    tracks: List[Dict[str, Any]],
    k: float = BRIGHT_K,
    polarity: float = 1.0,
) -> None:
    """Mark intensity-outlier trajectories in place via ``tr["bright"]``.

    "Too bright" is defined *relative to the other trajectories on the same
    kymograph*: a track is flagged when its ``intensity_signal`` deviates from
    the per-kymograph median by more than ``k · MAD`` **in the signal
    direction** (MAD scaled by 1.4826 to a std-equivalent). Robust to a few
    aggregates skewing the spread and free of any absolute brightness constant —
    it answers "abnormally strong for a motor in THIS movie", which is what
    flags likely multi-motor aggregates.

    ``polarity`` is what makes "the signal direction" well defined. On a
    bright-on-dark kymograph (``+1``, the default and the only case the DoG
    detector could produce) strong means a HIGH raw mean. On a polarity-inverted
    one (``-1``) strong means a LOW one, and comparing ``s > med + k·MAD`` there
    flags the *dimmest* trajectories as aggregates — the exact inverse of the
    intent. That case only became reachable with KymoButler, which detects
    polarity and so finds dark trajectories the old detector could not see.

    Every track is assigned ``bright`` (default ``False``). With fewer than 3
    tracks, or a degenerate (zero) MAD, nothing is flagged — there is no
    population to define an outlier against.
    """
    for tr in tracks:
        tr["bright"] = False
    sigs = [
        tr["intensity_signal"]
        for tr in tracks
        if tr.get("intensity_signal") is not None
    ]
    if len(sigs) < 3:
        return
    arr = np.asarray(sigs, dtype=np.float64)
    med = float(np.median(arr))
    mad = 1.4826 * float(np.median(np.abs(arr - med)))
    if mad <= 0:
        return
    for tr in tracks:
        s = tr.get("intensity_signal")
        if s is not None and polarity * (s - med) > k * mad:
            tr["bright"] = True


# --- KymoButler detection core -----------------------------------------------
#
# The vendored package is imported off the models DIRECTORY, not as
# ``models.kymobutler``. Going through the package would execute
# ``models/__init__``, which pulls in mamba_ssm and Triton and so needs a live
# CUDA driver; a kymograph needs neither, and the import would make this
# module's tests fail outright on any box without a GPU. Same spelling
# ``mt_metrics`` uses for ``mt_measure``, and appended for the same reason: that
# directory also holds generic names (unet.py, sperm.py) that must not shadow a
# real dependency for the whole process.
_MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
if str(_MODELS_DIR) not in sys.path:
    sys.path.append(str(_MODELS_DIR))


def kymograph_polarity(kymo: np.ndarray) -> float:
    """``+1`` for a bright-on-dark kymograph, ``-1`` for an inverted one.

    Delegates to KymoButler's own ``is_negated`` — the same call its
    preprocessing makes before deciding whether to invert — so the detector and
    every metric measured beside it agree on which way "signal" points. Nine of
    ten real production kymographs sampled on 2026-08-31 were ``+1``; the tenth
    was a 640 nm channel whose raw median sits at 247 of 255.

    Callers outside ``detect_tracks`` need this because the DoG blob detector it
    replaced could only ever find BRIGHT trajectories (it peaked on positive
    band-pass maxima), so every metric downstream of it silently assumed ``+1``.
    """
    import kymobutler  # noqa: E402  (needs the path set above)

    arr = np.asarray(kymo, dtype=np.float64)
    lo, hi = float(arr.min()), float(arr.max())
    if hi <= lo:
        return 1.0
    return -1.0 if kymobutler.is_negated((arr - lo) / (hi - lo)) else 1.0


def _kymobutler_device() -> str:
    """Return ``"cuda"`` when a GPU is genuinely usable, else ``"cpu"``.

    This matters more than it looks. The dominant cost is not the segmentation
    forward pass but TRACKING: the 124 MB decision module runs on one 48x48 crop
    per ambiguity per track per step, serially. On CPU that measured 2.6-132 s
    per real kymograph depending on box load and torch's thread count (see
    ``models/kymobutler/README.md`` — the GPU path could not be measured because
    this host's driver was mismatched throughout).

    ``torch.cuda.is_available()`` alone is not enough on this host. GPU access
    is granted by ``device_cgroup_rules``, and a systemd cgroup rewrite can
    strip it from a RUNNING container — after which allocation raises while
    ``is_available()`` may still say yes. So actually allocate one tensor.
    """
    import torch

    if not torch.cuda.is_available():
        return "cpu"
    try:
        torch.zeros(1, device="cuda")
    except Exception:  # pragma: no cover - needs a half-stripped GPU cgroup
        logger.warning(
            "CUDA reports available but allocation failed; "
            "running KymoButler on CPU"
        )
        return "cpu"
    return "cuda"


def detect_tracks(
    kymo: np.ndarray,
    *,
    mode: str = "bidirectional",
    device: Optional[str] = None,
    min_size: Optional[int] = None,
    min_frames: Optional[int] = None,
    pause_thresh: float = 0.10,
) -> List[Dict[str, Any]]:
    """Detect moving particles on a kymograph with KymoButler.

    Args:
        kymo: ``(F, X)`` float array — F frames (time, top = first) x X
            arc-length positions. The raw sampled intensity, NOT normalised.
        mode: ``"bidirectional"`` (BiNet + decision module; resolves crossings)
            or ``"unidirectional"`` (two-headed UniNet + connected components).
        device: ``"cpu"`` / ``"cuda"``; auto-detected when None.
        min_size: minimum skeleton pixel count per component. Defaults to
            KymoButler's own per-mode value (10 bidirectional, 3 unidirectional).
        min_frames: minimum frame span per trajectory. Same defaulting.
        pause_thresh: column/frame speed below which a trajectory counts as
            paused, for the run segmentation.

    Returns:
        One dict per detected track, sorted fastest-net-velocity first. The keys
        are exactly the ones ``KymographTrack`` accepts before enrichment::

            {
              "points":      [[frame, x], ...]   # sub-pixel, time-ordered; x in
                                                 #   kymograph COLUMNS (not px)
              "net_pxframe": float               # (x_last-x_first)/t span, col/frame
              "snr":         float
              "total_run_time_frames":    float  # Sum of directed-run durations
              "total_run_displacement_px": float # Sum |slope|*duration, COLUMNS
            }

        ``net_pxframe`` / ``total_run_displacement_px`` are in kymograph columns,
        NOT image pixels — the Node backend scales by px-per-column (= arc length
        / (n_samples-1)) before applying the µm calibration.

        Per-run detail is intentionally NOT exposed — the run segmentation is an
        internal step used only to aggregate the two totals above.
        ``total_run_time`` counts only directed runs of >=6 frames; pauses AND
        sub-6-frame directed flickers are excluded.
    """
    import kymobutler  # noqa: E402  (needs the path set above)

    if kymo.ndim != 2 or kymo.shape[0] < 4 or kymo.shape[1] < 4:
        return []
    if mode not in ("bidirectional", "unidirectional"):
        raise ValueError(f"unknown KymoButler mode: {mode!r}")

    kymo = kymo.astype(np.float32, copy=False)
    X = kymo.shape[1]
    dev = device or _kymobutler_device()

    # KymoButler consumes a row-normalised, polarity-corrected copy. The SNR and
    # the sub-pixel refinement below read the RAW matrix instead, because that is
    # what the DoG detector this replaced reported and what the intensity
    # metrics still measure — so the `snr` column stays comparable across the
    # detector swap.
    preprocessed, _raw, negated = kymobutler.preprocess_array(kymo)

    if mode == "bidirectional":
        nets = kymobutler.load_models(("binet", "decnet"), device=dev)
        pred = kymobutler.segment_bidirectional(preprocessed, nets["binet"], dev)
        # ``track_bidirectional`` takes its OWN ``device=`` and it is NOT
        # optional: the nets already sit on ``dev``, and every tensor this
        # builds must land there too or the first decision-module call raises a
        # device mismatch.
        tracks = kymobutler.track_bidirectional(
            pred,
            preprocessed,
            negated,
            threshold=kymobutler.BIDIRECTIONAL_THRESHOLD,
            vision_threshold=kymobutler.DEFAULT_VISION_THRESHOLD,
            vision_net=nets["decnet"],
            min_size=kymobutler.DEFAULT_MIN_SIZE if min_size is None else min_size,
            min_frames=(
                kymobutler.DEFAULT_MIN_FRAMES if min_frames is None else min_frames
            ),
            device=dev,
        )
        point_lists = [t.points for t in tracks]
    else:
        nets = kymobutler.load_models(("uninet",), device=dev)
        preds = kymobutler.segment_unidirectional(preprocessed, nets["uninet"], dev)
        # 3/3 rather than the bidirectional 10/10: this path has no decision
        # module to bridge a break, so its components are shorter. These are the
        # values that reproduce upstream's reference counts (see config.py).
        ant, ret = kymobutler.track_unidirectional(
            preds,
            preprocessed.shape,
            threshold=kymobutler.UNIDIRECTIONAL_THRESHOLD,
            min_size=3 if min_size is None else min_size,
            min_frames=3 if min_frames is None else min_frames,
        )
        point_lists = [t.points for t in ant + ret]

    # --- amplitude / noise scale, measured exactly as the DoG detector did ----
    # KymoButler emits no SNR of its own, and ``snr`` is a wire field that both
    # the Node mapper and the Excel export read. Reproducing the old estimator
    # at the new trajectory positions keeps that column meaning the same thing:
    # sigma from the MAD of the high-pass residual, amplitude from the
    # per-row-baseline-subtracted RAW matrix (not KymoButler's normalised copy,
    # whose units are arbitrary).
    #
    # ``polarity`` is the one thing the old estimator did not need. The DoG
    # detector peaked on POSITIVE band-pass maxima only, so it could not see a
    # dark trajectory on a bright background and never had to sign its
    # amplitudes. KymoButler detects polarity and inverts, so it finds those —
    # and reading their raw amplitude unsigned reports a NEGATIVE SNR for a
    # perfectly good trajectory. Measured 2026-08-31 on 10 real production
    # kymographs: 9 are bright-on-dark (polarity = +1, so this is a no-op and
    # the column is bit-identical to what the old detector produced), and the
    # tenth — a 640 nm channel whose raw median sits at 247 of 255 — is
    # inverted, where all 16 trajectories came out at SNR -6.2..-2.5 before this
    # sign. A track that runs AGAINST the detected polarity still gets a
    # negative SNR, which is the honest signal that nothing is under it.
    #
    # ``negated`` is what preprocess_array already decided, so this cannot
    # disagree with kymograph_polarity() — which the route calls to sign the
    # intensity metrics measured beside these tracks.
    from scipy.ndimage import gaussian_filter

    polarity = -1.0 if negated else 1.0
    S = polarity * (kymo - np.median(kymo, axis=1, keepdims=True))
    resid = S - gaussian_filter(S, (2.0, 2.0))
    sig_i = 1.4826 * np.median(np.abs(resid - np.median(resid))) + 1e-9
    # The same DoG band-pass the old detector peaked on, used ONLY to nudge each
    # integer skeleton column onto the sub-pixel intensity maximum (clipped to
    # +/-1 column inside _subpixel_peak). KymoButler tracks a THINNED BINARY
    # skeleton and so can only ever report whole columns, which would quantise a
    # slow trajectory's velocity to 0 or 1 column per frame.
    dog = gaussian_filter(S, 1.6) - gaussian_filter(S, 4.8)

    out: List[Dict[str, Any]] = []
    for pts in point_lists:
        if len(pts) < 2:
            continue
        t_arr = np.asarray([int(r) for r, _c in pts], dtype=np.float64)
        if t_arr[-1] <= t_arr[0]:
            continue
        cols = [min(max(int(round(c)), 0), X - 1) for _r, c in pts]
        x_arr = np.asarray(
            [_subpixel_peak(dog[int(t)], c, X) for t, c in zip(t_arr, cols)],
            dtype=np.float64,
        )
        amps = [float(S[int(t), c]) for t, c in zip(t_arr, cols)]

        net = float((x_arr[-1] - x_arr[0]) / (t_arr[-1] - t_arr[0]))
        segs = _segment_runs(t_arr, x_arr, pause_thresh)
        out.append(
            {
                "points": [[int(t), float(x)] for t, x in zip(t_arr, x_arr)],
                "net_pxframe": net,
                "snr": float(np.median(amps) / sig_i),
                "total_run_time_frames": float(sum(s["t1"] - s["t0"] for s in segs)),
                "total_run_displacement_px": float(
                    sum(abs(s["v_pxframe"]) * (s["t1"] - s["t0"]) for s in segs)
                ),
            }
        )
    out.sort(key=lambda r: -abs(r["net_pxframe"]))
    return out


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
