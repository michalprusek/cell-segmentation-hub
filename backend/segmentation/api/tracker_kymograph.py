"""Cross-frame microtubule tracking + kymograph rendering endpoints.

Both are pure NumPy / SciPy postprocessing on artefacts already produced
during per-frame segmentation:

- ``/track`` takes the per-frame polylines and runs a two-step Linear
  Assignment Problem tracker (TrackMate / u-track paradigm). A
  filament-aware cost blends symmetric curve-to-curve distance with
  endpoint distance, orientation and length so crossing MTs that share a
  centroid stay distinct. Step 1 is a birth/death LAP between adjacent
  frames (producing tracklet segments); step 2 is a gap-closing LAP that
  re-links a segment's end to a later segment's start across up to
  ``max_gap`` missed frames, so a briefly-lost filament regains its id.

  Until the microtubule v7 -> v5H swap the primary evidence was the cosine
  distance between 32-d embeddings the model sampled at each centerline
  point. v5H emits one foreground channel and no embedding field, so
  association is geometric: see ``mt_geometry_cost``. Common-mode stage
  drift is removed before matching, because a drifting field would
  otherwise inflate every curve distance at once.

  The cost has NO hard gates. An earlier version rejected pairs beyond a
  distance/overlap threshold outright, which fragmented tracks 3.14x on
  real data — see ``_filament_cost`` for the measurement.

- ``/kymograph`` samples raw image intensity along a polyline through
  every frame (using the tracked sibling polyline if available, the
  selected frame's geometry as a static fallback otherwise), resamples
  to a uniform width, and renders a viridis heatmap PNG plus the
  underlying CSV.

- ``/kymograph/batch`` renders N of those in one call, decoding each
  distinct frame ONCE and sampling every polyline from it. Same bodies,
  same maths, same output — only the loop order differs. It exists for the
  MT export, which builds one kymograph per (microtubule x channel) over
  one container's frames and so re-decoded each frame up to 60 times.
"""
from __future__ import annotations

import asyncio
import base64
import csv
import hashlib
import io
import logging
import os
import threading
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Literal, NamedTuple, Optional, Tuple

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from api.kymograph_velocity import (
    EMPTY_INTENSITY,
    detect_tracks,
    edge_touch,
    filter_dim_tracks,
    flag_bright_outliers,
    kymograph_polarity,
    net_velocity_threshold,
    render_overlay,
    tracks_intensity,
)
from api.mt_geometry_cost import (
    CURVE_SCALE_PX,
    build_tree,
    curve_distance_prebuilt,
    estimate_drift,
    resample,
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
    # DEPRECATED AND IGNORED since the microtubule v7 -> v5H swap. The v5H
    # model has no embedding field to sample, so cross-frame identity is
    # established from geometry alone. The field is kept ACCEPTED because
    # model_config forbids extras: segmentations stored by v7 still carry an
    # `_embedding`, and a Node container that has not been recreated yet still
    # sends it. Dropping the field outright would 400 both.
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
    # closing entirely. Default raised 2 -> 3: with gap_penalty=0.5 a 3-frame
    # bridge costs base*2.0, so it is only accepted when base < ~0.3 (well
    # inside the threshold), making the extra recall of short dropouts safe
    # against spurious merges.
    max_gap: int = Field(3, ge=0)
    # Multiplies the gap-close cost by (1 + gap_penalty * (gap - 1)) so that
    # longer gaps are progressively less attractive to bridge.
    gap_penalty: float = Field(0.5, ge=0.0)
    # Constant-velocity motion compensation for the frame-to-frame LAP: each
    # active track's endpoints are extrapolated to the next frame before the
    # cost is measured, so legitimate MT motion no longer inflates the
    # endpoint/orientation terms and pushes a true link past the threshold.
    # A track needs >= 2 observations to have a velocity; its first step
    # degrades to a zero-velocity (identity) prediction, i.e. the old
    # behaviour. Disable to A/B against the memoryless tracker.
    motion_model: bool = True
    # DEPRECATED AND IGNORED since the v5H swap: there is no embedding to
    # maintain an EMA template of. Accepted so an un-recreated Node container
    # does not 400 against model_config extra="forbid".
    emb_template_alpha: float = Field(0.5, ge=0.0, le=1.0)
    # Weights of the four filament-cost terms (curve distance, endpoint
    # distance, orientation, length). Each in [0, 1]; defaults sum to 1.
    # w_curve replaced w_emb: the primary evidence is now the symmetric
    # curve-to-curve distance rather than embedding cosine.
    w_curve: float = Field(0.5, ge=0.0, le=1.0)
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
    # Both retained for wire compatibility and both permanently 0/False since
    # the v5H swap: there is no embedding payload left to be corrupt, so
    # matching can no longer be "degraded" relative to itself. Node still reads
    # these fields; removing them would need a coordinated deploy for no gain.
    corrupt_count: int = 0
    degraded: bool = False


class _Filament(NamedTuple):
    """Geometry of one polyline, cached once per polyline so the two LAP
    passes never re-measure it.

    ``curve`` is an arclength-uniform resample of ``pts``. Without it the
    curve-to-curve distance would be biased by whichever centerline happened
    to carry more vertices, since the instancer's vertex density varies with
    local curvature.
    """

    curve: np.ndarray  # (K, 2) arclength-uniform resample, row/col
    #: cKDTree over ``curve``, built ONCE here rather than per candidate pair.
    #: The cost matrix is P x Q, so building it inside the pair loop rebuilds
    #: the same tree Q times — ~20 000 constructions per frame pair at ~100
    #: filaments a side, where 200 suffice.
    tree: Any
    #: (min_row, min_col, max_row, max_col) of ``curve``. Lets the cost skip
    #: the KD-tree queries entirely for a pair that is provably beyond
    #: CURVE_SCALE_PX — see ``_filament_cost``.
    bbox: np.ndarray
    end_a: np.ndarray  # first centerline point [row, col]
    end_b: np.ndarray  # last centerline point [row, col]
    theta: float  # atan2 orientation of the (undirected) end_b - end_a vector
    length: float  # summed segment length of the centerline (px)


def _bbox(curve: np.ndarray) -> np.ndarray:
    """Axis-aligned bounds of a curve as (min_row, min_col, max_row, max_col)."""
    if curve.size == 0:
        return np.zeros(4, dtype=np.float64)
    return np.concatenate([curve.min(axis=0), curve.max(axis=0)])


def _bbox_gap(a: np.ndarray, b: np.ndarray) -> float:
    """Euclidean gap between two axis-aligned boxes; 0 when they overlap.

    A LOWER BOUND on the curve-to-curve distance, because no point of one curve
    can be nearer to the other curve than its box is to the other box.
    """
    dr = max(0.0, a[0] - b[2], b[0] - a[2])
    dc = max(0.0, a[1] - b[3], b[1] - a[3])
    return float(np.hypot(dr, dc))


def _filament_features(p: PolylineInput) -> _Filament:
    """Summarise one polyline into the features the filament-aware cost
    consumes. Robust to empty / single-point centerlines."""
    pts = np.asarray(p.points_rc, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[0] == 0:
        zero = np.zeros(2, dtype=np.float64)
        return _Filament(np.zeros((0, 2)), None, np.zeros(4), zero, zero.copy(),
                         0.0, 0.0)
    end_a = pts[0]
    end_b = pts[-1]
    vec = end_b - end_a
    theta = float(np.arctan2(float(vec[0]), float(vec[1])))
    if pts.shape[0] >= 2:
        length = float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())
    else:
        length = 0.0
    curve = resample(pts)
    return _Filament(curve, build_tree(curve), _bbox(curve), end_a, end_b,
                     theta, length)


class _TrackState:
    """Online per-track state accumulated during the frame-to-frame pass.

    Holds the last two *endpoint-aligned* observations, so a constant-velocity
    prediction can be computed despite arbitrary centerline direction. Matching
    a new frame against the predicted filament — rather than the raw previous
    frame — is what makes the LAP robust to the per-frame geometry jitter of
    independently re-detected MTs.

    The EMA embedding template this used to carry is gone with the v5H swap;
    the equivalent smoothing now comes from the motion model alone.
    """

    __slots__ = ("last_frame", "last_feat", "prev_frame", "prev_feat")

    def __init__(self, frame: int, feat: _Filament) -> None:
        self.last_frame = frame
        self.last_feat = feat
        self.prev_frame: Optional[int] = None
        self.prev_feat: Optional[_Filament] = None


def _align_endpoints(feat: _Filament, ref: _Filament) -> _Filament:
    """Return *feat* with (end_a, end_b) swapped iff that better matches
    *ref*'s endpoint labelling (minimises head-head + tail-tail distance).

    Instancer centerline direction is arbitrary and can flip frame to frame;
    without this the per-endpoint velocity would be garbage. A single
    filament-vs-filament cost is direction-invariant (min-pairing endpoints,
    ``|cos Δθ|``, and a KD-tree curve distance that does not care about vertex
    order), so aligning a stored observation never *retroactively* changes the
    cost of the link just accepted. Its effect is confined to the per-endpoint
    velocity — which does feed the next frame's predicted endpoints and
    therefore its costs; that downstream influence is the whole point.

    ``curve`` is reversed alongside the endpoints. The distance functions are
    order-independent so nothing depends on it today, but keeping
    ``curve[0] == end_a`` true means a future caller that does assume it is not
    silently wrong.
    """
    straight = float(np.linalg.norm(feat.end_a - ref.end_a)) + float(
        np.linalg.norm(feat.end_b - ref.end_b)
    )
    swapped = float(np.linalg.norm(feat.end_b - ref.end_a)) + float(
        np.linalg.norm(feat.end_a - ref.end_b)
    )
    if swapped < straight:
        vec = feat.end_a - feat.end_b
        theta = float(np.arctan2(float(vec[0]), float(vec[1])))
        # Reversing moves neither the points nor the bbox, so both stay valid.
        return feat._replace(
            curve=feat.curve[::-1].copy(),
            end_a=feat.end_b,
            end_b=feat.end_a,
            theta=theta,
        )
    return feat


def _predict_filament(state: _TrackState, target_frame: int) -> _Filament:
    """Constant-velocity prediction of a track's filament at *target_frame*.

    Endpoints are extrapolated from the last two observations and the whole
    centerline is carried along by the mean of the two endpoint displacements.
    With < 2 observations the velocity is unknown and this returns a
    zero-velocity (identity) prediction — i.e. the old memoryless behaviour, so
    the first step of a freshly-born track is never worse than before.
    """
    last = state.last_feat
    # Fall back to a zero-velocity (identity) prediction with < 2 observations
    # OR when either observation is degenerate (empty / single-point centerline
    # → zero-vector endpoints, length 0): extrapolating from a [0, 0] endpoint
    # would inject a spurious ~origin-directed velocity into the next frame.
    if (
        state.prev_feat is None
        or state.prev_frame is None
        or last.length <= 0.0
        or state.prev_feat.length <= 0.0
    ):
        return last
    dt_prev = max(state.last_frame - state.prev_frame, 1)
    step = float(target_frame - state.last_frame)
    # Cap per-endpoint extrapolation to the filament's own length (fallback
    # 20 px): an MT does not translate more than its length between adjacent
    # frames, so this bounds the damage from a single noisy velocity estimate.
    cap = max(float(last.length), 20.0)

    def _extrapolate(p_now: np.ndarray, p_then: np.ndarray) -> np.ndarray:
        disp = (p_now - p_then) / dt_prev * step
        n = float(np.linalg.norm(disp))
        if n > cap:
            disp = disp * (cap / n)
        return p_now + disp

    pred_a = _extrapolate(last.end_a, state.prev_feat.end_a)
    pred_b = _extrapolate(last.end_b, state.prev_feat.end_b)
    vec = pred_b - pred_a
    theta = float(np.arctan2(float(vec[0]), float(vec[1])))
    # Translate the centerline by the mean endpoint displacement. A rigid
    # translation is the honest model here: the endpoints tell us where the
    # filament went, not how it deformed, and inventing a deformation would
    # make the curve distance measure the invention.
    shift = 0.5 * ((pred_a - last.end_a) + (pred_b - last.end_b))
    curve = last.curve + shift if last.curve.size else last.curve
    # The curve moved, so its tree is stale and must be rebuilt.
    return last._replace(curve=curve, tree=build_tree(curve), bbox=_bbox(curve),
                         end_a=pred_a, end_b=pred_b, theta=theta)


def _shift_filament(f: _Filament, drift: np.ndarray) -> _Filament:
    """Move a filament into the previous frame's drift-free coordinates.

    Orientation and length are translation-invariant, so only the positional
    members change.
    """
    shifted = f.curve - drift if f.curve.size else f.curve
    return f._replace(
        curve=shifted,
        tree=build_tree(shifted),   # the curve moved; the old tree is stale
        bbox=_bbox(shifted),
        end_a=f.end_a - drift,
        end_b=f.end_b - drift,
    )


def _update_track_state(state: _TrackState, feat: _Filament, frame: int) -> None:
    """Extend a track with a new observation: align its endpoints to the
    previous frame and shift history."""
    aligned = _align_endpoints(feat, state.last_feat)
    state.prev_feat = state.last_feat
    state.prev_frame = state.last_frame
    state.last_feat = aligned
    state.last_frame = frame


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
    w_curve: float = 0.5,
    w_end: float = 0.3,
    w_orient: float = 0.1,
    w_len: float = 0.1,
) -> float:
    """Filament-to-filament matching cost in [0, w_curve+w_end+w_orient+w_len].

    The primary evidence is the symmetric curve-to-curve distance, which
    replaced the embedding cosine when the v5H model stopped emitting
    embeddings.

    NO HARD GATES. An earlier version of this function rejected a pair outright
    (``inf``) when the curve distance exceeded ``CURVE_SCALE_PX`` or the overlap
    fell below a floor, and argued that being unable to outbid a rejection was a
    virtue. Measured on 30 frames of a real production video (3095 polylines,
    ~103/frame), that was wrong in both directions:

    - **25.3 %** of pairs the previous embedding tracker called the same
      microtubule exceed those thresholds. Their curve-distance distribution is
      bimodal — median 2.35 px, but p90 184 px and p99 727 px — because the
      instancer re-traces a different EXTENT of the same filament from frame to
      frame. The embedding recognised those by identity; a distance gate cannot.
    - The result was **417 tracks where the embedding tracker produced 133**, a
      3.14x fragmentation. Each gate caused nearly all of it independently
      (416 with distance alone, 408 with overlap alone). Every per-track
      measurement downstream — kymograph velocity, run length, intensity over
      time — was then computed over fragments of filaments, with no error
      anywhere to show for it.

    Removing both gates brings it to 250 (1.88x). The residue is the curve term
    itself, which saturates at 1.0 beyond ``CURVE_SCALE_PX`` and so charges a
    flat 0.5 for every far pair; ``w_curve`` is the knob for that, and lowering
    it to 0.25 measured 146 (1.10x) on the same data. That weight is NOT changed
    here, because 133 is not ground truth either — the same measurement shows
    the embedding tracker linking filaments 727 px apart between adjacent
    frames, which is not physically possible for a microtubule. Both trackers
    are wrong in opposite directions and the honest number needs a validation
    set, not a fit to one video's output.

    ``inf`` survives for one case only: geometry too degenerate to compare
    (a centerline with fewer than two points), where a distance of 0 would
    otherwise read as a perfect match.

    ``overlap_fraction`` is deliberately NOT consulted. As a hard gate it caused
    the fragmentation above; folded in as a cost term instead it measured 404
    tracks at weight 0.2 (worse) or 247 at a rebalanced weight (no better than
    250), while **doubling wall-clock** — 78 s vs 41 s for 30 frames — because
    it rebuilds the two cKDTrees ``curve_distance`` has already built.
    """
    if fa.tree is None or fb.tree is None:
        return float("inf")

    # EXACT short-circuit, not a gate. ``d_curve`` saturates at 1.0 beyond
    # CURVE_SCALE_PX, and the bounding-box gap is a lower bound on the
    # curve-to-curve distance — so once the boxes are that far apart the term is
    # provably 1.0 and the two KD-tree queries cannot change the answer.
    #
    # Worth the trouble: profiling 12 real frames put 95 % of /track in this
    # function and 58 % in cKDTree.query alone (233 028 calls, two per candidate
    # pair). Most pairs in a frame are nowhere near each other.
    if _bbox_gap(fa.bbox, fb.bbox) >= CURVE_SCALE_PX:
        d_curve = 1.0
    else:
        d_curve_px = curve_distance_prebuilt(fa.curve, fa.tree, fb.curve, fb.tree)
        if not np.isfinite(d_curve_px):
            return float("inf")
        d_curve = float(min(1.0, d_curve_px / CURVE_SCALE_PX))
    d_end, d_orient, d_len = _geom_terms(fa, fb, img_diag)
    return float(
        w_curve * d_curve + w_end * d_end + w_orient * d_orient + w_len * d_len
    )


