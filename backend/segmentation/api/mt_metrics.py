"""Per-microtubule-per-channel intensity metrics endpoint.

Designed for the project-export pipeline. The Node export service POSTs a
request per video container with the original ND2/TIFF absolute path,
which channels (by index + display name) to sample, and the polylines
per frame. This endpoint re-reads the original file so the intensity
numbers are derived from raw 16-bit signal rather than the 8-bit
display-normalised per-channel PNGs (which percentile-clip and are
unsuitable for absolute fluorescence quantification).

For each (frame, polyline, channel) it emits a long-format row with:
- length_px, area_px (band area at the supplied thickness)
- pixel_count, sum/mean/median/std of pixel intensities inside the band
- median_background / mean_background (median resp. mean of pixels
  OUTSIDE all bands dilated by ``thickness * margin_multiplier``, per
  channel)
- signal_minus_background = mean_intensity - median_background

Unit conversion (px -> um) is intentionally done on the Node side so
the user-supplied ``pixelToMicrometerScale`` from the export modal
stays the single source of truth.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Dict, List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)
router = APIRouter()

# Storage root that the ML container may access. Matches the volume mount in
# docker-compose (./backend/uploads → /app/uploads) and the UPLOAD_DIR env
# that the backend service sets. Paths supplied by callers must resolve to a
# descendant of this directory.
_UPLOAD_ROOT = Path(os.getenv("UPLOAD_DIR", "/app/uploads")).resolve()


def _assert_safe_path(p: Path, label: str) -> None:
    """Raise HTTPException(400) if *p* resolves outside _UPLOAD_ROOT."""
    try:
        resolved = p.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid path for {label}")
    if not str(resolved).startswith(str(_UPLOAD_ROOT) + os.sep) and resolved != _UPLOAD_ROOT:
        raise HTTPException(
            status_code=400,
            detail=f"Path for {label} is outside the allowed storage root",
        )


# ----------------------------------------------------------------------------
#  Request / response models
# ----------------------------------------------------------------------------


class MTPolylineInput(BaseModel):
    """One polyline from one frame, in (x, y) pixel coordinates.

    ``image_id`` and ``instance_id`` are propagated unchanged to the
    output so Node can join the rows back to its own DB records.
    """
    model_config = ConfigDict(extra="forbid")

    image_id: str
    instance_id: str
    track_id: Optional[str] = None
    # (M, 2) [x, y]. JSON-friendly nested list form.
    points: List[List[float]]


class MTFrameInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image_id: str
    frame_index: int
    polylines: List[MTPolylineInput]


class MTMetricsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Absolute path on the ML container's filesystem.
    original_path: str
    file_kind: Literal["nd2", "tiff"]
    # Parallel arrays: channel_indices[i] is the C-axis index for
    # channel_names[i]. Names round-trip into the response unchanged so
    # the user sees "TIRF_640" rather than channel position.
    channel_indices: List[int]
    channel_names: List[str]
    frames: List[MTFrameInput]
    thickness_px: int = Field(5, ge=1, le=100)
    margin_multiplier: float = Field(2.0, ge=0.0, le=10.0)
    # Per-frame per-channel translation applied at extraction (channel
    # registration). Keyed by frame_index (string) -> [[dy, dx], ...] aligned to
    # the FULL C-axis channel order (so index by C-axis channel index). Present
    # only for registered uploads; when set, each channel's frame is shifted by
    # its offset before sampling so intensity is read in the registered
    # (channel-0) space that the polylines live in. None = sample the raw file
    # unchanged (legacy / unregistered uploads).
    channel_offsets: Optional[Dict[str, List[List[int]]]] = None


class MTMetricsRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame_index: int
    image_id: str
    instance_id: str
    track_id: Optional[str] = None
    channel: str
    length_px: float
    area_px: int
    pixel_count: int
    sum_intensity: float
    mean_intensity: float
    median_intensity: float
    std_intensity: float
    # null when the background mask is empty (every pixel in the dilated
    # signal union) or when the band mask is empty.
    median_background: Optional[float] = None
    mean_background: Optional[float] = None
    signal_minus_background: Optional[float] = None


class MTChannelSummary(BaseModel):
    """Whole-video, whole-image total for one channel.

    Sum / mean over EVERY pixel of the channel across ALL frames of the video —
    independent of the microtubules. A global "how bright is this channel over
    the whole recording" measure, distinct from the per-MT band sums.
    """
    model_config = ConfigDict(extra="forbid")

    channel: str
    total_intensity: float
    mean_intensity: float
    pixel_count: int
    frames: int


class MTMetricsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: List[MTMetricsRow]
    # Per-channel whole-image totals over the whole video (one per requested
    # channel). Empty only when no channels were requested.
    channel_summaries: List[MTChannelSummary]
    frames_processed: int
    frame_height: int
    frame_width: int


# ----------------------------------------------------------------------------
#  Helpers
# ----------------------------------------------------------------------------


def _polyline_length(points: np.ndarray) -> float:
    """Sum of consecutive Euclidean distances. Returns 0 for <2 points."""
    if points.shape[0] < 2:
        return 0.0
    diffs = np.diff(points, axis=0)
    return float(np.sqrt((diffs ** 2).sum(axis=1)).sum())


def _rasterize_band(
    points: np.ndarray, h: int, w: int, thickness: int
) -> np.ndarray:
    """Rasterize a polyline as a thickness-wide 0/1 mask.

    cv2.polylines with `LINE_8` strokes whole pixels (no antialiasing),
    so the resulting mask is binary and the pixel_count is exactly the
    band area at the requested thickness. Rounded line caps + joins
    follow OpenCV's default, which matches what ImageJ's "fill stroke"
    produces for a width-N polyline.
    """
    import cv2  # local import to keep module load cheap for tests
    mask = np.zeros((h, w), dtype=np.uint8)
    if points.shape[0] < 2:
        return mask
    # cv2 wants (N, 1, 2) int32. (x, y) order matches what the editor
    # serialises; cv2 also uses (x, y) for polyline points so no swap
    # is needed.
    pts_int = np.rint(points).astype(np.int32).reshape(-1, 1, 2)
    cv2.polylines(
        mask, [pts_int],
        isClosed=False,
        color=1,
        thickness=int(thickness),
        lineType=8,  # cv2.LINE_8 numeric constant; avoids attr lookup on cold cv2 import
    )
    return mask


def _dilate(mask: np.ndarray, radius: int) -> np.ndarray:
    """Dilate a binary mask by a disc of given radius (in pixels)."""
    if radius <= 0:
        return mask
    import cv2
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE,
        (radius * 2 + 1, radius * 2 + 1),
    )
    return cv2.dilate(mask, kernel)


def _normalize_axes_nd2(arr: np.ndarray, axes: str) -> np.ndarray:
    """Permute / expand an ND2 array to canonical (T, C, Y, X)."""
    if "Z" in axes and arr.ndim >= 3:
        z_idx = axes.index("Z")
        arr = arr.max(axis=z_idx)
        axes = axes.replace("Z", "")

    if axes == "TCYX" and arr.ndim == 4:
        return arr
    if axes == "CYX" and arr.ndim == 3:
        return arr[None, ...]
    if axes == "TYX" and arr.ndim == 3:
        return arr[:, None, :, :]
    if axes == "YX" and arr.ndim == 2:
        return arr[None, None, :, :]
    # A position (P) / series (S) loop axis means a multi-position file.
    # Uploads split these into per-position single-position TIFF originals
    # (see videoUploadService), so a multi-position file should never reach
    # here. Reject clearly rather than letting the transpose below fail with
    # a raw ValueError if one ever does.
    for loop_axis in ("P", "S"):
        if loop_axis in axes and arr.shape[axes.index(loop_axis)] > 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Multi-position ND2 ('{loop_axis}' axis) is not a single "
                    f"video; metrics read per-position originals, not the "
                    f"source file. axes='{axes}' shape={arr.shape}"
                ),
            )
    # Try a generic transpose for any other order that contains TCYX.
    target = "TCYX"
    if all(ax in axes for ax in target):
        perm = [axes.index(ax) for ax in target]
        return np.transpose(arr, perm)
    raise HTTPException(
        status_code=500,
        detail=f"Unsupported ND2 axes='{axes}' shape={arr.shape}",
    )


def _normalize_axes_tiff(arr: np.ndarray, axes: str) -> np.ndarray:
    """Permute / expand a tifffile array to canonical (T, C, Y, X).

    Mirrors the logic in extract_tiff_stack.py so the channel index
    we read here is the SAME index used at extraction time.
    """
    axes = axes.upper()
    if "Z" in axes and arr.ndim >= 3:
        z_idx = axes.index("Z")
        arr = arr.max(axis=z_idx)
        axes = axes.replace("Z", "")

    if axes == "TCYX" and arr.ndim == 4:
        return arr
    if axes == "CYXT" and arr.ndim == 4:
        return arr.transpose(3, 0, 1, 2)
    if axes == "TYX" and arr.ndim == 3:
        return arr[:, None, :, :]
    # Single timepoint, multiple channels. A T=1 TCYX TIFF round-trips with
    # the singleton T squeezed to CYX (e.g. per-position originals split from
    # a snapshot multipoint ND2). This MUST be matched before the
    # "leading axis is time" heuristic below, which would otherwise read the
    # C channels as T timepoints.
    if axes == "CYX" and arr.ndim == 3:
        return arr[None, :, :, :]
    if axes == "YX" and arr.ndim == 2:
        return arr[None, None, :, :]
    if arr.ndim == 3 and arr.shape[0] > 1 and arr.shape[-1] not in (3, 4):
        # Heuristic: leading axis is time, single channel (matches the
        # fallback in extract_tiff_stack.py).
        return arr[:, None, :, :]
    if arr.ndim == 2:
        return arr[None, None, :, :]
    raise HTTPException(
        status_code=500,
        detail=f"Unsupported TIFF axes='{axes}' shape={arr.shape}",
    )


def _load_volume(path: Path, file_kind: str) -> np.ndarray:
    """Load the file and return (T, C, Y, X) numpy array."""
    if file_kind == "nd2":
        try:
            import nd2
        except ImportError as exc:
            raise HTTPException(
                status_code=500,
                detail="nd2 library not installed in ML service",
            ) from exc
        with nd2.ND2File(str(path)) as f:
            axes = "".join(f.sizes.keys())
            arr = f.asarray()
        return _normalize_axes_nd2(arr, axes)

    if file_kind == "tiff":
        try:
            import tifffile
        except ImportError as exc:
            raise HTTPException(
                status_code=500,
                detail="tifffile library not installed in ML service",
            ) from exc
        with tifffile.TiffFile(str(path)) as tf:
            arr = tf.asarray()
            axes = tf.series[0].axes if tf.series else ""
        return _normalize_axes_tiff(arr, axes)

    raise HTTPException(
        status_code=400,
        detail=f"Unsupported file_kind: {file_kind}",
    )


def _shift_frame(arr: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """Integer translation with a zero-filled border (lossless — no interp).

    Mirrors ``channel_registration.shift_frame`` in the backend extractor so a
    sampled channel lands in the exact same registered space as the stored
    frames. ``dy > 0`` moves content down, ``dx > 0`` right — the same shift the
    extractor applied when it wrote the registered PNGs.
    """
    if dy == 0 and dx == 0:
        return arr
    out = np.zeros_like(arr)
    h, w = arr.shape[:2]
    src_y0, src_y1 = max(0, -dy), h - max(0, dy)
    dst_y0, dst_y1 = max(0, dy), h - max(0, -dy)
    src_x0, src_x1 = max(0, -dx), w - max(0, dx)
    dst_x0, dst_x1 = max(0, dx), w - max(0, -dx)
    if src_y1 > src_y0 and src_x1 > src_x0:
        out[dst_y0:dst_y1, dst_x0:dst_x1] = arr[src_y0:src_y1, src_x0:src_x1]
    return out


# ----------------------------------------------------------------------------
#  Endpoint
# ----------------------------------------------------------------------------


@router.post("/mt-metrics", response_model=MTMetricsResponse)
async def mt_metrics(req: MTMetricsRequest) -> MTMetricsResponse:
    """Compute per-MT-per-channel intensity metrics for one video.

    Algorithm per frame:
      1. Rasterise each polyline into a thickness-wide binary mask.
      2. Union all band masks; dilate the union by
         ``thickness * margin_multiplier`` for the background exclusion.
      3. background_mask = NOT dilated_union.
      4. For each requested channel:
           - median_background / mean_background = median resp. mean of
             pixels under background_mask.
           - For each polyline: pixel_count / sum / mean / median / std
             under that polyline's band; emit one row.
    """
    if len(req.channel_indices) != len(req.channel_names):
        raise HTTPException(
            status_code=400,
            detail="channel_indices and channel_names length mismatch",
        )

    path = Path(req.original_path)
    _assert_safe_path(path, "original_path")
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Original file not found: {req.original_path}",
        )

    volume = _load_volume(path, req.file_kind)
    T, C, H, W = volume.shape
    logger.info(
        "mt-metrics: %s loaded T=%d C=%d H=%d W=%d "
        "(thickness=%d, margin=%.2f, frames=%d, channels=%d)",
        path.name, T, C, H, W,
        req.thickness_px, req.margin_multiplier,
        len(req.frames), len(req.channel_indices),
    )

    for ci in req.channel_indices:
        if ci < 0 or ci >= C:
            raise HTTPException(
                status_code=400,
                detail=f"channel_index {ci} out of bounds [0, {C - 1}]",
            )

    # Whole-image per-channel totals over the whole video: sum of EVERY pixel of
    # the channel across ALL frames (not just the MT bands). Uses the RAW file
    # (no registration offset) — this is a global channel measure and the
    # zero-filled borders of a shifted channel would understate its true total.
    channel_summaries: List[MTChannelSummary] = []
    for ci_idx, ci in enumerate(req.channel_indices):
        chan = volume[:, ci].astype(np.float64)
        pix = int(chan.size)
        total = float(chan.sum())
        channel_summaries.append(MTChannelSummary(
            channel=req.channel_names[ci_idx],
            total_intensity=total,
            mean_intensity=(total / pix) if pix else 0.0,
            pixel_count=pix,
            frames=int(T),
        ))

    margin_radius = int(round(req.thickness_px * req.margin_multiplier))
    rows: List[MTMetricsRow] = []

    for fr in req.frames:
        t = fr.frame_index
        if t < 0 or t >= T:
            logger.warning(
                "mt-metrics: frame_index %d out of bounds (T=%d); skipping",
                t, T,
            )
            continue
        if not fr.polylines:
            continue

        # 1. Per-polyline thickness masks (kept in a list so the index
        # aligns with `fr.polylines` for the per-channel loop below).
        band_masks: List[np.ndarray] = []
        polyline_lengths: List[float] = []
        for pl in fr.polylines:
            pts = np.asarray(pl.points, dtype=np.float32)
            if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2:
                band_masks.append(np.zeros((H, W), dtype=np.uint8))
                polyline_lengths.append(0.0)
                continue
            band_masks.append(_rasterize_band(pts, H, W, req.thickness_px))
            polyline_lengths.append(_polyline_length(pts))

        # 2 + 3. Background mask = NOT (dilated union of bands).
        signal_union = np.zeros((H, W), dtype=np.uint8)
        for m in band_masks:
            signal_union |= m
        signal_dilated = _dilate(signal_union, margin_radius)
        background_mask = signal_dilated == 0

        # 4. Per-channel computations.
        # Per-frame registration offsets (channel-registration at upload), one
        # [dy, dx] per C-axis channel index. None when the upload wasn't
        # registered — then channels are sampled from the raw file unchanged.
        frame_offsets = (req.channel_offsets or {}).get(str(t))
        for ci_idx, ci in enumerate(req.channel_indices):
            channel_name = req.channel_names[ci_idx]
            raw = volume[t, ci]
            # Shift the raw channel into the registered (channel-0) space the
            # polylines live in, so intensity is sampled where the microtubule
            # actually is in this channel. Channel 0 / no-offset is a no-op.
            if frame_offsets is not None and ci < len(frame_offsets):
                off_dy, off_dx = frame_offsets[ci]
                if off_dy or off_dx:
                    raw = _shift_frame(raw, int(off_dy), int(off_dx))
            # Cast to float64 once per channel so all reductions are in
            # consistent precision without upcasting every pixel slice.
            frame_arr = raw.astype(np.float64)

            bg_pixels = frame_arr[background_mask]
            has_bg = bg_pixels.size > 0
            median_bg = float(np.median(bg_pixels)) if has_bg else None
            mean_bg = float(bg_pixels.mean()) if has_bg else None

            for pl_idx, pl in enumerate(fr.polylines):
                band = band_masks[pl_idx]
                pixels = frame_arr[band > 0]
                pixel_count = int(pixels.size)
                if pixel_count == 0:
                    sum_v = mean_v = median_v = std_v = 0.0
                    signal_minus_bg: Optional[float] = None
                else:
                    sum_v = float(pixels.sum())
                    mean_v = float(pixels.mean())
                    median_v = float(np.median(pixels))
                    std_v = float(pixels.std())
                    signal_minus_bg = (
                        (mean_v - median_bg)
                        if median_bg is not None
                        else None
                    )

                rows.append(MTMetricsRow(
                    frame_index=t,
                    image_id=pl.image_id,
                    instance_id=pl.instance_id,
                    track_id=pl.track_id,
                    channel=channel_name,
                    length_px=polyline_lengths[pl_idx],
                    area_px=pixel_count,
                    pixel_count=pixel_count,
                    sum_intensity=sum_v,
                    mean_intensity=mean_v,
                    median_intensity=median_v,
                    std_intensity=std_v,
                    median_background=median_bg,
                    mean_background=mean_bg,
                    signal_minus_background=signal_minus_bg,
                ))

    logger.info(
        "mt-metrics: produced %d rows from %d frames",
        len(rows), len(req.frames),
    )
    return MTMetricsResponse(
        rows=rows,
        channel_summaries=channel_summaries,
        frames_processed=len(req.frames),
        frame_height=int(H),
        frame_width=int(W),
    )
