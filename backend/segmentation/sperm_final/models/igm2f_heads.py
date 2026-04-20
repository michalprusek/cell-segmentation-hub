"""IGM2F-PL: Instance-Grouped Mask2Former with Polyline Head.

Three novel components added on top of standard Mask2Former for sperm instance
segmentation:

1. PolylineHead      — per-query variable-length polyline regression (K_max points
                        + validity mask). Enables direct centerline prediction for
                        thin structures (Tail especially), avoiding the
                        mask→skeletonize→polyline round-trip.

2. InstanceEmbedHead — per-query 256-dim contrastive embedding. Trained with
                        InfoNCE using the globally-unique instance_id from the
                        unified COCO (Head+Midpiece+Tail of the same sperm share
                        an id). At inference, clusters queries into sperm groups
                        without needing graph_assembly post-processing.

3. losses:
   - chamfer_polyline_loss(pred, gt, pred_valid, gt_mask)
     Bidirectional Chamfer distance between predicted and GT polylines.
   - instance_contrastive_loss(embeds, matched_instance_ids)
     Supervised InfoNCE pulling same-instance queries together.
   - topology_continuity_loss(polylines_by_class_inst)
     Penalizes ||H_end - M_start|| + ||M_end - T_start|| for queries sharing
     an instance_id (anatomical endpoint continuity).

All components are opt-in via flags in ModelConfig/TrainConfig. When disabled the
behavior is identical to baseline Mask2Former, so adding them is non-breaking.

Design rationale is in plan file refactored-nibbling-lake.md (sekce "Moje novel
návrh: IGM2F-PL").
"""

from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


# -------------------- Heads --------------------

class PolylineHead(nn.Module):
    """Predicts a variable-length polyline (<= K_max points) per query.

    Output:
        coords: (B, Q, K_max, 2) in normalized [0, 1] coordinates of the image.
        logits: (B, Q, K_max)     validity logit per point (>0 = valid).

    Normalization to [0, 1] so the head is resolution-agnostic; caller multiplies
    by image/patch size when comparing to GT.
    """

    def __init__(self, hidden_dim: int = 256, k_max: int = 32, mlp_layers: int = 3):
        super().__init__()
        self.k_max = k_max
        layers = []
        d = hidden_dim
        for _ in range(mlp_layers - 1):
            layers += [nn.Linear(d, d), nn.GELU()]
        self.trunk = nn.Sequential(*layers)
        # Per-point (x, y, validity_logit)  -> 3*k_max outputs
        self.point_head = nn.Linear(d, k_max * 3)

    def forward(self, query_features: torch.Tensor) -> Dict[str, torch.Tensor]:
        # Run in fp32 for numerical stability (sigmoid + coord regression are sensitive).
        qf = query_features.float()
        x = self.trunk(qf)              # (B, Q, D)
        out = self.point_head(x)        # (B, Q, 3*K)
        B, Q, _ = out.shape
        out = out.view(B, Q, self.k_max, 3)
        coords = out[..., :2].sigmoid()       # normalized 0-1
        valid_logits = out[..., 2]
        return {"coords": coords, "valid_logits": valid_logits}


class InstanceEmbedHead(nn.Module):
    """Projects query features to a 256-dim L2-normalized embedding for
    contrastive instance grouping.
    """

    def __init__(self, hidden_dim: int = 256, embed_dim: int = 256):
        super().__init__()
        self.proj = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, embed_dim),
        )

    def forward(self, query_features: torch.Tensor) -> torch.Tensor:
        # fp32 for L2 norm stability (sum-of-squares can overflow in fp16).
        z = self.proj(query_features.float())
        return F.normalize(z, dim=-1, eps=1e-6)


# -------------------- Losses --------------------

def chamfer_polyline_loss(
    pred_coords: torch.Tensor,       # (N, K_max, 2) in image pixels
    pred_valid: torch.Tensor,        # (N, K_max) logits
    gt_points: List[torch.Tensor],   # List of (K_i, 2) GT polyline tensors
    image_size: Tuple[int, int],
) -> torch.Tensor:
    """Bidirectional Chamfer distance between predicted and GT polylines.

    Runs in fp32 internally — the invalid-cost sentinel (1e6) and pairwise
    squared distances overflow in fp16 (1e8 -> Inf, then NaN cascades).

    Only considers predicted points with valid_logits > 0. Scaled by image diag.
    """
    if len(gt_points) == 0 or pred_coords.numel() == 0:
        return pred_coords.sum() * 0.0

    H, W = image_size
    diag = float((H * H + W * W) ** 0.5)
    losses = []
    # Force fp32 to avoid fp16 overflow on the masked-cost sentinel + pairwise d²
    pc_all = pred_coords.float()
    pv_all = pred_valid.float()
    for i in range(len(gt_points)):
        gt = gt_points[i]
        if gt is None or gt.numel() == 0:
            continue
        gt = gt.float()
        pc = pc_all[i]                    # (K, 2)
        pv = torch.sigmoid(pv_all[i])     # (K,)
        # Pairwise squared distance
        d2 = ((pc[:, None, :] - gt[None, :, :]) ** 2).sum(-1)  # (K, M)
        # pred → gt
        min_p2g = d2.min(dim=1).values
        pred_to_gt = (pv * (min_p2g + 1e-8).sqrt()).sum() / (pv.sum() + 1e-6)
        # gt → pred — invalid preds get a large finite cost (squared pixels)
        d2_valid = d2 + (1.0 - pv)[:, None] * (diag ** 2)
        min_g2p = (d2_valid.min(dim=0).values + 1e-8).sqrt()
        gt_to_pred = min_g2p.mean()
        losses.append((pred_to_gt + gt_to_pred) / diag)
    if not losses:
        return pred_coords.sum() * 0.0
    return torch.stack(losses).mean()


