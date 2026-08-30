"""Translation-only multimodal channel registration for uploaded videos.

Multi-channel microscopy videos (ND2 / multi-page TIFF) sometimes carry a
small, fixed optical/chromatic offset between channels — e.g. a widefield IRM
channel and a TIRF fluorescence channel imaging the same microtubules land a
few pixels apart. This module estimates and removes that offset with a
**rigid translation** (2 DOF), so the channels overlay correctly.

Method — why phase correlation on gradient maps:
  The two channels are *different modalities*: their raw intensities are not
  linearly related (IRM can even be contrast-inverted vs fluorescence), so a
  plain intensity cross-correlation is unreliable. But both channels image the
  SAME physical structures, so their **edges** coincide. We therefore:
    1. reduce each channel to a structural (gradient-magnitude) map, which
       discards the DC/contrast difference and keeps the shared geometry;
    2. apply a 2-D Hann window (kills FFT wrap-around / edge leakage);
    3. take the whitened cross-power spectrum and inverse-FFT — the peak of the
       resulting phase-correlation surface is the integer translation.
  This is the fast, no-heavy-dependency (numpy-only) member of the phase-based
  multimodal-registration family that is standard in microscopy (ImageJ
  StackReg / scikit-image).

Why not mutual information (or LC²), measured rather than assumed:
  MI was evaluated against this method on real production pairs (2026-08-29,
  ±16 px window, 32 bins, 2× decimation).
    * Cost — 0.489 s vs 0.086 s per pair at 1024², i.e. 6× slower, and MI needs
      a SEARCH where phase correlation answers for every shift at once from two
      FFTs. On a 621-frame 2-channel ND2 that is +5.1 min on a synchronous
      upload against +0.9 min.
    * Accuracy — on 14 pairs this method handles well, MI's optimum disagreed
      on 7, and on those it landed ON THE WINDOW BOUNDARY ((-16,-16), (-16,-14),
      (6,-16)) with a flat landscape (peak/median 1.03-1.09): the signature of
      an optimiser sliding across a non-convex surface with no optimum in it.
      Phase correlation meanwhile returned the same (3, -2) across five
      independent containers of one microscope session — a reproducible
      chromatic offset MI could not recover.
    * As a veto — MI's peak/median does not separate the populations either
      (good pairs scored 106, 67, 9.97, 3.57, 1.52, 1.63, 1.10; bad ones up to
      2.75), so no threshold on it is usable.
  The pairs that fail here fail because the two channels image DIFFERENT
  structures — one is often nearly empty — and no similarity metric can invent
  a correspondence that is not in the data. Changing the metric would only
  change the disguise the failure wears.

The shift is applied as an **integer** pixel shift (array slice + zero-fill of
the vacated border), which is **lossless** for the 16-bit data — no
interpolation, so raw sample values are preserved (only translated). Channel 0
is the reference and never moves.

Runs inside the backend container (numpy only — no scipy / skimage / cv2).
"""

from __future__ import annotations

import json
import sys
from contextlib import nullcontext
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

import numpy as np

# How far from the origin the true offset may lie, in PIXELS. A chromatic or
# stage offset is a physical quantity — it does not grow because the camera has
# more pixels — so this is an absolute budget, not a fraction of the frame.
#
# It replaced ``_MAX_SHIFT_FRACTION = 0.10`` on 2026-08-29. That rule read
# "10 % of the smaller dimension", which is ±12 px on the 128² synthetic frames
# the tests used and ±130 px on a real 1300² acquisition — so on production data
# it admitted almost any noise peak. Measured over 116 real (reference, moving)
# pairs from production: 27 % of pairs had a spurious peak accepted and APPLIED
# as a shift of up to 128 px. Genuine offsets in that same sample had a median
# magnitude of 3 px and none exceeded 10.
_MAX_SHIFT_PX = 16

