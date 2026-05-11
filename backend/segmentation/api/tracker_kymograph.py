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
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

router = APIRouter()


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
) -> np.ndarray:
    """Cost = (1 - mean cosine sim of embeddings) + λ · normalised dist."""
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
    cost = np.full((P, Q), fill_value=1.0, dtype=np.float32)
    for i in range(P):
        for j in range(Q):
            spat = float(np.linalg.norm(prev_cent[i] - nxt_cent[j])) / max(
                img_diag, 1.0
            )
            if prev_emb[i] is None or nxt_emb[j] is None:
                cosine = 1.0  # neutral when embedding missing
            else:
                a = prev_emb[i]
                b = nxt_emb[j]
                denom = float(np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9
                cosine = 1.0 - float(np.dot(a, b) / denom)
            cost[i, j] = cosine + spatial_weight * spat
    return cost


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

    # Seed: every polyline in the first frame gets a fresh trackId.
    for p in frames[0].polylines:
        assignments[p.id] = _new_track_id()

    for prev_f, next_f in zip(frames, frames[1:]):
        if not prev_f.polylines or not next_f.polylines:
            for p in next_f.polylines:
                assignments[p.id] = _new_track_id()
            continue
        cost = _build_cost_matrix(
            prev_f.polylines,
            next_f.polylines,
            img_diag,
            req.spatial_weight,
        )
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
        f"{track_count} tracks"
    )
    return TrackResponse(assignments=assignments, track_count=track_count)


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


class KymographResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    png_base64: str
    csv_base64: str
    frame_count: int
    length_px: int
    tracked: bool


def _resample_profile(profile: np.ndarray, target_width: int) -> np.ndarray:
    """Linear resample a 1D profile to ``target_width`` points."""
    if profile.size == 0:
        return np.zeros(target_width, dtype=np.float32)
    if profile.size == target_width:
        return profile.astype(np.float32)
    src_x = np.linspace(0.0, 1.0, profile.size, dtype=np.float32)
    dst_x = np.linspace(0.0, 1.0, target_width, dtype=np.float32)
    return np.interp(dst_x, src_x, profile.astype(np.float32))


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


@router.post("/kymograph", response_model=KymographResponse)
async def kymograph(req: KymographRequest) -> KymographResponse:
    """Render a kymograph for one microtubule polyline."""
    from PIL import Image as PILImage
    from scipy.ndimage import map_coordinates

    if not req.frames:
        raise HTTPException(status_code=400, detail="No frames provided")

    frames = sorted(req.frames, key=lambda f: f.frame)

    rows: List[np.ndarray] = []
    for frame in frames:
        path = Path(frame.image_path)
        if not path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Frame image missing: {frame.image_path}",
            )
        img = np.array(PILImage.open(path).convert("L"), dtype=np.float32)
        H, W = img.shape
        pts = np.asarray(frame.polyline_rc, dtype=np.float32)
        if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2:
            rows.append(np.zeros(req.target_width, dtype=np.float32))
            continue
        # scipy.ndimage.map_coordinates expects (channel, point) layout for
        # row & column samplers. Clip into the frame to avoid silent zeros.
        rows_idx = np.clip(pts[:, 0], 0, H - 1)
        cols_idx = np.clip(pts[:, 1], 0, W - 1)
        profile = map_coordinates(
            img,
            np.stack([rows_idx, cols_idx]),
            order=1,
            mode="nearest",
        )
        rows.append(_resample_profile(profile, req.target_width))

    kymo = np.stack(rows, axis=0)  # (F, target_width)
    if kymo.size == 0:
        raise HTTPException(status_code=500, detail="Empty kymograph result")

    # Per-frame normalisation could obscure intensity changes — instead we
    # normalise globally to expose dynamics. Add 1e-9 to avoid /0.
    mn, mx = float(kymo.min()), float(kymo.max())
    norm = (kymo - mn) / max(mx - mn, 1e-9)
    rgb = _viridis(norm)

    buf = io.BytesIO()
    PILImage.fromarray(rgb).save(buf, format="PNG")
    png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    csv_buf = io.StringIO()
    writer = csv.writer(csv_buf)
    writer.writerow(["frame", *[f"x{i}" for i in range(req.target_width)]])
    for i, row in enumerate(kymo):
        writer.writerow([frames[i].frame, *row.tolist()])
    csv_b64 = base64.b64encode(csv_buf.getvalue().encode("utf-8")).decode("ascii")

    return KymographResponse(
        png_base64=png_b64,
        csv_base64=csv_b64,
        frame_count=int(kymo.shape[0]),
        length_px=int(kymo.shape[1]),
        tracked=bool(req.tracked),
    )
