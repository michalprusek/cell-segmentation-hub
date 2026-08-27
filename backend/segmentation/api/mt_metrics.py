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
import re
import sys
from pathlib import Path
from typing import Dict, List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

# The shared band/background measurement, imported off the models DIRECTORY
# rather than as ``models.mt_measure``. Going through the package would execute
# ``models/__init__``, which pulls in mamba_ssm and Triton and therefore needs a
# live CUDA driver — measuring pixels needs neither, and the import would make
# this module's tests silently skip on any box without a GPU. It is also the
# exact spelling the essays batch uses (``_mt_package.ensure_on_path()`` puts the
# same directory on its path), so both callers name the one file the same way.
# Appended, not prepended: that directory also holds hrnet.py, unet.py, sperm.py
# and friends, and putting it ahead of site-packages would let any of those
# generic names shadow a real dependency for the whole process. Nothing in the
# ML service imports them top-level today, and appending keeps it that way.
_MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
if str(_MODELS_DIR) not in sys.path:
    sys.path.append(str(_MODELS_DIR))
import mt_measure  # noqa: E402  (needs the path set above)

from ._log_safe import scrub  # noqa: E402

logger = logging.getLogger(__name__)
router = APIRouter()

# Storage root that the ML container may access. Matches the volume mount in
# docker-compose (./backend/uploads → /app/uploads) and the UPLOAD_DIR env
# that the backend service sets. Paths supplied by callers must resolve to a
# descendant of this directory.
_UPLOAD_ROOT = Path(os.getenv("UPLOAD_DIR", "/app/uploads")).resolve()


def _safe_path(p: Path, label: str) -> Path:
    """Return *p* resolved, or raise HTTPException(400) if it leaves _UPLOAD_ROOT.

    The RESOLVED path is what comes back and what callers must open. The
    previous form checked one path and returned nothing, so every caller went
    on to use the unresolved argument -- which is a different path whenever a
    symlink on the way is swapped between the check and the open, and which
    leaves no trace at the call site that a check happened at all.
    """
    try:
        resolved = p.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid path for {label}")
    if not str(resolved).startswith(str(_UPLOAD_ROOT) + os.sep) and resolved != _UPLOAD_ROOT:
        raise HTTPException(
            status_code=400,
            detail=f"Path for {label} is outside the allowed storage root",
        )
    return resolved


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
    # PNG-backed channels ADDED after upload ("Add channel"). Their pixels live
    # only in the per-frame PNGs (``<dir of original_path>/frames/<TTTT>/<name>.png``),
    # not in the original volume, so they are sampled from those PNGs by name.
    # A frame whose PNG is absent is skipped (an added channel may cover only
    # some frames). No channel_offsets apply — the PNGs are already stored in the
    # registered/aligned space.
    png_channels: List[str] = Field(default_factory=list)


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
    # Per-MT LOCAL background: median/mean of the pixels in THIS microtubule's
    # own vicinity ring (out to thickness*margin_multiplier around its band,
    # excluding every MT's signal band). null when that ring is empty or the
    # band mask is empty.
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


# The band geometry and the ImageJ statistics are NOT defined here. They live in
# models/mt_measure.py, which the Automated Essays batch imports through the same
# shared-package mechanism it uses for the v7 model, so the export and the batch
# can no longer answer "how bright is this filament" differently. These aliases
# keep the endpoint's own vocabulary (and its tests) while making the delegation
# explicit: rebinding one of them here would NOT change the essays batch, which
# is exactly the drift this arrangement exists to prevent.
# Re-exported deliberately: `test_mt_metrics_band.py` reaches for these by name
# to assert the endpoint's helpers ARE the shared objects, so an `__all__` entry
# states "unused here, used by the contract test" instead of leaving a reader to
# infer it from an unused-global warning.
__all__ = [
    "_polyline_length",
    "_imagej_median",
    "_fill_convex_polygon",
    "_rasterize_band",
    "_dilate",
    "_vicinity_mask",
]