def _build_link_cost(
    prev_feats: List[_Filament],
    nxt_feats: List[_Filament],
    img_diag: float,
    weights: tuple[float, float, float, float],
) -> np.ndarray:
    """Dense ``P × Q`` base cost matrix of filament costs.

    ``inf`` marks a gated-out pair (degenerate geometry -- see
    ``_filament_cost``). The neutral-median machinery the embedding cost
    needed is gone: geometry is always available, so there is no
    missing-evidence case to degrade for.

    VECTORIZED, and NOT by re-deriving the maths: every number here is the
    exact quantity ``_filament_cost``/``_geom_terms`` compute, just produced
    without a P*Q nested Python loop and without rebuilding a cKDTree per
    pair (that part was already fixed -- see ``_Filament.tree``).

    - ``d_end``/``d_orient``/``d_len`` depend only on each filament's own
      (end_a, end_b, theta, length), so they broadcast trivially over numpy
      arrays shaped (P, 1, 2) x (1, Q, 2) etc.
    - The bbox-gap EXACT short-circuit (see ``_filament_cost``) also
      broadcasts trivially, and gates which cells need a real curve
      distance at all.
    - The curve distance is the part that does not broadcast (it is a
      per-curve cKDTree query), so instead of querying pointwise it is
      BATCHED: for a fixed column j, every candidate row i's curve points
      are queried against ``nxt_feats[j].tree`` in ONE ``cKDTree.query``
      call (and symmetrically for a fixed row i against ``prev_feats[i]``'s
      tree). A KD-tree's per-point answer does not depend on what else was
      queried alongside it, so this changes nothing about what gets
      computed -- it changes cKDTree.query call count from up to ``2*P*Q``
      to ``P + Q``.

    Profiling put 95% of ``/track`` inside the nested-loop version of this
    function and 58% inside ``cKDTree.query`` alone -- at the real filament
    counts here (mean 61.2/frame, p95 134, max 311) that is up to ~193 000
    calls whose FIXED per-call dispatch overhead dominates, not the O(K)
    distance math each one does. Measured end to end on two real adjacent
    frames of a 15-frame production video (project
    d567956b-145a-4fd2-8fa9-ee00c603bb23, 283/311/303 polylines):
    283x311 pairs 2.10s -> 0.13s (16.5x), 311x303 pairs 3.54s -> 0.15s
    (24.0x) -- see ``tests/test_tracker_cost_equivalence.py``.

    Equivalence: bit-for-bit identical to the nested-loop reference on both
    real frame pairs above. On synthetic data a handful of cells differ by
    up to 1 ULP (~2.22e-16), because ``np.linalg.norm(v)`` on a bare 1-D
    vector (what ``_geom_terms`` calls) and ``np.linalg.norm(arr, axis=-1)``
    (what the broadcast form here needs) are different numpy code paths
    -- the former dispatches to a BLAS nrm2/dot, the latter is a plain
    sum-of-squares -- and are not guaranteed bit-identical for every input.
    This is pure floating-point noise several orders of magnitude below
    anything ``cost_threshold`` distinguishes: proven via ``np.allclose``
    AND, more importantly, via an identical ``linear_sum_assignment`` result
    from ``_solve_link_lap`` at every tested ``cost_threshold`` -- checked
    across hundreds of random (P, Q) trials in the test file, never once
    flipping an assignment.
    """
    P, Q = len(prev_feats), len(nxt_feats)
    if P == 0 or Q == 0:
        return np.zeros((P, Q), dtype=np.float64)

    w_curve, w_end, w_orient, w_len = weights
    diag = max(float(img_diag), 1.0)

    # --- endpoint / orientation / length terms: pure broadcasting, exactly
    # the formulas in _geom_terms applied to every (i, j) pair at once. ---
    end_a_p = np.stack([f.end_a for f in prev_feats])  # (P, 2)
    end_b_p = np.stack([f.end_b for f in prev_feats])
    end_a_n = np.stack([f.end_a for f in nxt_feats])  # (Q, 2)
    end_b_n = np.stack([f.end_b for f in nxt_feats])
    theta_p = np.array([f.theta for f in prev_feats])
    theta_n = np.array([f.theta for f in nxt_feats])
    length_p = np.array([f.length for f in prev_feats])
    length_n = np.array([f.length for f in nxt_feats])

    p1 = np.linalg.norm(
        end_a_p[:, None, :] - end_a_n[None, :, :], axis=2
    ) + np.linalg.norm(end_b_p[:, None, :] - end_b_n[None, :, :], axis=2)
    p2 = np.linalg.norm(
        end_a_p[:, None, :] - end_b_n[None, :, :], axis=2
    ) + np.linalg.norm(end_b_p[:, None, :] - end_a_n[None, :, :], axis=2)
    d_end = np.clip(np.minimum(p1, p2) / (2.0 * diag), 0.0, 1.0)
    d_orient = np.clip(
        1.0 - np.abs(np.cos(theta_p[:, None] - theta_n[None, :])), 0.0, 1.0
    )
    denom = np.maximum(np.maximum(length_p[:, None], length_n[None, :]), 1e-6)
    d_len = np.clip(np.abs(length_p[:, None] - length_n[None, :]) / denom, 0.0, 1.0)

    # --- degenerate-geometry gate: inf wherever either tree is None,
    # exactly `if fa.tree is None or fb.tree is None: return inf`. ---
    tree_ok_p = np.array([f.tree is not None for f in prev_feats])
    tree_ok_n = np.array([f.tree is not None for f in nxt_feats])
    tree_ok = tree_ok_p[:, None] & tree_ok_n[None, :]

    # --- bbox-gap EXACT short-circuit (see _filament_cost / _bbox_gap). ---
    bbox_p = np.stack([f.bbox for f in prev_feats])  # (P, 4)
    bbox_n = np.stack([f.bbox for f in nxt_feats])  # (Q, 4)
    dr = np.maximum(
        0.0,
        np.maximum(
            bbox_p[:, None, 0] - bbox_n[None, :, 2],
            bbox_n[None, :, 0] - bbox_p[:, None, 2],
        ),
    )
    dc = np.maximum(
        0.0,
        np.maximum(
            bbox_p[:, None, 1] - bbox_n[None, :, 3],
            bbox_n[None, :, 1] - bbox_p[:, None, 3],
        ),
    )
    bbox_gap = np.hypot(dr, dc)  # (P, Q)
    candidate = tree_ok & (bbox_gap < CURVE_SCALE_PX)

    # --- curve distance: batched cKDTree.query, one call per row/column
    # instead of one call per (row, column) pair. ---
    da = np.zeros((P, Q), dtype=np.float64)
    db = np.zeros((P, Q), dtype=np.float64)
    if candidate.any():
        for j in range(Q):
            rows = np.nonzero(candidate[:, j])[0]
            if rows.size == 0:
                continue
            tree_n = nxt_feats[j].tree
            pts_list = [prev_feats[i].curve for i in rows]
            counts = np.fromiter(
                (len(pts) for pts in pts_list), dtype=np.int64, count=len(pts_list)
            )
            stacked = np.concatenate(pts_list, axis=0)
            dist, _ = tree_n.query(stacked, k=1)
            for row_pos, part in zip(rows, np.split(dist, np.cumsum(counts)[:-1])):
                da[row_pos, j] = part.mean()

        for i in range(P):
            cols = np.nonzero(candidate[i, :])[0]
            if cols.size == 0:
                continue
            tree_p = prev_feats[i].tree
            pts_list = [nxt_feats[j].curve for j in cols]
            counts = np.fromiter(
                (len(pts) for pts in pts_list), dtype=np.int64, count=len(pts_list)
            )
            stacked = np.concatenate(pts_list, axis=0)
            dist, _ = tree_p.query(stacked, k=1)
            for col_pos, part in zip(cols, np.split(dist, np.cumsum(counts)[:-1])):
                db[i, col_pos] = part.mean()

    d_curve_px = 0.5 * (da + db)
    d_curve = np.where(candidate, np.minimum(1.0, d_curve_px / CURVE_SCALE_PX), 1.0)
    # Matches `_filament_cost`'s defensive `if not np.isfinite(d_curve_px):
    # return inf`. Unreachable in practice -- tree not None already implies
    # >= 2 finite curve points, so a nearest-neighbour query can't return a
    # non-finite distance -- kept for exact behavioural parity regardless.
    invalid_curve = candidate & ~np.isfinite(d_curve_px)

    base = w_curve * d_curve + w_end * d_end + w_orient * d_orient + w_len * d_len
    base = np.where(tree_ok, base, np.inf)
    base = np.where(invalid_curve, np.inf, base)
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
    # Vectorised, and bit-identical to the P x Q Python loop this replaces:
    # C starts at BIG everywhere, so `np.where` writes back the same BIG the
    # loop left in place, and it only *selects* float64 values -- no arithmetic
    # is performed on them. At the filament counts the frame-to-frame pass
    # actually sees (mean 61/frame, p95 134, max 311 -- see _build_link_cost)
    # the loop ran up to ~97k Python iterations per frame pair, immediately
    # after the matrix was produced by fully-vectorised numpy.
    C[:, :Q] = np.where(base <= cost_threshold, base, BIG)
    C[np.arange(P), Q + np.arange(P)] = cost_threshold
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

    # Pure integer arithmetic over the tracklet list, so this is exact.
    # M is the tracklet count -- 250-417 on one real 30-frame video -- and the
    # M x M Python loop this replaces ran up to ~174k iterations to subtract
    # two ints.
    starts = np.fromiter((s.start_frame for s in segments), dtype=np.int64, count=M)
    ends = np.fromiter((s.end_frame for s in segments), dtype=np.int64, count=M)
    gap_arr = starts[None, :] - ends[:, None]
    valid = (gap_arr >= 1) & (gap_arr <= max_gap)
    np.fill_diagonal(valid, False)
    gap_arr = np.where(valid, gap_arr, 0)
    if not valid.any():
        return []

    w_curve, w_end, w_orient, w_len = weights
    BIG = 1e6
    C = np.full((M, 2 * M), BIG, dtype=np.float64)
    accept = np.zeros((M, M), dtype=bool)
    # Walk only the valid pairs. Iterating the full M x M index space and
    # testing `valid[x, y]` inside would re-pay the M^2 the vectorised `valid`
    # above just eliminated; gaps are bounded by max_gap so `valid` is sparse.
    # Order is unchanged -- argwhere yields row-major, exactly the (x, y)
    # sequence the nested loops produced -- so identical cost ties resolve the
    # same way and linear_sum_assignment sees the same matrix.
    for x, y in np.argwhere(valid):
        x, y = int(x), int(y)
        base = _filament_cost(
            segments[x].end_feat,
            segments[y].start_feat,
            img_diag,
            w_curve,
            w_end,
            w_orient,
            w_len,
        )
        if base <= cost_threshold:
            gap = int(gap_arr[x, y])
            C[x, y] = base * (1.0 + gap_penalty * (gap - 1))
            accept[x, y] = True
    C[np.arange(M), M + np.arange(M)] = cost_threshold

    row_ind, col_ind = linear_sum_assignment(C)
    merges: List[Tuple[int, int]] = []
    for r, c in zip(row_ind, col_ind):
        if c < M and accept[r, c]:
            merges.append((int(r), int(c)))
    return merges