# The search is confined to ±_MAX_SHIFT_PX, so the peak is chosen among
# plausible candidates rather than found globally and then vetoed. That
# ordering is the point: when the true peak is the second-highest on the
# surface, a global argmax never sees it.

# Minimum ratio of the winning peak to its best RIVAL elsewhere on the surface
# for the estimate to be trusted.
#
# This is the discriminator, and its boundary is structural rather than tuned: a
# genuine registration peak IS the global maximum, so the ratio exceeds 1; a
# noise peak means the real maximum lies somewhere else, so it falls below 1.
# Measured on those same 116 production pairs, with the rival taken outside a
# ±_PEAK_EXCLUSION_PX box around the peak:
#
#     genuine pairs  n=52  min 1.006   median 10.5   max 32687
#     spurious pairs n=64  min 0.195   median 0.77   max 0.991
#
# The structural boundary is 1.0 — the empty gap in that sample is
# [0.991, 1.006]. 1.2 sits ~21 % ABOVE the highest spurious score, buying
# headroom on data the sample never saw; the price is paid on the genuine side.
# At this value it keeps 50 of 52 genuine estimates and admits 0 of 64 spurious
# ones — change it and those two counts stop describing it.
_MIN_PEAK_RATIO = 1.2

# Half-width of the square window around the winning peak that is excluded when looking for
# its rival. A real correlation peak is a few pixels wide, so without this the
# peak's own shoulder is its strongest competitor and every ratio collapses to
# ~1 regardless of match quality.
_PEAK_EXCLUSION_PX = 3

# Legacy peak-to-background ratio, kept as a floor for degenerate surfaces (an
# all-constant frame scores 0 here). It is NOT the discriminator and never was:
# the docstring below used to claim a no-match surface scores ~1, but measured,
# two unrelated frames score 6.7-8.1 — because ``mean + std`` makes this ratio
# track the extreme value of N noise samples, a property of the SURFACE SIZE,
# not of match quality. (√(2 ln N) is the Gaussian idealisation of that growth
# and under-predicts the measured 6.7-8.1, so read it as the reason, not the
# formula.) No value of this threshold
# separates the populations, which is why _MIN_PEAK_RATIO exists.
_MIN_CONFIDENCE = 3.0

# --------------------------------------------------------------------------
# Per-frame outcome vocabulary.
#
# Every estimate ends on exactly one of these, one per *branch* of
# :func:`estimate_translation_detailed`. Without them a rejected estimate is
# indistinguishable from a successful one: both a genuine "already aligned"
# result and an implausible peak that was discarded surface as (0, 0) with a
# high confidence, so a caller counting zero shifts cannot tell a no-op success
# from a silent failure.
#
# NOTE: there are no longer two ordered guards. ONE combined gate accepts
# (``quality`` AND ``confidence``); the two rejection reasons only CLASSIFY a
# rejection by where the global peak fell. The observable labelling is
# unchanged, but nothing is "guarded" in that order any more.
REASON_OK = "ok"  # estimate accepted and returned as-is (may be a real (0, 0))
#: Rejected, global peak INSIDE the window. Despite the name it fires mostly on
#: a weak `quality` at a HIGH `confidence` — see ``_MIN_CONFIDENCE`` above for
#: why that threshold is not the discriminator.
REASON_LOW_CONFIDENCE = "low_confidence"
#: Rejected, global peak OUTSIDE the ±`max_shift_px` window.
REASON_IMPLAUSIBLE_SHIFT = "implausible_shift"
#: Channel 0. Its offset is (0, 0) by definition — the origin every other
#: channel is measured against — which is NOT the same claim as "an estimate ran
#: and returned zero".
REASON_REFERENCE = "reference"
#: No estimate was attempted because a plane carried no acquisition (this
#: channel's, or the reference's). The normal case on a sparse stack, where the
#: microscope only refreshed a channel every N-th frame.
REASON_BLANK_PLANE = "blank_plane"
#: The container was extracted without channel registration at all.
REASON_NOT_REGISTERED = "not_registered"
#: No estimate ran, for a reason none of the above names. A defensive default:
#: a future skip condition then reads as "not estimated" rather than silently
#: inheriting "ok".
REASON_NOT_ESTIMATED = "not_estimated"
# Not produced here — :func:`estimate_translation_detailed` RAISES on a shape
# mismatch. It exists for callers that catch that case up-front and degrade to
# an unshifted copy rather than aborting a batch (``add_channel_align.py``), so
# that the vocabulary consumers see is complete.
REASON_SHAPE_MISMATCH = "shape_mismatch"


