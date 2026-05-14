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
- pixel_count, sum/mean/std of pixel intensities inside the band
- median_background (median of pixels OUTSIDE all bands dilated by
  ``thickness * margin_multiplier``, per channel)
- signal_minus_background = mean_intensity - median_background

Unit conversion (px -> um) is intentionally done on the Node side so
the user-supplied ``pixelToMicrometerScale`` from the export modal
stays the single source of truth.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)
router = APIRouter()


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
    std_intensity: float
    # null when the background mask is empty (every pixel in the dilated
    # signal union) or when the band mask is empty.
    median_background: Optional[float] = None
    signal_minus_background: Optional[float] = None


class MTMetricsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: List[MTMetricsRow]
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
           - median_background = median of pixels under background_mask.
           - For each polyline: pixel_count / sum / mean / std under
             that polyline's band; emit one row.
    """
    if len(req.channel_indices) != len(req.channel_names):
        raise HTTPException(
            status_code=400,
            detail="channel_indices and channel_names length mismatch",
        )

    path = Path(req.original_path)
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
        for ci_idx, ci in enumerate(req.channel_indices):
            channel_name = req.channel_names[ci_idx]
            # Cast to float64 once per channel so all reductions are in
            # consistent precision without upcasting every pixel slice.
            frame_arr = volume[t, ci].astype(np.float64)

            bg_pixels = frame_arr[background_mask]
            median_bg = (
                float(np.median(bg_pixels))
                if bg_pixels.size > 0
                else None
            )

            for pl_idx, pl in enumerate(fr.polylines):
                band = band_masks[pl_idx]
                pixels = frame_arr[band > 0]
                pixel_count = int(pixels.size)
                if pixel_count == 0:
                    sum_v = mean_v = std_v = 0.0
                    signal_minus_bg: Optional[float] = None
                else:
                    sum_v = float(pixels.sum())
                    mean_v = float(pixels.mean())
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
                    std_intensity=std_v,
                    median_background=median_bg,
                    signal_minus_background=signal_minus_bg,
                ))

    logger.info(
        "mt-metrics: produced %d rows from %d frames",
        len(rows), len(req.frames),
    )
    return MTMetricsResponse(
        rows=rows,
        frames_processed=len(req.frames),
        frame_height=int(H),
        frame_width=int(W),
    )