@router.post("/track", response_model=TrackResponse)
def track(req: TrackRequest) -> TrackResponse:
    # SYNCHRONOUS on purpose. This endpoint is pure CPU numpy/scipy with no
    # awaits, and the ML service runs uvicorn with `--workers 1`. As `async def`
    # it executed on the event loop, so a multi-frame video blocked the ONLY
    # worker for the whole run — /health included, which the compose healthcheck
    # polls every 30 s with a 10 s timeout and 3 retries. A long track therefore
    # marked the container unhealthy while doing nothing wrong. Declaring it
    # `def` hands it to FastAPI's threadpool instead, so the loop stays free.
    return _track_sync(req)


def _track_sync(req: TrackRequest) -> TrackResponse:
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

    weights = (req.w_curve, req.w_end, req.w_orient, req.w_len)

    # Cache per-polyline features once so the two LAP passes never re-measure.
    feats: Dict[str, _Filament] = {}
    for f in frames:
        for p in f.polylines:
            feats[p.id] = _filament_features(p)

    # --- Step 1: frame-to-frame linking with birth/death -> tracklets ---
    # An online per-track state (last two endpoint-aligned observations) lets
    # each frame be matched against a constant-velocity *prediction* of where
    # the track's filament should be, rather than the raw previous frame — the
    # core of the propagation-aware upgrade.
    assignments: Dict[str, str] = {}
    track_state: Dict[str, _TrackState] = {}

    def _birth(pid: str, frame: int) -> str:
        tid = _new_track_id()
        assignments[pid] = tid
        track_state[tid] = _TrackState(frame, feats[pid])
        return tid

    for p in frames[0].polylines:
        _birth(p.id, frames[0].frame)

    for prev_f, next_f in zip(frames, frames[1:]):
        prev_pl, next_pl = prev_f.polylines, next_f.polylines
        # Defensive: any prev polyline without an id (e.g. after an empty
        # frame) is a fresh birth in its own frame.
        for p in prev_pl:
            if p.id not in assignments:
                _birth(p.id, prev_f.frame)
        if not next_pl:
            continue
        if not prev_pl:
            for p in next_pl:
                _birth(p.id, next_f.frame)
            continue

        if req.motion_model:
            prev_feats = [
                _predict_filament(track_state[assignments[p.id]], next_f.frame)
                for p in prev_pl
            ]
        else:
            prev_feats = [feats[p.id] for p in prev_pl]

        next_feats = [feats[p.id] for p in next_pl]

        # Stage drift moves every filament in the field at once. Folding it
        # into per-filament motion would report drift as motility — the one
        # error a gliding assay cannot tolerate — and would also push genuine
        # links past the curve-distance gate on a drifting acquisition. Recover
        # the common-mode shift and match in the drift-free frame.
        drift = estimate_drift(
            [f.curve for f in prev_feats], [f.curve for f in next_feats]
        )
        if float(np.linalg.norm(drift)) > 1e-6:
            next_feats = [_shift_filament(f, drift) for f in next_feats]

        base = _build_link_cost(
            prev_feats,
            next_feats,
            img_diag,
            weights,
        )
        links = _solve_link_lap(base, req.cost_threshold)
        linked_cols = set(links.values())
        for pi, nj in links.items():
            tid = assignments[prev_pl[pi].id]
            assignments[next_pl[nj].id] = tid
            # The UNSHIFTED observation is stored: drift is a property of the
            # comparison, not of where the microtubule actually is. Storing the
            # shifted copy would accumulate the correction across frames.
            _update_track_state(
                track_state[tid], feats[next_pl[nj].id], next_f.frame
            )
        for c, p in enumerate(next_pl):
            if c not in linked_cols:
                _birth(p.id, next_f.frame)

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
        f"{len(segments)} tracklets -> {track_count} tracks after gap closing"
    )
    # corrupt_count / degraded are structurally 0 / False since the v5H swap;
    # see TrackResponse. They stay on the wire so Node needs no coordinated
    # deploy, and are not computed because there is nothing left to compute.
    return TrackResponse(
        assignments=assignments,
        track_count=track_count,
        corrupt_count=0,
        degraded=False,
    )


# ----------------------------------------------------------------------------
#  /kymograph
# ----------------------------------------------------------------------------

# Widest band ``line_width`` may ask for. See ``_sample_line_profile`` for the
# whole method; the bound lives up here because the pydantic Field below needs
# it. 51 spans 50 px between the outermost samples.
#
# It is a GUARD RAIL, not a recommendation, and the useful range is far below
# it. Measured on frame 0 of the reference container (4972cad8, all 60
# microtubules, 1924x1476, 17 684 columns) by averaging the transverse profile
# over every column of every filament, as the fraction of the single-pixel
# contrast (centre minus background at |offset| >= 20 px) that a band of each
# width still carries:
#
#   width           1     3     5     7     9    11    15    21    51
#   IRM          100%   80%   50%   26%   10%    0%   -10%  -16%  -13%
#   488 nm       100%   96%   93%   88%   83%   79%    74%   70%   35%
#
# The two rows differ because the modalities do. In IRM a microtubule is a DARK
# core (-199 counts) inside a BRIGHT interference halo that peaks at |offset|
# 4-5 px, so widening the band first dilutes the core and then, past width 11,
# inverts its sign — a "wider = smoother" intuition is actively wrong there. In
# fluorescence the filament is a plain bright PSF and the decay is gentle, so a
# wide band costs signal slowly and buys tolerance to a centerline that is a
# pixel or two off. Sensible values are 1-5 on IRM and up to ~11 on a
# fluorescence channel; ``mt_measure``'s own band is 5. 51 is simply the point
# past which nothing on real data is still a measurement of one filament, and
# it is also 51 ``map_coordinates`` samples per column — 31.7 M per frame at
# the 2077 columns production's longest polyline spans.
_LINE_WIDTH_MAX = 51


class KymographFrameInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frame: int
    # (M, 2) row, col centerline used to sample intensity in this frame.
    polyline_rc: List[List[float]]
    image_path: str  # absolute path the ML service can read


class KymographRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    frames: List[KymographFrameInput]
    # ACCEPTED AND IGNORED since 2026-09-01. The column axis is now one column
    # per pixel of the seed polyline's arc length, always and without a ceiling
    # (see ``_seed_columns``), so there is no width left to target.
    #
    # The field stays because this model is ``extra="forbid"``: deleting it
    # would 422 every kymograph posted by a Node container that has not been
    # recreated yet, and that would make the deploy order matter. Same
    # treatment, for the same reason, as ``/track``'s ``embedding`` and
    # ``emb_template_alpha``. ``backend/src/services/kymographService.ts`` no
    # longer sends it; nothing reads it here. Delete it once no deployed Node
    # build sends it.
    target_width: int = Field(200, ge=10, le=2000)
    tracked: bool = False
    # LINE WIDTH: how many pixels WIDE the sampled line is, perpendicular to the
    # polyline. 1 is a single-pixel line profile — exactly what this endpoint
    # did before 2026-09-01 and still the default, so an omitted field renders
    # the identical kymograph. Everything about the band is in
    # ``_sample_line_profile``.
    #
    # NOT ``intensity_width``, which is a band in kymograph COLUMN space around
    # an already-detected trajectory on the finished image. This one decides
    # what the image contains in the first place.
    line_width: int = Field(1, ge=1, le=_LINE_WIDTH_MAX)
    # How the ``line_width`` samples of one column collapse to one value.
    #
    # ``mean`` is the default and is what ImageJ's own polyline tools do —
    # ``ProfilePlot``/``Straightener`` average across the width and offer no
    # choice. KymoResliceWide defaults to ``max`` instead, which is brighter on
    # a filament that wanders off the drawn line but is not comparable with an
    # ImageJ number and is biased upward by a single hot pixel. The user asked
    # for ImageJ-comparable intensities, so ``mean`` it is; ``max`` is offered
    # because KymoResliceWide's users rely on it.
    line_reduce: Literal["mean", "max"] = "mean"
    # Hex `#RRGGBB`. When supplied, the kymograph is rendered as a linear
    # black-to-color gradient (intensity → that hue) so it matches the
    # channel tint the user chose in the editor's multi-channel overlay.
    # When None, falls back to viridis (legacy behaviour).
    channel_color: Optional[str] = Field(
        None,
        pattern=r"^#[0-9A-Fa-f]{6}$",
    )
    # When True, run trajectory detection (KymoButler) on the sampled intensity
    # matrix and return one KymographTrack per moving particle (velocities in
    # px/frame — the Node backend converts to um/s with the container's
    # calibration).
    detect_velocity: bool = False
    # Which KymoButler network to run. ``bidirectional`` is the default and the
    # one to keep unless you know the movie: it is the mode with a decision
    # module, so a crossing is resolved rather than guessed, and on 10 real
    # kymographs from 4 production containers it returned 31 trajectories where
    # the DoG detector it replaced returned 29 (both after the µm/s cut-off).
    # ``unidirectional`` has no decision module — its trajectories are plain
    # 8-connected components — and on the same 10 it returned 61, of which 13
    # sat below the SNR floor the old detector enforced. It is offered because
    # KymoButler ships it for genuinely one-way movies, not because it is
    # interchangeable. It is also ~6x faster, which is not a reason to pick it.
    kymobutler_mode: Literal["bidirectional", "unidirectional"] = "bidirectional"
    # When True (with detect_velocity), also composite the detected tracks onto
    # the kymograph and return it as ``overlay_png_base64`` — used by the export
    # pipeline to ship "segmented kymograph" images without a browser.
    render_overlay: bool = False
    # Width (in kymograph position columns) of the signal band sampled around
    # each detected trajectory for the background-subtracted intensity metric.
    # NOT the kymograph's line width and not a rendering parameter at all: it is
    # read off the FINISHED kymograph by ``tracks_intensity``, as the thickness
    # of the ImageJ ``Roi.convertLineToArea`` band rasterised PERPENDICULAR to
    # each trajectory, and it also sets the reach of the background ring around
    # that band (see ``intensity_bg_margin``, which is a multiple of it).
    #
    # Default raised 3 -> 5 on 2026-09-01 at the user's request. Band and ring
    # widen together, so every ``intensity_signal`` / ``intensity_background`` /
    # ``intensity_minus_background`` in an export changes: numbers from before
    # that date are NOT comparable with later ones. 5 is also ``mt_measure``'s
    # own ``thickness_px`` default, so a trajectory and a microtubule are now
    # measured with the identical geometry in the identical numbers.
    intensity_width: int = Field(5, ge=1, le=50)
    # Half-width of the background ring drawn around that band, as a MULTIPLE of
    # it — the ring reaches ``round(intensity_width * intensity_bg_margin)``
    # pixels from the trajectory and excludes every OTHER trajectory's band, so a
    # neighbouring streak is never counted as background. Same name, same range
    # and same default as ``MTMetricsRequest.margin_multiplier``, because it is
    # the same measurement: the two must not drift into two answers to "how
    # bright is this, above what". 0 collapses the ring onto the band and so
    # reports a null background.
    #
    # Nothing sets it yet — ``backend/src/services/kymographService.ts`` builds
    # the ML request and is where a user-facing control would plumb through, the
    # same shape ``include_csv`` is in. Present here so the geometry is tunable
    # from the API without a redeploy of this service.
    intensity_bg_margin: float = Field(2.0, ge=0.0, le=10.0)
    # Container calibration. When both are present the endpoint drops tracks
    # whose |net velocity| is below ``min_net_velocity_um_s`` (non-processive /
    # oscillatory blobs) BEFORE rendering the overlay, so overlay = tracks table =
    # exported velocity CSV (this response's csv_base64 is the intensity matrix).
    pixel_size_um: Optional[float] = Field(None, gt=0)
    frame_interval_ms: Optional[float] = Field(None, gt=0)
    min_net_velocity_um_s: float = Field(0.01, ge=0.0)
    # Absolute intensity floor: drop trajectories whose
    # ``intensity_minus_bg`` (band mean minus the ring's median background) is
    # below this many RAW SAMPLE UNITS. 0 disables it, which is the default and
    # reproduces today's response exactly.
    #
    # WHY THIS FIELD AND NOT A FRACTION. The kymograph matrix is sampled at the
    # frame's native bit depth (``_decode_rows`` never converts to 8-bit) and
    # ``tracks_intensity`` measures on that raw matrix, so these numbers are
    # camera counts. The min/max normalisation further down this function
    # exists only to paint the PNG and touches nothing that is measured — which
    # is what makes an absolute cut-off meaningful here at all. By contrast a
    # threshold on the DETECTOR could not be absolute: KymoButler consumes
    # ``preprocess_array``'s row-normalised copy, whose units are arbitrary.
    #
    # WHAT IT IS NOT: comparable between channels. Measured on two production
    # containers, ``intensity_minus_bg`` runs 9-51 counts on 488 nm and 228 on
    # 640 nm of the SAME movie — subtracting the background removes the offset,
    # not the scale (dye brightness, exposure, gain). This is a per-channel
    # judgement, which is why the control sits in the modal where one channel
    # is on screen. ``snr`` is the dimensionless alternative and is already
    # reported per track.
    min_intensity_minus_bg: float = Field(0.0, ge=0.0)
    # When True, also render one matplotlib line plot per frame (intensity vs.
    # position along the microtubule) and return them as ``profiles``. A
    # kymograph IS a stack of these per-frame rows, so this reuses the exact
    # same sampled ``kymo`` matrix — the profiles are just each row drawn as a
    # 1-D plot instead of a 2-D heatmap. Used by the "intensity profiles" export
    # mode. Independent of ``detect_velocity``.
    render_profiles: bool = False
    # Build ``csv_base64``: the sampled intensity matrix, one row per frame.
    #
    # Defaults True so a caller that omits the field gets exactly today's
    # response, byte for byte. That covers the old-Node-against-new-ml
    # direction. The OTHER direction is not covered and cannot be: this model
    # is ``extra="forbid"``, so a Node container that sends ``include_csv`` to
    # an ml container which has not been recreated yet gets a 422 on every
    # kymograph. **Deploy ml before the Node caller that sets it.**
    #
    # The kymograph export mode sets it False (it writes the overlay PNG and
    # the velocity workbook and never reads the matrix); the profiles export
    # and the interactive modal leave it on. It is worth more since the column
    # cap was removed on 2026-09-01, because the matrix is O(frames x columns)
    # at ~8 B per value: on the 299-frame container above it was 469 KB raw /
    # 626 KB base64 at 200 columns and is 2.9 MB / 3.9 MB at the 1251 columns
    # that microtubule actually spans. Still worth turning off for the modal,
    # which re-requests a kymograph on every channel switch and every
    # ``intensity_width`` nudge but only reads the CSV when the user clicks
    # download — and ``KymographServiceResult.csvBase64`` must become
    # `string | null` in the same change, or a null reaches the download handler.
    include_csv: bool = True


class KymographTrack(BaseModel):
    """One moving particle detected on the kymograph.

    Per-run detail is deliberately omitted: the run segmentation is internal to
    ``detect_tracks`` and surfaces only as the two processive totals below.
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


class ProfilePng(BaseModel):
    """One per-frame intensity profile rendered as a matplotlib line plot."""

    model_config = ConfigDict(extra="forbid")

    frame: int
    png_base64: str


class KymographResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    png_base64: str
    # The sampled intensity matrix as base64 CSV. None ONLY when the request set
    # ``include_csv=False`` — never as a degraded fallback, so a caller that
    # asked for the CSV and got None has hit a bug, not an empty kymograph (an
    # empty one would still carry its header row). Not "" for the same reason:
    # an empty string would download as a zero-byte file instead of failing.
    csv_base64: Optional[str] = None
    frame_count: int
    length_px: int
    tracked: bool
    # Image pixels per kymograph column (= seed arc length / (length_px-1)).
    # Since the column cap was removed (2026-09-01) this is 1.0 to within the
    # rounding of ``round(arc)+1``, i.e. |1 - px_per_column| < 1/(2·arc) — never
    # exactly 1.0, and never compressed either. It stays on the wire because it
    # is still the correct conversion, because dropping it would change the
    # response shape for no gain, and because it is the one number that would
    # move again if the column rule ever changed. The Node backend multiplies
    # column-space velocities + run displacements by it before applying the µm
    # calibration.
    px_per_column: float = 1.0
    # How many detected tracks were dropped by the net-velocity cut-off. Lets the
    # caller distinguish "hidden as non-processive" from "nothing detected".
    filtered_track_count: int = 0
    # How many were dropped by ``min_intensity_minus_bg``. SEPARATE from the
    # velocity count on purpose: the UI names the reason, and one number for
    # two different cut-offs would make it name the wrong one.
    filtered_dim_track_count: int = 0
    # Populated only when the request set ``detect_velocity``; otherwise None.
    tracks: Optional[List[KymographTrack]] = None
    # Populated only when ``render_overlay`` was set; base64 PNG of the
    # kymograph with detected tracks drawn on top.
    overlay_png_base64: Optional[str] = None
    # Set to a non-empty string when velocity detection crashed unexpectedly.
    # An empty/absent field means detection either succeeded or was not requested.
    # Distinguishes "no motility detected" (tracks=[]) from "detection crashed".
    velocity_error: Optional[str] = None
    # Populated only when ``render_profiles`` was set: one matplotlib line plot
    # (intensity vs. position) per frame, in frame order. None otherwise, or if
    # the (optional) profile render failed — the base kymograph is never blocked.
    profiles: Optional[List[ProfilePng]] = None


# Upper bound on the items of ONE batch.
#
# The export caps a container at 60 microtubules
# (``MAX_MT_PER_CONTAINER`` in ``mtKymographExporter.ts``) and sends one batch
# per (container, channel), so 64 covers that with headroom. The decode side
# does NOT scale with items (that is the point of the endpoint); only the
# response does.
_BATCH_MAX_ITEMS = 64

# Upper bound on the OUTPUT of one batch, as summed kymograph pixels
# (frames x columns over the items). This is the bound that actually holds the
# response down; ``_BATCH_MAX_ITEMS`` no longer can.
#
# It used to. Until 2026-09-01 every kymograph was at most ``target_width=200``
# columns wide, so "64 items" and "64 x 300 x 200 output pixels" were the same
# statement and the comment here sized the response as 64 x (128 KB PNG +
# 128 KB overlay) ~ 16 MB. With the cap gone a kymograph is as wide as its
# microtubule is long — 2077 columns for the longest one in production — so the
# item count bounds nothing.
#
# 3 840 000 = 64 items x 300 frames x 200 columns is deliberately the SAME
# envelope that sentence described, re-expressed in the unit that now varies.
# Measured bytes per output pixel on real production frames (container
# 4972cad8, 299 frames, channel 488_nm, and container 1b000528, 35 frames, IRM),
# rendering both the capped and the uncapped width of the same microtubule:
#
#   PNG      1.40 - 1.97 B/px      overlay PNG   1.60 - 1.61 B/px
#   CSV      ~8 B/px (the intensity matrix, only with ``include_csv``)
#
# So at this budget: PNG + overlay <= 4 B/px = 15.4 MB, x4/3 for base64 = 20 MB
# on the wire, and ~41 MB more if the caller leaves ``include_csv`` on. Both
# match the old sizing to within the estimate it was built on.
#
# Checked against every microtubule container in production (60 of them, up to
# 300 frames): the largest batch the export builds TODAY is 3 596 700 px, i.e.
# nothing that fits in one request now starts splitting. Uncapped, two
# containers exceed the budget (7 977 000 and 5 305 200 px) and split into 3 and
# 2 requests; the other 58 still travel in one.
#
# A batch of ONE is exempt: ``/kymograph`` renders any single kymograph without
# a size bound, and making the batch endpoint refuse work its un-batched
# equivalent accepts would cost that microtubule its kymograph outright. The
# bound exists to stop N items multiplying, not to forbid a long movie.
_BATCH_MAX_OUTPUT_PIXELS = 3_840_000


class KymographBatchRequest(BaseModel):
    """N kymographs in one request, so each frame is decoded ONCE for all of
    them instead of once per (microtubule x channel).

    ``items`` are plain ``KymographRequest`` bodies, unchanged and independent
    — the batch is a transport, not a new rendering mode. That is deliberate:
    it keeps every render parameter per-item (two microtubules of one container
    have different ``n_samples``, and a caller may mix channels), and it makes
    the equivalence with the single endpoint checkable by construction — the
    bodies a batch carries are byte-for-byte the bodies the un-batched export
    posted one at a time.

    Nothing requires the items to share frames; the dedup is over the stat
    identity of each ``image_path``, so items that share none simply decode
    everything and cost exactly what N separate requests would.

    Two bounds apply, and only the second one still bounds the response:
    ``_BATCH_MAX_ITEMS`` here, and ``_BATCH_MAX_OUTPUT_PIXELS`` in the handler
    (a schema validator cannot express it — it needs each item's seed arc
    length, and it must exempt a single item).
    """

    model_config = ConfigDict(extra="forbid")

    items: List[KymographRequest] = Field(
        ..., min_length=1, max_length=_BATCH_MAX_ITEMS
    )


class KymographBatchItem(BaseModel):
    """One item's outcome. Exactly one of the two fields is set.

    Errors are per item on purpose. The un-batched export ran one HTTP request
    per microtubule and caught failures individually, so one polyline with a
    single vertex — or one channel missing a frame PNG, which is real: on
    container 4972cad8 the IRM channel is missing frame 299 — cost that
    microtubule its kymograph and nothing else. Failing the whole batch would
    turn that into "the container exported no kymographs at all".
    """

    model_config = ConfigDict(extra="forbid")

    kymograph: Optional[KymographResponse] = None
    error: Optional[str] = None


class KymographBatchResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # One entry per request item, in request order.
    results: List[KymographBatchItem]


def _arc_length_resample_polyline(
    pts_rc: np.ndarray, n_samples: int
) -> np.ndarray:
    """Resample a polyline to ``n_samples`` arc-length-uniform points.

    Mirrors ImageJ's ``PolygonRoi.getEquidistantPoints`` (``PolygonRoi.java``
    L1035-1036): ``round(L) + 1`` points at a fixed arc-length step, with the
    LAST point forced onto the polyline's endpoint. ``_seed_columns`` supplies
    exactly that count, so the step here is 1.0 px to within its rounding.

    It is NOT ``Roi.getInterpolatedPolygon(step, smooth=false)`` (``Roi.java``
    L686-711), which the docstring claimed until 2026-09-01. That one is a
    chord walk: it steps along the polyline emitting a point whenever the
    remaining distance to the next vertex falls below the step, and for an open
    polyline it DROPS the endpoint (it stops at the last full step and appends
    nothing). The code below has always forced the endpoint via
    ``np.linspace(0, total, n)``, i.e. it has always been the other method. The
    CODE is right and the citation was wrong — do not "fix" the code to match
    the old comment.

    Either way the result has uniform spatial spacing, so a kymograph row built
    from it preserves "column N = the same fractional position along the
    microtubule" across frames (the property a biologist expects from an
    ImageJ-style kymograph).
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