#: Every reason this module can produce or accept, so a consumer can enumerate
#: the set instead of hard-coding it. A tuple rather than an enum ON PURPOSE:
#: this file is COPY'd into the essays image and executed under Python 3.10
#: there (`/app/models/channel_registration.py`) while the backend runs 3.12.
#: `StrEnum` does not exist on 3.10 — and the ImportError would be swallowed by
#: `nd2_io._load_estimator`, silently disabling the whole diagnostic — while the
#: `(str, Enum)` fallback formats as 'ok' on 3.10 and 'R.OK' on 3.12, which
#: would corrupt `register_plane`'s operator line on one of them.
REASONS: tuple[str, ...] = (
    REASON_OK,
    REASON_LOW_CONFIDENCE,
    REASON_IMPLAUSIBLE_SHIFT,
    REASON_SHAPE_MISMATCH,
    REASON_REFERENCE,
    REASON_BLANK_PLANE,
    REASON_NOT_REGISTERED,
    REASON_NOT_ESTIMATED,
)

#: The subset :func:`estimate_translation_detailed` can RETURN — the only ones
#: that can reach `add_channel_align`'s rows, and therefore the TypeScript
#: `ALIGN_REASONS` in addChannelService.
ESTIMATOR_REASONS: tuple[str, ...] = (
    REASON_OK,
    REASON_LOW_CONFIDENCE,
    REASON_IMPLAUSIBLE_SHIFT,
)


class TranslationEstimate(NamedTuple):
    """One frame's registration outcome: the shift that was APPLIED, how much
    the correlation was trusted, WHY the shift is what it is, and the raw
    correlation peak before the guards ran.

    ``(dy, dx)`` is zero whenever ``reason`` is not ``ok``; ``(peak_dy,
    peak_dx)`` still carries the discarded candidate, which is what turns
    "20 frames rejected" into the actionable "20 frames wanted (-87, 3)".
    """

    dy: int
    dx: int
    confidence: float
    reason: str
    peak_dy: int
    peak_dx: int
    #: Winning peak / best rival outside a ±_PEAK_EXCLUSION_PX box. Above 1 the
    #: peak beats everything outside that box — a near-1 value can still have a
    #: rival a few px away. Acceptance needs this AND ``confidence``.
    quality: float


class PreparedFrame(NamedTuple):
    """One frame reduced to the half-spectrum an estimate consumes.

    Preparing a frame — float conversion, gradient magnitude, Hann window,
    ``rfft2`` — is the per-FRAME half of an estimate and costs about as much as
    the correlation it feeds (measured at 2048²: 124 ms of a 365 ms estimate,
    twice over, and at the decimation the consecutive drift pass uses the PNG
    decode alone outweighs the correlation 5:1).

    Anything walking a CHAIN of pairs — ``(0,dt), (dt,2dt), (2dt,3dt)…``, which
    is every pass of :mod:`drift_correction` — meets each frame twice: once as
    the moving frame, once as the next pair's reference. Preparing separately
    lets the second visit reuse the first for one half-spectrum of RAM.

    ``shape`` is carried because it is not recoverable from the spectrum: an
    ``rfft2`` of width W has width ``W // 2 + 1``, so 6 and 7 both give 4, and
    the pair check needs the real one.
    """

    spectrum: np.ndarray
    shape: tuple[int, int]


