"""Sliding window prediction with NMS merging.

Adapted from combined_pipeline.py:48-156.
"""

import logging
from typing import Dict, List, Tuple

import cv2
import numpy as np
import torch
import torch.nn.functional as F

from sperm_final.config import ID_TO_CLASS, NUM_CLASSES
from sperm_final.data.dataset import IMAGENET_MEAN, IMAGENET_STD

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helper functions for three-phase post-processing
# ---------------------------------------------------------------------------


def _compute_mask_orientation(binary_mask: np.ndarray) -> Tuple[float, Tuple[float, float]]:
    """Compute orientation angle and centroid of a binary mask using image moments.

    Returns:
        (angle_degrees, (cx, cy)) — angle in [0, 180), centroid coords.
    """
    moments = cv2.moments(binary_mask.astype(np.uint8))
    area = moments["m00"]
    if area < 1:
        return 0.0, (0.0, 0.0)
    cx = moments["m10"] / area
    cy = moments["m01"] / area
    # Orientation from central moments
    mu20 = moments["mu20"]
    mu02 = moments["mu02"]
    mu11 = moments["mu11"]
    angle = 0.5 * np.degrees(np.arctan2(2 * mu11, mu20 - mu02))
    if angle < 0:
        angle += 180.0
    return angle, (cx, cy)


