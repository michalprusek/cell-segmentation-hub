"""Cross-frame microtubule tracking + kymograph rendering endpoints.

Both are pure NumPy / SciPy postprocessing on artefacts already produced
during per-frame segmentation:

- ``/track`` takes the per-frame polylines + their L2-normalised
  embedding samples (32-d, sampled at centerline points) and runs a
  two-step Linear Assignment Problem tracker (TrackMate / u-track
  paradigm). A filament-aware cost blends embedding cosine distance with
  endpoint distance, orientation and length so crossing MTs that share a
  centroid stay distinct. Step 1 is a birth/death LAP between adjacent
  frames (producing tracklet segments); step 2 is a gap-closing LAP that
  re-links a segment's end to a later segment's start across up to
  ``max_gap`` missed frames, so a briefly-lost filament regains its id.

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
from typing import Any, Dict, List, Literal, NamedTuple, Optional, Tuple

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
    # Maximum accepted matching cost. The filament cost is a weighted sum of
    # four [0, 1] terms whose weights sum to 1 by default, so the cost lives
    # in [0, 1] and 0.6 accepts moderately-confident links while rejecting
    # weak ones. Kept in [0, 2] for backward compatibility with older callers.
    cost_threshold: float = Field(0.6, ge=0.0, le=2.0)
    # DEPRECATED, accepted for backward compatibility: the previous greedy
    # tracker weighted a centroid-distance term by this. The filament-aware
    # cost supersedes it (see w_end) and this value is now ignored.
    spatial_weight: float = Field(0.3, ge=0.0, le=1.0)
    # Gap closing (second LAP): a filament may vanish for up to max_gap
    # frames and still be re-linked to its original track. 0 disables gap
    # closing entirely.
    max_gap: int = Field(2, ge=0)
    # Multiplies the gap-close cost by (1 + gap_penalty * (gap - 1)) so that
    # longer gaps are progressively less attractive to bridge.
    gap_penalty: float = Field(0.5, ge=0.0)
    # Weights of the four filament-cost terms (embedding, endpoint distance,
    # orientation, length). Each in [0, 1]; defaults sum to 1.
    w_emb: float = Field(0.5, ge=0.0, le=1.0)
    w_end: float = Field(0.3, ge=0.0, le=1.0)
    w_orient: float = Field(0.1, ge=0.0, le=1.0)
    w_len: float = Field(0.1, ge=0.0, le=1.0)
    # Optional (H, W) of the source frame; when given the endpoint term is
    # normalised by sqrt(H^2 + W^2). Otherwise a point-spread heuristic
    # (bbox diagonal of all centerline points) is used.
    image_hw: Optional[Tuple[int, int]] = None


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


class _Filament(NamedTuple):
    """Geometry + embedding summary of one polyline, cached once per
    polyline so the two LAP passes never re-decode or re-measure it."""

    mean_emb: Optional[np.ndarray]  # (32,) mean of the sampled embedding rows
    was_corrupt: bool  # True iff the embedding payload failed to decode
    end_a: np.ndarray  # first centerline point [row, col]
    end_b: np.ndarray  # last centerline point [row, col]
    theta: float  # atan2 orientation of the (undirected) end_b - end_a vector
    length: float  # summed segment length of the centerline (px)


def _filament_features(p: PolylineInput) -> _Filament:
    """Summarise one polyline into the features the filament-aware cost
    consumes. Robust to empty / single-point centerlines."""
    mean_emb, was_corrupt = _safe_mean_embedding(p)
    pts = np.asarray(p.points_rc, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[0] == 0:
        zero = np.zeros(2, dtype=np.float64)
        return _Filament(mean_emb, was_corrupt, zero, zero.copy(), 0.0, 0.0)
    end_a = pts[0]
    end_b = pts[-1]
    vec = end_b - end_a
    theta = float(np.arctan2(float(vec[0]), float(vec[1])))
    if pts.shape[0] >= 2:
        length = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
    else:
        length = 0.0
    return _Filament(mean_emb, was_corrupt, end_a, end_b, theta, length)


def _emb_distance(fa: _Filament, fb: _Filament) -> Optional[float]:
    """Cosine-based embedding distance in [0, 1]; None when either
    filament has no (or corrupt) embedding — the caller substitutes a
    neutral value derived from the rest of the matrix."""
    if fa.mean_emb is None or fb.mean_emb is None:
        return None
    a, b = fa.mean_emb, fb.mean_emb
    denom = float(np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9
    cos = float(np.dot(a, b) / denom)
    return float(np.clip((1.0 - cos) / 2.0, 0.0, 1.0))


def _geom_terms(
    fa: _Filament, fb: _Filament, img_diag: float
) -> tuple[float, float, float]:
    """Return ``(d_end, d_orient, d_len)``, each in [0, 1].

    - ``d_end`` uses the MIN over the two head/tail endpoint pairings, so
      it is invariant to arbitrary centerline direction.
    - ``d_orient`` uses ``1 - |cos Δθ|`` — undirected, so a reversed
      centerline (θ flipped by π) scores identically.
    - ``d_len`` is the relative centerline-length mismatch.
    """
    diag = max(float(img_diag), 1.0)
    p1 = float(np.linalg.norm(fa.end_a - fb.end_a)) + float(
        np.linalg.norm(fa.end_b - fb.end_b)
    )
    p2 = float(np.linalg.norm(fa.end_a - fb.end_b)) + float(
        np.linalg.norm(fa.end_b - fb.end_a)
    )
    d_end = float(np.clip(min(p1, p2) / (2.0 * diag), 0.0, 1.0))
    d_orient = float(np.clip(1.0 - abs(np.cos(fa.theta - fb.theta)), 0.0, 1.0))
    denom = max(fa.length, fb.length, 1e-6)
    d_len = float(np.clip(abs(fa.length - fb.length) / denom, 0.0, 1.0))
    return d_end, d_orient, d_len


def _filament_cost(
    fa: _Filament,
    fb: _Filament,
    img_diag: float,
    neutral_d_emb: float = 0.5,
    w_emb: float = 0.5,
    w_end: float = 0.3,
    w_orient: float = 0.1,
    w_len: float = 0.1,
) -> float:
    """Filament-to-filament matching cost in [0, w_emb+w_end+w_orient+w_len].

    A missing/corrupt embedding on either side substitutes ``neutral_d_emb``
    (the median of the valid embedding distances in the current matrix, or
    0.5 when none are valid) so the pair degrades gracefully to geometry
    rather than being rewarded or rejected outright.
    """
    d = _emb_distance(fa, fb)
    d_emb = neutral_d_emb if d is None else d
    d_end, d_orient, d_len = _geom_terms(fa, fb, img_diag)
    return float(
        w_emb * d_emb + w_end * d_end + w_orient * d_orient + w_len * d_len
    )


def _build_link_cost(
    prev_feats: List[_Filament],
    nxt_feats: List[_Filament],
    img_diag: float,
    weights: tuple[float, float, float, float],
) -> np.ndarray:
    """Dense ``P × Q`` base cost matrix of filament costs.

    Missing-embedding cells reuse the MEDIAN of the valid embedding
    distances in this matrix as their neutral ``d_emb`` (0.5 if the whole
    matrix lacks embeddings) — the same graceful-degradation logic the
    greedy tracker used, lifted to the filament cost.
    """
    P, Q = len(prev_feats), len(nxt_feats)
    if P == 0 or Q == 0:
        return np.zeros((P, Q), dtype=np.float64)

    demb = np.full((P, Q), np.nan, dtype=np.float64)
    for i in range(P):
        for j in range(Q):
            d = _emb_distance(prev_feats[i], nxt_feats[j])
            if d is not None:
                demb[i, j] = d
    valid = ~np.isnan(demb)
    neutral = float(np.median(demb[valid])) if valid.any() else 0.5

    w_emb, w_end, w_orient, w_len = weights
    base = np.zeros((P, Q), dtype=np.float64)
    for i in range(P):
        for j in range(Q):
            base[i, j] = _filament_cost(
                prev_feats[i],
                nxt_feats[j],
                img_diag,
                neutral,
                w_emb,
                w_end,
                w_orient,
                w_len,
            )
    return base


def _solve_link_lap(
    base_cost: np.ndarray, cost_threshold: float
) -> Dict[int, int]:
    """One frame-to-frame LAP with birth/death (TrackMate step 1).

    Builds a ``P × (Q + P)`` augmented matrix: real links cost their
    filament cost when ``<= cost_threshold`` (else a large finite BIG so
    the assignment prefers a death); ``C[i, Q+i] = cost_threshold`` is the
    death alternative for prev ``i``. Returns ``{prev_idx: next_idx}`` for
    accepted links only. Any prev not in the mapping *dies*; any next not
    referenced is a *birth*.
    """
    from scipy.optimize import linear_sum_assignment

    base = np.asarray(base_cost, dtype=np.float64)
    P, Q = base.shape
    if P == 0 or Q == 0:
        return {}

    BIG = 1e6
    C = np.full((P, Q + P), BIG, dtype=np.float64)
    for i in range(P):
        for j in range(Q):
            if base[i, j] <= cost_threshold:
                C[i, j] = base[i, j]
        C[i, Q + i] = cost_threshold
    row_ind, col_ind = linear_sum_assignment(C)
    links: Dict[int, int] = {}
    for r, c in zip(row_ind, col_ind):
        if c < Q and base[r, c] <= cost_threshold:
            links[int(r)] = int(c)
    return links


def _new_track_id() -> str:
    return f"track_{uuid.uuid4().hex[:10]}"


class _Segment(NamedTuple):
    """A tracklet produced by the frame-to-frame LAP: one trackId observed
    over a contiguous run of frames, summarised by its first and last
    filament for the gap-closing pass."""

    track_id: str
    start_frame: int
    end_frame: int
    start_feat: _Filament
    end_feat: _Filament


def _gap_close_merges(
    segments: List[_Segment],
    img_diag: float,
    weights: Tuple[float, float, float, float],
    cost_threshold: float,
    max_gap: int,
    gap_penalty: float,
) -> List[Tuple[int, int]]:
    """Second LAP (TrackMate step 2): link a segment's END to a later
    segment's START across a gap of ``1..max_gap`` frames.

    Cost is ``cost(end, start) * (1 + gap_penalty * (gap - 1))`` and the
    candidate is rejected when the *base* cost exceeds ``cost_threshold``.
    Each row (segment end) also has a no-link alternative at
    ``cost_threshold``. Returns ``[(end_idx, start_idx), ...]`` merge pairs.
    """
    from scipy.optimize import linear_sum_assignment

    M = len(segments)
    if max_gap < 1 or M < 2:
        return []

    valid = np.zeros((M, M), dtype=bool)
    gap_arr = np.zeros((M, M), dtype=np.int64)
    demb_vals: List[float] = []
    for x in range(M):
        for y in range(M):
            if x == y:
                continue
            gap = segments[y].start_frame - segments[x].end_frame
            if 1 <= gap <= max_gap:
                valid[x, y] = True
                gap_arr[x, y] = gap
                d = _emb_distance(segments[x].end_feat, segments[y].start_feat)
                if d is not None:
                    demb_vals.append(d)
    if not valid.any():
        return []

    neutral = float(np.median(demb_vals)) if demb_vals else 0.5
    w_emb, w_end, w_orient, w_len = weights
    BIG = 1e6
    C = np.full((M, 2 * M), BIG, dtype=np.float64)
    accept = np.zeros((M, M), dtype=bool)
    for x in range(M):
        for y in range(M):
            if valid[x, y]:
                base = _filament_cost(
                    segments[x].end_feat,
                    segments[y].start_feat,
                    img_diag,
                    neutral,
                    w_emb,
                    w_end,
                    w_orient,
                    w_len,
                )
                if base <= cost_threshold:
                    gap = int(gap_arr[x, y])
                    C[x, y] = base * (1.0 + gap_penalty * (gap - 1))
                    accept[x, y] = True
        C[x, M + x] = cost_threshold

    row_ind, col_ind = linear_sum_assignment(C)
    merges: List[Tuple[int, int]] = []
    for r, c in zip(row_ind, col_ind):
        if c < M and accept[r, c]:
            merges.append((int(r), int(c)))
    return merges


@router.post("/track", response_model=TrackResponse)
async def track(req: TrackRequest) -> TrackResponse:
    """Two-step LAP filament tracker (TrackMate / u-track paradigm).

    Step 1 links filaments between adjacent frames with an augmented
    birth/death LAP over a filament-aware cost (embedding + endpoint +
    orientation + length), producing tracklet *segments*. Step 2 closes
    gaps: a second LAP links segment ends to later segment starts across up
    to ``max_gap`` missed frames, and union-find collapses transitive
    merges so a filament briefly lost regains its original trackId.
    """
    from collections import defaultdict

    if not req.frames:
        return TrackResponse(assignments={}, track_count=0)

    frames = sorted(req.frames, key=lambda f: f.frame)

    # Image diagonal for endpoint-distance normalisation.
    if req.image_hw is not None:
        h, w = req.image_hw
        img_diag = float(np.hypot(float(h), float(w)))
    else:
        all_points = [pt for f in frames for p in f.polylines for pt in p.points_rc]
        if all_points:
            coords = np.asarray(all_points, dtype=np.float64)
            img_diag = float(
                np.linalg.norm(coords.max(axis=0) - coords.min(axis=0))
            )
        else:
            img_diag = 1.0
    img_diag = max(img_diag, 1.0)

    weights = (req.w_emb, req.w_end, req.w_orient, req.w_len)

    # Cache per-polyline features once; count each corrupt embedding once.
    feats: Dict[str, _Filament] = {}
    corrupt_ids: set[str] = set()
    for f in frames:
        for p in f.polylines:
            ft = _filament_features(p)
            feats[p.id] = ft
            if ft.was_corrupt:
                corrupt_ids.add(p.id)
    total_corrupt = len(corrupt_ids)
    if total_corrupt > 0:
        logger.error(
            f"Tracker: {total_corrupt} embeddings were corrupt and fell "
            "back to geometry-only matching"
        )

    # --- Step 1: frame-to-frame linking with birth/death -> tracklets ---
    assignments: Dict[str, str] = {}
    for p in frames[0].polylines:
        assignments[p.id] = _new_track_id()

    for prev_f, next_f in zip(frames, frames[1:]):
        prev_pl, next_pl = prev_f.polylines, next_f.polylines
        # Defensive: any prev polyline without an id (e.g. after an empty
        # frame) is a fresh birth in its own frame.
        for p in prev_pl:
            assignments.setdefault(p.id, _new_track_id())
        if not next_pl:
            continue
        if not prev_pl:
            for p in next_pl:
                assignments[p.id] = _new_track_id()
            continue

        base = _build_link_cost(
            [feats[p.id] for p in prev_pl],
            [feats[p.id] for p in next_pl],
            img_diag,
            weights,
        )
        links = _solve_link_lap(base, req.cost_threshold)
        linked_cols = set(links.values())
        for pi, nj in links.items():
            assignments[next_pl[nj].id] = assignments[prev_pl[pi].id]
        for c, p in enumerate(next_pl):
            if c not in linked_cols:
                assignments[p.id] = _new_track_id()

    # --- Step 2: gap closing over tracklet segments (second LAP) ---
    members: Dict[str, List[Tuple[int, str]]] = defaultdict(list)
    for f in frames:
        for p in f.polylines:
            members[assignments[p.id]].append((f.frame, p.id))

    seg_ids = list(members.keys())
    segments: List[_Segment] = []
    for tid in seg_ids:
        mem = sorted(members[tid], key=lambda x: x[0])
        (start_frame, start_pid) = mem[0]
        (end_frame, end_pid) = mem[-1]
        segments.append(
            _Segment(
                track_id=tid,
                start_frame=start_frame,
                end_frame=end_frame,
                start_feat=feats[start_pid],
                end_feat=feats[end_pid],
            )
        )

    merges = _gap_close_merges(
        segments,
        img_diag,
        weights,
        req.cost_threshold,
        req.max_gap,
        req.gap_penalty,
    )

    if merges:
        parent = list(range(len(segments)))

        def _find(i: int) -> int:
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for x, y in merges:
            rx, ry = _find(x), _find(y)
            if rx != ry:
                parent[ry] = rx

        # Canonical trackId per merged component = the earliest-starting
        # segment's id (tie: lexicographically smallest), so "Y adopts X".
        comp: Dict[int, List[int]] = defaultdict(list)
        for i in range(len(segments)):
            comp[_find(i)].append(i)
        remap: Dict[str, str] = {}
        for idxs in comp.values():
            canon = min(
                idxs, key=lambda i: (segments[i].start_frame, segments[i].track_id)
            )
            canon_id = segments[canon].track_id
            for i in idxs:
                remap[segments[i].track_id] = canon_id
        for pid, tid in list(assignments.items()):
            assignments[pid] = remap.get(tid, tid)

    track_count = len(set(assignments.values()))
    logger.info(
        f"Tracker: {len(req.frames)} frames, "
        f"{sum(len(f.polylines) for f in frames)} polylines, "
        f"{len(segments)} tracklets -> {track_count} tracks after gap closing, "
        f"{total_corrupt} corrupt embeddings"
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