def _band_normals_rc(pts_rc: np.ndarray) -> np.ndarray:
    """Unit normals of a resampled polyline, one per point, in (row, col).

    Transcribed from KymoResliceWide's ``processWideLine``
    (``UU-cellbiology/KymoResliceWide`` @ 506760c4, L843-914): the tangent at
    column k is the BACKWARD difference ``p[k] - p[k-1]`` of consecutive
    resampled points, normalised, then rotated ``(dx, dy) -> (-dy, dx)``.
    Column 0 has no predecessor and uses the forward difference instead.

    The points here are (row, col) and the reference is (x, y) = (col, row), so
    that rotation is ``(tr, tc) -> (tc, -tr)``. It is the same 90 degrees with
    the opposite handedness, which cannot matter: the offsets applied along the
    normal are symmetric about 0 and both reductions (mean, max) are order-
    invariant, so flipping the normal permutes the band's samples and returns
    the identical value.

    A zero-length tangent yields a zero normal, which collapses the band onto
    the centre point. That can only happen for a polyline of zero total arc
    length, which ``_arc_length_resample_polyline`` has already degenerated to
    a single repeated point — there is no band to draw across a point, and a
    row of the centre value is the honest answer.
    """
    tangents = np.diff(pts_rc, axis=0, prepend=pts_rc[:1])
    if tangents.shape[0] > 1:
        # Column 0's backward difference is the zero vector (prepend of itself);
        # ImageJ's forward-difference special case replaces it.
        tangents[0] = tangents[1]
    norms = np.linalg.norm(tangents, axis=1, keepdims=True)
    unit = tangents / np.where(norms > 0.0, norms, 1.0)
    # (tr, tc) -> (tc, -tr). Perpendicular by construction: the dot product with
    # the tangent is tr*tc + tc*(-tr) = 0 exactly, at any angle.
    return np.stack([unit[:, 1], -unit[:, 0]], axis=1)


def _sample_line_profile(
    img: np.ndarray,
    pts_rc: np.ndarray,
    line_width: int,
    line_reduce: str,
) -> np.ndarray:
    """One kymograph row: intensity along ``pts_rc``, averaged across a band
    ``line_width`` pixels wide, perpendicular to the line.

    The recipe is KymoResliceWide's ``getIrregularProfileWide`` (L679-824) plus
    ``processWideLine`` (L843-914), with two deliberate deviations noted below.
    Sampling is BILINEAR with zero fill outside the image, which is what every
    polyline path in ImageJ does — ``ImageProcessor.getInterpolatedValue``
    (``ij/process/ImageProcessor.java`` L2005-2013) is bilinear, and
    ``ProfilePlot``, ``Straightener`` and KymoResliceWide all call it.
    Nearest-neighbour was the outlier here; only KymographBuilder uses it.

    1. ``_arc_length_resample_polyline`` has already put the points at a
       uniform ~1.0 px arc-length step, continuous across vertices. (The
       reference walks the polyline carrying the fractional remainder from one
       segment into the next; resampling the whole arc at once is the exact
       version of the same thing.)
    2. Normals from ``_band_normals_rc``.
    3. ``line_width`` samples at 1.0 px spacing, offsets ``-(w-1)/2 ...
       +(w-1)/2``. **Deviation:** ``(w-1)/2`` for BOTH parities, which is
       ImageJ ``Straightener``'s convention (``Straightener.java`` L181-182).
       KymoResliceWide uses an asymmetric ``w/2`` that puts an even-width band
       0.5 px off-centre. Note the consequence: "width 5" spans 4 px between
       the outermost samples, not 5.
    4. Bilinear sample, zero fill.
    5. Reduce with mean (default) or max.

    Two things NONE of the reference implementations handle, matched here
    anyway because matching them is the point:

    - **Sharp vertices are not mitred.** On the outside of a corner the fan of
      normals leaves an unsampled wedge; on the inside the bands of successive
      columns overlap and the same pixels are counted twice. ImageJ, Multi
      Kymograph and KymoResliceWide all do exactly this. ImageJ's own answer to
      it is NOT copied: ``Straightener.straightenLine`` unconditionally calls
      ``fitSplineForStraightening()`` (``Straightener.java`` L149) and
      ``ProfilePlot`` routes every width>1 polyline through it
      (``ProfilePlot.java`` L74-79), silently replacing the drawn polyline with
      a natural cubic spline. Measured on realistic shapes, that spline leaves
      the drawn path by 5.77 px (+3.0 % arc length) on a right angle and
      4.99 px (+2.3 %) on an MT-like wiggle — a path error larger than the band
      it is smoothing, which disqualifies it for filament measurement.
    - **Out-of-image samples are zeros and are counted in the mean.** A band
      overhanging the frame border is therefore biased toward zero, in
      proportion to how much of it is outside. Same ``mode="constant",
      cval=0.0`` the single-line path has used since edge-clamping was found to
      falsely brighten polylines crossing the border; extending it across the
      width keeps one rule rather than two.

    Multi Kymograph's width is deliberately NOT a model: its ``Linewidth`` adds
    the offset to x and to y IDENTICALLY (``MultipleKymograph_.java`` L150-151,
    L299-302), i.e. a fixed 45 degree diagonal shift with no normal computed
    anywhere, and it mutates the caller's ROI in place so the offsets
    accumulate (``linewidth=3`` samples -1, -1, 0). It is broken.
    """
    from scipy.ndimage import map_coordinates

    rows = pts_rc[:, 0].astype(np.float64)
    cols = pts_rc[:, 1].astype(np.float64)
    if line_width > 1:
        normals = _band_normals_rc(pts_rc.astype(np.float64))
        offsets = (
            np.arange(line_width, dtype=np.float64) - (line_width - 1) / 2.0
        )[:, None]
        rows = rows[None, :] + offsets * normals[None, :, 0]
        cols = cols[None, :] + offsets * normals[None, :, 1]
    # order=1 = bilinear. This was order=0 (nearest) until 2026-09-01, under a
    # comment claiming it matched "ImageJ's getInterpolatedValue zero-fill".
    # Only the zero-fill half of that was ever true: getInterpolatedValue
    # (ij/process/ImageProcessor.java L2005-2013) is BILINEAR, and so is every
    # ImageJ polyline path that calls it.
    #
    # It changes every number in every kymograph, so: measured on frame 0 of
    # container 4972cad8, all 60 microtubules, 17 684 columns per channel, as
    # |bilinear - nearest| against the frame's own full range —
    #
    #   IRM      mean 0.59 % of range (68.6 counts), p95 1.62 %, max 3.86 %
    #   488 nm   mean 0.09 %  ( 6.0 counts), p95 0.24 %, max 12.04 %
    #   640 nm   mean 0.17 %  ( 5.4 counts), p95 0.45 %, max  8.12 %
    #
    # and 99.5-99.9 % of columns move at all. The mean is small; the max is
    # not, and it lands exactly where a kymograph is read — a punctate spot,
    # where nearest snaps to whichever pixel centre happens to be closest and
    # so makes a moving particle's intensity flicker with sub-pixel position.
    #
    # mode='constant', cval=0 keeps the zero-fill: pixels outside the image
    # read as 0 rather than edge-clamping, which falsely brightened polylines
    # that crossed the frame border.
    profile = map_coordinates(
        img,
        np.stack([rows.ravel(), cols.ravel()]),
        order=1,
        mode="constant",
        cval=0.0,
    )
    if line_width > 1:
        band = profile.reshape(line_width, -1)
        profile = band.max(axis=0) if line_reduce == "max" else band.mean(axis=0)
    return profile.astype(np.float32)