def _to_float_gray(arr: np.ndarray) -> np.ndarray:
    """2-D float64 view of a channel frame (collapse a stray singleton axis)."""
    a = np.asarray(arr)
    if a.ndim == 3:
        # Defensive: an accidental (H, W, 1) — squeeze to 2-D.
        a = a.reshape(a.shape[0], a.shape[1])
    return a.astype(np.float64)


def _gradient_magnitude(a: np.ndarray) -> np.ndarray:
    """Structural map used for matching: |∇a|.

    Using the gradient (not raw intensity) is what makes the correlation
    *multimodal*-robust — it depends on where edges are, not on how bright or
    which way round the contrast runs.

    ``np.hypot`` writes into the ``gx`` buffer rather than allocating a third
    full-frame float64 array (elementwise, so the aliasing is safe and the
    values are bit-identical to the out-of-place form). At 2048² that is one
    32 MB allocation saved per gradient, and this runs twice per estimate on
    every (frame, channel) — see the memory note on
    :func:`estimate_translation_detailed`.
    """
    gy, gx = np.gradient(a)
    np.hypot(gx, gy, out=gx)
    return gx


@lru_cache(maxsize=2)
def _hann2d(shape: tuple[int, int]) -> np.ndarray:
    """Separable 2-D Hann window; tapers the borders to zero so the FFT's
    implicit periodicity doesn't create a false correlation ridge at the edges.

    Cached per shape and returned READ-ONLY. The window depends only on the
    frame geometry, which is constant for a whole acquisition, so rebuilding it
    on every (frame, channel) estimate allocated a full-frame float64 array
    (32 MB at 2048²) per call for an identical result. ``maxsize=2`` bounds the
    retained cache at 2·Y·X·8 bytes — one live shape plus one in transition — a
    fixed cost that replaces one full-frame allocation on EVERY (frame, channel)
    estimate. The array is frozen so a caller cannot mutate the shared
    instance.
    """
    wy = np.hanning(shape[0])
    wx = np.hanning(shape[1])
    win = np.outer(wy, wx)
    win.flags.writeable = False
    return win


def estimate_translation_detailed(
    reference: np.ndarray,
    moving: np.ndarray,
    max_shift_px: int = _MAX_SHIFT_PX,
) -> TranslationEstimate:
    """Integer translation ``(dy, dx)`` that best aligns ``moving`` onto
    ``reference`` (both single-channel frames of equal shape), with the outcome
    ``reason``, the raw GLOBAL correlation peak and ``quality``.

    Applying the result: ``registered = shift_frame(moving, dy, dx)`` puts
    ``moving``'s features on top of ``reference``'s. ``(dy, dx)`` is ``(0, 0)``
    whenever ``reason`` is not ``ok``, so the reason is what separates a
    genuine "already aligned" from a refusal:

    * ``ok`` — the windowed peak cleared both ``_MIN_PEAK_RATIO`` and
      ``_MIN_CONFIDENCE`` and is returned. A returned ``(0, 0)`` here is a
      genuine success: the channels are already aligned.
    * ``implausible_shift`` — rejected, and the GLOBAL peak lies outside the
      ±``max_shift_px`` window: something elsewhere in the frame correlated
      better than anything plausible. ``peak_dy``/``peak_dx`` carry that
      candidate so a caller can report WHAT it refused.
    * ``low_confidence`` — rejected with the global peak inside the window.
      Read it as "no dominant peak"; the name predates ``quality`` and is not a
      statement about ``_MIN_CONFIDENCE`` (see that constant).

    Note both rejection reasons are CLASSIFICATIONS of one combined gate, not
    two guards applied in order.

    A shape mismatch raises, as before; it is not a reason this function can
    return (see ``REASON_SHAPE_MISMATCH``).

    Memory: every intermediate is a FULL-FRAME float64 (or complex128
    half-spectrum) array — 32 MB apiece at 2048² — and the naive out-of-place
    form kept a dozen of them alive at once: a measured **386 MB of RSS per
    call** for a single 2048² frame. Run from N encoder threads that is 386·N,
    which is what OOM-killed a 4 GiB container on a 2-channel 2048²
    acquisition. :func:`_prepare` and :func:`estimate_translation_prepared`
    therefore reuse buffers in place and ``del`` each array at its last use,
    holding the traced peak to ~6 full-frame float64 planes and the RSS peak to
    ~290 MB at 2048² once allocator slack and pocketfft's internal buffers are
    counted. The peak falls at the cross-power step, where both spectra are
    live either way, so the split does not move it — but a caller that RETAINS
    a spectrum between calls (see :class:`PreparedFrame`) adds one plane on top
    for as long as it holds it.

    Every rewrite is elementwise with exact aliasing, so the arithmetic and the
    returned numbers are BIT-IDENTICAL to the out-of-place form — verified over
    84 frame/dtype/shift combinations and pinned by
    ``test_channel_registration.py``. The algorithm, the gate and its thresholds
    are untouched.
    """
    ref = _to_float_gray(reference)
    mov = _to_float_gray(moving)
    if ref.shape != mov.shape:
        raise ValueError(
            f"channel frames must share a shape, got {ref.shape} vs {mov.shape}"
        )
    if ref.ndim != 2:
        raise ValueError(f"expected 2-D frames, got ndim={ref.ndim}")

    a = _prepare(ref)
    del ref
    b = _prepare(mov)
    del mov
    return estimate_translation_prepared(a, b, max_shift_px)


