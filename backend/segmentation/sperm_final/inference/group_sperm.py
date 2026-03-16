"""Group Head + Midpiece + Tail parts into complete sperm instances.

Adapted from:
- combined_pipeline.py:173-251 (centroid/endpoint-based grouping)
- Sperm-Detection/test_maskrcnn.py:457-595 (polyline endpoint proximity)
"""

import math
from typing import Dict, List, Optional, Tuple

import numpy as np


def endpoints_from_mask(mask: np.ndarray, threshold: float = 0.5) -> List[Tuple[float, float]]:
    """Find two most distant points in a binary mask.

    From combined_pipeline.py:182-193.
    """
    b = mask >= threshold
    ys, xs = np.where(b)
    if len(ys) == 0:
        return []
    pts = np.stack([xs, ys], axis=1).astype(float)
    if len(pts) < 2:
        return [(float(pts[0, 0]), float(pts[0, 1]))]
    dists = np.linalg.norm(pts[:, None] - pts[None, :], axis=2)
    i, j = np.unravel_index(dists.argmax(), dists.shape)
    return [(float(pts[i, 0]), float(pts[i, 1])),
            (float(pts[j, 0]), float(pts[j, 1]))]


def min_endpoint_dist(inst_a: Dict, inst_b: Dict) -> float:
    """Min distance between endpoints of two instances.

    From combined_pipeline.py:196-202.
    """
    eps_a = endpoints_from_mask(inst_a["mask"])
    eps_b = endpoints_from_mask(inst_b["mask"])
    if not eps_a or not eps_b:
        return float("inf")
    return min(
        math.hypot(a[0]-b[0], a[1]-b[1])
        for a in eps_a for b in eps_b
    )


def group_sperm_parts(
    instances: List[Dict],
    distance_threshold: float = 100.0,
) -> List[Dict]:
    """Group Head + Midpiece + Tail into complete sperm by endpoint proximity.

    Adapted from combined_pipeline.py:205-251.

    Args:
        instances: List of {"mask": ndarray, "cls": int, "score": float}.
        distance_threshold: Max endpoint distance for grouping.

    Returns:
        List of sperm dicts: {"head": inst, "midpiece": inst, "tail": inst}.
    """
    midpieces = [inst for inst in instances if inst["cls"] == 2]
    heads = [inst for inst in instances if inst["cls"] == 1]
    tails = [inst for inst in instances if inst["cls"] == 3]

    sperm_list = []
    used_heads = set()
    used_tails = set()

    for mi, mid in enumerate(midpieces):
        sperm = {"midpiece": mid, "head": None, "tail": None}

        # Find closest head
        best_h, best_hd = None, distance_threshold
        for hi, head in enumerate(heads):
            if hi in used_heads:
                continue
            d = min_endpoint_dist(mid, head)
            if d < best_hd:
                best_hd = d
                best_h = hi

        # Find closest tail
        best_t, best_td = None, distance_threshold
        for ti, tail in enumerate(tails):
            if ti in used_tails:
                continue
            d = min_endpoint_dist(mid, tail)
            if d < best_td:
                best_td = d
                best_t = ti

        if best_h is not None:
            sperm["head"] = heads[best_h]
            used_heads.add(best_h)
        if best_t is not None:
            sperm["tail"] = tails[best_t]
            used_tails.add(best_t)

        sperm_list.append(sperm)

    return sperm_list