# ----------------------------------------------------------------------------
#  Frame sampling: the 14 000x read amplification, and what to cache
# ----------------------------------------------------------------------------
#
# Measured on a real 300-frame container (CH5_DO4 / 4972cad8, 1924x1476 16-bit
# IRM PNGs, 4.24 MB each) while the column axis was still capped at 200:
#
#   bytes read per kymograph   1267 MB
#   pixels actually used         59 800  (200 per frame)  -> 14 199x amplified
#   PIL open                      0.05 s
#   full-frame decode             9.48 s  (99% of the sampling loop)
#   polyline resample             0.06 s
#   map_coordinates               0.02 s
#   whole sampling loop           9.62 s
#
# Two things follow, and they are the whole design of this section.
#
# 1. CACHE THE SAMPLED ROW, NOT THE DECODED FRAME. The 299 rows of that
#    request are 233.6 KB in total; the 299 decoded frames are 3.4 GB (11.36 MB
#    each as float32), against a 12 GB container limit shared with seven
#    segmentation models. A frame cache small enough to fit would also be
#    USELESS rather than merely small: a kymograph is a strict sequential scan
#    of every frame, so an LRU shorter than the scan evicts each entry before
#    the next request reaches it again and returns a 0% hit rate while still
#    holding the memory. The row cache has no such failure mode — an entire
#    request's working set is a quarter of a megabyte.
#
#    What it buys: a repeat of the same geometry (reopening the modal, toggling
#    velocity detection, nudging `intensity_width`, exporting after viewing)
#    skips the decode entirely. What it does NOT buy: a different microtubule,
#    or the same one on another channel, is a different key and pays the cold
#    cost. That is why (2) and (3) exist.
#
# 2. DECODE IN PARALLEL. Pillow releases the GIL inside the PNG decoder, so the
#    cold path is thread-scalable. Measured on 60 of the frames above, inside
#    the ml container's 4-CPU quota:
#
#      serial   1.999 s   x2  1.126 s   x4  0.559 s   x8  0.631 s   x12  0.762 s
#
#    3.58x at four threads, then it turns over — there are only four CPUs, and
#    oversubscription costs more than it wins. cv2.imread was measured on the
#    same frames (2.079 s serial, 0.832 s at x4) and is no faster than Pillow,
#    so the hot path keeps the decoder it already had.
#
# 3. SAMPLE MANY POLYLINES PER DECODE. (1) and (2) make ONE kymograph as cheap
#    as it can be; they do nothing about the export, which builds one per
#    (microtubule x channel) over the SAME frames. Every lookup misses, because
#    every job has a different polyline and the key carries its digest. Real
#    production export, 2026-09-01: 61 requests, 0 frames from cache, 69
#    decoded — the cache was doing nothing at all for it.
#
#    ``/kymograph/batch`` inverts the loop instead: decode a frame once and
#    sample every polyline that wants a row from it before moving on. That is
#    O(1) frames resident in the number of polylines, which no LRU can be —
#    an LRU has to hold the entire working set to score its first hit, and here
#    the working set is 3.4 GB. Measured 2026-09-01 on 60 microtubules x 300
#    frames of container 4972cad8 (channel 488_nm, velocity detection and
#    overlay on, cold row cache both times):
#
#      60 requests   18 000 decodes   186.2 s   peak RSS 1.146 GiB
#       1 request       300 decodes    13.2 s   peak RSS 1.381 GiB
#
#    14.1x, and the +235 MB of peak is the 29 MB request body and 36 MB
#    response as Python objects — NOT frames. Frames resident stay at one per
#    decode thread whether the batch carries 1 polyline or 60.
#
# The pool is capped rather than sized to the machine because the cap is the
# container's CPU quota (`cpus: '4.0'` in docker-compose.production.yml), and
# because this card is shared with the essays worker and Maptimize.

_DECODE_WORKERS_CAP = 4


def _decode_workers() -> int:
    """Threads used to decode frame PNGs for one kymograph.

    ``KYMOGRAPH_DECODE_WORKERS`` overrides it; 1 serialises the decodes again
    (still on the pool — see ``_run_row_jobs`` for why inline is worse).
    """
    override = os.getenv("KYMOGRAPH_DECODE_WORKERS", "").strip()
    if override:
        try:
            return max(1, min(_DECODE_WORKERS_CAP, int(override)))
        except ValueError:
            logger.warning(
                "KYMOGRAPH_DECODE_WORKERS=%r is not an integer; using the default",
                override,
            )
    try:
        cpus = len(os.sched_getaffinity(0))  # respects a cpuset, unlike cpu_count
    except AttributeError:  # pragma: no cover - non-Linux
        cpus = os.cpu_count() or 1
    return max(1, min(_DECODE_WORKERS_CAP, cpus))


_DECODE_WORKERS = _decode_workers()
_DECODE_POOL = ThreadPoolExecutor(
    max_workers=_DECODE_WORKERS, thread_name_prefix="kymo-decode"
)

# Per-entry cost of the LRU beyond the row's own bytes: the OrderedDict link,
# the 6-tuple key with its 16-byte digest, and the ndarray object header.
# Measured with tracemalloc over 20 000 entries of 200 columns: 391.5 B on top
# of an 800 B row. Rounded up. Counting it matters — at the MEDIAN production
# microtubule (118 px of arc, so 119 columns / 476 B) it is nearly half of what
# the entry actually holds, so a budget that counted only the rows would be out
# by that much.
_ENTRY_OVERHEAD_BYTES = 400

_DEFAULT_SAMPLE_CACHE_MB = 64


def _sample_cache_budget_bytes() -> int:
    """Byte budget for the row cache, sized to the working set rather than to a
    guess about frames — the mistake commit 24434138 fixed in the editor's
    decode cache, where a constant chosen for one channel silently evicted a
    three-channel window on every frame.

    Here the working set is explicit, and since 2026-09-01 it scales with the
    microtubule's length rather than sitting at a fixed 200 columns. At the
    MEDIAN production microtubule (118 px of arc -> 119 columns) a 300-frame
    kymograph is 300 x (476 + 400) B = 257 KB, so 64 MB holds ~261 of them —
    every microtubule of a dense frame, on all three channels, several times
    over. At the LONGEST one in production (2076 px -> 2077 columns) an entry is
    8.5 KB and the budget still holds ~25 full-length kymographs.

    ``KYMOGRAPH_SAMPLE_CACHE_MB`` overrides it. A malformed value must not take
    the module's import down with it: this endpoint is registered by
    ``api.main``, so a typo in the compose file would stop the whole ml service
    rather than one route.
    """
    raw = os.getenv("KYMOGRAPH_SAMPLE_CACHE_MB", "").strip()
    megabytes = _DEFAULT_SAMPLE_CACHE_MB
    if raw:
        try:
            megabytes = max(1, int(raw))
        except ValueError:
            logger.warning(
                "KYMOGRAPH_SAMPLE_CACHE_MB=%r is not an integer; using %d MB",
                raw,
                _DEFAULT_SAMPLE_CACHE_MB,
            )
    return megabytes * 1024 * 1024


class _SampledRowCache:
    """Bounded, byte-accounted LRU of sampled kymograph rows.

    Keyed on ``(st_dev, st_ino, st_mtime_ns, st_size, n_samples, geometry)``.

    The file half of that key is the stat identity rather than the path string,
    because the bytes are what the row depends on: two spellings of one frame
    (or a hard link) must hit, and a REWRITTEN frame must miss. Frame PNGs are
    not immutable — ``drift_correction.correct_drift_in_place`` rewrites them
    on disk after extraction, and ``add_channel_align`` writes new ones — so
    "extracted once, never touched" would be a wrong assumption to cache on.
    Size alone would not catch a re-registration that happens to re-compress to
    the same length; mtime at nanosecond resolution does.

    The geometry half is a digest of the request's polyline bytes together with
    ``n_samples``, which are the only other inputs to a row: the resample is a
    pure function of the two.

    ``n_samples`` earns its place in the key even though it is now derived from
    geometry, because it is derived from the SEED frame's geometry — not from
    this row's. Two requests can carry a byte-identical polyline for frame 7
    and still want different row lengths for it, because their frame 0 polylines
    differ. Drop ``n_samples`` from the key and the second request is served the
    first one's row at the wrong length.
    """

    def __init__(self, budget_bytes: int) -> None:
        self._budget = budget_bytes
        self._lock = threading.Lock()
        self._entries: "OrderedDict[Tuple[Any, ...], np.ndarray]" = OrderedDict()
        self._bytes = 0
        self.hits = 0
        self.misses = 0
        self.evictions = 0

    @staticmethod
    def _cost(row: np.ndarray) -> int:
        return int(row.nbytes) + _ENTRY_OVERHEAD_BYTES

    def get(self, key: Tuple[Any, ...]) -> Optional[np.ndarray]:
        with self._lock:
            row = self._entries.get(key)
            if row is None:
                self.misses += 1
                return None
            self._entries.move_to_end(key)
            self.hits += 1
            return row

    def put(self, key: Tuple[Any, ...], row: np.ndarray) -> None:
        cost = self._cost(row)
        if cost > self._budget:
            return
        with self._lock:
            previous = self._entries.pop(key, None)
            if previous is not None:
                self._bytes -= self._cost(previous)
            self._entries[key] = row
            self._bytes += cost
            while self._bytes > self._budget:
                _, evicted = self._entries.popitem(last=False)
                self._bytes -= self._cost(evicted)
                self.evictions += 1

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._bytes = 0

    def stats(self) -> Dict[str, int]:
        with self._lock:
            return {
                "entries": len(self._entries),
                "bytes": self._bytes,
                "budget_bytes": self._budget,
                "hits": self.hits,
                "misses": self.misses,
                "evictions": self.evictions,
            }


_SAMPLE_CACHE = _SampledRowCache(_sample_cache_budget_bytes())

# One decoded frame per decode thread, kept alive until that thread decodes the
# next one. Not a cache — nothing ever reads it — it exists only to stop glibc
# handing 11 MB back to the kernel between frames.
#
# The loop this replaced held `img` across iterations by accident of being a
# loop, so a new frame was always allocated while the previous one was still
# live: the allocator kept a free block of exactly the right size and reused it
# in place. Decoding in a function frees the block at every return, glibc trims
# it, and the next frame faults its 2775 pages back in one at a time. Measured
# over 299 real frames, that difference is 822 839 minor faults and 1.74 s of
# system time per request against 5 312 faults and 0.24 s.
#
# The cost is memory the allocator now keeps instead of returning: measured
# over three consecutive cold kymographs of different microtubules, RSS
# plateaus at 286 MB against 147 MB without this line and 158 MB before the
# whole change. Flat across all three requests — it is one frame per thread
# plus the arena high-water mark, not a leak. ~128 MB against the ml service's
# 12 GB limit, to stop paying 1.4 s of kernel time on every kymograph, and the
# export path fans one request out over every microtubule in the container.
#
# The tidier-looking version — keep ONE buffer per thread and decode into it
# with np.copyto — was measured and is worse on both axes (1 045 690 faults,
# 1.63 s sys, 190 MB): Pillow still allocates and frees its own decode buffer
# per frame, so the churn survives and the extra copy is pure cost.
_DECODE_SCRATCH = threading.local()


class _RowJob(NamedTuple):
    """One kymograph row that still has to be read off a decoded frame.

    ``item`` indexes the kymograph being built (always 0 outside a batch),
    ``row`` its frame. ``file_key`` is the stat identity of the PNG — the same
    identity ``_SampledRowCache`` keys on, so two spellings of one frame (or a
    hard link) group onto one decode and a rewritten frame does not.

    ``line_width`` / ``line_reduce`` travel WITH the job rather than being read
    off the request in ``_sample_frame_rows``, because a batch groups jobs from
    different items onto one decode and two items may ask for different bands
    of the same frame. They are in ``cache_key`` for the same reason.
    """

    item: int
    row: int
    path: Path
    file_key: Tuple[Any, ...]
    pts: np.ndarray
    n_samples: int
    cache_key: Tuple[Any, ...]
    line_width: int = 1
    line_reduce: str = "mean"


def _sample_frame_rows(path: Path, jobs: List[_RowJob]) -> List[np.ndarray]:
    """Decode one frame ONCE and read every job's intensity profile off it.

    This is the whole point of the batch endpoint. The export builds one
    kymograph per (microtubule x channel) and every one of them reads the same
    frames, so decoding per row made a 300-frame, 3-channel, 60-microtubule
    container do 54 000 decodes of 900 distinct files. Decoding per FILE and
    sampling every polyline that wants a row from it makes that 900 — and the
    memory stays one frame per decode thread however many polylines are in
    flight, which is what no LRU of decoded frames can offer (it would need the
    whole 300-frame, 3.4 GB working set resident before it scored a hit).

    Runs on the decode pool, so it must touch no shared state. The returned
    rows are frozen read-only: they are handed straight into the cache, and
    ``np.stack`` copies them into the kymograph matrix, so nothing downstream
    has a reason to write through one — an accidental write should raise rather
    than corrupt every later request that reads the same entry.
    """
    from PIL import Image as PILImage

    # Load at native bit depth. convert('L') would force 8-bit and lose
    # half the dynamic range of 16-bit microscopy frames.
    pil_frame = PILImage.open(path)
    if pil_frame.mode in ('I;16', 'I;16B', 'I;16L', 'I', 'F'):
        img = np.array(pil_frame, dtype=np.float32)
    else:
        img = np.array(pil_frame.convert("L"), dtype=np.float32)
    _, _ = img.shape
    rows: List[np.ndarray] = []
    for job in jobs:
        # Step 1 (ImageJ-style): resample the polyline geometry to
        # ``n_samples`` arc-length-uniform points. This is THE change
        # that makes the kymograph spatially honest — vertex-only
        # sampling was aliasing punctate signal between vertices.
        sampled_pts = _arc_length_resample_polyline(job.pts, job.n_samples)
        # Step 2: read the image along those points — one bilinear sample per
        # column at line_width 1, a band of them reduced to one value above it.
        # See ``_sample_line_profile``.
        row = _sample_line_profile(
            img, sampled_pts, job.line_width, job.line_reduce
        )
        row.setflags(write=False)
        rows.append(row)
    # See _DECODE_SCRATCH: hold this frame until the next one on this thread
    # has been allocated, so the allocator reuses the block instead of
    # returning it to the kernel and re-faulting every page.
    _DECODE_SCRATCH.previous_frame = img
    return rows