_polyline_length = mt_measure.polyline_length
_imagej_median = mt_measure.imagej_median
_fill_convex_polygon = mt_measure.fill_convex_polygon
_rasterize_band = mt_measure.rasterize_band
_dilate = mt_measure.dilate
_vicinity_mask = mt_measure.vicinity_mask


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


_CHANNEL_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _load_png_frame(
    frames_dir: Path, t: int, name: str, height: int, width: int
) -> Optional[np.ndarray]:
    """Load a PNG-backed channel's raster for frame ``t`` as a 2-D float64
    array, or None when the PNG is absent (partial coverage — an added channel
    may cover only some frames) or its shape doesn't match (height, width).

    ``name`` is validated against the channel-name whitelist and the resolved
    path is asserted to stay under the storage root before any read.
    """
    if not _CHANNEL_NAME_RE.match(name):
        raise HTTPException(
            status_code=400, detail=f"Invalid png channel name: {name}"
        )
    p = _safe_path(frames_dir / f"{t:04d}" / f"{name}.png", "png channel frame")
    if not p.exists():
        return None
    from PIL import Image

    arr = np.asarray(Image.open(p))
    if arr.ndim == 3:
        arr = arr.mean(axis=2)
    if arr.shape != (height, width):
        logger.warning(
            "mt-metrics: png channel %s frame %d shape %s != (%d, %d); skipping",
            scrub(name), t, arr.shape, height, width,
        )
        return None
    return arr.astype(np.float64)


def _emit_channel_rows(
    frame_arr: np.ndarray,
    band_masks: List[np.ndarray],
    polyline_lengths: List[float],
    vicinity_masks: List[np.ndarray],
    fr: "MTFrameInput",
    channel_name: str,
    rows: List["MTMetricsRow"],
) -> None:
    """Append one row per polyline for ``channel_name`` on frame ``fr``.

    Shared by the volume-backed and PNG-backed channel paths so both compute
    background + per-band statistics identically. ``frame_arr`` is the channel's
    raster already cast to float64 and (for volume channels) shifted into the
    registered space. Each microtubule's background is sampled from its OWN
    local vicinity ring (``vicinity_masks[pl_idx]``), not a frame-global region.
    """
    for pl_idx, pl in enumerate(fr.polylines):
        sig = mt_measure.region_stats(frame_arr, band_masks[pl_idx])
        # Per-MT LOCAL background: pixels in this microtubule's vicinity ring.
        # ImageJ measures the exported ``_bg`` composite ROI as an area, so its
        # median follows the same histogram tie-rule as the signal.
        bg = mt_measure.region_stats(frame_arr, vicinity_masks[pl_idx])

        # An empty ring is reported as *absent*, not as zero: a zero background
        # would silently inflate signal_minus_background by the full signal.
        median_bg = bg.median if bg.n else None
        mean_bg = bg.mean if bg.n else None
        signal_minus_bg: Optional[float] = (
            (sig.mean - median_bg)
            if (sig.n and median_bg is not None) else None
        )

        rows.append(MTMetricsRow(
            frame_index=fr.frame_index,
            image_id=pl.image_id,
            instance_id=pl.instance_id,
            track_id=pl.track_id,
            channel=channel_name,
            length_px=polyline_lengths[pl_idx],
            area_px=sig.n,
            pixel_count=sig.n,
            sum_intensity=sig.sum,
            mean_intensity=sig.mean,
            median_intensity=sig.median,
            std_intensity=sig.std,
            median_background=median_bg,
            mean_background=mean_bg,
            signal_minus_background=signal_minus_bg,
        ))


# ----------------------------------------------------------------------------
#  Endpoint
# ----------------------------------------------------------------------------


