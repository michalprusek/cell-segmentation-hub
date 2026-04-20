"""Min-cost max-flow graph optimization for sperm part assembly.

Graph enforces complete sperm only (Head→Midpiece→Tail):
- Only Heads can start a flow path (S → Head_in)
- Only Tails can end a flow path (Tail_out → T)
- Incomplete paths are impossible by construction

Handles containment via effective area discounting, crossing detection
via skeleton junction analysis, and same-class fragment merging.
"""

from collections import deque
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import networkx as nx
from skimage.morphology import skeletonize

from sperm_final.config import GraphAssemblyConfig


def _skeleton_endpoints_and_tangents(
    binary: np.ndarray,
    tangent_n_pts: int = 8,
) -> List[Tuple[np.ndarray, np.ndarray]]:
    """Extract skeleton endpoints and their tangent vectors.

    Returns:
        List of (endpoint_xy, tangent_unit_vec) tuples (0 or 2 entries).
        Empty if skeleton is degenerate.
    """
    if binary.sum() < 10:
        return []
    skel = skeletonize(binary > 0).astype(np.uint8)
    ys, xs = np.where(skel > 0)
    if len(ys) < 3:
        return []
    pts_set = set(zip(xs.tolist(), ys.tolist()))

    def nbrs(p):
        x, y = p
        return [(x + dx, y + dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                if (dx or dy) and (x + dx, y + dy) in pts_set]

    adj = {p: nbrs(p) for p in pts_set}
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

    if len(path) < 2:
        return []

    results = []
    for end_idx, slice_pts in [(0, path[:tangent_n_pts]),
                                (-1, path[-tangent_n_pts:][::-1])]:
        ep = np.array(path[end_idx] if end_idx == 0 else path[-1], dtype=float)
        if len(slice_pts) >= 2:
            far_pt = np.array(slice_pts[-1], dtype=float)
            tangent = far_pt - ep
            norm = np.linalg.norm(tangent)
            if norm > 0:
                tangent /= norm
            else:
                tangent = np.array([0.0, 0.0])
        else:
            tangent = np.array([0.0, 0.0])
        results.append((ep, tangent))
    return results


def compute_instance_features(
    inst: Dict,
    mask_threshold: float,
    tangent_n_pts: int = 8,
) -> Dict:
    """Compute geometric features for a single instance.

    Returns dict with: area, centroid, orientation, skeleton_endpoints,
    tangent_vectors, bbox, binary_mask.
    """
    binary = (inst["mask"] >= mask_threshold).astype(np.uint8)
    area = int(binary.sum())

    moments = cv2.moments(binary)
    if moments["m00"] > 0:
        cx = moments["m10"] / moments["m00"]
        cy = moments["m01"] / moments["m00"]
    else:
        ys, xs = np.where(binary > 0)
        cx = float(xs.mean()) if len(xs) > 0 else 0.0
        cy = float(ys.mean()) if len(ys) > 0 else 0.0

    mu20 = moments["mu20"]
    mu02 = moments["mu02"]
    mu11 = moments["mu11"]
    orientation = 0.5 * np.degrees(np.arctan2(2 * mu11, mu20 - mu02))
    if orientation < 0:
        orientation += 180.0

    ys, xs = np.where(binary > 0)
    if len(ys) > 0:
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    else:
        bbox = (0, 0, 0, 0)

    # Skeleton endpoints and tangents (skip for Head — blob-like)
    ep_tangents = []
    if inst["cls"] != 1 and area >= 10:
        ep_tangents = _skeleton_endpoints_and_tangents(binary, tangent_n_pts)

    return {
        "area": area,
        "centroid": (cx, cy),
        "orientation": orientation,
        "ep_tangents": ep_tangents,  # list of (endpoint_xy, tangent_vec)
        "bbox": bbox,
        "binary": binary,
        "cls": inst["cls"],
        "score": inst["score"],
    }


def compute_effective_areas(
    features: List[Dict],
    discount: float,
) -> List[float]:
    """Compute effective areas with overlap discounting.

    For each instance, subtract overlap with higher-scoring same-class instances.
    This handles containment without explicit removal: small contained duplicates
    get near-zero effective area → near-zero reward → solver ignores them.
    """
    n = len(features)
    effective = [float(f["area"]) for f in features]

    # Sort indices by score descending
    sorted_indices = sorted(range(n), key=lambda i: -features[i]["score"])

    # For each instance (in score order), subtract overlap with higher-scoring same-class
    processed_by_class: Dict[int, List[int]] = {}  # cls -> [indices already processed]
    for i in sorted_indices:
        cls_i = features[i]["cls"]
        bin_i = features[i]["binary"]

        # Check overlap with all higher-scoring same-class instances
        for j in processed_by_class.get(cls_i, []):
            bin_j = features[j]["binary"]
            overlap = int((bin_i & bin_j).sum())
            if overlap > 0:
                effective[i] -= discount * overlap

        effective[i] = max(0.0, effective[i])
        processed_by_class.setdefault(cls_i, []).append(i)

    return effective


def _bbox_close(
    bbox_a: Tuple[int, int, int, int],
    bbox_b: Tuple[int, int, int, int],
    max_gap: float,
) -> bool:
    """Check if two bounding boxes are within max_gap pixels of each other."""
    gap_x = max(0, max(bbox_a[0], bbox_b[0]) - min(bbox_a[2], bbox_b[2]))
    gap_y = max(0, max(bbox_a[1], bbox_b[1]) - min(bbox_a[3], bbox_b[3]))
    return (gap_x * gap_x + gap_y * gap_y) <= max_gap * max_gap


def _skeletons_cross(
    bin_a: np.ndarray,
    bin_b: np.ndarray,
) -> bool:
    """Detect crossing by checking for junction pixels in the union skeleton.

    Two same-class instances cross if their combined skeleton has junction
    pixels (pixels with >= 3 skeleton neighbors). This indicates the skeletons
    merge/branch at an intersection point.
    """
    union = (bin_a | bin_b).astype(np.uint8)
    if union.sum() < 10:
        return False

    skel = skeletonize(union > 0).astype(np.uint8)
    ys, xs = np.where(skel > 0)
    if len(ys) < 3:
        return False

    pts_set = set(zip(xs.tolist(), ys.tolist()))
    for x, y in pts_set:
        nbr_count = sum(
            1 for dy in (-1, 0, 1) for dx in (-1, 0, 1)
            if (dx or dy) and (x + dx, y + dy) in pts_set
        )
        if nbr_count >= 3:
            return True
    return False


def detection_reward(effective_area: float, score: float, alpha: float) -> int:
    """Compute reward for selecting an instance. Higher = more desirable."""
    return max(1, round(alpha * effective_area * score))


def _endpoint_distance_head(feat_head: Dict, feat_other: Dict) -> float:
    """Distance from head centroid to closest skeleton endpoint of other instance."""
    hc = np.array(feat_head["centroid"])
    if not feat_other["ep_tangents"]:
        oc = np.array(feat_other["centroid"])
        return float(np.linalg.norm(hc - oc))
    return min(float(np.linalg.norm(hc - ep)) for ep, _ in feat_other["ep_tangents"])


def _apply_learned_cost(
    hand_cost: int,
    feat_a: Dict,
    feat_b: Dict,
    config: GraphAssemblyConfig,
    edge_type: int,
    image_diag: Optional[float] = None,
    edge_cost_mlp=None,
) -> int:
    """Blend hand-tuned cost with learned MLP cost if available.

    hand_cost: integer cost from hand-tuned branch
    edge_type: 0=H→M, 1=M→T, 2=same-class merge (see edge_cost_mlp.EDGE_*)
    """
    if edge_cost_mlp is None or not config.use_learned_costs:
        return hand_cost
    if config.learned_skip_merge and edge_type == 2:
        return hand_cost
    emb_a = feat_a.get("embedding")
    emb_b = feat_b.get("embedding")
    if emb_a is None or emb_b is None:
        return hand_cost

    import torch
    from sperm_final.models.edge_cost_mlp import extract_geom_features

    diag = image_diag if image_diag is not None else 4000.0
    geom = extract_geom_features(feat_a, feat_b, diag)
    device = next(edge_cost_mlp.parameters()).device
    z_i = torch.as_tensor(emb_a, device=device, dtype=torch.float32).unsqueeze(0)
    z_j = torch.as_tensor(emb_b, device=device, dtype=torch.float32).unsqueeze(0)
    g = torch.as_tensor(geom, device=device, dtype=torch.float32).unsqueeze(0)
    with torch.no_grad():
        logits = edge_cost_mlp(z_i, z_j, g)[0]  # (3,)
    prob = torch.sigmoid(logits[edge_type]).item()
    learned_cost = max(1, round(config.learned_scale * (1.0 - prob)))

    hw = config.hybrid_weight
    if hw >= 0.999:
        return learned_cost
    if hw <= 0.001:
        return hand_cost
    return max(1, round(hw * learned_cost + (1.0 - hw) * hand_cost))


def connection_cost(
    feat_a: Dict,
    feat_b: Dict,
    config: GraphAssemblyConfig,
    edge_cost_mlp=None,
    image_diag: Optional[float] = None,
) -> Optional[int]:
    """Compute cost of connecting two cross-class instances.

    For cross-class connections (Head→Midpiece, Midpiece→Tail), the tangents
    at each endpoint point INTO their own skeleton (away from the connection
    partner). So we check: tangent at A should point AWAY from B (i.e.,
    aligned with the direction from B to A).

    Returns None if connection is infeasible (too far).

    When `edge_cost_mlp` is provided and `config.use_learned_costs=True`, the
    hand-tuned cost is blended with the learned MLP score per `config.hybrid_weight`.
    """
    cls_a, cls_b = feat_a["cls"], feat_b["cls"]
    # Edge type index used by learned MLP (0=H→M, 1=M→T)
    edge_type = 0 if cls_a == 1 else 1

    # Head uses centroid-based distance
    if cls_a == 1:  # Head -> Midpiece
        dist = _endpoint_distance_head(feat_a, feat_b)
        if dist > config.max_connection_dist:
            return None
        # Tangent penalty: midpiece endpoint tangent should point AWAY from head
        angle_penalty = 0.0
        if feat_b["ep_tangents"]:
            hc = np.array(feat_a["centroid"])
            best_angle = 180.0
            for ep, tg in feat_b["ep_tangents"]:
                if np.linalg.norm(tg) < 0.5:
                    continue
                dir_away = ep - hc
                d = np.linalg.norm(dir_away)
                if d > 0:
                    dir_away /= d
                angle = np.degrees(np.arccos(np.clip(np.dot(tg, dir_away), -1, 1)))
                best_angle = min(best_angle, angle)
            angle_penalty = best_angle
        hand_cost = max(1, round(config.w_dist * dist + config.w_angle * angle_penalty))
        return _apply_learned_cost(hand_cost, feat_a, feat_b, config,
                                     edge_type=edge_type, image_diag=image_diag,
                                     edge_cost_mlp=edge_cost_mlp)

    # Midpiece -> Tail (both have skeleton endpoints)
    if not feat_a["ep_tangents"] or not feat_b["ep_tangents"]:
        # Fallback: centroid distance
        dist = np.linalg.norm(
            np.array(feat_a["centroid"]) - np.array(feat_b["centroid"])
        )
        if dist > config.max_connection_dist:
            return None
        hand_cost = max(1, round(config.w_dist * dist))
        return _apply_learned_cost(hand_cost, feat_a, feat_b, config,
                                     edge_type=edge_type, image_diag=image_diag,
                                     edge_cost_mlp=edge_cost_mlp)

    # Find best endpoint pair
    best_cost = None
    for ep_a, tg_a in feat_a["ep_tangents"]:
        for ep_b, tg_b in feat_b["ep_tangents"]:
            dist = float(np.linalg.norm(ep_a - ep_b))
            if dist > config.max_connection_dist:
                continue

            # Tangent at A should point AWAY from B
            angle_a = 0.0
            if np.linalg.norm(tg_a) >= 0.5:
                dir_away_from_b = ep_a - ep_b
                d = np.linalg.norm(dir_away_from_b)
                if d > 0:
                    dir_away_from_b /= d
                angle_a = np.degrees(np.arccos(np.clip(np.dot(tg_a, dir_away_from_b), -1, 1)))

            # Tangent at B should point AWAY from A
            angle_b = 0.0
            if np.linalg.norm(tg_b) >= 0.5:
                dir_away_from_a = ep_b - ep_a
                d = np.linalg.norm(dir_away_from_a)
                if d > 0:
                    dir_away_from_a /= d
                angle_b = np.degrees(np.arccos(np.clip(np.dot(tg_b, dir_away_from_a), -1, 1)))

            angle_penalty = (angle_a + angle_b) / 2.0
            cost = round(config.w_dist * dist + config.w_angle * angle_penalty)
            if best_cost is None or cost < best_cost:
                best_cost = cost

    if best_cost is None:
        return None
    hand_cost = max(1, best_cost)
    return _apply_learned_cost(hand_cost, feat_a, feat_b, config,
                                 edge_type=edge_type, image_diag=image_diag,
                                 edge_cost_mlp=edge_cost_mlp)


def merge_cost(
    feat_a: Dict,
    feat_b: Dict,
    config: GraphAssemblyConfig,
) -> Optional[int]:
    """Compute cost of merging two same-class instances.

    Returns None if merge is infeasible (incompatible orientation, too far, or crossing).
    Negative cost = reward for merging overlapping fragments.
    """
    bin_a = feat_a["binary"]
    bin_b = feat_b["binary"]

    # Orientation guard for non-Head classes
    if feat_a["cls"] != 1:
        angle_a = feat_a["orientation"]
        angle_b = feat_b["orientation"]
        diff = abs(angle_a - angle_b) % 180
        if diff > 90:
            diff = 180 - diff
        if diff > config.merge_max_angle_diff:
            return None

        # Collinearity check
        ca = np.array(feat_a["centroid"])
        cb = np.array(feat_b["centroid"])
        dx = cb[0] - ca[0]
        dy = cb[1] - ca[1]
        if abs(dx) >= 1 or abs(dy) >= 1:
            vec_angle = np.degrees(np.arctan2(dy, dx)) % 180
            for orient in [angle_a, angle_b]:
                d = abs(vec_angle - orient) % 180
                if d > 90:
                    d = 180 - d
                if d > config.merge_max_angle_diff:
                    return None

    # Crossing detection: if union skeleton has junctions, these are crossing instances
    if feat_a["cls"] != 1 and _skeletons_cross(bin_a, bin_b):
        return None

    # Check overlap
    overlap = int((bin_a & bin_b).sum())
    smaller_area = min(feat_a["area"], feat_b["area"])

    if overlap > 0 and smaller_area > 0:
        overlap_ratio = overlap / smaller_area
        # Negative cost = reward for merging overlapping fragments
        return -round(config.merge_overlap_bonus * overlap_ratio)

    # Check gap distance (adjacent fragments)
    gap_limit = int(config.max_merge_gap)
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (2 * gap_limit + 1, 2 * gap_limit + 1)
    )
    dilated = cv2.dilate(bin_a, kernel, iterations=1)
    if not bool(np.any(dilated & bin_b)):
        return None  # too far apart

    # Estimate gap distance from bounding box proximity
    bx_a = feat_a["bbox"]
    bx_b = feat_b["bbox"]
    gap_x = max(0, max(bx_a[0], bx_b[0]) - min(bx_a[2], bx_b[2]))
    gap_y = max(0, max(bx_a[1], bx_b[1]) - min(bx_a[3], bx_b[3]))
    gap_dist = np.sqrt(gap_x**2 + gap_y**2)

    # Tangent penalty for elongated fragments
    tangent_penalty = 0.0
    if feat_a["ep_tangents"] and feat_b["ep_tangents"]:
        best_angle = 180.0
        for ep_a, tg_a in feat_a["ep_tangents"]:
            for ep_b, tg_b in feat_b["ep_tangents"]:
                if np.linalg.norm(tg_a) < 0.5 or np.linalg.norm(tg_b) < 0.5:
                    continue
                dir_ab = ep_b - ep_a
                d = np.linalg.norm(dir_ab)
                if d > 0:
                    dir_ab /= d
                a1 = np.degrees(np.arccos(np.clip(np.dot(tg_a, dir_ab), -1, 1)))
                a2 = np.degrees(np.arccos(np.clip(np.dot(tg_b, -dir_ab), -1, 1)))
                best_angle = min(best_angle, (a1 + a2) / 2.0)
        tangent_penalty = best_angle

    return max(1, round(config.merge_w_gap * gap_dist + config.merge_w_tangent * tangent_penalty))