def _plan_rows(
    frames: List[KymographFrameInput],
    n_samples: int,
    item: int = 0,
    line_width: int = 1,
    line_reduce: str = "mean",
) -> Tuple[List[Optional[np.ndarray]], List[_RowJob], int]:
    """Resolve every row of ONE kymograph to a finished row or a decode job.

    Returns ``(rows, jobs, hits)``; ``rows[i]`` is None exactly where ``jobs``
    carries an entry for row ``i``.

    Validation (path guard, existence, polyline shape) stays SERIAL and in
    request order, so a bad frame produces the same error, naming the same
    frame, as it did when the whole loop was serial. Only cache misses become
    jobs, so a fully warm kymograph never reaches the decode pool.
    """
    rows: List[Optional[np.ndarray]] = [None] * len(frames)
    jobs: List[_RowJob] = []
    hits = 0

    for i, frame in enumerate(frames):
        path = Path(frame.image_path)
        _assert_safe_path(path, "image_path")
        try:
            st = os.stat(path)
        except OSError:
            raise HTTPException(
                status_code=404,
                detail=f"Frame image missing: {frame.image_path}",
            )
        pts = np.asarray(frame.polyline_rc, dtype=np.float32)
        if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2:
            logger.warning(
                "kymograph: frame %s polyline has <2 points; row filled with zeros",
                frame.frame,
            )
            rows[i] = np.zeros(n_samples, dtype=np.float32)
            continue
        file_key = (st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size)
        # Every input the sampled row depends on. ``line_width`` and
        # ``line_reduce`` joined it on 2026-09-01: without them, asking for the
        # same microtubule at width 5 would be served the width-1 row.
        cache_key = (
            *file_key,
            n_samples,
            line_width,
            line_reduce,
            hashlib.blake2b(pts.tobytes(), digest_size=16).digest(),
        )
        cached = _SAMPLE_CACHE.get(cache_key)
        if cached is not None:
            rows[i] = cached
            hits += 1
        else:
            jobs.append(
                _RowJob(
                    item,
                    i,
                    path,
                    file_key,
                    pts,
                    n_samples,
                    cache_key,
                    line_width,
                    line_reduce,
                )
            )

    return rows, jobs, hits


def _run_row_jobs(
    jobs: List[_RowJob], rows_by_item: List[List[Optional[np.ndarray]]]
) -> int:
    """Decode every distinct frame the jobs name ONCE, fill their rows in
    place, and return how many frames were decoded.

    Grouping is by ``file_key`` (stat identity) rather than by path string, so
    the dedup is over the BYTES the rows depend on — the same reasoning as the
    row cache's key.
    """
    if not jobs:
        return 0

    # Insertion-ordered so the decode order still follows the request. That
    # keeps the page-cache access pattern sequential across frames, which is
    # what the export's channel-major dispatch is arranged to exploit.
    by_file: "OrderedDict[Tuple[Any, ...], Tuple[Path, List[_RowJob]]]" = (
        OrderedDict()
    )
    for job in jobs:
        entry = by_file.get(job.file_key)
        if entry is None:
            by_file[job.file_key] = (job.path, [job])
        else:
            entry[1].append(job)

    # Everything goes through the pool, including a single frame and a pool of
    # one worker. The obvious optimisation — call inline when there is nothing
    # to parallelise — measurably backfires: decoding on the calling thread
    # allocates and frees an 11 MB frame buffer per call, so glibc munmaps it
    # and the next frame faults its 2775 pages back in one at a time. Measured
    # over 299 real frames: 1 390 621 minor faults and 2.33 s of system time
    # inline, against 20 205 faults and 0.37 s through the pool, whose worker
    # keeps one arena warm across calls.
    #
    # ``map`` preserves input order, and each call returns its rows in its own
    # jobs' order — which is what keeps row i of item j the row for frame i.
    grouped = list(by_file.values())
    sampled = _DECODE_POOL.map(lambda g: _sample_frame_rows(g[0], g[1]), grouped)
    for (_path, file_jobs), file_rows in zip(grouped, sampled):
        for job, row in zip(file_jobs, file_rows):
            rows_by_item[job.item][job.row] = row
            _SAMPLE_CACHE.put(job.cache_key, row)
    return len(grouped)


def _assert_rows_complete(
    frames: List[KymographFrameInput], rows: List[Optional[np.ndarray]]
) -> List[np.ndarray]:
    """Row i MUST be frame i: the CSV writer labels row i with
    ``frames[i].frame`` and the tracker reads velocities off the row axis, so
    dropping an unfilled row would relabel every later frame instead of
    failing. Every index is written above; this is the assertion that keeps it
    that way."""
    unfilled = [frames[i].frame for i, row in enumerate(rows) if row is None]
    if unfilled:
        raise HTTPException(
            status_code=500,
            detail=f"Kymograph sampling produced no row for frame(s) {unfilled[:5]}",
        )
    return [row for row in rows if row is not None]


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


def _render_profiles(
    kymo: np.ndarray,
    frames: List[KymographFrameInput],
    px_per_column: float,
) -> List[ProfilePng]:
    """Render each frame's intensity profile (one row of ``kymo``) as a
    matplotlib line plot of intensity vs. position along the microtubule.

    matplotlib is imported lazily with the headless ``Agg`` backend (the ML
    container has no display), mirroring the codebase's lazy-heavy-dep pattern
    so process startup is unaffected. The object-oriented ``Figure`` API is
    used instead of ``pyplot`` to avoid pyplot's non-thread-safe global state
    and the per-figure cleanup it would otherwise require.
    """
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib.figure import Figure

    n_samples = int(kymo.shape[1])
    # Column index → position in image pixels along the MT (matches the
    # kymograph's "Along microtubule (px)" x-axis). px_per_column is 1.0 to
    # within rounding since the column cap was removed, so this is now very
    # nearly an identity — kept because it is the correct expression of the
    # axis, not because it currently rescales anything.
    x_px = np.arange(n_samples, dtype=np.float64) * float(px_per_column)

    profiles: List[ProfilePng] = []
    for i, row in enumerate(kymo):
        fig = Figure(figsize=(6, 3), dpi=100)
        ax = fig.subplots()
        ax.plot(x_px, np.asarray(row, dtype=np.float64), color="#2563eb", linewidth=1.0)
        ax.set_xlabel("Position along microtubule (px)")
        ax.set_ylabel("Intensity")
        ax.set_title(f"Frame {int(frames[i].frame)}")
        ax.margins(x=0)
        ax.grid(True, alpha=0.3)
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png")
        profiles.append(
            ProfilePng(
                frame=int(frames[i].frame),
                png_base64=base64.b64encode(buf.getvalue()).decode("ascii"),
            )
        )
    return profiles


# One slot, on purpose.
#
# The body below is fully blocking — decode, SciPy, matplotlib, PNG encode —
# and it used to run on the event loop, where a 10-30 s render stalled every
# other request in the worker including the GET /health that the compose
# healthcheck polls every 30 s with a 10 s timeout. The previous note here said
# the fix "needs a bounded executor, not a keyword change. Measure before
# switching", and declined to do either, because `def` would have handed this
# to anyio's 40-slot threadpool: forty concurrent renders each holding a
# full-frame float32 buffer, on the container that is also doing GPU inference,
# all calling the process-global `matplotlib.use()`.
#
# A one-worker executor is that bounded executor. It keeps the concurrency the
# event loop was providing — exactly one kymograph in flight, so matplotlib's
# global state is reached by one thread at a time — and gives back the only
# thing the event loop should never have been holding: the ability to answer
# anything else.
#
# The memory peak is NOT unchanged, and the reason is the decode pool above,
# not this executor: `_run_row_jobs` now holds up to `_DECODE_WORKERS` (4)
# full-frame float32 buffers at once instead of one. Measured on the 299-frame
# container, peak RSS went 146 MB -> 187 MB, i.e. +41 MB against 11.36 MB per
# 1924x1476 frame — three extra frames in flight, as expected. On the 2048x2048
# frames the old note sized, that is ~50 MB rather than ~17 MB. Both are small
# against the service's 12 GB limit, but the arithmetic is why neither number
# is free to raise: `max_workers` here multiplies by `_DECODE_WORKERS_CAP`
# there, so growing either is a throughput decision that needs its own
# measurement of the peak.
_KYMOGRAPH_EXECUTOR = ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="kymograph"
)


@router.post("/kymograph", response_model=KymographResponse)
async def kymograph(req: KymographRequest) -> KymographResponse:
    """Render a kymograph for one microtubule polyline.

    Thin async wrapper: the work runs on ``_KYMOGRAPH_EXECUTOR`` so the event
    loop stays free. See ``_kymograph_sync`` for the body.
    """
    return await asyncio.get_running_loop().run_in_executor(
        _KYMOGRAPH_EXECUTOR, _kymograph_sync, req
    )


class _KymographPlan(NamedTuple):
    """Everything ``_finish_kymograph`` needs that is decided BEFORE any pixel
    is read: the frame order, the sample count, and the per-row work."""

    frames: List[KymographFrameInput]
    n_samples: int
    px_per_column: float
    rows: List[Optional[np.ndarray]]
    jobs: List[_RowJob]
    hits: int


def _seed_columns(polyline_rc: List[List[float]]) -> Optional[Tuple[int, float]]:
    """``(columns, arc_length_px)`` for a kymograph seeded on this polyline, or
    None when the geometry cannot seed one (fewer than two 2-D vertices).

    ONE COLUMN PER PIXEL OF ARC LENGTH, with no ceiling. That is ImageJ's
    convention for a line profile — ``Roi.getLine``/``ProfilePlot`` sample once
    per pixel — and it is what makes the position axis readable in image pixels
    rather than in an arbitrary fraction of them.

    Until 2026-09-01 this was clamped to the request's ``target_width`` (200 by
    default), which existed to bound the OUTPUT, not to make the measurement
    right. It was doing real damage: measured over all 146 216 microtubule
    polylines in production, the median arc is 118 px (unaffected) but the p95
    is 625, the p99 985 and the longest 2076 — so **33 % of real microtubules
    were being squeezed** into 200 columns, the p95 by 3.1x and the longest by
    10.4x. Trajectory detection runs on those columns: on a real 299-frame
    kymograph of a 1250 px microtubule (container 4972cad8, channel 488_nm),
    200 columns yielded 5 trajectories and 1251 columns yielded 13. Squeezing
    6.3 image pixels into one column merges neighbouring tracks.

    Cost of removing it, on the same data: the PNG grows in proportion (84 KB
    -> 524 KB for that kymograph; 14 KB -> 61 KB for the longest microtubule
    over 35 frames). That is what ``_BATCH_MAX_OUTPUT_PIXELS`` now bounds.
    """
    try:
        pts = np.asarray(polyline_rc, dtype=np.float64)
    except (TypeError, ValueError):  # ragged / non-numeric geometry
        return None
    if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 2:
        return None
    arc = float(np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1)))
    return max(2, int(round(arc)) + 1), arc


