"""Pure polyline geometry for FRAP spot placement.

Every length in this module is in PIXELS and every name says so. The conversion
from micrometres happens exactly once, at the boundary in ``frap_select``: mixing
the two silently is the easiest way to get an isolation criterion wrong by a
factor of ten and never notice.

Point arrays are ``(N, 2)`` and ordered ``[x, y]`` = ``[col, row]`` — the
transpose of NumPy indexing, and the same convention the segmentation API and
CVAT use.
"""
from __future__ import annotations

import numpy as np


def polyline_length_px(points_xy) -> float:
    """Arc length of an open polyline. Fewer than two points is length zero."""
    pts = np.asarray(points_xy, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[0] < 2:
        return 0.0
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum())


def resample_polyline(points_xy, step_px: float) -> np.ndarray:
    """Resample to uniform arc-length spacing of about ``step_px``.

    Uniform spacing is what lets every later step treat a vertex index as a
    distance, which is why this runs before anything else. The endpoints are
    preserved exactly; the spacing is ``total / round(total / step_px)``, so it
    lands near ``step_px`` rather than exactly on it.
    """
    pts = np.asarray(points_xy, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[0] < 2:
        return pts.reshape(-1, 2).copy()
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(s[-1])
    if total <= 0.0:
        return pts[:1].copy()
    n = max(2, int(round(total / float(step_px))) + 1)
    targets = np.linspace(0.0, total, n)
    out = np.empty((n, 2), dtype=np.float64)
    out[:, 0] = np.interp(targets, s, pts[:, 0])
    out[:, 1] = np.interp(targets, s, pts[:, 1])
    return out


def _baseline_indices(n: int, baseline_px: float, step_px: float):
    """Index pairs whose separation is baseline_px, i.e., ±baseline_px/2 around each vertex.

    Returns (lo, hi) where hi - lo (in pixels) ≈ baseline_px.
    """
    k = max(1, int(round(float(baseline_px) / (2.0 * float(step_px)))))
    idx = np.arange(n)
    return np.clip(idx - k, 0, n - 1), np.clip(idx + k, 0, n - 1)


def tangent_angles(points_xy, baseline_px: float, step_px: float) -> np.ndarray:
    """Tangent angle in radians at each vertex of a resampled polyline.

    The tangent is taken over a finite ``baseline_px``, not vertex to vertex. On a
    densely resampled polyline the vertex-to-vertex direction is mostly noise, and
    the noise is what a curvature threshold would end up measuring.
    """
    pts = np.asarray(points_xy, dtype=np.float64)
    n = pts.shape[0]
    if n < 2:
        return np.zeros(max(n, 0), dtype=np.float64)
    lo, hi = _baseline_indices(n, baseline_px, step_px)
    d = pts[hi] - pts[lo]
    return np.arctan2(d[:, 1], d[:, 0])


def curvature_profile(points_xy, baseline_px: float, step_px: float) -> np.ndarray:
    """``|dtheta/ds|`` in rad/px at each vertex.

    BOTH the tangent and the difference between tangents are taken over
    ``baseline_px``. Stating that is not pedantry: the same 957 annotated
    microtubules give 0.239 rad/px at an 8 px baseline and 1.015 rad/px at 2 px,
    so a curvature number without its baseline means nothing. This is a *tunable
    placement preference*, and deliberately not the project's derived physical
    bound kappa_max = 0.25 rad/px, which must never be fitted.
    """
    pts = np.asarray(points_xy, dtype=np.float64)
    n = pts.shape[0]
    if n < 3:
        return np.zeros(max(n, 0), dtype=np.float64)
    ang = tangent_angles(pts, baseline_px, step_px)
    lo, hi = _baseline_indices(n, baseline_px, step_px)
    delta = ang[hi] - ang[lo]
    # Wrap into (-pi, pi] so a turn through the +/-pi branch is not read as 2pi.
    delta = np.arctan2(np.sin(delta), np.cos(delta))
    span_px = np.maximum(hi - lo, 1).astype(np.float64) * float(step_px)
    return np.abs(delta) / span_px