@router.post("/mt-metrics", response_model=MTMetricsResponse)
async def mt_metrics(req: MTMetricsRequest) -> MTMetricsResponse:
    """Compute per-MT-per-channel intensity metrics for one video.

    Algorithm per frame:
      1. Rasterise each polyline into a thickness-wide binary mask.
      2. Union all band masks (the "signal" all MTs occupy).
      3. Per MT: vicinity = dilate(its band, thickness*margin_multiplier) minus
         the signal union — a local ring hugging that MT, excluding every MT's
         band.
      4. For each requested channel, for each polyline:
           - median/mean_background = median resp. mean of the pixels in THAT
             microtubule's own vicinity ring (local, not frame-global).
           - pixel_count / sum / mean / median / std under its band.
           - emit one row.
    """
    if len(req.channel_indices) != len(req.channel_names):
        raise HTTPException(
            status_code=400,
            detail="channel_indices and channel_names length mismatch",
        )

    path = _safe_path(Path(req.original_path), "original_path")
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
        scrub(path.name), T, C, H, W,
        req.thickness_px, req.margin_multiplier,
        len(req.frames), len(req.channel_indices),
    )

    for ci in req.channel_indices:
        if ci < 0 or ci >= C:
            raise HTTPException(
                status_code=400,
                detail=f"channel_index {ci} out of bounds [0, {C - 1}]",
            )

    # PNG-backed (added) channels live next to the original as per-frame PNGs.
    frames_dir = path.parent / "frames"

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
    # Whole-image totals for PNG-backed (added) channels: stream over every
    # frame that actually has a PNG (partial coverage → fewer frames). One PIL
    # open per covered frame keeps memory bounded (no full-video buffer).
    for name in req.png_channels:
        total = 0.0
        pix = 0
        frames_present = 0
        for t in range(T):
            arr = _load_png_frame(frames_dir, t, name, H, W)
            if arr is None:
                continue
            total += float(arr.sum())
            pix += int(arr.size)
            frames_present += 1
        channel_summaries.append(MTChannelSummary(
            channel=name,
            total_intensity=total,
            mean_intensity=(total / pix) if pix else 0.0,
            pixel_count=pix,
            frames=frames_present,
        ))

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

        # 1 + 2 + 3. Per-polyline thickness masks, and each microtubule's LOCAL
        # background ring: within `thickness * margin` of ITS OWN band, minus the
        # union of every MT's band — so a neighbouring microtubule never counts
        # as background. Built once per frame (geometry is channel-independent)
        # and reused across channels. Shared with the Automated Essays batch, so
        # both measure the same pixels.
        geom = mt_measure.frame_geometry(
            [np.asarray(pl.points, dtype=np.float32) for pl in fr.polylines],
            H, W, req.thickness_px, req.margin_multiplier,
        )
        band_masks = geom.bands
        polyline_lengths = geom.lengths
        vicinity_masks = geom.vicinities

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
            _emit_channel_rows(
                frame_arr, band_masks, polyline_lengths,
                vicinity_masks, fr, channel_name, rows,
            )

        # PNG-backed (added) channels: sampled from the per-frame PNG, already
        # in the stored/aligned space, so no registration offset is applied. A
        # frame whose PNG is absent (partial coverage) yields no rows.
        for name in req.png_channels:
            frame_arr = _load_png_frame(frames_dir, t, name, H, W)
            if frame_arr is None:
                continue
            _emit_channel_rows(
                frame_arr, band_masks, polyline_lengths,
                vicinity_masks, fr, name, rows,
            )

    # Count rows whose per-MT vicinity ring came out empty (background nulled).
    # With the local ring this is more common than the old frame-global mask
    # (an MT hugged by neighbours or clipped at the frame edge can have no
    # ring), so surface it — otherwise scattered blank background cells look
    # like a bug rather than "no local background available".
    null_bg = sum(1 for r in rows if r.median_background is None)
    logger.info(
        "mt-metrics: produced %d rows from %d frames (%d with empty local "
        "background ring → null background)",
        len(rows), len(req.frames), null_bg,
    )
    return MTMetricsResponse(
        rows=rows,
        channel_summaries=channel_summaries,
        frames_processed=len(req.frames),
        frame_height=int(H),
        frame_width=int(W),
    )


# ----------------------------------------------------------------------------
#  Background-ROI endpoint (ImageJ composite ROIs for the MT export)
# ----------------------------------------------------------------------------
#
# The ImageJ RoiSet export draws each microtubule's per-MT LOCAL background as a
# ROI so a biologist can re-measure exactly what the ``median/mean_background``
# columns were computed from. That region is the vicinity ring
# ``dilate(band, thickness*margin) & ~signal_union`` — a band with EVERY
# microtubule (its own core + any neighbour crossing the ring) cut out. A plain
# stroke-width polyline cannot express those holes, so it is exported as an
# ImageJ COMPOSITE (ShapeRoi): the outer contour plus a hole contour per cut-out,
# rendered with the even-odd fill rule. The mask is the SAME ``_vicinity_mask``
# the metrics endpoint samples, so the ROI and the numbers can never diverge.


class MTBgPolylineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instance_id: str
    points: List[List[float]]
    # ImageJ ROI name (e.g. ``mt_3_bg``) baked into the composite bytes.
    roi_name: str
    # ARGB stroke colour (opaque alpha in the high byte) matching the sibling MT
    # ROI's per-track colour. None leaves ImageJ's default.
    stroke_color: Optional[int] = None
    # 1-based stack slice this ROI sits on (the video frame).
    position: Optional[int] = None


class MTBgFrameInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame_index: int
    polylines: List[MTBgPolylineInput]


class MTBackgroundRoisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frames: List[MTBgFrameInput]
    thickness_px: int = Field(5, ge=1, le=100)
    margin_multiplier: float = Field(2.0, ge=0.0, le=10.0)
    # Real frame dimensions so the ring clips at the true image border exactly as
    # the metrics endpoint does. When omitted, a canvas bounding all polylines
    # (padded by the margin) is used — identical except for MTs touching a border.
    frame_height: Optional[int] = None
    frame_width: Optional[int] = None


class MTBackgroundRoi(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instance_id: str
    # Base64 of the ImageJ ``.roi`` composite bytes.
    roi_b64: str


class MTBackgroundRoisFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame_index: int
    rois: List[MTBackgroundRoi]


class MTBackgroundRoisResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frames: List[MTBackgroundRoisFrame]


def _vicinity_composite_roi_bytes(
    vicinity: np.ndarray,
    name: str,
    stroke_color: Optional[int],
    position: Optional[int],
) -> Optional[bytes]:
    """Encode a boolean vicinity mask as ImageJ COMPOSITE ``.roi`` bytes.

    The composite must rasterise IN IMAGEJ back to the exact ``vicinity`` mask so
    that measuring the exported ``_bg`` ROI reproduces the ``mean/median_background``
    columns. That requires tracing the mask boundary along pixel EDGES, not pixel
    centres: ``cv2.findContours`` puts vertices at integer pixel indices (centres),
    and ImageJ fills a pixel only when its centre is inside the polygon, so a
    centre-traced outline drops the whole outer boundary ring (~½ px shrink, biasing
    the mean by a few % because those lost pixels hug the bright microtubule).

    Instead we trace the ``0.5`` iso-contour (``skimage.measure.find_contours``),
    whose vertices sit on pixel edges, and shift ``skimage``'s centre-indexed
    coordinates into ImageJ's corner-indexed space with ``+0.5``. Outer and hole
    contours all become one geometric path (MOVETO/LINETO/CLOSE per contour) and
    ImageJ's even-odd fill turns the holes into cut-outs — reproducing the mask
    exactly (verified round-trip: area/mean/median identical to the vicinity metric
    on real frames). Collinear vertices are dropped so the path stays compact.
    Returns None for an empty mask (no ring — the metrics side reports null
    background for the same case).
    """
    import struct
    import roifile
    from skimage import measure

    mask = np.ascontiguousarray(vicinity.astype(np.uint8))
    if mask.sum() == 0:
        return None
    # Pad by 1 so a ring touching the frame border still traces a closed contour;
    # the pad is removed again by the -1 below.
    contours = measure.find_contours(np.pad(mask, 1).astype(np.float64), 0.5)

    path: List[float] = []
    for c in contours:
        # c is (row, col) on the padded grid. Unpad (-1) and shift +0.5 so the
        # edge crossings land on ImageJ pixel corners: (x, y) = (col-0.5, row-0.5).
        pts = np.column_stack((c[:, 1] - 0.5, c[:, 0] - 0.5))
        if len(pts) > 1 and np.allclose(pts[0], pts[-1]):
            pts = pts[:-1]  # find_contours repeats the first point to close
        if len(pts) < 3:
            continue
        # Keep only direction-change vertices (drop collinear runs) around the loop.
        prev = np.roll(pts, 1, axis=0)
        nxt = np.roll(pts, -1, axis=0)
        cross = ((pts[:, 0] - prev[:, 0]) * (nxt[:, 1] - prev[:, 1])
                 - (pts[:, 1] - prev[:, 1]) * (nxt[:, 0] - prev[:, 0]))
        pts = pts[np.abs(cross) > 1e-9]
        if len(pts) < 3:
            continue
        path.extend((0.0, float(pts[0, 0]), float(pts[0, 1])))  # MOVETO
        for q in pts[1:]:
            path.extend((1.0, float(q[0]), float(q[1])))  # LINETO
        path.append(4.0)  # CLOSE
    if not path:
        return None
    multi = np.asarray(path, dtype=np.float32)

    ys, xs = np.nonzero(mask)
    roi = roifile.ImagejRoi(
        roitype=roifile.ROI_TYPE.RECT,
        name=name,
        left=int(xs.min()),
        top=int(ys.min()),
        right=int(xs.max()) + 1,
        bottom=int(ys.max()) + 1,
        n_coordinates=0,
        shape_roi_size=int(multi.size),
        multi_coordinates=multi,
    )
    if stroke_color is not None:
        # ImageJ .roi is big-endian ARGB.
        roi.stroke_color = struct.pack(">I", int(stroke_color) & 0xFFFFFFFF)
    if position is not None and position > 0:
        roi.position = int(position)
    return roi.tobytes()


@router.post("/mt-background-rois", response_model=MTBackgroundRoisResponse)
async def mt_background_rois(
    req: MTBackgroundRoisRequest,
) -> MTBackgroundRoisResponse:
    """Per-MT background composite ROIs for the ImageJ export.

    Mirrors the metrics endpoint's geometry step (exact-thickness bands →
    signal union → per-MT vicinity ring) and encodes each ring as an ImageJ
    COMPOSITE ROI. Geometry-only (no raster read), so it is cheap.
    """
    import base64

    margin_radius = int(round(req.thickness_px * req.margin_multiplier))
    out_frames: List[MTBackgroundRoisFrame] = []

    for fr in req.frames:
        valid_pts = [
            np.asarray(pl.points, dtype=np.float32)
            for pl in fr.polylines
            if len(pl.points) >= 2
        ]
        if not valid_pts:
            out_frames.append(
                MTBackgroundRoisFrame(frame_index=fr.frame_index, rois=[])
            )
            continue

        if req.frame_height and req.frame_width:
            h, w = int(req.frame_height), int(req.frame_width)
        else:
            stacked = np.concatenate(valid_pts, axis=0)
            pad = margin_radius + req.thickness_px + 4
            w = int(np.ceil(stacked[:, 0].max())) + pad
            h = int(np.ceil(stacked[:, 1].max())) + pad

        # The SAME geometry call the metrics endpoint makes, so the exported ROI
        # can never enclose a different region than the numbers were taken from.
        geom = mt_measure.frame_geometry(
            [np.asarray(pl.points, dtype=np.float32) for pl in fr.polylines],
            h, w, req.thickness_px, req.margin_multiplier,
        )

        rois: List[MTBackgroundRoi] = []
        for i, pl in enumerate(fr.polylines):
            vicinity = geom.vicinities[i]
            roi_bytes = _vicinity_composite_roi_bytes(
                vicinity, pl.roi_name, pl.stroke_color, pl.position
            )
            if roi_bytes is not None:
                rois.append(
                    MTBackgroundRoi(
                        instance_id=pl.instance_id,
                        roi_b64=base64.b64encode(roi_bytes).decode("ascii"),
                    )
                )
        out_frames.append(
            MTBackgroundRoisFrame(frame_index=fr.frame_index, rois=rois)
        )

    logger.info(
        "mt-background-rois: %d frames, %d composite ROIs",
        len(out_frames),
        sum(len(f.rois) for f in out_frames),
    )
    return MTBackgroundRoisResponse(frames=out_frames)
