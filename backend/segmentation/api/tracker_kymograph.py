"""Cross-frame microtubule tracking + kymograph rendering endpoints.

Both are pure NumPy / SciPy postprocessing on artefacts already produced
during per-frame segmentation:

- ``/track`` takes the per-frame polylines + their L2-normalised
  embedding samples (32-d, sampled at centerline points) and runs
  Hungarian assignment between consecutive frames. Cost combines
  (1 - mean cosine similarity) with normalised spatial distance, so the
  matching is robust both to MTs drifting in space and to crossings
  where geometry alone is ambiguous.

- ``/kymograph`` samples raw image intensity along a polyline through
  every frame (using the tracked sibling polyline if available, the
  selected frame's geometry as a static fallback otherwise), resamples
  to a uniform width, and renders a viridis heatmap PNG plus the
  underlying CSV.
"""
from __future__ import annotations

import base64
import csv
import io
import logging
import os
import uuid
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from api.kymograph_velocity import (
    detect_blobs,
    edge_touch,
    flag_bright_outliers,
    net_velocity_threshold,
    render_overlay,
    track_intensity,
)

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
#  /track
# ----------------------------------------------------------------------------

class PolylineInput(BaseModel):
    """One polyline as fed to the tracker."""
    model_config = ConfigDict(extra="forbid")

    id: str
    # (M, 2) row, col centerline pixel coords. List-of-list is the
    # JSON-friendly form; numpy conversion happens server-side.
    points_rc: List[List[float]]
    # base64-encoded little-endian float16 byte string of (M, 32) embedding
    # samples. None when embedding wasn't persisted (older segmentations).
    embedding: Optional[str] = None


