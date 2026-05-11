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
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ----------------------------------------------------------------------------
#  /track
# ----------------------------------------------------------------------------

class PolylineInput(BaseModel):
    """One polyline as fed to the tracker."""
    id: str
    # (M, 2) row, col centerline pixel coords. List-of-list is the
    # JSON-friendly form; numpy conversion happens server-side.
    points_rc: List[List[float]]
    # base64-encoded little-endian float16 byte string of (M, 32) embedding
    # samples. None when embedding wasn't persisted (older segmentations).
    embedding: Optional[str] = None


class FramePolylines(BaseModel):
    frame: int
    polylines: List[PolylineInput]


class TrackRequest(BaseModel):
    frames: List[FramePolylines]
    cost_threshold: float = Field(0.5, ge=0.0, le=2.0)
    spatial_weight: float = Field(0.3, ge=0.0, le=1.0)


class TrackResponse(BaseModel):
    assignments: Dict[str, str]  # polylineId -> trackId
    track_count: int


def _decode_embedding(b64: str | None, n_points: int) -> Optional[np.ndarray]:
    if not b64:
        return None
    try:
        buf = base64.b64decode(b64)
        arr = np.frombuffer(buf, dtype=np.float16)
        if arr.size % 32 != 0:
            return None
        arr = arr.reshape(-1, 32)
        # If the embedding was persisted at full per-point resolution it
        # should match n_points exactly; tolerate small mismatches by
        # trimming or padding to whichever is smaller.
        if arr.shape[0] != n_points:
            return arr[:n_points] if arr.shape[0] > n_points else arr
        return arr
    except Exception as exc:
        logger.warning(f"failed to decode embedding: {exc}")
        return None


def _build_cost_matrix(
    prev: List[PolylineInput],
    nxt: List[PolylineInput],
    img_diag: float,
    spatial_weight: float,
) -> np.ndarray:
    """Cost = (1 - mean cosine sim of embeddings) + λ · normalised dist."""
    prev_emb = []
    prev_cent = []
    for p in prev:
        emb = _decode_embedding(p.embedding, len(p.points_rc))
        prev_emb.append(emb.mean(axis=0) if emb is not None else None)
        pts = np.asarray(p.points_rc, dtype=np.float32)
        prev_cent.append(pts.mean(axis=0) if pts.size else np.zeros(2))

    nxt_emb = []
    nxt_cent = []
    for p in nxt:
        emb = _decode_embedding(p.embedding, len(p.points_rc))
        nxt_emb.append(emb.mean(axis=0) if emb is not None else None)
        pts = np.asarray(p.points_rc, dtype=np.float32)
        nxt_cent.append(pts.mean(axis=0) if pts.size else np.zeros(2))

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
    frame: int
    # (M, 2) row, col centerline used to sample intensity in this frame.
    polyline_rc: List[List[float]]
    image_path: str  # absolute path the ML service can read


class KymographRequest(BaseModel):
    frames: List[KymographFrameInput]
    target_width: int = Field(200, ge=10, le=2000)
    tracked: bool = False


class KymographResponse(BaseModel):
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


_VIRIDIS_RGB = np.array([  # 16-stop subsample of matplotlib viridis
    [68, 1, 84],   [72, 25, 109], [69, 50, 127], [62, 73, 137],
    [54, 95, 141], [47, 116, 142], [40, 137, 141], [35, 158, 138],
    [37, 178, 124], [73, 195, 102], [128, 207, 70], [188, 215, 39],
    [246, 222, 31], [253, 188, 25], [253, 144, 21], [241, 96, 17],
], dtype=np.float32) / 255.0


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
