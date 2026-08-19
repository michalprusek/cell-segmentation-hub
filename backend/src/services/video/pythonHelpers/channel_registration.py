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
  StackReg / scikit-image). For the rigid-translation, shared-structure case
  it is as good in practice as mutual-information registration, without the
  extra dependency or the non-convex optimisation.

The shift is applied as an **integer** pixel shift (array slice + zero-fill of
the vacated border), which is **lossless** for the 16-bit data — no
interpolation, so raw sample values are preserved (only translated). Channel 0
is the reference and never moves.

Runs inside the backend container (numpy only — no scipy / skimage / cv2).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple

import numpy as np

# A channel offset larger than this fraction of the smaller image dimension is
# treated as a spurious correlation peak (real chromatic/stage offsets are a
# handful of pixels, never a third of the frame) and rejected → (0, 0).
_MAX_SHIFT_FRACTION = 0.10

# Minimum peak-to-background ratio for a phase-correlation estimate to be
# trusted. A dark/low-signal frame produces a flat surface with no clear peak;
# below this the estimate is discarded so noise can't inject jitter.
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
# NOTE on branch ORDER: the plausibility guard runs BEFORE the confidence
# guard, so an estimate that is both implausibly large AND weak is reported as
# ``implausible_shift``. That is what the code does; the reason names the
# branch actually taken, not a priority ranking.
REASON_OK = "ok"  # estimate accepted and returned as-is (may be a real (0, 0))
REASON_LOW_CONFIDENCE = "low_confidence"  # peak-to-background < _MIN_CONFIDENCE
REASON_IMPLAUSIBLE_SHIFT = "implausible_shift"  # peak beyond _MAX_SHIFT_FRACTION
# Not produced here — :func:`estimate_translation_detailed` RAISES on a shape
# mismatch. It exists for callers that catch that case up-front and degrade to
# an unshifted copy rather than aborting a batch (``add_channel_align.py``), so
# that the vocabulary consumers see is complete.
REASON_SHAPE_MISMATCH = "shape_mismatch"


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
    """
    gy, gx = np.gradient(a)
    return np.hypot(gx, gy)


def _hann2d(shape: tuple[int, int]) -> np.ndarray:
    """Separable 2-D Hann window; tapers the borders to zero so the FFT's
    implicit periodicity doesn't create a false correlation ridge at the edges.
    """
    wy = np.hanning(shape[0])
    wx = np.hanning(shape[1])
    return np.outer(wy, wx)


def estimate_translation(
    reference: np.ndarray, moving: np.ndarray
) -> tuple[int, int, float]:
    """Integer translation ``(dy, dx)`` that best aligns ``moving`` onto
    ``reference`` (both single-channel frames of equal shape), plus a
    confidence score.

    Applying the result: ``registered = shift_frame(moving, dy, dx)`` puts
    ``moving``'s features on top of ``reference``'s.

    Returns ``(0, 0, confidence)`` when the estimate is implausibly large or
    the correlation peak is too weak to trust — a safe no-op. Those two
    outcomes are NOT distinguishable from this 3-tuple; call
    :func:`estimate_translation_detailed` when you need to report *why*.

    Kept as a thin wrapper so existing 3-tuple call sites are untouched: the
    numbers are produced by exactly the same code path, so the shifts this
    returns are identical to what it returned before the reason field existed.
    """
    est = estimate_translation_detailed(reference, moving)
    return est.dy, est.dx, est.confidence


def estimate_translation_detailed(
    reference: np.ndarray, moving: np.ndarray
) -> TranslationEstimate:
    """:func:`estimate_translation` plus the outcome ``reason`` and the raw
    correlation peak.

    The registration math and both guards are unchanged — this only *names*
    the branch that produced the returned shift:

    * ``ok`` — the peak passed both guards and is returned. A returned
      ``(0, 0)`` here is a genuine success: the channels are already aligned.
    * ``implausible_shift`` — a peak was found but sits further than
      ``_MAX_SHIFT_FRACTION`` of the smaller dimension from the origin, so it
      was discarded. Zeroed shift, confidence untouched — this is the silent
      failure that used to be indistinguishable from "already aligned".
    * ``low_confidence`` — the peak-to-background ratio is below
      ``_MIN_CONFIDENCE`` (a flat, no-match correlation surface).

    A shape mismatch raises, as before; it is not a reason this function can
    return (see ``REASON_SHAPE_MISMATCH``).
    """
    ref = _to_float_gray(reference)
    mov = _to_float_gray(moving)
    if ref.shape != mov.shape:
        raise ValueError(
            f"channel frames must share a shape, got {ref.shape} vs {mov.shape}"
        )
    if ref.ndim != 2:
        raise ValueError(f"expected 2-D frames, got ndim={ref.ndim}")

    win = _hann2d(ref.shape)
    rg = _gradient_magnitude(ref) * win
    mg = _gradient_magnitude(mov) * win

    fr = np.fft.rfft2(rg)
    fm = np.fft.rfft2(mg)
    cross = fr * np.conj(fm)
    cross /= np.abs(cross) + 1e-8  # whiten → pure phase correlation
    corr = np.fft.irfft2(cross, s=ref.shape)

    peak = np.unravel_index(int(np.argmax(corr)), corr.shape)
    peak_val = float(corr[peak])
    # Peak-to-background ratio: a sharp, trustworthy peak sits far above the
    # surface's mean±std; a flat (no-match) surface scores ~1.
    background = float(corr.mean() + corr.std()) or 1e-12
    confidence = peak_val / background if background > 0 else 0.0

    # Fold the periodic FFT index into a signed shift in [-N/2, N/2).
    dy, dx = int(peak[0]), int(peak[1])
    if dy > ref.shape[0] // 2:
        dy -= ref.shape[0]
    if dx > ref.shape[1] // 2:
        dx -= ref.shape[1]

    max_shift = _MAX_SHIFT_FRACTION * min(ref.shape)
    if abs(dy) > max_shift or abs(dx) > max_shift:
        # Implausible → reject. The candidate peak survives in peak_dy/peak_dx
        # so the caller can report WHAT was rejected, not just that something
        # was.
        return TranslationEstimate(0, 0, confidence, REASON_IMPLAUSIBLE_SHIFT, dy, dx)
    if confidence < _MIN_CONFIDENCE:
        return TranslationEstimate(0, 0, confidence, REASON_LOW_CONFIDENCE, dy, dx)

    return TranslationEstimate(dy, dx, confidence, REASON_OK, dy, dx)


def shift_frame(arr: np.ndarray, dy: int, dx: int, fill: int = 0) -> np.ndarray:
    """Return ``arr`` translated by integer ``(dy, dx)``, zero-filling the
    vacated border. Lossless: every retained pixel keeps its exact value
    (no interpolation), so 16-bit data survives untouched.

    ``dy > 0`` moves content down, ``dx > 0`` moves it right — the inverse of
    the offset returned by :func:`estimate_translation`, i.e. calling
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