def build_assembly_graph(
    instances: List[Dict],
    mask_threshold: float,
    config: GraphAssemblyConfig = None,
    edge_cost_mlp=None,
    image_diag: Optional[float] = None,
) -> nx.DiGraph:
    """Build min-cost flow graph for sperm part assembly.

    Graph structure enforces complete sperm (H+M+T) only:
    - S → Head_in (only Heads can start a path)
    - Tail_out → T (only Tails can end a path)
    - Head_out → Midpiece_in, Midpiece_out → Tail_in (cross-class)
    - Same-class merge edges (i_out → j_in)
    - S → T bypass absorbs unused supply

    Containment is handled by effective area discounting (not explicit removal).
    """
    if config is None:
        config = GraphAssemblyConfig()

    N = len(instances)
    if N == 0:
        G = nx.DiGraph()
        G.add_node("S", demand=-0)
        G.add_node("T", demand=0)
        return G, [], []

    # Step 1: compute features + propagate per-instance embedding (needed by MLP)
    features = []
    for inst in instances:
        feat = compute_instance_features(inst, mask_threshold, config.tangent_n_pts)
        if "embedding" in inst:
            feat["embedding"] = inst["embedding"]
        features.append(feat)

    # Step 2: compute effective areas (handles containment)
    effective_areas = compute_effective_areas(features, config.effective_area_discount)

    # Step 3: create graph with S, T
    G = nx.DiGraph()
    supply = N
    G.add_node("S", demand=-supply)
    G.add_node("T", demand=supply)

    # Bypass edge: absorbs unused supply
    G.add_edge("S", "T", capacity=supply, weight=0)

    # Step 4: per-instance edges — only Heads enter from S, only Tails exit to T
    for i, feat in enumerate(features):
        i_in = f"{i}_in"
        i_out = f"{i}_out"
        G.add_node(i_in, demand=0)
        G.add_node(i_out, demand=0)

        # Detection reward (negative cost = reward)
        reward = detection_reward(effective_areas[i], feat["score"], config.alpha)
        G.add_edge(i_in, i_out, capacity=1, weight=-reward)

        cls = feat["cls"]

        # Entry: only Heads can start a path
        if cls == 1:  # Head
            G.add_edge("S", i_in, capacity=1, weight=0)

        # Exit: only Tails can end a path
        if cls == 3:  # Tail
            G.add_edge(i_out, "T", capacity=1, weight=0)

    # Step 5: cross-class connection edges with bbox pruning
    heads = [(i, f) for i, f in enumerate(features) if f["cls"] == 1]
    midpieces = [(i, f) for i, f in enumerate(features) if f["cls"] == 2]
    tails = [(i, f) for i, f in enumerate(features) if f["cls"] == 3]

    # Head → Midpiece
    for hi, hf in heads:
        for mi, mf in midpieces:
            if not _bbox_close(hf["bbox"], mf["bbox"], config.bbox_prune_gap):
                continue
            cost = connection_cost(hf, mf, config,
                                    edge_cost_mlp=edge_cost_mlp, image_diag=image_diag)
            if cost is not None:
                G.add_edge(f"{hi}_out", f"{mi}_in", capacity=1, weight=cost)

    # Midpiece → Tail
    for mi, mf in midpieces:
        for ti, tf in tails:
            if not _bbox_close(mf["bbox"], tf["bbox"], config.bbox_prune_gap):
                continue
            cost = connection_cost(mf, tf, config,
                                    edge_cost_mlp=edge_cost_mlp, image_diag=image_diag)
            if cost is not None:
                G.add_edge(f"{mi}_out", f"{ti}_in", capacity=1, weight=cost)

    # Step 6: same-class merge edges (i_out → j_in, i < j) with bbox pruning
    by_class = {}
    for i, feat in enumerate(features):
        by_class.setdefault(feat["cls"], []).append(i)

    for cls, indices in by_class.items():
        for ai in range(len(indices)):
            i = indices[ai]
            for bi in range(ai + 1, len(indices)):
                j = indices[bi]
                if not _bbox_close(features[i]["bbox"], features[j]["bbox"],
                                   config.bbox_prune_gap):
                    continue
                cost = merge_cost(features[i], features[j], config)
                if cost is not None:
                    G.add_edge(f"{i}_out", f"{j}_in", capacity=1, weight=cost)

    return G, features, effective_areas


