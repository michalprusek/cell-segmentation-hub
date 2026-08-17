"""Geometric evidence for cross-frame microtubule association.

This replaces the 32-d DINOv3 embedding the v7 model used to emit. At the
single-digit-pixel displacements these acquisitions have, consecutive
centerlines overlap heavily and geometry is highly informative; a learned
association would be a component whose proxy has not been validated against the
thing it must improve.

Ported from the v5H package's ``instance/tracker.py`` and kept as a standalone
module so the tracker endpoint can unit-test it without importing torch or the
model package -- the same reason ``models/mt_measure.py`` sits BESIDE the
``microtubule`` package rather than inside it.

Coordinate order
----------------
Every function here takes ``(N, 2)`` arrays and computes only distances, so it
is agnostic to whether the columns are ``(row, col)`` or ``(x, y)`` -- with ONE
exception: :func:`estimate_drift` returns a shift in the same column order as
its inputs. The tracker feeds it ``(row, col)``, so it gets ``(d_row, d_col)``.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np
from scipy.spatial import cKDTree

#: Hard gate: no association beyond this curve-to-curve distance, px.
#: This is the gate that owns "is it in the same place?".
GATE_MAX_SHIFT: float = 25.0

#: Fraction of BOTH curves that must have a partner nearby before two polylines
#: may be called the same microtubule. This gate owns "is it the same extent?".
GATE_MIN_OVERLAP: float = 0.35

#: What "nearby" means when measuring that fraction, px.
#:
#: Deliberately NOT the upstream 4.0. With a 4 px tolerance the overlap gate
#: silently becomes a 4 px *perpendicular displacement* gate — a filament that
#: moved 5 px sideways has zero overlap and is rejected however well
#: curve_distance scores it. That double-counts distance, which
#: GATE_MAX_SHIFT already owns, and makes the real gate the tighter
#: undocumented one.
#:
#: 12 px is comfortably above the residual displacement expected after stage
#: drift and the constant-velocity prediction have been removed (single-digit
#: px in these acquisitions), and far below microtubule lengths, so a short
#: fragment lying on a long filament is still rejected.
OVERLAP_TOL: float = 12.0

#: Search gate for the drift estimator. MUST exceed GATE_MAX_SHIFT: drift is
#: exactly what pushes a genuine pair past the association gate, so an
#: estimator that refused to look further than that gate could never recover a
#: drift large enough to matter. Pairs are matched by centroid here only to
#: collect normal-flow constraints; a few wrong pairs are absorbed by the
#: least-squares, whereas a missed drift severs every track in the field.
DRIFT_MAX_SHIFT: float = 60.0

#: Resampling step for centerline comparison, px.
DS: float = 2.0


def arclength(p: np.ndarray) -> np.ndarray:
    """Cumulative arclength along a polyline, starting at 0."""
    p = np.asarray(p, dtype=float)
    if len(p) < 2:
        return np.zeros(len(p), dtype=float)
    seg = np.linalg.norm(np.diff(p, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(seg)])


def resample(p: np.ndarray, ds: float = DS) -> np.ndarray:
    """Arclength-uniform resampling.

    Without it a densely-sampled centerline and a sparsely-sampled one are not
    comparable: the mean nearest-point distance would be dominated by whichever
    curve happened to carry more vertices.
    """
    p = np.asarray(p, dtype=float)
    if len(p) < 2:
        return p
    s = arclength(p)
    total = float(s[-1])
    if total <= 0:
        return p
    n = max(2, int(np.ceil(total / ds)) + 1)
    t = np.linspace(0.0, total, n)
    return np.stack([np.interp(t, s, p[:, k]) for k in range(p.shape[1])], axis=1)


def curve_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Symmetric mean nearest-point distance between two polylines, px.

    Returns ``inf`` for degenerate input rather than 0, so a one-point stub can
    never be mistaken for a perfect match -- the failure mode a plain centroid
    distance has.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return float("inf")
    da, _ = cKDTree(b).query(a, k=1)
    db, _ = cKDTree(a).query(b, k=1)
    return float(0.5 * (da.mean() + db.mean()))


def overlap_fraction(a: np.ndarray, b: np.ndarray, tol: float = OVERLAP_TOL) -> float:
    """Smallest fraction of either curve that has a partner within ``tol``.

    Distance alone is not enough. A short fragment lying on top of a long
    filament has a tiny mean distance in one direction, so without this the
    fragment can win the assignment and orphan the real filament.

    DELIBERATE DEVIATION from the upstream package, which reduces with ``max``.
    Upstream's own docstring says the quantity of interest is the fraction of
    the *shorter* curve -- but for a 10 px fragment on a 200 px filament the
    fragment is 100% covered, so ``max`` (and "shorter", equally) returns 1.0
    and the gate never fires. Upstream survives that because its length and
    endpoint terms price the pair out anyway; a gate that cannot reject is not
    doing the job its name claims.

    ``min`` states the identity condition directly: BOTH curves must be
    substantially covered by the other. At the 0.35 default that still admits a
    microtubule growing to ~3x its length between frames, which is far beyond
    anything real, while rejecting a 5% fragment.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return 0.0
    fa = float((cKDTree(b).query(a, k=1)[0] <= tol).mean())
    fb = float((cKDTree(a).query(b, k=1)[0] <= tol).mean())
    return min(fa, fb)