def write_registration_sidecar(
    dest_dir: Path | str,
    channel_names: list[str],
    offsets: dict[int, list],
) -> None:
    """Persist the per-frame per-channel translation applied at extraction, as
    ``<dest_dir>/registration.json``. Downstream consumers that re-read the raw
    file (MT metrics / kymographs) load this to sample each channel in the
    registered (channel-0) space. Single-channel videos have nothing to record,
    so this is a no-op there. Shared by both extractors so the on-disk format
    stays identical.
    """
    if len(channel_names) <= 1:
        return
    data = {
        "version": 1,
        "method": "phase_correlation_gradient_translation",
        "referenceChannel": channel_names[0],
        "channels": channel_names,
        # frameIndex (string key) -> [[dy, dx], ...] aligned to ``channels``.
        "frames": {str(t): offsets[t] for t in sorted(offsets)},
    }
    (Path(dest_dir) / "registration.json").write_text(json.dumps(data))


def register_stack_to_first_channel(
    frame_channels: list[list[np.ndarray]],
) -> tuple[list[list[np.ndarray]], list[list[tuple[int, int]]]]:
    """Register every channel of every frame onto that frame's **channel 0**.

    ``frame_channels[t][c]`` is the 2-D array for frame ``t``, channel ``c``.
    Per-frame estimation (offsets may drift across the acquisition), with
    channel 0 fixed as the reference. Returns the registered arrays plus the
    applied ``(dy, dx)`` offset for each (frame, channel) for provenance.
    Single-channel frames pass through unchanged with a ``(0, 0)`` offset.
    """
    registered: list[list[np.ndarray]] = []
    offsets: list[list[tuple[int, int]]] = []
    for channels in frame_channels:
        if len(channels) <= 1:
            registered.append([c.copy() for c in channels])
            offsets.append([(0, 0)] * len(channels))
            continue
        ref = channels[0]
        reg_row: list[np.ndarray] = [ref.copy()]
        off_row: list[tuple[int, int]] = [(0, 0)]
        for c in channels[1:]:
            dy, dx, _conf = estimate_translation(ref, c)
            reg_row.append(shift_frame(c, dy, dx))
            off_row.append((dy, dx))
        registered.append(reg_row)
        offsets.append(off_row)
    return registered, offsets