def instance_contrastive_loss(
    embeds: torch.Tensor,                # (N, D)
    instance_ids: torch.Tensor,          # (N,) ints; -1 = ignore
    temperature: float = 0.1,
) -> torch.Tensor:
    """Supervised InfoNCE over matched queries.

    For each anchor, positives = other queries with same instance_id;
    negatives = all queries with different instance_id.
    """
    valid = instance_ids >= 0
    if valid.sum() < 2:
        return embeds.sum() * 0.0

    z = embeds[valid].float()  # fp32 for stable matmul + softmax
    iid = instance_ids[valid]
    sim = z @ z.t() / temperature
    # Mask self-similarity (use finite sentinel safe for fp32 log_softmax)
    mask_self = torch.eye(len(z), device=z.device, dtype=torch.bool)
    sim = sim.masked_fill(mask_self, -1e4)

    pos_mask = (iid[:, None] == iid[None, :]) & ~mask_self  # (N, N)

    # Skip anchors with no positive
    has_pos = pos_mask.any(dim=1)
    if has_pos.sum() == 0:
        return embeds.sum() * 0.0

    # log_softmax over all negatives (and positives within logits), sum positives' logprob
    log_prob = F.log_softmax(sim, dim=1)
    pos_log_prob = (log_prob * pos_mask.float()).sum(dim=1) / (pos_mask.sum(dim=1).clamp_min(1))
    loss = -pos_log_prob[has_pos].mean()
    return loss


def topology_continuity_loss(
    pred_coords: torch.Tensor,           # (N, K_max, 2) pixels
    pred_valid_logits: torch.Tensor,     # (N, K_max)
    class_ids: torch.Tensor,             # (N,) 1=H, 2=M, 3=T
    instance_ids: torch.Tensor,          # (N,) matched inst IDs
    image_size: Tuple[int, int],
) -> torch.Tensor:
    """Enforces H_end ≈ M_start and M_end ≈ T_start for queries sharing instance.

    Endpoint definition: first/last valid (sigmoid>0.5) predicted point. Falls
    back to first/last overall if no valid point predicted.
    """
    if instance_ids.numel() == 0:
        return pred_coords.sum() * 0.0

    H, W = image_size
    diag = float((H * H + W * W) ** 0.5)

    # fp32 for stability (sqrt + small distances)
    pred_coords = pred_coords.float()
    pred_valid_logits = pred_valid_logits.float()

    # Group queries by instance
    unique_iids = instance_ids.unique()
    losses = []
    for iid in unique_iids:
        if int(iid) < 0:
            continue
        inds = (instance_ids == iid).nonzero(as_tuple=True)[0]
        if inds.numel() < 2:
            continue
        # Map class → query index within this instance (take first match)
        per_cls = {}
        for i in inds.tolist():
            c = int(class_ids[i])
            per_cls.setdefault(c, i)
        coords = pred_coords  # alias
        valid = torch.sigmoid(pred_valid_logits) > 0.5

        def endpoints(q_idx):
            v = valid[q_idx]
            if v.any():
                vi = v.nonzero(as_tuple=True)[0]
                return coords[q_idx, vi[0]], coords[q_idx, vi[-1]]
            return coords[q_idx, 0], coords[q_idx, -1]

        if 1 in per_cls and 2 in per_cls:
            _, h_end = endpoints(per_cls[1])
            m_start, _ = endpoints(per_cls[2])
            losses.append((((h_end - m_start) ** 2).sum() + 1e-8).sqrt() / diag)
        if 2 in per_cls and 3 in per_cls:
            _, m_end = endpoints(per_cls[2])
            t_start, _ = endpoints(per_cls[3])
            losses.append((((m_end - t_start) ** 2).sum() + 1e-8).sqrt() / diag)

    if not losses:
        return pred_coords.sum() * 0.0
    return torch.stack(losses).mean()