def solve_assembly(graph: nx.DiGraph) -> Tuple[int, Dict]:
    """Solve the min-cost flow problem using network simplex.

    Returns:
        (total_cost, flow_dict) where flow_dict[u][v] = flow on edge (u,v).
    """
    cost, flow_dict = nx.network_simplex(graph)
    return cost, flow_dict


def extract_flow_paths(
    flow_dict: Dict,
    n_instances: int,
) -> List[List[int]]:
    """Trace S->T paths through the flow solution.

    Returns list of instance-index lists, one per sperm.
    Each path follows: S -> i_in -> i_out -> (j_in -> j_out ->) ... -> T
    """
    paths = []

    # Find all edges leaving S with flow > 0
    s_flows = flow_dict.get("S", {})
    for next_node, flow in s_flows.items():
        if flow <= 0:
            continue
        if next_node == "T":
            continue  # bypass edge

        # Trace path from this starting node
        path_indices = []
        current = next_node
        visited = set()

        while current != "T" and current not in visited:
            visited.add(current)

            if current.endswith("_in"):
                # This is an instance input — extract index
                idx = int(current.rsplit("_", 1)[0])
                path_indices.append(idx)
                # Must go to i_out
                out_node = f"{idx}_out"
                if flow_dict.get(current, {}).get(out_node, 0) > 0:
                    current = out_node
                else:
                    break
            elif current.endswith("_out"):
                # Find next node with flow > 0
                out_flows = flow_dict.get(current, {})
                next_found = False
                for nxt, f in out_flows.items():
                    if f > 0:
                        current = nxt
                        next_found = True
                        break
                if not next_found:
                    break
            else:
                break

        if path_indices:
            paths.append(path_indices)

    return paths