def _plan_kymograph(req: KymographRequest, item: int = 0) -> _KymographPlan:
    """Validate one kymograph request and resolve its rows to cache hits or
    pending decode jobs. Raises HTTPException on anything malformed."""
    if not req.frames:
        raise HTTPException(status_code=400, detail="No frames provided")

    frames = sorted(req.frames, key=lambda f: f.frame)

    # The column count comes from the seed (lowest-numbered) frame's polyline
    # and nothing else — see ``_seed_columns`` for the rule and why it has no
    # ceiling. ``req.target_width`` is accepted and ignored.
    seeded = _seed_columns(frames[0].polyline_rc)
    if seeded is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Seed-frame polyline has {len(frames[0].polyline_rc)} "
                "vertex(es); need >= 2."
            ),
        )
    n_samples, seed_arc = seeded
    # Image pixels spanned by one kymograph column: 1.0 to within the rounding
    # of ``round(arc)+1``, by construction, and no longer able to exceed it.
    # Kept because it is still the exact conversion the Node backend applies to
    # column-space velocities and run displacements before the µm calibration.
    px_per_column = seed_arc / (n_samples - 1) if n_samples > 1 else 1.0

    rows, jobs, hits = _plan_rows(
        frames, n_samples, item, req.line_width, req.line_reduce
    )
    return _KymographPlan(frames, n_samples, px_per_column, rows, jobs, hits)


def _batch_output_pixels(items: List[KymographRequest]) -> int:
    """Kymograph pixels (frames x columns) the batch would render, summed.

    Cheap enough for the event loop: it touches only each item's seed polyline,
    not its frames. An item whose seed geometry is unusable contributes 0 — it
    will fail planning and return an error entry instead of an image, and one
    malformed polyline must not decide whether the other 59 are accepted.
    """
    total = 0
    for item in items:
        if not item.frames:
            continue
        seed = min(item.frames, key=lambda f: f.frame)
        seeded = _seed_columns(seed.polyline_rc)
        if seeded is None:
            continue
        total += len(item.frames) * seeded[0]
    return total


@router.post("/kymograph/batch", response_model=KymographBatchResponse)
async def kymograph_batch(req: KymographBatchRequest) -> KymographBatchResponse:
    """Render N kymographs, decoding each distinct frame once for all of them.

    Same thin async wrapper as ``/kymograph``, onto the same one-slot executor:
    a batch and a single kymograph never run concurrently, so the peak memory
    stays what it was (one decoded frame per decode-pool thread).

    The size bound is checked HERE rather than in the executor body so an
    oversized batch is refused immediately instead of queueing behind a render
    that is already in flight.
    """
    pixels = _batch_output_pixels(req.items)
    if len(req.items) > 1 and pixels > _BATCH_MAX_OUTPUT_PIXELS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Batch would render {pixels} kymograph pixels "
                f"(frames x columns, summed over {len(req.items)} items); "
                f"the limit is {_BATCH_MAX_OUTPUT_PIXELS}. Split it."
            ),
        )
    return await asyncio.get_running_loop().run_in_executor(
        _KYMOGRAPH_EXECUTOR, _kymograph_batch_sync, req
    )


def _kymograph_batch_sync(
    req: KymographBatchRequest,
) -> KymographBatchResponse:
    """Blocking body of /kymograph/batch. Runs on the single-slot executor.

    Three phases, and the middle one is the reason the endpoint exists:

    1. Plan every item (validation + row-cache lookups). An item that fails
       validation is recorded and dropped; the rest carry on.
    2. Run ALL the surviving items' row jobs together, so a frame wanted by 60
       polylines is decoded once and sampled 60 times.
    3. Finish each item exactly as ``_kymograph_sync`` would — detection,
       render, CSV — from rows that are bit-identical to the ones it would
       have sampled on its own.
    """
    plans: List[Optional[_KymographPlan]] = []
    errors: List[Optional[str]] = []
    for i, item in enumerate(req.items):
        try:
            plans.append(_plan_kymograph(item, i))
            errors.append(None)
        except HTTPException as exc:
            plans.append(None)
            errors.append(str(exc.detail))
        except Exception as exc:  # noqa: BLE001 - one item must not sink 63
            logger.exception("kymograph batch: item %d failed to plan", i)
            plans.append(None)
            errors.append(str(exc))

    rows_by_item: List[List[Optional[np.ndarray]]] = [
        plan.rows if plan is not None else [] for plan in plans
    ]
    jobs = [job for plan in plans if plan is not None for job in plan.jobs]
    decoded = _run_row_jobs(jobs, rows_by_item)
    logger.info(
        "kymograph batch: %d item(s), %d cached / %d sampled from %d "
        "frame decode(s) (%d worker(s))",
        len(req.items),
        sum(plan.hits for plan in plans if plan is not None),
        len(jobs),
        decoded,
        _DECODE_WORKERS,
    )

    results: List[KymographBatchItem] = []
    for i, plan in enumerate(plans):
        if plan is None:
            results.append(KymographBatchItem(error=errors[i]))
            continue
        try:
            results.append(
                KymographBatchItem(kymograph=_finish_kymograph(req.items[i], plan))
            )
        except HTTPException as exc:
            results.append(KymographBatchItem(error=str(exc.detail)))
        except Exception as exc:  # noqa: BLE001 - as above
            logger.exception("kymograph batch: item %d failed to render", i)
            results.append(KymographBatchItem(error=str(exc)))
    return KymographBatchResponse(results=results)


def _kymograph_sync(req: KymographRequest) -> KymographResponse:
    """Blocking body of /kymograph. Runs on the single-slot executor above."""
    plan = _plan_kymograph(req)
    decoded = _run_row_jobs(plan.jobs, [plan.rows])
    logger.info(
        "kymograph: %d frame(s), %d cached / %d decoded (%d worker(s))",
        len(plan.frames),
        plan.hits,
        decoded,
        _DECODE_WORKERS,
    )
    return _finish_kymograph(req, plan)


def _finish_kymograph(
    req: KymographRequest, plan: _KymographPlan
) -> KymographResponse:
    """Turn sampled rows into the response: detection, render, CSV.

    Split out of ``_kymograph_sync`` so the batch endpoint can run the sampling
    of every item together (one decode per frame) and only then come back here,
    once per item, with exactly the same arguments a single request would have
    produced.
    """
    from PIL import Image as PILImage

    frames = plan.frames
    n_samples = plan.n_samples
    px_per_column = plan.px_per_column

    kymo = np.stack(_assert_rows_complete(frames, plan.rows), axis=0)
    if kymo.size == 0:
        raise HTTPException(status_code=500, detail="Empty kymograph result")

    # Trajectory detection runs on the RAW (un-normalised) matrix so the
    # background-subtraction and SNR estimates inside detect_tracks see real
    # intensities, not a [0,1]-rescaled version. KymoButler applies its own
    # normalisation internally, to its own copy. The velocity layer is
    # OPTIONAL: a detection failure must never break the kymograph itself — and
    # since the swap to KymoButler that now also covers "the ONNX weights were
    # never staged" — so we degrade to "no tracks" rather than 500-ing the whole
    # request.
    raw_tracks: List[Dict[str, Any]] = []
    tracks: Optional[List[KymographTrack]] = None
    velocity_error: Optional[str] = None
    filtered_track_count = 0
    filtered_dim_track_count = 0
    if req.detect_velocity:
        try:
            # Already OFF the event loop: `kymograph` hands this whole body
            # to `_KYMOGRAPH_EXECUTOR`, so uvicorn keeps answering /segment,
            # /track and /health while detection runs. That matters more since
            # 2026-08-31 than it used to — detection was 0.03-0.2 s of numpy
            # and is now KymoButler, 0.03-0.14 s on GPU but 2.6-132 s of torch
            # on CPU, plus a one-off ~5 s onnx2torch conversion. Held inline on
            # the loop, the CPU figure alone would trip the compose healthcheck
            # (30 s interval, 5 retries) after ~150 s.
            #
            # Serialisation is already guaranteed: this body runs on
            # `_KYMOGRAPH_EXECUTOR`, a max_workers=1 pool, so exactly one
            # detection is in flight at a time. An explicit lock here would be
            # redundant — and an `async` one is impossible, because this
            # function is synchronous by construction.
            raw_tracks = detect_tracks(kymo, mode=req.kymobutler_mode)
            # Which way "signal" points on THIS kymograph. detect_tracks signs
            # its own SNR the same way; the metrics below are measured beside
            # those tracks and must agree, or an inverted kymograph reports a
            # negative intensity_minus_bg and flags its dimmest trajectories as
            # aggregates.
            polarity = kymograph_polarity(kymo)
            # Enrich each track with the edge-touch flag + background-subtracted
            # intensity along its trajectory, both read off the same kymo.
            #
            # The intensity is measured for ALL trajectories in ONE call, never
            # one at a time: each background ring is that trajectory's band
            # dilated by ``intensity_width * intensity_bg_margin`` MINUS the
            # union of every trajectory's band, so a neighbouring streak a few
            # columns away can never be averaged in as background. That is the
            # per-microtubule geometry (``mt_measure``), and it is not separable
            # per track.
            #
            # It is therefore also not isolable per track: a failure nulls the
            # three intensity fields for the whole kymograph rather than for one
            # trajectory. Those nulls are the fields' documented "not available",
            # and everything else about the response — the matrix, the
            # trajectories, their velocities — still comes back.
            try:
                intensities = tracks_intensity(
                    kymo,
                    [tr["points"] for tr in raw_tracks],
                    req.intensity_width,
                    margin_multiplier=req.intensity_bg_margin,
                    polarity=polarity,
                )
            except Exception:
                logger.exception(
                    "kymograph intensity measurement failed; nulling fields"
                )
                intensities = [dict(EMPTY_INTENSITY) for _ in raw_tracks]
            for tr, vals in zip(raw_tracks, intensities):
                tr["edge"] = edge_touch(tr["points"], n_samples)
                tr.update(vals)
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
            # Drop trajectories dimmer than the absolute intensity floor.
            #
            # AFTER tracks_intensity, and it has to be: the background ring is
            # defined by the union of EVERY trajectory's band, so measuring a
            # subset would measure each survivor as if its dropped neighbours
            # were empty field. Before render_overlay and the bright flag, for
            # the same reason the velocity cut-off is — overlay, returned table
            # and exported CSV must show one set of trajectories.
            if req.min_intensity_minus_bg > 0:
                raw_tracks, filtered_dim_track_count = filter_dim_tracks(
                    raw_tracks,
                    req.min_intensity_minus_bg,
                    polarity=polarity,
                )
                if filtered_dim_track_count:
                    logger.info(
                        "kymograph: dropped %d track(s) below %.4g counts "
                        "above background",
                        filtered_dim_track_count,
                        req.min_intensity_minus_bg,
                    )
            # Flag intensity outliers among the FINAL (post-filter) tracks, so
            # the "bright" flag matches the trajectories that actually appear in
            # the table / overlay / exported sheet.
            flag_bright_outliers(raw_tracks, polarity=polarity)
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
            filtered_dim_track_count = 0

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

    # OPTIONAL per-frame intensity profiles (one matplotlib plot per kymograph
    # row). A render failure must never break the base kymograph, so degrade to
    # ``profiles=None`` — same discipline as the overlay above.
    profiles: Optional[List[ProfilePng]] = None
    if req.render_profiles:
        try:
            profiles = _render_profiles(kymo, frames, px_per_column)
        except Exception:
            logger.exception("kymograph profile render failed; omitting profiles")

    # The intensity matrix as CSV, only when the caller asked for it — see
    # ``KymographRequest.include_csv``. Row i is labelled with ``frames[i].frame``,
    # which is why ``_assert_rows_complete`` refuses to return a short list.
    csv_b64: Optional[str] = None
    if req.include_csv:
        csv_buf = io.StringIO()
        writer = csv.writer(csv_buf)
        writer.writerow(["frame", *[f"x{i}" for i in range(n_samples)]])
        for i, row in enumerate(kymo):
            writer.writerow([frames[i].frame, *row.tolist()])
        csv_b64 = base64.b64encode(
            csv_buf.getvalue().encode("utf-8")
        ).decode("ascii")

    return KymographResponse(
        png_base64=png_b64,
        csv_base64=csv_b64,
        frame_count=int(kymo.shape[0]),
        length_px=int(kymo.shape[1]),
        tracked=bool(req.tracked),
        px_per_column=float(px_per_column),
        filtered_track_count=int(filtered_track_count),
        filtered_dim_track_count=int(filtered_dim_track_count),
        tracks=tracks,
        overlay_png_base64=overlay_b64,
        velocity_error=velocity_error,
        profiles=profiles,
    )
