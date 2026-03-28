"""Mask to polyline post-processing.

Reuses skeleton extraction pipeline from combined_pipeline.py:254-398.
"""

from collections import deque
from typing import List, Tuple

import cv2
import numpy as np
from scipy.interpolate import splprep, splev
from skimage.morphology import skeletonize

from sperm_final.config import TARGET_POINTS


def mask_to_skeleton(mask01: np.ndarray) -> np.ndarray:
    """Skeletonize a binary mask. From combined_pipeline.py:255-256."""
    return skeletonize(mask01 > 0).astype(np.uint8)


def skeleton_to_ordered_path(skel: np.ndarray) -> List[Tuple[int, int]]:
    """Extract longest path from skeleton via BFS.

    From combined_pipeline.py:259-299.
    """
    ys, xs = np.where(skel > 0)
    if len(ys) == 0:
        return []
    pts_set = set(zip(xs.tolist(), ys.tolist()))

    def nbrs(p):
        x, y = p
        return [(x+dx, y+dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                if (dx or dy) and (x+dx, y+dy) in pts_set]

    adj = {p: nbrs(p) for p in pts_set}
    if not adj:
        return []

    eps = [p for p, n in adj.items() if len(n) == 1]
    start = eps[0] if eps else next(iter(adj))

    def bfs(s):
        dist = {s: 0}
        parent = {s: None}
        q = deque([s])
        while q:
            u = q.popleft()
            for v in adj.get(u, []):
                if v not in dist:
                    dist[v] = dist[u] + 1
                    parent[v] = u
                    q.append(v)
        far = max(dist, key=dist.get)
        return far, parent

    a, _ = bfs(start)
    b, parent = bfs(a)
    path = []
    cur = b
    while cur is not None:
        path.append(cur)
        cur = parent[cur]
    path.reverse()
    return path


def prune_skeleton(skel: np.ndarray, min_branch_length: int = 5) -> np.ndarray:
    """Remove short branches from a skeleton image.

    Identifies junction points, finds terminal branches, and removes
    those shorter than min_branch_length pixels.

    Args:
        skel: (H, W) binary skeleton image.
        min_branch_length: minimum branch length to keep.

    Returns:
        Pruned skeleton image.
    """
    ys, xs = np.where(skel > 0)
    if len(ys) < 3:
        return skel

    pts_set = set(zip(xs.tolist(), ys.tolist()))

    def nbrs(p):
        x, y = p
        return [(x+dx, y+dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                if (dx or dy) and (x+dx, y+dy) in pts_set]

    adj = {p: nbrs(p) for p in pts_set}

    # Find junction points (degree >= 3) and endpoints (degree == 1)
    junctions = {p for p, n in adj.items() if len(n) >= 3}
    endpoints = {p for p, n in adj.items() if len(n) == 1}

    if not junctions:
        return skel  # no junctions → single path, nothing to prune

    # Trace each endpoint branch until a junction
    pruned = skel.copy()
    for ep in endpoints:
        branch = [ep]
        cur = ep
        prev = None
        while True:
            neighbors = [n for n in adj.get(cur, []) if n != prev]
            if not neighbors:
                break
            nxt = neighbors[0]
            if nxt in junctions:
                break
            branch.append(nxt)
            prev = cur
            cur = nxt
            if len(branch) > min_branch_length:
                break

        if len(branch) <= min_branch_length:
            for (bx, by) in branch:
                pruned[by, bx] = 0

    return pruned


def rdp_simplify(points: List[Tuple], eps: float = 1.5) -> List[Tuple]:
    """Ramer-Douglas-Peucker line simplification.

    From combined_pipeline.py:302-324.
    """
    if len(points) < 3:
        return points
    pts = np.array(points, dtype=np.float32)

    def perp_dist(p, a, b):
        d = b - a
        if d[0] == 0 and d[1] == 0:
            return np.linalg.norm(p - a)
        t = max(0, min(1, np.dot(p - a, d) / np.dot(d, d)))
        return np.linalg.norm(p - (a + t * d))

    def rec(i, j):
        mx, idx = -1, -1
        for k in range(i + 1, j):
            d = perp_dist(pts[k], pts[i], pts[j])
            if d > mx:
                mx, idx = d, k
        if mx > eps:
            return rec(i, idx)[:-1] + rec(idx, j)
        return [tuple(pts[i]), tuple(pts[j])]

    return rec(0, len(pts) - 1)


def resample_polyline(points: List[Tuple], n: int) -> List[Tuple[float, float]]:
    """Uniformly resample polyline to n points.

    From combined_pipeline.py:327-347.
    """
    if not points or n < 1:
        return []
    pts = np.array(points, dtype=float)
    if len(pts) == 1:
        return [tuple(pts[0])] * n
    segs = np.linalg.norm(pts[1:] - pts[:-1], axis=1)
    total = segs.sum()
    if total == 0:
        return [tuple(pts[0])] * n
    cum = np.concatenate([[0], np.cumsum(segs)])
    samples = np.linspace(0, total, n)
    out = []
    si = 0
    for s in samples:
        while si < len(segs) - 1 and s > cum[si + 1]:
            si += 1
        t = (s - cum[si]) / segs[si] if segs[si] > 0 else 0
        p = (1 - t) * pts[si] + t * pts[si + 1]
        out.append((float(p[0]), float(p[1])))
    return out


def contour_to_midline(mask_bin: np.ndarray) -> List[Tuple[int, int]]:
    """Fallback: use contour longest axis as polyline.

    From combined_pipeline.py:350-369.
    """
    contours, _ = cv2.findContours(mask_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    cnt = max(contours, key=cv2.contourArea)
    pts = cnt.squeeze()
    if pts.ndim < 2 or len(pts) < 2:
        return []
    dists = np.linalg.norm(pts[:, None].astype(float) - pts[None, :].astype(float), axis=2)
    i, j = np.unravel_index(dists.argmax(), dists.shape)
    n = len(pts)
    if j < i:
        i, j = j, i
    arc1 = list(range(i, j + 1))
    arc2 = list(range(j, n)) + list(range(0, i + 1))
    arc = arc1 if len(arc1) <= len(arc2) else arc2
    return [(int(pts[k][0]), int(pts[k][1])) for k in arc]


def bspline_smooth(
    points: List[Tuple], n_output: int, smoothing: float = 0.0,
) -> Tuple[List[Tuple[float, float]], float]:
    """Fit B-spline to points and compute arc length.

    Args:
        points: input polyline points.
        n_output: number of output points.
        smoothing: splprep smoothing parameter (0 = interpolating).

    Returns:
        (smoothed_points, arc_length) tuple.
        Falls back to (points, polyline_length) if splprep fails.
    """
    pts = np.array(points, dtype=np.float64)
    if len(pts) < 4:
        # Not enough points for cubic B-spline, fall back
        segs = np.linalg.norm(pts[1:] - pts[:-1], axis=1)
        return [(float(p[0]), float(p[1])) for p in pts], float(segs.sum())

    try:
        k = min(3, len(pts) - 1)
        tck, u = splprep([pts[:, 0], pts[:, 1]], s=smoothing, k=k)

        # Dense evaluation for arc length
        u_dense = np.linspace(0, 1, max(500, len(pts) * 10))
        x_dense, y_dense = splev(u_dense, tck)
        dx = np.diff(x_dense)
        dy = np.diff(y_dense)
        arc_length = float(np.sqrt(dx**2 + dy**2).sum())

        # Output points evenly spaced along spline
        u_out = np.linspace(0, 1, n_output)
        x_out, y_out = splev(u_out, tck)
        smoothed = [(float(x), float(y)) for x, y in zip(x_out, y_out)]

        return smoothed, arc_length
    except Exception:
        # splprep can fail on degenerate inputs
        segs = np.linalg.norm(pts[1:] - pts[:-1], axis=1)
        return [(float(p[0]), float(p[1])) for p in pts], float(segs.sum())


def mask_to_polyline(
    mask: np.ndarray,
    cls: int,
    mask_threshold: float = 0.5,
    simplify_eps: float = 5.0,
    pts_per_100px: float = 32.0,
    min_pts: int = 2,
) -> List[Tuple[float, float]]:
    """Convert instance mask to a smooth polyline.

    Pipeline: skeleton → prune → BFS longest path → RDP simplify →
    uniform resampling.

    The number of output points adapts to the arc length of the structure.
    Head (cls=1) is always 3 points. Midpiece/tail use pts_per_100px density.

    Args:
        mask: Soft mask (float32).
        cls: Class ID (1=Head, 2=Midpiece, 3=Tail).
        mask_threshold: Threshold for binarization.
        simplify_eps: RDP epsilon for initial simplification (higher = smoother).
        pts_per_100px: Output point density (points per 100px of arc length).
        min_pts: Minimum number of output points.
    """
    bin_mask = (mask >= mask_threshold).astype(np.uint8)
    area = bin_mask.sum()
    if area == 0:
        return []

    # Try skeleton first
    skel = mask_to_skeleton(bin_mask)
    path = []
    if skel.sum() > 0:
        # Prune short branches before extracting longest path
        skel = prune_skeleton(skel, min_branch_length=5)
        if skel.sum() > 0:
            path = skeleton_to_ordered_path(skel)

    # Fallback to contour midline
    if len(path) < 2:
        path = contour_to_midline(bin_mask)

    # Last resort: two most distant mask pixels
    if len(path) < 2:
        ys, xs = np.where(bin_mask > 0)
        if len(ys) < 2:
            return []
        pts = np.stack([xs, ys], axis=1).astype(float)
        dists = np.linalg.norm(pts[:, None] - pts[None, :], axis=2)
        i, j = np.unravel_index(dists.argmax(), dists.shape)
        path = [(int(pts[i, 0]), int(pts[i, 1])), (int(pts[j, 0]), int(pts[j, 1]))]

    simplified = rdp_simplify(path, simplify_eps)

    # Estimate arc length from simplified path to determine output point count
    pts_arr = np.array(simplified, dtype=float)
    arc_len = float(np.linalg.norm(pts_arr[1:] - pts_arr[:-1], axis=1).sum())
    # Head (cls=1): always 3 points (start, midpoint, end) for a clean arc
    if cls == 1:
        n_output = 3
    else:
        n_output = max(min_pts, round(arc_len * pts_per_100px / 100.0))

    # Uniform resampling along the simplified polyline — stable and follows
    # the RDP-simplified path exactly without B-spline overshoot
    return resample_polyline(simplified, n_output)


def _orient_polyline_toward(
    polyline: List[Tuple[float, float]],
    target: Tuple[float, float],
    use_start: bool = True,
) -> List[Tuple[float, float]]:
    """Orient polyline so the end closest to target is at the desired position.

    Args:
        polyline: Polyline points.
        target: Reference point to orient toward.
        use_start: If True, the START of the returned polyline should be
                   closest to target. If False, the END should be closest.
    """
    if len(polyline) < 2:
        return polyline
    start = np.array(polyline[0])
    end = np.array(polyline[-1])
    tgt = np.array(target)
    d_start = np.linalg.norm(start - tgt)
    d_end = np.linalg.norm(end - tgt)
    if use_start:
        # We want START closest to target
        if d_end < d_start:
            return list(reversed(polyline))
    else:
        # We want END closest to target
        if d_start < d_end:
            return list(reversed(polyline))
    return polyline


def connect_sperm_polylines(
    sperm: dict,
    mask_threshold: float = 0.3,
    simplify_eps: float = 5.0,
    pts_per_100px: float = 32.0,
) -> dict:
    """Generate connected polylines for a complete sperm (H+M+T).

    For each part, generates a polyline via mask_to_polyline(). Then orients
    them so they flow Head → Midpiece → Tail, and at each junction replaces
    the meeting endpoints with their average so the polylines connect seamlessly.

    Args:
        sperm: Dict with "head", "midpiece", "tail" instance dicts.
        mask_threshold: Threshold for binary masks.

    Returns:
        Dict with "head", "midpiece", "tail" polylines (list of (x,y) tuples).
        Missing parts have empty lists.
    """
    cls_map = {"head": 1, "midpiece": 2, "tail": 3}
    polylines = {}
    centroids = {}

    for part_key in ["head", "midpiece", "tail"]:
        part = sperm.get(part_key)
        if part is None:
            polylines[part_key] = []
            centroids[part_key] = None
            continue
        poly = mask_to_polyline(
            part["mask"], cls_map[part_key],
            mask_threshold=mask_threshold,
            simplify_eps=simplify_eps,
            pts_per_100px=pts_per_100px,
        )
        polylines[part_key] = poly
        # Compute centroid for orientation reference
        binary = (part["mask"] >= mask_threshold).astype(np.uint8)
        ys, xs = np.where(binary > 0)
        if len(ys) > 0:
            centroids[part_key] = (float(xs.mean()), float(ys.mean()))
        else:
            centroids[part_key] = None

    h_poly = polylines["head"]
    m_poly = polylines["midpiece"]
    t_poly = polylines["tail"]

    # Orient midpiece: start near head, end near tail
    if len(m_poly) >= 2:
        if len(h_poly) >= 1 and centroids["head"] is not None:
            m_poly = _orient_polyline_toward(m_poly, centroids["head"], use_start=True)
        elif len(t_poly) >= 1 and centroids["tail"] is not None:
            m_poly = _orient_polyline_toward(m_poly, centroids["tail"], use_start=False)

    # Orient head: END should be closest to midpiece start
    if len(h_poly) >= 2 and len(m_poly) >= 1:
        h_poly = _orient_polyline_toward(h_poly, m_poly[0], use_start=False)

    # Orient tail: START should be closest to midpiece end
    if len(t_poly) >= 2 and len(m_poly) >= 1:
        t_poly = _orient_polyline_toward(t_poly, m_poly[-1], use_start=True)

    # Connect Head↔Midpiece junction: average meeting endpoints
    if len(h_poly) >= 1 and len(m_poly) >= 1:
        h_end = np.array(h_poly[-1])
        m_start = np.array(m_poly[0])
        junction = tuple(((h_end + m_start) / 2.0).tolist())
        h_poly[-1] = junction
        m_poly[0] = junction

    # Connect Midpiece↔Tail junction: average meeting endpoints
    if len(m_poly) >= 1 and len(t_poly) >= 1:
        m_end = np.array(m_poly[-1])
        t_start = np.array(t_poly[0])
        junction = tuple(((m_end + t_start) / 2.0).tolist())
        m_poly[-1] = junction
        t_poly[0] = junction

    return {"head": h_poly, "midpiece": m_poly, "tail": t_poly}
