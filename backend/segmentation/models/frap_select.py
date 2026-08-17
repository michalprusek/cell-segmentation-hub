"""Choose FRAP bleach spots on microtubule centerlines.

Pure policy: geometry in, spots out. No model, no I/O, no HTTP — so the criteria
that the experiment depends on can be tested on hand-drawn filaments without a GPU.

The one rule that shapes everything here: the bleach must not touch a neighbouring
microtubule, and the recovery readout must not be contaminated by one. Those are
two different requirements with two different radii, so they are two tests
(``bleach_clearance`` and ``readout_clearance``), never one averaged compromise.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.spatial import cKDTree

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import frap_geometry as G      # noqa: E402
import mt_measure              # noqa: E402
# Imported off the models DIRECTORY, not as ``models.mt_measure``: the package
# __init__ pulls in torch and a live CUDA driver, and measuring pixels needs
# neither. ``api/mt_metrics.py`` established this pattern for the same reason.


@dataclass(frozen=True)
class SelectionParams:
    """Selection criteria. Lengths in micrometres; the caller supplies um_per_px.

    Deliberately strict about isolation. Strictness costs yield — on a dense field
    this returns fewer than k_min spots — and that is the intended direction: a
    shortfall is visible and recoverable, a bleach that clipped a neighbour is not.
    """

    l_min_um: float = 5.0            # filament must hold the observation window
    spot_len_um: float = 1.0         # bleached length of lattice
    spot_wid_um: float = 1.0         # bleached width across the filament
    bleach_spread_um: float = 0.5    # MEASURE this, do not guess it (spec 9.6)
    r_iso_um: float = 3.0            # readout clearance
    obs_len_um: float = 3.0          # stretch integrated for the recovery curve
    border_margin_um: float = 2.0    # drift reserve
    d_sep_um: float = 10.0           # between two chosen spots
    f_mid: float = 0.5               # candidates come from the middle half
    kappa_spot: float = 0.05         # rad/px AT AN 8 PX BASELINE
    kappa_baseline_px: float = 8.0
    snr_min: float = 2.0             # calibrate from a dry-run overlay
    band_thickness_px: int = 5       # mt_measure defaults, kept identical
    margin_multiplier: float = 2.0
    step_px: float = 1.0             # resampling pitch
    spot_shape: str = "ellipse"      # or "rect" — not read in this module; Task 5's
    # renderer reads it to choose the emitted ROI outline. The clearance tests here
    # deliberately always evaluate the conservative rectangle regardless of this
    # value (see footprint_clearance_px's docstring in frap_geometry.py).


@dataclass(frozen=True)
class Spot:
    x: float
    y: float
    tangent_deg: float
    mt_index: int
    mt_length_um: float
    bleach_clearance_um: float
    readout_clearance_um: float
    snr: Optional[float]
    score: float


@dataclass(frozen=True)
class RejectedFilament:
    """Why one filament produced no bleach spot, and roughly where it is.

    One entry per rejected filament, not per rejected candidate: a frame has on the
    order of a thousand candidates and a hundred filaments, and the question an
    operator asks of an overlay is "why not that microtubule", not "why not that
    pixel".
    """
    x: float
    y: float
    reason: str
    mt_index: int


@dataclass(frozen=True)
class SelectionResult:
    spots: List[Spot]
    rejected_by: Dict[str, int]
    n_candidates: int
    n_polylines: int
    shortfall: bool
    rejected_filaments: List[RejectedFilament]


_REJECT_KEYS = ("length", "border", "bleach_clearance",
                "readout_clearance", "straightness", "snr")


def _polyline_midpoint_xy(pts: np.ndarray) -> Optional[Tuple[float, float]]:
    """The arc-length midpoint of an already-resampled (uniform-spacing) polyline.

    ``None`` when the filament is too degenerate to have one (zero points) — the
    caller skips such a filament rather than guessing a position for it.
    """
    n = pts.shape[0]
    if n == 0:
        return None
    if n == 1:
        return float(pts[0, 0]), float(pts[0, 1])
    mid = 0.5 * (n - 1)
    lo, hi = int(np.floor(mid)), int(np.ceil(mid))
    if lo == hi:
        return float(pts[lo, 0]), float(pts[lo, 1])
    frac = mid - lo
    x = pts[lo, 0] * (1.0 - frac) + pts[hi, 0] * frac
    y = pts[lo, 1] * (1.0 - frac) + pts[hi, 1] * frac
    return float(x), float(y)


def _half_axes_px(p: SelectionParams, um_per_px: float) -> Tuple[float, float]:
    """Half-length along the tangent and half-width across it, in pixels."""
    return (0.5 * p.spot_len_um / um_per_px, 0.5 * p.spot_wid_um / um_per_px)


def _window_half_k(half_px: float, step_px: float) -> int:
    """Sample count the observation window reaches from its centre index, each way.

    The single source of truth for the window's quantised half-width — both
    ``_slice_window`` (which actually builds the window) and ``select_spots``'s
    KD-tree query radius (which must bound how far the window can really reach,
    in pixels, so a too-close neighbour is never mistaken for isolated) call this
    same function, so the two can never drift apart the way a query radius that
    just assumed ``obs_half_px`` used to.
    """
    return max(1, int(round(half_px / step_px)))


def _slice_window(pts: np.ndarray, i: int, half_px: float, step_px: float) -> np.ndarray:
    k = _window_half_k(half_px, step_px)
    return pts[max(0, i - k): min(pts.shape[0], i + k + 1)]


def _spot_snr(fluor: np.ndarray, window: np.ndarray, not_signal: np.ndarray,
              p: SelectionParams) -> float:
    """Contrast of the observation window over its own background ring.

    Uses mt_measure's band and vicinity primitives so that "is this filament bright
    enough to bleach" is measured with the identical geometry that produces the
    assay's own numbers — one implementation, not two that drift apart.
    """
    h, w = fluor.shape[:2]
    band = mt_measure.rasterize_band(window.astype(np.float32), h, w, p.band_thickness_px)
    margin_radius = int(round(p.band_thickness_px * p.margin_multiplier))
    ring = mt_measure.vicinity_mask(band, not_signal, margin_radius)
    b = mt_measure.region_stats(fluor, band)
    r = mt_measure.region_stats(fluor, ring)
    if b.n == 0 or r.n == 0 or r.median <= 0.0:
        # b.n == 0 is also what covers an empty or degenerate ``window`` (fewer than
        # two points): mt_measure.rasterize_band itself guards ``n < 2`` and returns
        # an all-zero band in that case, which makes b.n == 0 here — so a small
        # obs_len_um handing this a degenerate polyline is already the safe
        # direction (SNR reads 0.0, snr_min rejects it) with no extra check needed.
        return 0.0
    return float((b.mean - r.median) / r.median)


def select_spots(
    polylines_xy: Sequence[np.ndarray],
    shape_hw: Tuple[int, int],
    um_per_px: float,
    fluor: Optional[np.ndarray] = None,
    params: SelectionParams = SelectionParams(),
    k_min: int = 5,
    k_max: int = 10,
) -> SelectionResult:
    """Pick up to ``k_max`` bleach spots. See the module docstring for the rule."""
    p = params
    h, w = int(shape_hw[0]), int(shape_hw[1])
    rejected = {k: 0 for k in _REJECT_KEYS}
    # Per-filament reject tallies, kept separate from the frame-wide ``rejected``
    # histogram above: that one answers "how many candidates failed each test", this
    # one answers "of THIS filament's own candidates, which test failed most" — the
    # question RejectedFilament.reason exists to answer. Populated at the exact same
    # sites as ``rejected[...] += 1`` below, so the two can never disagree.
    per_filament_rejects: Dict[int, Dict[str, int]] = {}

    def _bump_filament_reject(mt_i: int, reason: str) -> None:
        counts = per_filament_rejects.setdefault(mt_i, {})
        counts[reason] = counts.get(reason, 0) + 1

    resampled = [G.resample_polyline(np.asarray(pl, dtype=np.float64), p.step_px)
                 for pl in polylines_xy]
    lengths_um = [G.polyline_length_px(r) * um_per_px for r in resampled]

    # One KD-tree over every filament's points, with an owner index per point, so a
    # candidate can ask "what is near me that is NOT my own filament".
    owners, all_pts = [], []
    for i, r in enumerate(resampled):
        if r.shape[0]:
            owners.append(np.full(r.shape[0], i, dtype=np.int32))
            all_pts.append(r)
    if all_pts:
        owner_of = np.concatenate(owners)
        pts_all = np.concatenate(all_pts, axis=0)
        tree = cKDTree(pts_all)
    else:
        owner_of = np.zeros(0, dtype=np.int32)
        pts_all = np.zeros((0, 2))
        tree = None

    not_signal = None
    if fluor is not None and tree is not None:
        union = np.zeros((h, w), dtype=np.uint8)
        for r in resampled:
            if r.shape[0] >= 2:
                union |= mt_measure.rasterize_band(
                    r.astype(np.float32), h, w, p.band_thickness_px)
        not_signal = union == 0

    a_px, b_px = _half_axes_px(p, um_per_px)
    spread_px = p.bleach_spread_um / um_per_px
    r_iso_px = p.r_iso_um / um_per_px
    obs_half_px = 0.5 * p.obs_len_um / um_per_px
    border_px = p.border_margin_um / um_per_px
    # footprint_clearance_px always evaluates the ROI as a rectangle (conservative:
    # the rectangle contains the ellipse), so its centre-to-corner reach is
    # hypot(a_px, b_px), not max(a_px, b_px) — a neighbour at the corner is farther
    # from the centre than max() alone accounts for.
    corner_px = float(np.hypot(a_px, b_px))
    # _slice_window quantises the window to whole samples, so it reaches k*step_px from
    # the centre, not obs_half_px: the ratio can round down, and the max(1, ...) floor
    # overshoots outright when obs_half_px < step_px/2. Mirror that arithmetic here via
    # _window_half_k rather than hoping a fixed slack covers it — this bound is what
    # stops a too-close neighbour from being missed and read as "isolated".
    obs_reach_px = float(_window_half_k(obs_half_px, p.step_px) * p.step_px)
    # A max of two terms, not a sum: a neighbour matters if it is within spread_px of the
    # footprint OR within r_iso_px of the window. Do not "simplify" this into a sum.
    query_r_px = float(max(corner_px + spread_px, obs_reach_px + r_iso_px) + p.step_px)

    candidates: List[Spot] = []
    n_candidates = 0

    for i, pts in enumerate(resampled):
        if lengths_um[i] < p.l_min_um or pts.shape[0] < 3:
            rejected["length"] += 1
            _bump_filament_reject(i, "length")
            continue
        angles = G.tangent_angles(pts, p.kappa_baseline_px, p.step_px)
        curv = G.curvature_profile(pts, p.kappa_baseline_px, p.step_px)
        n = pts.shape[0]
        mid = 0.5 * (n - 1)
        half_band = 0.5 * p.f_mid * (n - 1)
        lo = max(0, int(np.floor(mid - half_band)))
        hi = min(n - 1, int(np.ceil(mid + half_band)))
        best: Optional[Spot] = None

        for j in range(lo, hi + 1):
            n_candidates += 1
            cx, cy = float(pts[j, 0]), float(pts[j, 1])
            # The dilated footprint's farthest point from the centre is its rounded
            # corner, at corner_px + spread_px — the same corner-anchored reach used
            # for query_r_px above, not max(a_px, b_px).
            reach_px = corner_px + spread_px + border_px
            if not (reach_px <= cx <= w - 1 - reach_px and reach_px <= cy <= h - 1 - reach_px):
                rejected["border"] += 1
                _bump_filament_reject(i, "border")
                continue

            near = tree.query_ball_point([cx, cy], query_r_px) if tree is not None else []
            near = [k for k in near if owner_of[k] != i]
            others = pts_all[near] if near else np.zeros((0, 2))

            bleach_px = G.footprint_clearance_px((cx, cy), float(angles[j]),
                                                 a_px, b_px, others)
            if bleach_px < spread_px:
                rejected["bleach_clearance"] += 1
                _bump_filament_reject(i, "bleach_clearance")
                continue

            window = _slice_window(pts, j, obs_half_px, p.step_px)
            readout_px = G.window_clearance_px(window, others)
            if readout_px < r_iso_px:
                rejected["readout_clearance"] += 1
                _bump_filament_reject(i, "readout_clearance")
                continue

            if float(curv[j]) > p.kappa_spot:
                rejected["straightness"] += 1
                _bump_filament_reject(i, "straightness")
                continue

            snr = None
            if fluor is not None:
                snr = _spot_snr(fluor, window, not_signal, p)
                if snr < p.snr_min:
                    rejected["snr"] += 1
                    _bump_filament_reject(i, "snr")
                    continue

            # Clearance dominates. Passing the two tests is a floor, not the goal:
            # between 1.1 um and 4 um of room the experiment wants the second, and a
            # score that weighted SNR equally would sometimes hand back the first.
            bleach_um = float(min(bleach_px * um_per_px, 999.0))
            readout_um = float(min(readout_px * um_per_px, 999.0))
            score = (
                2.0 * min(bleach_um / max(p.r_iso_um, 1e-6), 3.0)
                + 1.0 * min(readout_um / max(p.r_iso_um, 1e-6), 3.0)
                + 0.3 * min((snr if snr is not None else 0.0) / max(p.snr_min, 1e-6), 3.0)
                + 0.2 * min(lengths_um[i] / max(p.l_min_um, 1e-6), 3.0)
                + 0.2 * (1.0 - abs(j - mid) / max(half_band, 1.0))
                - 0.2 * (float(curv[j]) / max(p.kappa_spot, 1e-6))
            )
            cand = Spot(
                x=cx, y=cy, tangent_deg=float(np.degrees(angles[j])),
                mt_index=i, mt_length_um=float(lengths_um[i]),
                bleach_clearance_um=bleach_um, readout_clearance_um=readout_um,
                snr=(float(snr) if snr is not None else None), score=float(score),
            )
            if best is None or cand.score > best.score:
                best = cand

        if best is not None:
            candidates.append(best)

    candidates.sort(key=lambda s: s.score, reverse=True)
    d_sep_px = p.d_sep_um / um_per_px
    chosen: List[Spot] = []
    for cand in candidates:
        if len(chosen) >= k_max:
            break
        if all(np.hypot(cand.x - c.x, cand.y - c.y) >= d_sep_px for c in chosen):
            chosen.append(cand)

    # One RejectedFilament per filament that contributed nothing to `chosen` AND has
    # at least one of its own candidates with a defined rejection reason. A filament
    # that produced a passing candidate but simply lost the d_sep/k_max round has no
    # such reason (none of its own candidates were rejected by any criterion) — that
    # is over-subscription, not rejection, so it is left undecorated rather than
    # guessed at.
    chosen_mt_indices = {s.mt_index for s in chosen}
    rejected_filaments: List[RejectedFilament] = []
    for i, pts in enumerate(resampled):
        if i in chosen_mt_indices:
            continue
        counts = per_filament_rejects.get(i)
        if not counts:
            continue
        reason = max(_REJECT_KEYS, key=lambda k: counts.get(k, 0))
        mid_xy = _polyline_midpoint_xy(pts)
        if mid_xy is None:
            continue
        rejected_filaments.append(RejectedFilament(
            x=mid_xy[0], y=mid_xy[1], reason=reason, mt_index=i))

    return SelectionResult(spots=chosen, rejected_by=rejected,
                           n_candidates=n_candidates, n_polylines=len(list(polylines_xy)),
                           shortfall=len(chosen) < k_min,
                           rejected_filaments=rejected_filaments)