def contour_shift(a: np.ndarray, b: np.ndarray, edge_frac: float = 0.15) -> float:
    """Signed shift of ``b`` along ``a``'s own contour, px. Positive = toward a's head.

    A gliding filament slides along itself, so its perpendicular displacement is
    ~zero and a distance-based tracker sees no motion at all. What moves is the
    material, and the way to see it is that every point of b sits at a constant
    arclength offset from its counterpart on a.

    The subtlety is the ends. Once b has advanced, its head lies BEYOND a's
    head, so the nearest point on a is a's last vertex and the projection
    saturates -- reporting zero shift however far the filament actually went.
    Including those points halves the estimate, so the offset is taken over
    interior matches only.
    """
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sa, sb = arclength(a), arclength(b)
    if sa[-1] <= 0 or sb[-1] <= 0:
        return 0.0
    _, idx = cKDTree(a).query(b, k=1)
    offs = sa[idx] - sb
    lo, hi = edge_frac * sa[-1], (1.0 - edge_frac) * sa[-1]
    interior = (sa[idx] > lo) & (sa[idx] < hi)
    if int(interior.sum()) < 3:
        interior = np.ones(len(offs), dtype=bool)   # too short to trim
    return float(np.median(offs[interior]))


def estimate_drift(
    prev: Sequence[np.ndarray],
    curr: Sequence[np.ndarray],
    max_shift: float = DRIFT_MAX_SHIFT,
    ds: float = DS,
) -> np.ndarray:
    """Common-mode translation between two frames, in the input column order.

    **Not** the median centroid shift. A gliding filament's centroid travels
    along its own contour at the full gliding speed, and in a gliding field
    every filament does -- so that estimator measures motility and calls it
    drift. Upstream measured it returning 2.9 px of drift on synthetic
    sequences with drift switched off. Subtracting that would cancel exactly
    the signal a motility assay exists to measure.

    What separates the two is that gliding is motion ALONG the filament while
    drift moves the whole field. The component of a displacement perpendicular
    to the filament's own tangent therefore contains no gliding at all. This is
    the aperture problem, and it is solved the way optical flow solves it:
    collect the perpendicular ("normal flow") constraints from filaments at
    DIFFERENT orientations and least-squares the single translation that
    explains them. Two distinct orientations suffice; a field of parallel
    filaments is genuinely ambiguous and the estimate degrades toward zero.
    """
    if len(prev) == 0 or len(curr) == 0:
        return np.zeros(2)

    P = [resample(np.asarray(p, dtype=float), ds) for p in prev]
    C = [resample(np.asarray(c, dtype=float), ds) for c in curr]
    P = [p for p in P if len(p) >= 3]
    C = [c for c in C if len(c) >= 2]
    if not P or not C:
        return np.zeros(2)

    cp = np.array([p.mean(axis=0) for p in P])
    cc = np.array([c.mean(axis=0) for c in C])
    dist, nearest = cKDTree(cc).query(cp, k=1)

    rows, vals = [], []
    for i, within_gate in enumerate(dist <= max_shift):
        if not within_gate:
            continue
        a, b = P[i], C[nearest[i]]
        _, idx = cKDTree(b).query(a, k=1)
        disp = b[idx] - a
        tang = np.gradient(a, axis=0)
        nrm = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
        nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
        rows.append(nrm)
        vals.append(np.einsum("ij,ij->i", nrm, disp))

    if not rows:
        return np.zeros(2)

    A = np.concatenate(rows, axis=0)
    y = np.concatenate(vals, axis=0)
    # Rank-deficient when every filament shares one orientation: lstsq returns
    # the minimum-norm solution, which is the honest answer -- no evidence for
    # motion along the unconstrained direction.
    sol, *_ = np.linalg.lstsq(A, y, rcond=None)
    return np.asarray(sol, dtype=float)