def _prepare(gray: np.ndarray) -> PreparedFrame:
    """Windowed gradient map of an already-float 2-D frame, as a half-spectrum.

    Consumes ``gray``: the caller should drop its reference immediately after,
    as :func:`estimate_translation_detailed` does.
    """
    shape = gray.shape
    g = _gradient_magnitude(gray)
    g *= _hann2d(shape)  # in place: same values as `_gradient_magnitude(g) * win`
    spectrum = np.fft.rfft2(g)
    del g
    # Frozen for the same reason `_hann2d`'s window is: a caller may CACHE this
    # and hand it to a second correlation (see PreparedFrame), so a future
    # buffer-reusing rewrite would corrupt the NEXT pair in a chain — where the
    # corruption reads as a drift estimate, not as an error. Verified
    # bit-identical with the flag set.
    spectrum.flags.writeable = False
    return PreparedFrame(spectrum, shape)


def prepare_frame(frame: np.ndarray) -> PreparedFrame:
    """One frame reduced to the half-spectrum an estimate consumes.

    Public so a caller walking a CHAIN of pairs can prepare each frame once —
    see :class:`PreparedFrame` for why that is worth doing.
    """
    gray = _to_float_gray(frame)
    if gray.ndim != 2:
        raise ValueError(f"expected 2-D frames, got ndim={gray.ndim}")
    return _prepare(gray)