def find_closest_tails_for_midpieces(
    polylines_list: List[Tuple[List, int]],
    distance_threshold: float = 50.0,
) -> Tuple[List, List, Dict]:
    """Connect tail/head endpoints to midpiece endpoints.

    Adapted from Sperm-Detection/test_maskrcnn.py:457-595.

    Args:
        polylines_list: List of (polyline_points, class_id) tuples.
        distance_threshold: Max connection distance.

    Returns:
        connection_lines: List of (pt1, pt2) tuples.
        distances: List of (pt, distance) tuples.
        midpiece_mutations: Dict mapping index → list of (end_pos, replacement_pt).
    """
    midpieces = [(i, poly) for i, (poly, cls) in enumerate(polylines_list) if cls == 2]
    tails = [(i, poly) for i, (poly, cls) in enumerate(polylines_list) if cls == 3]
    if not midpieces or not tails:
        return [], [], {}

    # Prepare endpoints
    midpiece_endpoints = []
    for mp_idx, mp_poly in midpieces:
        if len(mp_poly) < 2:
            continue
        midpiece_endpoints.append((mp_idx, 0, np.array(mp_poly[0], dtype=np.float32)))
        midpiece_endpoints.append((mp_idx, -1, np.array(mp_poly[-1], dtype=np.float32)))

    tail_endpoints = []
    for tail_idx, tail_poly in tails:
        if len(tail_poly) < 1:
            continue
        tail_endpoints.append((tail_idx, 0, np.array(tail_poly[0], dtype=np.float32)))
        tail_endpoints.append((tail_idx, -1, np.array(tail_poly[-1], dtype=np.float32)))

    used_midpiece_ends = set()
    used_tail_ends = set()
    connection_lines = []
    distances = []
    midpiece_mutations = {}

    # Connect tails to midpieces
    for tail_idx, tail_end_idx, tail_pt in tail_endpoints:
        if (tail_idx, tail_end_idx) in used_tail_ends:
            continue
        min_dist = float("inf")
        closest_mp = None
        closest_mp_end_idx = None
        closest_tail_pt = tail_pt

        for mp_idx, mp_end_idx, mp_pt in midpiece_endpoints:
            if (mp_idx, mp_end_idx) in used_midpiece_ends:
                continue
            dist = np.linalg.norm(mp_pt - tail_pt)
            if dist < min_dist:
                min_dist = dist
                closest_mp = mp_idx
                closest_mp_end_idx = mp_end_idx

        if closest_mp is not None and min_dist <= distance_threshold:
            mp_poly = None
            for idx, poly in midpieces:
                if idx == closest_mp:
                    mp_poly = poly
                    break
            if mp_poly is not None and len(mp_poly) >= 2:
                if closest_mp_end_idx == 0:
                    connect_pt = np.array(mp_poly[1], dtype=np.float32)
                else:
                    connect_pt = np.array(mp_poly[-2], dtype=np.float32)
                connection_lines.append((tuple(connect_pt), tuple(closest_tail_pt)))
                distances.append((tuple(connect_pt), min_dist))
                used_midpiece_ends.add((closest_mp, closest_mp_end_idx))
                used_tail_ends.add((tail_idx, tail_end_idx))
                midpiece_mutations.setdefault(closest_mp, []).append(
                    (closest_mp_end_idx, tuple(closest_tail_pt))
                )

    # Connect heads to remaining midpiece endpoints
    headpieces = [(i, poly) for i, (poly, cls) in enumerate(polylines_list) if cls == 1]
    head_endpoints = []
    for head_idx, head_poly in headpieces:
        if len(head_poly) < 1:
            continue
        head_endpoints.append((head_idx, 0, np.array(head_poly[0], dtype=np.float32)))
        if len(head_poly) > 1:
            head_endpoints.append((head_idx, -1, np.array(head_poly[-1], dtype=np.float32)))

    available_mp = [
        (mp_idx, mp_end_idx, mp_pt)
        for (mp_idx, mp_end_idx, mp_pt) in midpiece_endpoints
        if (mp_idx, mp_end_idx) not in used_midpiece_ends
    ]

    used_head_ends = set()
    used_mp_head = set()

    for head_idx, head_end_idx, head_pt in head_endpoints:
        if (head_idx, head_end_idx) in used_head_ends:
            continue
        min_dist = float("inf")
        closest_mp = None
        closest_mp_end_idx = None

        for mp_idx, mp_end_idx, mp_pt in available_mp:
            if (mp_idx, mp_end_idx) in used_mp_head:
                continue
            dist = np.linalg.norm(mp_pt - head_pt)
            if dist < min_dist:
                min_dist = dist
                closest_mp = mp_idx
                closest_mp_end_idx = mp_end_idx

        if closest_mp is not None and min_dist <= distance_threshold + 20.0:
            mp_poly = None
            for idx, poly in midpieces:
                if idx == closest_mp:
                    mp_poly = poly
                    break
            if mp_poly is not None and len(mp_poly) >= 2:
                if closest_mp_end_idx == 0:
                    connect_pt = np.array(mp_poly[1], dtype=np.float32)
                else:
                    connect_pt = np.array(mp_poly[-2], dtype=np.float32)
                connection_lines.append((tuple(head_pt), tuple(connect_pt)))
                distances.append((tuple(head_pt), min_dist))
                used_head_ends.add((head_idx, head_end_idx))
                used_mp_head.add((closest_mp, closest_mp_end_idx))
                midpiece_mutations.setdefault(closest_mp, []).append(
                    (closest_mp_end_idx, tuple(head_pt))
                )

    return connection_lines, distances, midpiece_mutations