def _masks_are_proximate(mask_a: np.ndarray, mask_b: np.ndarray, gap_px: int) -> bool:
    """Check if two binary masks are within gap_px pixels of each other."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE,
                                       (2 * gap_px + 1, 2 * gap_px + 1))
    dilated = cv2.dilate(mask_a.astype(np.uint8), kernel, iterations=1)
    return bool(np.any(dilated & mask_b.astype(np.uint8)))


def _orientations_compatible(
    angle_a: float,
    angle_b: float,
    centroid_a: Tuple[float, float],
    centroid_b: Tuple[float, float],
    max_angle_diff: float,
) -> bool:
    """Check orientation compatibility: angle difference AND collinearity.

    Two fragments are compatible if:
    1. Their orientations are similar (within max_angle_diff degrees).
    2. The inter-centroid vector is roughly aligned with both orientations.
    """
    # Angle difference normalized to [0, 90]
    diff = abs(angle_a - angle_b) % 180
    if diff > 90:
        diff = 180 - diff
    if diff > max_angle_diff:
        return False

    # Collinearity: check inter-centroid vector vs orientations
    dx = centroid_b[0] - centroid_a[0]
    dy = centroid_b[1] - centroid_a[1]
    if abs(dx) < 1 and abs(dy) < 1:
        return True  # centroids coincide — trivially compatible
    vec_angle = np.degrees(np.arctan2(dy, dx)) % 180

    for orient in [angle_a, angle_b]:
        d = abs(vec_angle - orient) % 180
        if d > 90:
            d = 180 - d
        if d > max_angle_diff:
            return False
    return True


def _accumulate_soft_masks(
    raw_instances: List[Dict],
    mask_threshold: float,
) -> List[Dict]:
    """Phase 1: Merge overlapping same-class predictions by averaging soft masks.

    When multiple patches predict the same instance (IoU > 0.5), average
    their soft (sigmoid) masks to produce smoother, more complete masks.
    """
    raw_instances.sort(key=lambda x: -x["score"])
    accumulated = []
    for inst in raw_instances:
        b1 = inst["mask"] >= mask_threshold
        matched = False
        for acc in accumulated:
            if acc["cls"] != inst["cls"]:
                continue
            b2 = acc["mask"] >= mask_threshold
            intersection = (b1 & b2).sum()
            union_area = (b1 | b2).sum()
            if union_area > 0 and intersection / union_area > 0.3:
                # Average the soft masks
                count = acc["_acc_count"]
                acc["mask"] = (acc["mask"] * count + inst["mask"]) / (count + 1)
                acc["score"] = max(acc["score"], inst["score"])
                acc["_acc_count"] = count + 1
                matched = True
                break
        if not matched:
            accumulated.append({**inst, "_acc_count": 1})
    # Clean up internal key
    for acc in accumulated:
        acc.pop("_acc_count", None)
    return accumulated


def _merge_fragments_with_orientation(
    instances: List[Dict],
    merge_iou_threshold: float,
    proximity_gap: int,
    max_angle_diff: float,
    mask_threshold: float,
) -> List[Dict]:
    """Phase 3: Merge same-class fragments that overlap or are nearby.

    Uses orientation guard to prevent merging distinct parallel instances.
    Head class (cls=1) skips orientation check (nearly circular).
    """
    merged = list(instances)
    changed = True
    while changed:
        changed = False
        new_merged = []
        used = set()
        for i in range(len(merged)):
            if i in used:
                continue
            inst_i = merged[i]
            bi = (inst_i["mask"] >= mask_threshold).astype(np.uint8)
            bi_area = int(bi.sum())
            # Accumulate merges into this instance
            combined_mask = inst_i["mask"].copy()
            combined_score = inst_i["score"]

            for j in range(i + 1, len(merged)):
                if j in used:
                    continue
                inst_j = merged[j]
                if inst_i["cls"] != inst_j["cls"]:
                    continue
                bj = (inst_j["mask"] >= mask_threshold).astype(np.uint8)
                bj_area = int(bj.sum())

                # Check if candidate for merging
                inter = int((bi & bj).sum())
                smaller = min(bi_area, bj_area)
                is_candidate = False

                if smaller > 0 and inter / smaller > merge_iou_threshold:
                    is_candidate = True
                elif proximity_gap > 0 and _masks_are_proximate(bi, bj, proximity_gap):
                    is_candidate = True

                if not is_candidate:
                    continue

                # Orientation guard (skip for Head class)
                if inst_i["cls"] != 1:  # not Head
                    angle_i, cent_i = _compute_mask_orientation(bi)
                    angle_j, cent_j = _compute_mask_orientation(bj)
                    if not _orientations_compatible(
                        angle_i, angle_j, cent_i, cent_j, max_angle_diff
                    ):
                        continue

                # Merge: average soft masks in overlap, union elsewhere
                overlap = (bi & bj).astype(bool)
                merged_mask = np.maximum(combined_mask, inst_j["mask"])
                if overlap.any():
                    merged_mask[overlap] = (
                        combined_mask[overlap] + inst_j["mask"][overlap]
                    ) / 2.0
                combined_mask = merged_mask
                combined_score = max(combined_score, inst_j["score"])
                # Update binary mask for subsequent comparisons
                bi = (combined_mask >= mask_threshold).astype(np.uint8)
                bi_area = int(bi.sum())
                used.add(j)
                changed = True

            new_merged.append({
                "mask": combined_mask,
                "cls": inst_i["cls"],
                "score": combined_score,
            })
            used.add(i)
        merged = new_merged
    return merged


def _chain_link_fragments(
    instances: List[Dict],
    mask_threshold: float,
    max_endpoint_dist: float = 60.0,
    max_tangent_angle: float = 40.0,
    tangent_n_pts: int = 8,
    min_area: int = 10,
) -> List[Dict]:
    """Merge same-class fragments whose skeleton endpoints point at each other.

    For each instance, extracts the skeleton's longest-path endpoints and
    computes a local tangent direction (from last `tangent_n_pts` skeleton
    points near each endpoint).  Two fragments are linked if:

    1. Same class (Head class is skipped — blob-like).
    2. Closest endpoint pair distance < max_endpoint_dist.
    3. Tangent at endpoint A roughly points toward endpoint B (angle < max_tangent_angle).
    4. Tangent at endpoint B roughly points toward endpoint A (angle < max_tangent_angle).

    Links are resolved greedily (best pair first, each endpoint used once),
    then connected components of the link graph are merged.
    """
    from skimage.morphology import skeletonize
    from collections import deque

    # --- helpers ---
    def _skeleton_endpoints_and_tangents(mask, cls_id):
        """Return [(endpoint_xy, tangent_unit_vec), ...] for each end of the
        skeleton's longest path.  Returns [] if skeleton is degenerate."""
        binary = (mask >= mask_threshold).astype(np.uint8)
        if binary.sum() < min_area:
            return []
        skel = skeletonize(binary > 0).astype(np.uint8)
        ys, xs = np.where(skel > 0)
        if len(ys) < 3:
            return []
        pts_set = set(zip(xs.tolist(), ys.tolist()))

        def nbrs(p):
            x, y = p
            return [(x+dx, y+dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                    if (dx or dy) and (x+dx, y+dy) in pts_set]

        adj = {p: nbrs(p) for p in pts_set}
        eps = [p for p, n in adj.items() if len(n) == 1]
        start = eps[0] if eps else next(iter(adj))

        def bfs(s):
            dist = {s: 0}; parent = {s: None}; q = deque([s])
            while q:
                u = q.popleft()
                for v in adj.get(u, []):
                    if v not in dist:
                        dist[v] = dist[u] + 1; parent[v] = u; q.append(v)
            far = max(dist, key=dist.get)
            return far, parent

        a, _ = bfs(start)
        b, parent = bfs(a)
        path = []
        cur = b
        while cur is not None:
            path.append(cur); cur = parent[cur]
        path.reverse()

        if len(path) < 2:
            return []

        results = []
        for end_idx, slice_pts in [(0, path[:tangent_n_pts]),
                                    (-1, path[-tangent_n_pts:][::-1])]:
            ep = np.array(path[end_idx] if end_idx == 0 else path[-1], dtype=float)
            if len(slice_pts) >= 2:
                # Tangent: direction from endpoint outward along the skeleton
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

    # --- extract endpoint info for all instances ---
    # Skip Head class (cls=1) — blob-like, not elongated
    ep_info = []  # list of (inst_idx, endpoint_xy, tangent_vec, end_id)
    non_head_indices = []
    for idx, inst in enumerate(instances):
        if inst["cls"] == 1:
            continue
        non_head_indices.append(idx)
        endpoints = _skeleton_endpoints_and_tangents(inst["mask"], inst["cls"])
        for eid, (ep, tg) in enumerate(endpoints):
            ep_info.append((idx, ep, tg, eid))

    if len(ep_info) < 2:
        return instances

    # --- build candidate links ---
    # Each candidate: (score, inst_i, end_i, inst_j, end_j)
    # score = endpoint distance (lower is better)
    candidates = []
    for ai in range(len(ep_info)):
        idx_a, ep_a, tg_a, eid_a = ep_info[ai]
        for bi in range(ai + 1, len(ep_info)):
            idx_b, ep_b, tg_b, eid_b = ep_info[bi]
            if idx_a == idx_b:
                continue
            if instances[idx_a]["cls"] != instances[idx_b]["cls"]:
                continue

            # 1) Endpoint distance
            dist = np.linalg.norm(ep_a - ep_b)
            if dist > max_endpoint_dist:
                continue

            # 2) Tangent at A should point toward B
            if np.linalg.norm(tg_a) < 0.5:
                continue
            dir_a_to_b = (ep_b - ep_a)
            d = np.linalg.norm(dir_a_to_b)
            if d > 0:
                dir_a_to_b /= d
            angle_a = np.degrees(np.arccos(np.clip(np.dot(tg_a, dir_a_to_b), -1, 1)))
            if angle_a > max_tangent_angle:
                continue

            # 3) Tangent at B should point toward A
            if np.linalg.norm(tg_b) < 0.5:
                continue
            dir_b_to_a = -dir_a_to_b
            angle_b = np.degrees(np.arccos(np.clip(np.dot(tg_b, dir_b_to_a), -1, 1)))
            if angle_b > max_tangent_angle:
                continue

            candidates.append((dist, idx_a, eid_a, idx_b, eid_b))

    # --- greedy matching: best (shortest distance) first, each endpoint used once ---
    candidates.sort(key=lambda x: x[0])
    used_endpoints = set()  # (inst_idx, end_id)
    links = []  # list of (inst_a, inst_b)
    for dist, ia, ea, ib, eb in candidates:
        if (ia, ea) in used_endpoints or (ib, eb) in used_endpoints:
            continue
        used_endpoints.add((ia, ea))
        used_endpoints.add((ib, eb))
        links.append((ia, ib))

    if not links:
        return instances

    # --- find connected components of linked instances ---
    from collections import defaultdict
    adj = defaultdict(set)
    for ia, ib in links:
        adj[ia].add(ib)
        adj[ib].add(ia)

    visited = set()
    components = []
    for node in adj:
        if node in visited:
            continue
        comp = []
        stack = [node]
        while stack:
            n = stack.pop()
            if n in visited:
                continue
            visited.add(n)
            comp.append(n)
            stack.extend(adj[n])
        components.append(comp)

    # --- merge each component into a single instance ---
    merged_indices = set()
    result = []
    for comp in components:
        if len(comp) < 2:
            continue
        merged_mask = np.zeros_like(instances[comp[0]]["mask"])
        best_score = 0.0
        cls = instances[comp[0]]["cls"]
        for idx in comp:
            merged_mask = np.maximum(merged_mask, instances[idx]["mask"])
            best_score = max(best_score, instances[idx]["score"])
            merged_indices.add(idx)
        result.append({"mask": merged_mask, "cls": cls, "score": best_score})

    # Add unmerged instances
    for idx, inst in enumerate(instances):
        if idx not in merged_indices:
            result.append(inst)

    return result


def _split_disconnected_instances(
    instances: List[Dict],
    mask_threshold: float,
    min_area: int = 10,
) -> List[Dict]:
    """Phase 4: Split instances whose binary mask has multiple connected components.

    After merging, an instance may have disconnected blobs. Each connected
    component becomes its own instance (same class, same score).
    """
    result = []
    for inst in instances:
        binary = (inst["mask"] >= mask_threshold).astype(np.uint8)
        n_labels, labels = cv2.connectedComponents(binary, connectivity=8)
        if n_labels <= 2:
            # 0 or 1 component — keep as is
            result.append(inst)
            continue
        # Multiple components — split
        for lbl in range(1, n_labels):
            component = (labels == lbl)
            if component.sum() < min_area:
                continue
            new_mask = inst["mask"].copy()
            new_mask[~component] = 0.0
            result.append({
                "mask": new_mask,
                "cls": inst["cls"],
                "score": inst["score"],
            })
    return result


def _split_branching_instances(
    instances: List[Dict],
    mask_threshold: float,
    min_area: int = 10,
    junction_radius: int = 8,
) -> List[Dict]:
    """Phase 5: Split instances whose skeleton has branch points (junctions).

    When multiple sperm cross, the model may predict one merged mask.
    Skeletonize, find junction pixels (degree >= 3), erase a small disk
    around each junction to disconnect the branches, then split into
    separate connected components.

    Skips Head class (cls=1) — heads are blob-like, not elongated.
    """
    from skimage.morphology import skeletonize

    result = []
    for inst in instances:
        if inst["cls"] == 1:  # skip Head
            result.append(inst)
            continue

        binary = (inst["mask"] >= mask_threshold).astype(np.uint8)
        if binary.sum() < min_area:
            result.append(inst)
            continue

        skel = skeletonize(binary > 0).astype(np.uint8)
        if skel.sum() < 3:
            result.append(inst)
            continue

        # Find junction points: pixels with >= 3 skeleton neighbours
        ys, xs = np.where(skel > 0)
        pts_set = set(zip(xs.tolist(), ys.tolist()))
        junctions = []
        for x, y in pts_set:
            nbr_count = sum(
                1 for dy in (-1, 0, 1) for dx in (-1, 0, 1)
                if (dx or dy) and (x + dx, y + dy) in pts_set
            )
            if nbr_count >= 3:
                junctions.append((x, y))

        if not junctions:
            result.append(inst)
            continue

        # Erase a disk around each junction on the binary mask
        split_mask = binary.copy()
        for jx, jy in junctions:
            cv2.circle(split_mask, (jx, jy), junction_radius, 0, -1)

        # Split into connected components
        n_labels, labels = cv2.connectedComponents(split_mask, connectivity=8)
        if n_labels <= 2:
            # Junctions existed but erasing didn't disconnect — keep original
            result.append(inst)
            continue

        for lbl in range(1, n_labels):
            component = (labels == lbl)
            if component.sum() < min_area:
                continue
            new_mask = inst["mask"].copy()
            new_mask[~component] = 0.0
            result.append({
                "mask": new_mask,
                "cls": inst["cls"],
                "score": inst["score"],
            })
    return result


def generate_patches(h: int, w: int, patch_size: int, overlap: int):
    """Generate patch coordinates. From combined_pipeline.py:48-54."""
    step = patch_size - overlap
    coords = set()
    for y in range(0, h, step):
        for x in range(0, w, step):
            coords.add((min(x, max(0, w - patch_size)),
                         min(y, max(0, h - patch_size))))
    return list(coords)


def predict_full_image(
    model,
    image_tensor: torch.Tensor,
    device: torch.device,
    patch_size: int = 518,
    overlap: int = 128,
    score_threshold: float = 0.5,
    mask_threshold: float = 0.5,
    nms_iou_threshold: float = 0.3,
    merge_iou_threshold: float = 0.15,
    proximity_gap: int = 15,
    max_angle_diff: float = 45.0,
    graph_assembly: bool = False,
) -> List[Dict]:
    """Run sliding window prediction on a full image.

    Three-phase post-processing pipeline:
      Phase 1: Soft mask accumulation (average overlapping same-instance predictions)
      Phase 2: NMS deduplication (standard same-class IoU suppression)
      Phase 3: Orientation-aware fragment merging (merge nearby compatible fragments)

    Args:
        model: Mask2FormerModel in eval mode.
        image_tensor: (3, H, W) normalized image tensor.
        device: torch device.
        patch_size: Patch size.
        overlap: Overlap between patches.
        score_threshold: Minimum class score to keep instance.
        mask_threshold: Threshold for binary mask.
        nms_iou_threshold: IoU threshold for NMS dedup.
        merge_iou_threshold: IoU (inter/min_area) threshold for fragment merging.
        proximity_gap: Max pixel gap for proximity-based fragment merging.
        max_angle_diff: Max orientation difference (degrees) for fragment merging.

    Returns:
        List of instance dicts with "mask", "cls", "score".
    """
    model.eval()
    C, H, W = image_tensor.shape

    # Pad image to be divisible by backbone stride
    # ConvNeXt needs divisibility by 32, DINOv2 by 14 (patch_size)
    is_convnext = getattr(model, "is_convnext", False)
    pad_divisor = 32 if is_convnext else 14
    pad_h = (pad_divisor - H % pad_divisor) % pad_divisor
    pad_w = (pad_divisor - W % pad_divisor) % pad_divisor
    if pad_h > 0 or pad_w > 0:
        image_tensor = F.pad(image_tensor, (0, pad_w, 0, pad_h), mode="reflect")
    _, Hp, Wp = image_tensor.shape

    coords = generate_patches(Hp, Wp, patch_size, overlap)
    raw_instances = []

    with torch.no_grad():
        for (px, py) in coords:
            # Extract patch
            patch = image_tensor[:, py:py+patch_size, px:px+patch_size]
            ph, pw = patch.shape[1], patch.shape[2]

            # Pad if needed
            if ph < patch_size or pw < patch_size:
                padded = torch.zeros(3, patch_size, patch_size,
                                     dtype=patch.dtype, device=patch.device)
                padded[:, :ph, :pw] = patch
                patch = padded

            # Forward
            outputs = model(patch.unsqueeze(0).to(device))

            pred_logits = outputs["pred_logits"][0]  # (Q, C)
            pred_masks = outputs["pred_masks"][0]     # (Q, H_m, W_m)

            # Get class predictions
            probs = pred_logits.softmax(-1)  # (Q, C)
            scores, classes = probs[:, 1:].max(-1)  # exclude background
            classes = classes + 1  # shift back

            for q in range(len(scores)):
                score = float(scores[q])
                cls = int(classes[q])
                if score < score_threshold or cls < 1 or cls >= NUM_CLASSES:
                    continue

                # Get mask and resize to patch size
                mask = pred_masks[q]  # (H_m, W_m)
                mask = F.interpolate(
                    mask.unsqueeze(0).unsqueeze(0),
                    size=(patch_size, patch_size),
                    mode="bilinear",
                    align_corners=False,
                ).squeeze().sigmoid().cpu().numpy()

                # Place in full image coordinates
                full_mask = np.zeros((Hp, Wp), dtype=np.float32)
                actual_h = min(patch_size, Hp - py)
                actual_w = min(patch_size, Wp - px)
                full_mask[py:py+actual_h, px:px+actual_w] = mask[:actual_h, :actual_w]

                # Crop to original image size (remove padding)
                full_mask = full_mask[:H, :W]

                if (full_mask >= mask_threshold).sum() < 10:
                    continue

                raw_instances.append({
                    "mask": full_mask,
                    "cls": cls,
                    "score": score,
                })

    # === Containment removal (class-agnostic) ===
    # Drop smaller instance if >80% of it is covered by the union of all larger instances.
    raw_instances.sort(key=lambda x: -(x["mask"] >= mask_threshold).sum())
    keep = []
    for inst in raw_instances:
        b1 = inst["mask"] >= mask_threshold
        area1 = int(b1.sum())
        if area1 == 0:
            continue
        # Check coverage by union of all already-kept (larger) instances
        covered = np.zeros_like(b1)
        for m in keep:
            covered |= (m["mask"] >= mask_threshold)
        overlap = int((b1 & covered).sum())
        if overlap / area1 > 0.8:
            continue  # drop — engulfed
        keep.append(inst)

    # === Split disconnected components ===
    keep = _split_disconnected_instances(keep, mask_threshold)

    # === Split branching skeletons (crossing sperm) ===
    keep = _split_branching_instances(keep, mask_threshold)

    # === Final containment removal (catches fragments created by splits) ===
    keep.sort(key=lambda x: -(x["mask"] >= mask_threshold).sum())
    final = []
    for inst in keep:
        b1 = inst["mask"] >= mask_threshold
        area1 = int(b1.sum())
        if area1 == 0:
            continue
        covered = np.zeros_like(b1)
        for m in final:
            covered |= (m["mask"] >= mask_threshold)
        overlap = int((b1 & covered).sum())
        if overlap / area1 > 0.8:
            continue
        final.append(inst)

    if graph_assembly:
        # Return clean instances for graph assembly (skip chain-link + orientation merge)
        return final

    # === Chain-link fragments (endpoint tangent matching) ===
    final = _chain_link_fragments(final, mask_threshold)

    # === Re-split after chain-link (may have created multi-component masks) ===
    final = _split_disconnected_instances(final, mask_threshold)

    # === Merge overlapping same-class instances (orientation-guarded) ===
    # Only merge if orientations are compatible (skip check for Head).
    did_merge = True
    while did_merge:
        did_merge = False
        new_final = []
        used = set()
        for i in range(len(final)):
            if i in used:
                continue
            inst_i = final[i]
            bi = (inst_i["mask"] >= mask_threshold).astype(np.uint8)
            combined_mask = inst_i["mask"].copy()
            combined_score = inst_i["score"]
            for j in range(i + 1, len(final)):
                if j in used:
                    continue
                inst_j = final[j]
                if inst_i["cls"] != inst_j["cls"]:
                    continue
                bj = (inst_j["mask"] >= mask_threshold).astype(np.uint8)
                if int((bi & bj).sum()) == 0:
                    continue
                # Orientation guard for non-Head classes
                if inst_i["cls"] != 1:
                    angle_i, cent_i = _compute_mask_orientation(bi)
                    angle_j, cent_j = _compute_mask_orientation(bj)
                    if not _orientations_compatible(
                        angle_i, angle_j, cent_i, cent_j, 15.0
                    ):
                        continue
                combined_mask = np.maximum(combined_mask, inst_j["mask"])
                combined_score = max(combined_score, inst_j["score"])
                bi = (combined_mask >= mask_threshold).astype(np.uint8)
                used.add(j)
                did_merge = True
            new_final.append({
                "mask": combined_mask,
                "cls": inst_i["cls"],
                "score": combined_score,
            })
            used.add(i)
        final = new_final

    return final


def predict_full_image_tta(
    model,
    image_tensor: torch.Tensor,
    device: torch.device,
    patch_size: int = 518,
    overlap: int = 128,
    score_threshold: float = 0.5,
    mask_threshold: float = 0.5,
    nms_iou_threshold: float = 0.3,
    merge_iou_threshold: float = 0.15,
    proximity_gap: int = 15,
    max_angle_diff: float = 45.0,
) -> List[Dict]:
    """Run TTA prediction: original + hflip + vflip, merge results.

    Averages soft masks across augmentations before thresholding.
    Typically gives +1-2% IoU improvement.
    """
    C, H, W = image_tensor.shape

    # Define augmentations: (transform_fn, inverse_fn)
    augmentations = [
        ("original", lambda x: x, lambda m: m),
        ("hflip", lambda x: torch.flip(x, dims=[2]), lambda m: np.flip(m, axis=1).copy()),
        ("vflip", lambda x: torch.flip(x, dims=[1]), lambda m: np.flip(m, axis=0).copy()),
    ]

    # Collect all instances from all augmentations
    all_instances = []
    for aug_name, transform_fn, inverse_fn in augmentations:
        aug_image = transform_fn(image_tensor)
        instances = predict_full_image(
            model, aug_image, device,
            patch_size=patch_size,
            overlap=overlap,
            score_threshold=score_threshold * 0.8,  # slightly lower threshold for TTA
            mask_threshold=0.0,  # keep soft masks for averaging
            nms_iou_threshold=nms_iou_threshold,
            merge_iou_threshold=merge_iou_threshold,
            proximity_gap=proximity_gap,
            max_angle_diff=max_angle_diff,
        )
        # Inverse-transform masks
        for inst in instances:
            inst["mask"] = inverse_fn(inst["mask"])
            inst["_aug"] = aug_name
        all_instances.extend(instances)

    # Merge instances across augmentations: group by class + spatial overlap
    all_instances.sort(key=lambda x: -x["score"])
    merged = []
    for inst in all_instances:
        b1 = inst["mask"] >= mask_threshold
        matched = False
        for m in merged:
            if m["cls"] != inst["cls"]:
                continue
            b2 = m["mask"] >= mask_threshold
            intersection = (b1 & b2).sum()
            union_area = (b1 | b2).sum()
            if union_area > 0 and intersection / union_area > 0.3:
                # Average the soft masks
                m["mask"] = (m["mask"] * m["_count"] + inst["mask"]) / (m["_count"] + 1)
                m["score"] = max(m["score"], inst["score"])
                m["_count"] += 1
                matched = True
                break
        if not matched:
            inst["_count"] = 1
            merged.append(inst)

    # Final NMS on merged results
    keep = []
    for inst in merged:
        b1 = inst["mask"] >= mask_threshold
        if b1.sum() < 10:
            continue
        dup = False
        for k in keep:
            if k["cls"] != inst["cls"]:
                continue
            b2 = k["mask"] >= mask_threshold
            intersection = (b1 & b2).sum()
            union_area = (b1 | b2).sum()
            if union_area > 0 and intersection / union_area > nms_iou_threshold:
                dup = True
                break
        if not dup:
            # Clean up internal keys
            inst.pop("_count", None)
            inst.pop("_aug", None)
            keep.append(inst)

    return keep


def predict_full_image_for_graph(
    model,
    image_tensor: torch.Tensor,
    device: torch.device,
    patch_size: int = 1024,
    overlap: int = 300,
    score_threshold: float = 0.95,
    mask_threshold: float = 0.3,
) -> List[Dict]:
    """Minimal prediction pipeline for graph assembly input.

    Patches → soft mask accumulation → split_disconnected → split_branching → return.
    No containment removal, chain-linking, or orientation merge — the graph handles all assembly.

    Args:
        model: Mask2FormerModel in eval mode.
        image_tensor: (3, H, W) normalized image tensor.
        device: torch device.
        patch_size: Patch size (1024 for ConvNeXt).
        overlap: Overlap between patches.
        score_threshold: Minimum class score (high = trust model).
        mask_threshold: Threshold for binary masks.

    Returns:
        List of instance dicts with "mask", "cls", "score".
    """
    model.eval()
    C, H, W = image_tensor.shape

    # Pad image to be divisible by backbone stride
    is_convnext = getattr(model, "is_convnext", False)
    pad_divisor = 32 if is_convnext else 14
    pad_h = (pad_divisor - H % pad_divisor) % pad_divisor
    pad_w = (pad_divisor - W % pad_divisor) % pad_divisor
    if pad_h > 0 or pad_w > 0:
        image_tensor = F.pad(image_tensor, (0, pad_w, 0, pad_h), mode="reflect")
    _, Hp, Wp = image_tensor.shape

    coords = generate_patches(Hp, Wp, patch_size, overlap)
    raw_instances = []

    with torch.no_grad():
        for (px, py) in coords:
            patch = image_tensor[:, py:py+patch_size, px:px+patch_size]
            ph, pw = patch.shape[1], patch.shape[2]

            if ph < patch_size or pw < patch_size:
                padded = torch.zeros(3, patch_size, patch_size,
                                     dtype=patch.dtype, device=patch.device)
                padded[:, :ph, :pw] = patch
                patch = padded

            outputs = model(patch.unsqueeze(0).to(device))
            pred_logits = outputs["pred_logits"][0]
            pred_masks = outputs["pred_masks"][0]

            probs = pred_logits.softmax(-1)
            scores, classes = probs[:, 1:].max(-1)
            classes = classes + 1

            # Log top detection scores for debugging threshold issues
            top_k = min(5, len(scores))
            top_vals, top_idx = scores.topk(top_k)
            above_half = [(f"{float(top_vals[i]):.3f}", int(classes[top_idx[i]])) for i in range(top_k) if float(top_vals[i]) > 0.3]
            if above_half:
                logger.info(f"Patch ({py},{px}): detections above 0.3: {above_half}, threshold={score_threshold}")

            for q in range(len(scores)):
                score = float(scores[q])
                cls = int(classes[q])
                if score < score_threshold or cls < 1 or cls >= NUM_CLASSES:
                    continue

                mask = pred_masks[q]
                mask = F.interpolate(
                    mask.unsqueeze(0).unsqueeze(0),
                    size=(patch_size, patch_size),
                    mode="bilinear",
                    align_corners=False,
                ).squeeze().sigmoid().cpu().numpy()

                full_mask = np.zeros((Hp, Wp), dtype=np.float32)
                actual_h = min(patch_size, Hp - py)
                actual_w = min(patch_size, Wp - px)
                full_mask[py:py+actual_h, px:px+actual_w] = mask[:actual_h, :actual_w]
                full_mask = full_mask[:H, :W]

                if (full_mask >= mask_threshold).sum() < 10:
                    continue

                raw_instances.append({
                    "mask": full_mask,
                    "cls": cls,
                    "score": score,
                })

    # Phase 1: Soft mask accumulation (merge overlapping same-instance patch predictions)
    instances = _accumulate_soft_masks(raw_instances, mask_threshold)

    # Phase 2: Split disconnected components
    instances = _split_disconnected_instances(instances, mask_threshold)

    # Phase 3: Split branching skeletons (crossing sperm in one mask)
    instances = _split_branching_instances(instances, mask_threshold)

    return instances


def instances_to_binary_masks(
    instances: List[Dict],
    height: int,
    width: int,
    mask_threshold: float = 0.5,
) -> Dict[int, np.ndarray]:
    """Merge instances into per-class binary masks."""
    class_masks = {}
    for inst in instances:
        cls = inst["cls"]
        mask = (inst["mask"] >= mask_threshold).astype(np.uint8)
        if cls not in class_masks:
            class_masks[cls] = np.zeros((height, width), dtype=np.uint8)
        class_masks[cls] = np.maximum(class_masks[cls], mask)
    return class_masks