def estimate_translation_prepared(
    reference: PreparedFrame,
    moving: PreparedFrame,
    max_shift_px: int = _MAX_SHIFT_PX,
) -> TranslationEstimate:
    """:func:`estimate_translation_detailed` on two already-prepared frames.

    This is the PAIR half of an estimate — everything that genuinely depends on
    both frames. Splitting it out changes no arithmetic: the spectra are read,
    never written (``cross = fr * np.conj(fm)`` allocates), so an estimate run
    from a reused spectrum is bit-identical to one that recomputed it.
    """
    if reference.shape != moving.shape:
        raise ValueError(
            f"channel frames must share a shape, got "
            f"{reference.shape} vs {moving.shape}"
        )
    shape = reference.shape
    fr, fm = reference.spectrum, moving.spectrum
    # NOTE: written exactly as `fr * np.conj(fm)` on purpose. numpy dispatches
    # this expression to a different complex-multiply loop than the buffer-
    # reusing `np.conjugate(fm, out=fm); np.multiply(fr, fm, out=fm)` form, and
    # the two disagree in the last ULP — enough to move `confidence` and, at a
    # threshold boundary, the accepted shift. Since the split above, a spectrum
    # may also be SHARED with a caller's cache, so writing into one would
    # corrupt the next pair as well; both reasons point the same way.
    cross = fr * np.conj(fm)
    del fr, fm
    mag = np.abs(cross)
    mag += 1e-8
    cross /= mag  # whiten → pure phase correlation
    del mag
    corr = np.fft.irfft2(cross, s=shape)
    del cross

    h, w = shape

    # The GLOBAL peak is computed for reporting only — it is what the estimate
    # would have been under the old global-argmax rule, and naming it is what
    # turns "rejected" into the actionable "wanted (-87, 3)".
    gpeak = np.unravel_index(int(np.argmax(corr)), corr.shape)
    peak_val = float(corr[gpeak])
    background = float(corr.mean() + corr.std()) or 1e-12
    confidence = peak_val / background if background > 0 else 0.0

    # Fold the periodic FFT index into a signed shift in [-N/2, N/2).
    gdy, gdx = int(gpeak[0]), int(gpeak[1])
    if gdy > h // 2:
        gdy -= h
    if gdx > w // 2:
        gdx -= w

    # --- the estimate itself: best peak WITHIN the plausible window ---------
    # Clamped so a frame smaller than the budget cannot wrap the window onto
    # itself (at 32² a ±16 window would cover every shift there is).
    # ``max_shift_px`` is a per-call budget because the two callers measure
    # different physical quantities. A CHANNEL offset is a fixed chromatic /
    # optical constant and never grows, so 16 px is generous. STAGE DRIFT
    # accumulates: at the 0.084 px/frame measured on production, a 243-frame
    # baseline has moved 20 px and a 729-frame one 61 px, both of which a 16 px
    # window would clip to its edge and then reject. Drift estimation therefore
    # passes its own, larger budget.
    radius = max(1, min(max_shift_px, min(h, w) // 4))
    off = np.arange(-radius, radius + 1)
    ys, xs = off % h, off % w
    sub = corr[np.ix_(ys, xs)]  # (2r+1)² — small, unlike the full surface
    k = int(np.argmax(sub))
    dy = int(off[k // sub.shape[1]])
    dx = int(off[k % sub.shape[1]])
    win_val = float(corr[dy % h, dx % w])

    # --- quality: the winning peak against its best rival -------------------
    # The exclusion window is written into `corr` in place and never restored:
    # `corr` is local and dead after this. A masked copy would cost another
    # full-frame float64 (32 MB at 2048²), which the memory note above exists
    # to avoid.
    ey = (dy + np.arange(-_PEAK_EXCLUSION_PX, _PEAK_EXCLUSION_PX + 1)) % h
    ex = (dx + np.arange(-_PEAK_EXCLUSION_PX, _PEAK_EXCLUSION_PX + 1)) % w
    corr[np.ix_(ey, ex)] = -np.inf
    rival = float(corr.max())
    del corr
    quality = win_val / rival if rival > 0 and win_val > 0 else 0.0

    if quality >= _MIN_PEAK_RATIO and confidence >= _MIN_CONFIDENCE:
        return TranslationEstimate(dy, dx, confidence, REASON_OK, gdy, gdx, quality)

    # Rejected. WHICH reason is itself informative: a global peak outside the
    # window means a real (or noise) structure pulled the match somewhere
    # implausible, while a global peak inside it means the surface simply has
    # no dominant peak at all. Order preserved from the original: the
    # plausibility branch reports first when both would fire.
    if abs(gdy) > radius or abs(gdx) > radius:
        return TranslationEstimate(
            0, 0, confidence, REASON_IMPLAUSIBLE_SHIFT, gdy, gdx, quality
        )
    return TranslationEstimate(
        0, 0, confidence, REASON_LOW_CONFIDENCE, gdy, gdx, quality
    )


def shift_frame(arr: np.ndarray, dy: int, dx: int, fill: int = 0) -> np.ndarray:
    """Return ``arr`` translated by integer ``(dy, dx)``, zero-filling the
    vacated border. Lossless: every retained pixel keeps its exact value
    (no interpolation), so 16-bit data survives untouched.

    ``dy > 0`` moves content down, ``dx > 0`` moves it right — the inverse of
    the offset returned by :func:`estimate_translation_detailed`, i.e. calling
    ``shift_frame(moving, dy, dx)`` with that offset registers ``moving`` onto
    the reference.
    """
    if dy == 0 and dx == 0:
        return arr.copy()
    out = np.full_like(arr, fill)
    h, w = arr.shape[:2]

    # Source/destination row spans for a vertical shift of dy.
    src_y0, src_y1 = max(0, -dy), h - max(0, dy)
    dst_y0, dst_y1 = max(0, dy), h - max(0, -dy)
    # Column spans for a horizontal shift of dx.
    src_x0, src_x1 = max(0, -dx), w - max(0, dx)
    dst_x0, dst_x1 = max(0, dx), w - max(0, -dx)

    if src_y1 > src_y0 and src_x1 > src_x0:
        out[dst_y0:dst_y1, dst_x0:dst_x1] = arr[src_y0:src_y1, src_x0:src_x1]
    return out


def initial_reasons(
    channel_count: int, *, registering: bool, blank: list[bool]
) -> list[str]:
    """What each channel's ``reason`` is BEFORE any estimate runs.

    Both extractors seeded every channel with ``REASON_OK`` until 2026-08-30,
    which recorded "never attempted" as "estimated and accepted" — the exact
    ambiguity the reasons map was added to end. It lands hardest on sparse-IRM
    stacks, where a blank plane is the normal case, not an anomaly: those
    containers reported a full row of ``ok`` for registrations that never ran.

    Channels that DO get estimated have their entry overwritten by
    :func:`register_plane`; the value seeded here is what survives for the ones
    that do not.
    """
    if not registering:
        return [REASON_NOT_REGISTERED] * channel_count
    out = []
    for c in range(channel_count):
        if c == 0:
            out.append(REASON_REFERENCE)
        elif blank[0] or blank[c]:
            out.append(REASON_BLANK_PLANE)
        else:
            out.append(REASON_NOT_ESTIMATED)
    return out


def register_plane(
    reference: np.ndarray,
    plane: np.ndarray,
    *,
    frame_index: int,
    channel_name: str,
    gate=None,
) -> tuple[np.ndarray, list[int], str]:
    """Estimate one channel's offset onto ``reference``, apply it, and REPORT.

    Returns ``(plane, [dy, dx], reason)`` — the registered plane (the original
    object when the offset is zero, so no needless copy), the offset for the
    sidecar, and the outcome for its ``reasons`` map.

    Lives here rather than in the extractors because both of them run exactly
    this step and used to carry byte-identical copies of it. The stderr line is
    the reason that matters: it is the only place a rejected registration
    becomes visible to an operator, and a copy that drifted would silently take
    half the diagnostics with it.

    ``gate`` is an optional context manager bounding how many estimates run at
    once (the ND2 extractor registers from a thread pool and caps the FFT
    workspace; the TIFF path is serial and passes nothing). It gates only the
    estimate, never the shift or the write.
    """
    with gate if gate is not None else nullcontext():
        est = estimate_translation_detailed(reference, plane)
    if est.reason != REASON_OK:
        sys.stderr.write(
            f"registration: frame {frame_index} channel '{channel_name}' "
            f"not registered ({est.reason}; wanted "
            f"({est.peak_dy},{est.peak_dx}), quality "
            f"{est.quality:.2f})\n"
        )
    if est.dy or est.dx:
        plane = shift_frame(plane, est.dy, est.dx)  # new array
    return plane, [est.dy, est.dx], est.reason


def write_registration_sidecar(
    dest_dir: Path | str,
    channel_names: list[str],
    offsets: dict[int, list],
    reasons: dict[int, list[str]] | None = None,
) -> None:
    """Persist the per-frame per-channel translation applied at extraction, as
    ``<dest_dir>/registration.json``. ``mtMetricsExporter`` loads this to sample
    each channel of the RAW original in the registered (channel-0) space —
    it is the only reader, and deliberately so: the kymograph path samples the
    STORED PNGs, which already carry the shift, and applying these offsets
    there would double-count it. Shared by both extractors so the on-disk
    format stays identical.

    A single-channel video has no channel-TO-channel offset to record, but it
    can still carry a per-frame DRIFT offset, and that one is load-bearing:
    without the sidecar `mtMetricsExporter.readRegistrationOffsets` returns
    undefined and `mt_metrics.py` samples the untouched original, up to 20 px
    from where the polylines drawn on the de-drifted PNGs actually sit. So the
    skip needs BOTH — one channel AND nothing to record. A multi-channel
    container whose offsets are all zero IS written. The two stopped meaning the
    same thing when drift correction arrived (production has 4 single-channel
    multi-frame microtubule containers).
    """
    if len(channel_names) <= 1 and not any(
        dy or dx for rows in offsets.values() for dy, dx in rows
    ):
        return
    # The file is positional: `frames[t][c]` and `reasons[t][c]` are read by
    # index, so a row of the wrong length silently re-aligns every channel after
    # it. Checked here because this is the only place that owns the format, and
    # because the damage is UNRECOVERABLE — it goes to disk and the extract is
    # not repeatable without the original upload.
    for label, rows_by_frame in (("offsets", offsets), ("reasons", reasons or {})):
        bad = [t for t, row in rows_by_frame.items() if len(row) != len(channel_names)]
        if bad:
            raise ValueError(
                f"{label} rows must carry one entry per channel "
                f"({len(channel_names)}); frames {sorted(bad)[:5]} do not"
            )
    data = {
        "version": 2,
        "method": "phase_correlation_gradient_translation",
        "referenceChannel": channel_names[0],
        "channels": channel_names,
        # frameIndex (string key) -> [[dy, dx], ...] aligned to ``channels``.
        # SHAPE IS FROZEN: mtMetricsExporter indexes ``frames[t][c] ==
        # [dy, dx]`` positionally, so the reasons go in a PARALLEL map rather
        # than being appended to each row.
        "frames": {str(t): offsets[t] for t in sorted(offsets)},
    }
    if reasons is not None:
        # Why each offset is what it is. Without this a stored ``(0, 0)`` is
        # ambiguous — genuinely aligned, or an estimate that was refused — and
        # that ambiguity is exactly why the 2026-08 registration failures went
        # unnoticed: the reason existed in memory and both extractors dropped
        # it on the floor.
        data["reasons"] = {str(t): reasons[t] for t in sorted(reasons)}
    (Path(dest_dir) / "registration.json").write_text(json.dumps(data))


def read_registration_sidecar(
    dest_dir: Path | str,
) -> tuple[list[str], dict[int, list], dict[int, list[str]]] | None:
    """The sidecar written by :func:`write_registration_sidecar`, parsed back.

    Returns ``(channel_names, offsets, reasons)`` with integer frame keys — the
    shape :func:`write_registration_sidecar` takes — or ``None`` when no
    sidecar exists.

    The counterpart to the writer, and here for the same reason it is: the
    schema has exactly one definition. ``correct_drift.py`` re-reads this file
    to fold stage drift into it, and a reader that open-coded the key names
    would be a second, silent statement of a format whose consumers
    (``mtMetricsExporter``) index it positionally.
    """
    path = Path(dest_dir) / "registration.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    offsets = {int(t): rows for t, rows in data["frames"].items()}
    reasons = {int(t): rows for t, rows in data.get("reasons", {}).items()}
    return data["channels"], offsets, reasons