class FramePolylines(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame: int
    polylines: List[PolylineInput]


class TrackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frames: List[FramePolylines]
    # cost_threshold is in [0, 2]: cosine-distance term is in [0, 2]
    # (1 - cosine_similarity), spatial term is spatial_weight * normalized
    # distance in [0, spatial_weight]. The 0.5 default picks pairs whose
    # average cosine similarity is at least ~0.5 OR whose spatial drift
    # alone is small enough to dominate the cost.
    cost_threshold: float = Field(0.5, ge=0.0, le=2.0)
    # spatial_weight multiplies a normalized [0, 1] distance, so the
    # spatial contribution to cost lives in [0, spatial_weight]. 0.3 keeps
    # the embedding signal dominant while still penalising distant matches.
    spatial_weight: float = Field(0.3, ge=0.0, le=1.0)


class TrackResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    assignments: Dict[str, str]  # polylineId -> trackId
    track_count: int
    # Number of polylines whose embedding payload was corrupt (base64/shape
    # error).  Those polylines fell back to spatial-only matching.  A non-zero
    # value here means the Hungarian assignment may be less accurate than usual;
    # Node can surface this as a warning or log it for debugging.
    corrupt_count: int = 0
    # True when any embedding corruption was detected in this batch.
    degraded: bool = False


class EmbeddingDecodeError(ValueError):
    """Distinguishes a corrupt embedding payload from a legitimately
    absent one (b64 == None). Caller decides whether to log + neutral-
    cost or raise."""


def _decode_embedding(
    b64: str | None, n_points: int
) -> Optional[np.ndarray]:
    """Decode a base64 float16 (n_points × 32) embedding.

    Returns None ONLY when the embedding string itself is None/empty
    (older segmentations don't have one). Decode failures raise
    EmbeddingDecodeError — callers should treat that as data corruption
    and log it loudly rather than degrade silently to spatial-only
    matching.
    """
    if not b64:
        return None
    try:
        buf = base64.b64decode(b64)
        arr = np.frombuffer(buf, dtype=np.float16)
    except Exception as exc:
        raise EmbeddingDecodeError(f"base64/float16 decode failed: {exc}")
    if arr.size == 0 or arr.size % 32 != 0:
        raise EmbeddingDecodeError(
            f"embedding byte count {arr.size * 2} is not a multiple of 32 float16"
        )
    arr = arr.reshape(-1, 32)
    if arr.shape[0] > n_points:
        # Persisted too many rows — trim to centerline length so cosine
        # mean is computed against the relevant slice.
        return arr[:n_points]
    if arr.shape[0] < n_points:
        # Fewer embedding rows than centerline points: keep what we have
        # rather than guessing. Caller may log a soft warning.
        return arr
    return arr


def _safe_mean_embedding(p: PolylineInput) -> tuple[Optional[np.ndarray], bool]:
    """Decode embedding mean for one polyline; second element is True iff
    decoding raised EmbeddingDecodeError (i.e. corruption rather than
    legitimately-absent embedding). Caller aggregates the corruption
    count and logs once per frame pair."""
    try:
        emb = _decode_embedding(p.embedding, len(p.points_rc))
    except EmbeddingDecodeError as exc:
        logger.warning(f"polyline {p.id}: {exc}")
        return None, True
    if emb is None:
        return None, False
    return emb.mean(axis=0), False


def _build_cost_matrix(
    prev: List[PolylineInput],
    nxt: List[PolylineInput],
    img_diag: float,
    spatial_weight: float,
) -> tuple[np.ndarray, int]:
    """Cost = (1 - mean cosine sim of embeddings) + λ · normalised dist.

    Returns a ``(cost_matrix, corrupt_count)`` tuple so the caller can
    surface the number of corrupt embeddings in the API response without
    the endpoint having to re-decode embeddings independently.
    """
    prev_emb: List[Optional[np.ndarray]] = []
    prev_cent: List[np.ndarray] = []
    corrupt_count = 0
    for p in prev:
        emb, was_corrupt = _safe_mean_embedding(p)
        prev_emb.append(emb)
        if was_corrupt:
            corrupt_count += 1
        pts = np.asarray(p.points_rc, dtype=np.float32)
        prev_cent.append(pts.mean(axis=0) if pts.size else np.zeros(2))

    nxt_emb: List[Optional[np.ndarray]] = []
    nxt_cent: List[np.ndarray] = []
    for p in nxt:
        emb, was_corrupt = _safe_mean_embedding(p)
        nxt_emb.append(emb)
        if was_corrupt:
            corrupt_count += 1
        pts = np.asarray(p.points_rc, dtype=np.float32)
        nxt_cent.append(pts.mean(axis=0) if pts.size else np.zeros(2))

    if corrupt_count > 0:
        logger.error(
            f"Tracker: {corrupt_count}/{len(prev) + len(nxt)} embeddings "
            "were corrupt and fell back to spatial-only matching"
        )

    P, Q = len(prev), len(nxt)
    # First pass: compute cosine distance for every pair where BOTH
    # embeddings are present. Track which cells are "missing" so the
    # second pass can substitute a neutral cost from the same matrix.
    cost = np.full((P, Q), fill_value=np.nan, dtype=np.float32)
    spat_matrix = np.zeros((P, Q), dtype=np.float32)
    for i in range(P):
        for j in range(Q):
            spat_matrix[i, j] = float(
                np.linalg.norm(prev_cent[i] - nxt_cent[j])
            ) / max(img_diag, 1.0)
            if prev_emb[i] is None or nxt_emb[j] is None:
                continue
            a = prev_emb[i]
            b = nxt_emb[j]
            denom = float(np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9
            cost[i, j] = 1.0 - float(np.dot(a, b) / denom)

    # Round-2 review finding: previously cells without an embedding got
    # cosine=1.0, which combined with cost_threshold=0.5 effectively
    # **rejected** the polyline rather than degrading to spatial-only.
    # Substitute the MEDIAN of the valid cosine distances (or a sensible
    # constant if no valid pairs exist). The polyline still has to win
    # its row in the Hungarian assignment AND clear cost_threshold, so
    # this is a true "neutral" — neither rewarded nor punished.
    valid_mask = ~np.isnan(cost)
    if valid_mask.any():
        neutral_cosine = float(np.median(cost[valid_mask]))
    else:
        # Whole batch is missing embeddings (older segmentation runs
        # before the embedding-persistence change): fall back to a tight
        # spatial-only match. 0.3 ≈ typical inter-MT distance once
        # normalised; keeps the threshold useful.
        neutral_cosine = 0.3
    cost = np.where(valid_mask, cost, neutral_cosine)
    cost = cost + spatial_weight * spat_matrix
    return cost.astype(np.float32), corrupt_count


def _new_track_id() -> str:
    return f"track_{uuid.uuid4().hex[:10]}"


@router.post("/track", response_model=TrackResponse)
async def track(req: TrackRequest) -> TrackResponse:
    """Hungarian matching of microtubule polylines across consecutive frames."""
    from scipy.optimize import linear_sum_assignment

    if not req.frames:
        return TrackResponse(assignments={}, track_count=0)

    frames = sorted(req.frames, key=lambda f: f.frame)

    # Heuristic image diagonal — used for spatial-distance normalisation.
    all_points = []
    for f in frames:
        for p in f.polylines:
            for pt in p.points_rc:
                all_points.append(pt)
    if all_points:
        coords = np.asarray(all_points, dtype=np.float32)
        img_diag = float(np.linalg.norm(coords.max(axis=0) - coords.min(axis=0)))
    else:
        img_diag = 1.0

    assignments: Dict[str, str] = {}
    total_corrupt = 0

    # Seed: every polyline in the first frame gets a fresh trackId.
    for p in frames[0].polylines:
        assignments[p.id] = _new_track_id()

    for prev_f, next_f in zip(frames, frames[1:]):
        if not prev_f.polylines or not next_f.polylines:
            for p in next_f.polylines:
                assignments[p.id] = _new_track_id()
            continue
        cost, pair_corrupt = _build_cost_matrix(
            prev_f.polylines,
            next_f.polylines,
            img_diag,
            req.spatial_weight,
        )
        total_corrupt += pair_corrupt
        row_ind, col_ind = linear_sum_assignment(cost)
        matched = set()
        for r, c in zip(row_ind, col_ind):
            if cost[r, c] < req.cost_threshold:
                assignments[next_f.polylines[c].id] = assignments[
                    prev_f.polylines[r].id
                ]
                matched.add(c)
            # else fall through to fresh trackId below
        for c, p in enumerate(next_f.polylines):
            if c not in matched and p.id not in assignments:
                assignments[p.id] = _new_track_id()

    track_count = len(set(assignments.values()))
    logger.info(
        f"Tracker: {len(req.frames)} frames, "
        f"{sum(len(f.polylines) for f in frames)} polylines, "
        f"{track_count} tracks, {total_corrupt} corrupt embeddings"
    )
    return TrackResponse(
        assignments=assignments,
        track_count=track_count,
        corrupt_count=total_corrupt,
        degraded=total_corrupt > 0,
    )


# ----------------------------------------------------------------------------
#  /kymograph
# ----------------------------------------------------------------------------

class KymographFrameInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame: int
    # (M, 2) row, col centerline used to sample intensity in this frame.
    polyline_rc: List[List[float]]
    image_path: str  # absolute path the ML service can read


class KymographRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frames: List[KymographFrameInput]
    target_width: int = Field(200, ge=10, le=2000)
    tracked: bool = False
    # Hex `#RRGGBB`. When supplied, the kymograph is rendered as a linear
    # black-to-color gradient (intensity → that hue) so it matches the
    # channel tint the user chose in the editor's multi-channel overlay.
    # When None, falls back to viridis (legacy behaviour).
    channel_color: Optional[str] = Field(
        None,
        pattern=r"^#[0-9A-Fa-f]{6}$",
    )
    # When True, run blob-motion detection on the sampled intensity matrix and
    # return one KymographTrack per moving particle (velocities in px/frame —
    # the Node backend converts to um/s with the container's calibration).
    detect_velocity: bool = False
    # When True (with detect_velocity), also composite the detected tracks onto
    # the kymograph and return it as ``overlay_png_base64`` — used by the export
    # pipeline to ship "segmented kymograph" images without a browser.
    render_overlay: bool = False
    # Width (in kymograph position columns) of the signal band sampled around
    # each detected trajectory for the background-subtracted intensity metric.
    intensity_width: int = Field(3, ge=1, le=50)
    # Container calibration. When both are present the endpoint drops tracks
    # whose |net velocity| is below ``min_net_velocity_um_s`` (non-processive /
    # oscillatory blobs) BEFORE rendering the overlay, so overlay = tracks table =
    # exported velocity CSV (this response's csv_base64 is the intensity matrix).
    pixel_size_um: Optional[float] = Field(None, gt=0)
    frame_interval_ms: Optional[float] = Field(None, gt=0)
    min_net_velocity_um_s: float = Field(0.01, ge=0.0)


class KymographTrack(BaseModel):
    """One moving particle detected on the kymograph.

    Per-run detail is deliberately omitted: the run segmentation is internal to
    ``detect_blobs`` and surfaces only as the two processive totals below.
    """

    model_config = ConfigDict(extra="forbid")

    points: List[List[float]]  # [[frame, x_subpixel], ...], time-ordered
    net_pxframe: float
    snr: float
    # Aggregated over processive runs (pauses excluded): total time in directed
    # motion (frames) and total directed distance travelled (px). The Node
    # backend converts these to seconds / µm with the container calibration.
    total_run_time_frames: float = 0.0
    total_run_displacement_px: float = 0.0
    # Does the trajectory reach a kymograph end (motor continues onto MT outside
    # the imaged segment). Literal both documents and enforces the closed set.
    edge: Literal["left", "right", "both", "none"] = "none"
    # Background-subtracted intensity along the trajectory (raw pixel units).
    intensity_signal: Optional[float] = None
    intensity_background: Optional[float] = None
    intensity_minus_bg: Optional[float] = None
    # Intensity outlier: ``intensity_signal`` is abnormally high relative to the
    # other trajectories on this kymograph (median + k·MAD) — typically a
    # multi-motor aggregate rather than a single motor.
    bright: bool = False


class KymographResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    png_base64: str
    csv_base64: str
    frame_count: int
    length_px: int
    tracked: bool
    # Image pixels per kymograph column (= seed arc length / (length_px-1)). The
    # Node backend multiplies column-space velocities + run displacements by this
    # before applying µm calibration, so long MTs (column axis compressed at
    # target_width) report correct µm/s and µm.
    px_per_column: float = 1.0
    # How many detected tracks were dropped by the net-velocity cut-off. Lets the
    # caller distinguish "hidden as non-processive" from "nothing detected".
    filtered_track_count: int = 0
    # Populated only when the request set ``detect_velocity``; otherwise None.
    tracks: Optional[List[KymographTrack]] = None
    # Populated only when ``render_overlay`` was set; base64 PNG of the
    # kymograph with detected tracks drawn on top.
    overlay_png_base64: Optional[str] = None
    # Set to a non-empty string when velocity detection crashed unexpectedly.
    # An empty/absent field means detection either succeeded or was not requested.
    # Distinguishes "no motility detected" (tracks=[]) from "detection crashed".
    velocity_error: Optional[str] = None


def _arc_length_resample_polyline(
    pts_rc: np.ndarray, n_samples: int
) -> np.ndarray:
    """Resample a polyline to ``n_samples`` arc-length-uniform points.

    Mirrors ImageJ's ``PolygonRoi.getInterpolatedPolygon(step, smooth=false)``:
    walk the polyline at fixed arc-length step ``= total / (n - 1)``, emit
    one point per step. The result has uniform spatial spacing, so a
    kymograph row built from it preserves "column N = the same fractional
    position along the microtubule" across frames (the property a biologist
    expects from an ImageJ-style kymograph).
    """
    if pts_rc.shape[0] < 2 or n_samples < 2:
        return pts_rc.astype(np.float32)
    segs = np.diff(pts_rc, axis=0)
    seg_lengths = np.sqrt(np.sum(segs * segs, axis=1))
    cum = np.concatenate([[0.0], np.cumsum(seg_lengths)])
    total = float(cum[-1])
    if total <= 0.0:
        return np.tile(pts_rc[0], (n_samples, 1)).astype(np.float32)
    targets = np.linspace(0.0, total, n_samples, dtype=np.float64)
    # For each target arc length, find which segment contains it.
    seg_idx = np.searchsorted(cum, targets, side="right") - 1
    seg_idx = np.clip(seg_idx, 0, len(segs) - 1)
    seg_start_cum = cum[seg_idx]
    seg_len_at = seg_lengths[seg_idx]
    # local in [0, 1] within the segment; guard zero-length segments.
    local = np.where(
        seg_len_at > 0.0,
        (targets - seg_start_cum) / np.maximum(seg_len_at, 1e-12),
        0.0,
    )
    local = np.clip(local, 0.0, 1.0)[:, None]
    out = pts_rc[seg_idx] + local * segs[seg_idx]
    return out.astype(np.float32)


_VIRIDIS_RGB = np.array(
    [
        # 16-stop subsample of matplotlib viridis colormap.
        # Sampled at i/15 for i in [0..15] from matplotlib.cm.viridis. The
        # tail (>= stop 12) intentionally stays in the yellow/yellow-green
        # band — viridis ends at bright yellow #fde725, not in orange/red.
        # Mixing in plasma/inferno tail stops would silently mis-render
        # high-intensity pixels relative to ImageJ output.
        [68, 1, 84],
        [71, 22, 105],
        [72, 41, 122],
        [69, 60, 135],
        [62, 78, 138],
        [54, 96, 141],
        [47, 113, 142],
        [40, 130, 142],
        [35, 147, 142],
        [33, 165, 133],
        [40, 181, 121],
        [73, 197, 103],
        [127, 211, 79],
        [187, 222, 56],
        [232, 230, 56],
        [253, 231, 37],
    ],
    dtype=np.float32,
) / 255.0


def _viridis(values: np.ndarray) -> np.ndarray:
    """Map a 2D float32 [0,1] array to RGB via the 16-stop viridis LUT."""
    clipped = np.clip(values, 0.0, 1.0)
    idx_f = clipped * (_VIRIDIS_RGB.shape[0] - 1)
    lo = np.floor(idx_f).astype(np.int32)
    hi = np.minimum(lo + 1, _VIRIDIS_RGB.shape[0] - 1)
    t = (idx_f - lo)[..., None]
    rgb = _VIRIDIS_RGB[lo] * (1.0 - t) + _VIRIDIS_RGB[hi] * t
    return (rgb * 255.0).astype(np.uint8)


def _hex_to_rgb_array(hex_color: str) -> np.ndarray:
    """Parse `#RRGGBB` → float32 ndarray of length 3, values in [0, 1]."""
    h = hex_color.lstrip("#")
    return np.array(
        [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)],
        dtype=np.float32,
    ) / 255.0


def _linear_gradient(values: np.ndarray, hex_color: str) -> np.ndarray:
    """Map a 2D float32 [0,1] array to RGB via a black→hex_color gradient.

    Pure intensity-modulated single-hue render, matching the convention
    most live-cell imaging tools use when the user picks a channel tint
    (ImageJ "Fire" with all stops a single hue). Loses the perceptual-
    uniformity of viridis but gains "the kymograph for the green channel
    is rendered in green", which is what users intuitively expect after
    they've already coloured the multi-channel overlay.
    """
    clipped = np.clip(values, 0.0, 1.0)
    color = _hex_to_rgb_array(hex_color)  # shape (3,)
    # Broadcast (F, W) × (3,) → (F, W, 3); each pixel is intensity × color.
    rgb = clipped[..., None] * color
    return (rgb * 255.0).astype(np.uint8)


@router.post("/kymograph", response_model=KymographResponse)
async def kymograph(req: KymographRequest) -> KymographResponse:
    """Render a kymograph for one microtubule polyline."""
    from PIL import Image as PILImage
    from scipy.ndimage import map_coordinates

    if not req.frames:
        raise HTTPException(status_code=400, detail="No frames provided")

    frames = sorted(req.frames, key=lambda f: f.frame)

    # Choose the canonical sample count: round to the nearest integer of
    # the seed (first) frame's polyline arc length. Matches ImageJ's
    # convention of one sample per pixel along the line. The request's
    # ``target_width`` acts as a clamp so we still cap output dimensions.
    seed_pts = np.asarray(frames[0].polyline_rc, dtype=np.float64)
    if seed_pts.ndim != 2 or seed_pts.shape[1] != 2 or seed_pts.shape[0] < 2:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Seed-frame polyline has {seed_pts.shape[0]} vertex(es); "
                "need >= 2."
            ),
        )
    seed_arc = float(np.sum(np.linalg.norm(np.diff(seed_pts, axis=0), axis=1)))
    n_samples = max(2, min(int(round(seed_arc)) + 1, req.target_width))
    # Image pixels spanned by one kymograph column. ≈1 while the arc length fits
    # in target_width; >1 once the column axis is compressed (long MT capped at
    # target_width). Velocities + run lengths are measured in columns, so the
    # Node backend multiplies by this before applying the µm calibration.
    px_per_column = seed_arc / (n_samples - 1) if n_samples > 1 else 1.0

    rows: List[np.ndarray] = []
    for frame in frames:
        path = Path(frame.image_path)
        _assert_safe_path(path, "image_path")
        if not path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Frame image missing: {frame.image_path}",
            )
        # Load at native bit depth. convert('L') would force 8-bit and lose
        # half the dynamic range of 16-bit microscopy frames.
        pil_frame = PILImage.open(path)
        if pil_frame.mode in ('I;16', 'I;16B', 'I;16L', 'I', 'F'):
            img = np.array(pil_frame, dtype=np.float32)
        else:
            img = np.array(pil_frame.convert("L"), dtype=np.float32)
        H, W = img.shape
        pts = np.asarray(frame.polyline_rc, dtype=np.float32)
        if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2:
            logger.warning(
                "kymograph: frame %s polyline has <2 points; row filled with zeros",
                frame.frame,
            )
            rows.append(np.zeros(n_samples, dtype=np.float32))
            continue
        # Step 1 (ImageJ-style): resample the polyline geometry to
        # ``n_samples`` arc-length-uniform points. This is THE change
        # that makes the kymograph spatially honest — vertex-only
        # sampling was aliasing punctate signal between vertices.
        sampled_pts = _arc_length_resample_polyline(pts, n_samples)
        # Step 2: sample the underlying image at each interpolated point.
        # order=0 = nearest pixel (no intensity blending). mode='constant',
        # cval=0 = pixels outside the image read as 0 (matches ImageJ's
        # getInterpolatedValue zero-fill, instead of edge-clamping which
        # falsely brightened polylines that crossed the frame border).
        profile = map_coordinates(
            img,
            np.stack([sampled_pts[:, 0], sampled_pts[:, 1]]),
            order=0,
            mode="constant",
            cval=0.0,
        )
        rows.append(profile.astype(np.float32))

    kymo = np.stack(rows, axis=0)  # (F, n_samples)
    if kymo.size == 0:
        raise HTTPException(status_code=500, detail="Empty kymograph result")

    # Blob-motion detection runs on the RAW (un-normalised) matrix so the
    # background-subtraction and SNR estimates inside detect_blobs see real
    # intensities, not a [0,1]-rescaled version. The velocity layer is
    # OPTIONAL: a detection failure must never break the kymograph itself, so
    # we degrade to "no tracks" rather than 500-ing the whole request.
    raw_tracks: List[Dict[str, Any]] = []
    tracks: Optional[List[KymographTrack]] = None
    velocity_error: Optional[str] = None
    filtered_track_count = 0
    if req.detect_velocity:
        try:
            raw_tracks = detect_blobs(kymo)
            # Enrich each track with the edge-touch flag + background-subtracted
            # intensity along its trajectory (both read off the same kymo). A
            # failure on ONE track must not discard the whole batch, so isolate
            # the enrichment per track and default its fields on error.
            for tr in raw_tracks:
                try:
                    tr["edge"] = edge_touch(tr["points"], n_samples)
                    tr.update(
                        track_intensity(kymo, tr["points"], req.intensity_width)
                    )
                except Exception:
                    logger.exception(
                        "kymograph track enrichment failed; defaulting fields"
                    )
                    tr.setdefault("edge", "none")
                    tr.setdefault("intensity_signal", None)
                    tr.setdefault("intensity_background", None)
                    tr.setdefault("intensity_minus_bg", None)
            # Drop non-processive tracks: |net velocity| below the µm/s cut-off
            # (oscillatory / static blobs are not directed transport). Needs the
            # calibration to convert the µm/s threshold to a column/frame cut-off;
            # without it we keep every track. Filter BEFORE render_overlay so the
            # rendered overlay matches the returned table / exported velocity CSV.
            if req.pixel_size_um and req.frame_interval_ms:
                thr = net_velocity_threshold(
                    req.min_net_velocity_um_s,
                    req.frame_interval_ms,
                    req.pixel_size_um,
                    px_per_column,
                )
                kept = [tr for tr in raw_tracks if abs(tr["net_pxframe"]) >= thr]
                filtered_track_count = len(raw_tracks) - len(kept)
                if filtered_track_count:
                    logger.info(
                        "kymograph: dropped %d/%d track(s) below %.3g um/s",
                        filtered_track_count,
                        len(raw_tracks),
                        req.min_net_velocity_um_s,
                    )
                raw_tracks = kept
            # Flag intensity outliers among the FINAL (post-filter) tracks, so
            # the "bright" flag matches the trajectories that actually appear in
            # the table / overlay / exported sheet.
            flag_bright_outliers(raw_tracks)
            tracks = [KymographTrack(**tr) for tr in raw_tracks]
        except Exception as _vel_exc:
            logger.exception(
                "kymograph velocity detection failed; "
                "returning kymograph without tracks"
            )
            velocity_error = str(_vel_exc)
            raw_tracks = []
            tracks = []
            filtered_track_count = 0

    # Per-frame normalisation could obscure intensity changes — instead we
    # normalise globally to expose dynamics. Add 1e-9 to avoid /0.
    mn, mx = float(kymo.min()), float(kymo.max())
    norm = (kymo - mn) / max(mx - mn, 1e-9)
    rgb = (
        _linear_gradient(norm, req.channel_color)
        if req.channel_color
        else _viridis(norm)
    )

    buf = io.BytesIO()
    PILImage.fromarray(rgb).save(buf, format="PNG")
    png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    # Render the "segmented kymograph" whenever the caller asked for it — even
    # with zero tracks (then it's just the kymograph, which is still the image
    # the export wants). raw_tracks may be empty; render_overlay handles that.
    overlay_b64: Optional[str] = None
    if req.render_overlay:
        try:
            overlay_b64 = base64.b64encode(
                render_overlay(rgb, raw_tracks)
            ).decode("ascii")
        except Exception:
            logger.exception("kymograph overlay render failed; omitting overlay")

    csv_buf = io.StringIO()
    writer = csv.writer(csv_buf)
    writer.writerow(["frame", *[f"x{i}" for i in range(n_samples)]])
    for i, row in enumerate(kymo):
        writer.writerow([frames[i].frame, *row.tolist()])
    csv_b64 = base64.b64encode(csv_buf.getvalue().encode("utf-8")).decode("ascii")

    return KymographResponse(
        png_base64=png_b64,
        csv_base64=csv_b64,
        frame_count=int(kymo.shape[0]),
        length_px=int(kymo.shape[1]),
        tracked=bool(req.tracked),
        px_per_column=float(px_per_column),
        filtered_track_count=int(filtered_track_count),
        tracks=tracks,
        overlay_png_base64=overlay_b64,
        velocity_error=velocity_error,
    )