def paths_to_sperm(
    paths: List[List[int]],
    instances: List[Dict],
    features: List[Dict],
    mask_threshold: float,
) -> List[Dict]:
    """Convert flow paths to sperm dicts, keeping only complete sperm (H+M+T).

    Each path groups instances by class and merges same-class masks.
    Incomplete paths (missing any of Head, Midpiece, Tail) are discarded.

    Returns:
        List of {"head": inst, "midpiece": inst, "tail": inst} — all 3 always present.
    """
    sperm_list = []

    for path in paths:
        # Group by class
        by_class = {}
        for idx in path:
            cls = features[idx]["cls"]
            by_class.setdefault(cls, []).append(idx)

        # Check completeness: must have all 3 classes
        if not {1, 2, 3}.issubset(by_class.keys()):
            continue  # incomplete — discard

        sperm = {}
        cls_to_key = {1: "head", 2: "midpiece", 3: "tail"}

        for cls, indices in by_class.items():
            key = cls_to_key.get(cls)
            if key is None:
                continue

            if len(indices) == 1:
                sperm[key] = instances[indices[0]]
            else:
                # Merge masks
                merged_mask = np.zeros_like(instances[indices[0]]["mask"])
                best_score = 0.0
                for idx in indices:
                    merged_mask = np.maximum(merged_mask, instances[idx]["mask"])
                    best_score = max(best_score, instances[idx]["score"])
                sperm[key] = {"mask": merged_mask, "cls": cls, "score": best_score}

        sperm_list.append(sperm)

    return sperm_list


def assemble_sperm_graph(
    instances: List[Dict],
    mask_threshold: float,
    config: GraphAssemblyConfig = None,
    edge_cost_mlp=None,
    image_diag: Optional[float] = None,
) -> List[Dict]:
    """Top-level: build graph -> solve -> extract -> filter complete only.

    Args:
        instances: List of {"mask", "cls", "score", [optional] "embedding"}.
        mask_threshold: Threshold for binary masks.
        config: Graph assembly configuration.
        edge_cost_mlp: Optional EdgeCostMLP for learned costs. Requires each
            instance to carry an "embedding" field (from v12 InstanceEmbedHead).
        image_diag: Image diagonal in pixels (for geom-feature normalization).

    Returns:
        List of sperm dicts: {"head": inst, "midpiece": inst, "tail": inst}.
        Only complete sperm (all 3 parts present) are returned.
    """
    if config is None:
        config = GraphAssemblyConfig()

    if not instances:
        return []

    graph, features, effective_areas = build_assembly_graph(
        instances, mask_threshold, config,
        edge_cost_mlp=edge_cost_mlp, image_diag=image_diag,
    )
    cost, flow_dict = solve_assembly(graph)
    paths = extract_flow_paths(flow_dict, len(instances))
    sperm_list = paths_to_sperm(paths, instances, features, mask_threshold)

    return sperm_list
