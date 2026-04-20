"""Hungarian matching + losses for Mask2Former training.

Implements:
- Bipartite matching between predicted and ground-truth instances
- Classification loss (cross-entropy)
- Mask losses (BCE + Dice)
"""

from typing import Dict, List, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from scipy.optimize import linear_sum_assignment


class HungarianMatcher(nn.Module):
    """Bipartite matching between predictions and ground truth.

    Matches predicted queries to GT instances using a cost matrix
    combining classification and mask costs.
    """

    def __init__(
        self,
        cost_class: float = 2.0,
        cost_mask_bce: float = 5.0,
        cost_mask_dice: float = 5.0,
    ):
        super().__init__()
        self.cost_class = cost_class
        self.cost_mask_bce = cost_mask_bce
        self.cost_mask_dice = cost_mask_dice

    @torch.no_grad()
    def forward(
        self,
        pred_logits: torch.Tensor,
        pred_masks: torch.Tensor,
        targets: List[Dict[str, torch.Tensor]],
    ) -> List[Tuple[torch.Tensor, torch.Tensor]]:
        """Compute optimal matching.

        Args:
            pred_logits: (B, Q, num_classes)
            pred_masks: (B, Q, H, W)
            targets: List of dicts with "labels" (M,) and "masks" (M, H_gt, W_gt)

        Returns:
            List of (pred_indices, gt_indices) tuples per batch element.
        """
        B, Q, num_classes = pred_logits.shape

        indices = []
        for b in range(B):
            gt_labels = targets[b]["labels"]
            gt_masks = targets[b]["masks"].float()

            if gt_labels.shape[0] == 0:
                indices.append((
                    torch.tensor([], dtype=torch.int64, device=pred_logits.device),
                    torch.tensor([], dtype=torch.int64, device=pred_logits.device),
                ))
                continue

            # Classification cost
            pred_probs = pred_logits[b].softmax(-1)  # (Q, num_classes)
            cost_class = -pred_probs[:, gt_labels]  # (Q, M)

            # Resize GT masks to match prediction resolution
            pred_h, pred_w = pred_masks.shape[-2:]
            gt_h, gt_w = gt_masks.shape[-2:]
            if (gt_h, gt_w) != (pred_h, pred_w):
                gt_masks_resized = F.interpolate(
                    gt_masks.unsqueeze(1).float(),
                    size=(pred_h, pred_w),
                    mode="nearest",
                ).squeeze(1)
            else:
                gt_masks_resized = gt_masks

            # Mask costs
            pred_m = pred_masks[b].sigmoid()  # (Q, H, W)
            pred_flat = pred_m.flatten(1)  # (Q, H*W)
            gt_flat = gt_masks_resized.flatten(1).float()  # (M, H*W)

            # Dice cost via matmul
            intersection = torch.mm(pred_flat, gt_flat.T)  # (Q, M)
            pred_sum = pred_flat.sum(1, keepdim=True)  # (Q, 1)
            gt_sum = gt_flat.sum(1, keepdim=True).T     # (1, M)
            cost_dice = 1 - 2 * intersection / (pred_sum + gt_sum + 1e-6)  # (Q, M)

            # BCE cost (point-sampled for memory efficiency)
            HW = pred_flat.shape[1]
            n_points = min(1024, HW)
            point_idx = torch.randperm(HW, device=pred_flat.device)[:n_points]
            pred_sampled = pred_masks[b].flatten(1)[:, point_idx]  # (Q, n_points) logits
            gt_sampled = gt_flat[:, point_idx]  # (M, n_points)
            # Compute BCE: (Q, n_points, 1) vs (1, n_points, M) -> mean over points
            cost_bce = F.binary_cross_entropy_with_logits(
                pred_sampled.unsqueeze(2).expand(-1, -1, gt_sampled.shape[0]),
                gt_sampled.T.unsqueeze(0).expand(pred_sampled.shape[0], -1, -1),
                reduction="none",
            ).mean(1)  # (Q, M)

            # Total cost
            C = (
                self.cost_class * cost_class
                + self.cost_mask_bce * cost_bce
                + self.cost_mask_dice * cost_dice
            )

            # Hungarian matching
            C_np = C.detach().cpu().float().numpy()
            # Sanitize NaN/inf
            C_np = np.nan_to_num(C_np, nan=1e6, posinf=1e6, neginf=-1e6)
            pred_idx, gt_idx = linear_sum_assignment(C_np)
            indices.append((
                torch.tensor(pred_idx, dtype=torch.int64, device=pred_logits.device),
                torch.tensor(gt_idx, dtype=torch.int64, device=pred_logits.device),
            ))

        return indices


def _focal_loss(pred_logits, target_classes, num_classes, alpha=0.25, gamma=2.0):
    """Sigmoid focal loss for classification.

    Handles class imbalance better than cross-entropy for query-based models
    where most queries are background.
    """
    target_one_hot = F.one_hot(target_classes, num_classes).float()
    p = pred_logits.sigmoid()
    ce = F.binary_cross_entropy_with_logits(pred_logits, target_one_hot, reduction="none")
    p_t = p * target_one_hot + (1 - p) * (1 - target_one_hot)
    focal_weight = (1 - p_t) ** gamma
    loss = alpha * focal_weight * ce
    # Normalize by number of foreground targets
    n_fg = max(target_one_hot[:, 1:].sum(), 1)
    return loss.sum() / n_fg


# Per-class loss weights (Tail gets 2× weight as it's hardest to segment)
CLASS_LOSS_WEIGHTS = {1: 1.0, 2: 1.0, 3: 2.0}


def _lovasz_grad(gt_sorted):
    """Compute Lovász gradient (subgradient of Jaccard)."""
    gts = gt_sorted.sum()
    intersection = gts - gt_sorted.float().cumsum(0)
    union = gts + (1 - gt_sorted).float().cumsum(0)
    jaccard = 1 - intersection / (union + 1e-6)
    if len(jaccard) > 1:
        jaccard[1:] = jaccard[1:] - jaccard[:-1]
    return jaccard


def _lovasz_hinge_loss(pred_logits, gt_masks, weights=None):
    """Lovász hinge loss — direct IoU surrogate.

    Args:
        pred_logits: (K, H, W) raw logits
        gt_masks: (K, H, W) binary GT
        weights: optional (K,) per-instance weights
    """
    losses = []
    for i in range(pred_logits.shape[0]):
        pred = pred_logits[i].flatten()
        gt = gt_masks[i].flatten()
        signs = 2 * gt - 1  # {-1, +1}
        errors = 1 - signs * pred  # hinge
        errors_sorted, perm = torch.sort(errors, descending=True)
        gt_sorted = gt[perm]
        grad = _lovasz_grad(gt_sorted)
        loss = torch.dot(F.relu(errors_sorted), grad)
        if weights is not None:
            loss = loss * weights[i]
        losses.append(loss)
    if not losses:
        return torch.tensor(0.0, device=pred_logits.device)
    return torch.stack(losses).mean()


def _boundary_loss(pred_masks, gt_masks, kernel_size=3):
    """Compute boundary-aware loss on mask edges.

    Uses Laplacian edge detection on GT masks and computes extra BCE
    loss weighted towards boundary pixels.
    """
    device = pred_masks.device
    # Laplacian kernel for edge detection
    laplacian = torch.tensor(
        [[0, 1, 0], [1, -4, 1], [0, 1, 0]],
        dtype=torch.float32, device=device,
    ).reshape(1, 1, 3, 3)

    # Detect boundaries in GT masks
    gt_padded = F.pad(gt_masks.unsqueeze(1), [1, 1, 1, 1], mode="replicate")
    edges = F.conv2d(gt_padded, laplacian).squeeze(1).abs()
    boundary_mask = (edges > 0.1).float()

    # Dilate boundary slightly for more supervision signal
    dilate_kernel = torch.ones(1, 1, 3, 3, device=device)
    boundary_padded = F.pad(boundary_mask.unsqueeze(1), [1, 1, 1, 1], mode="constant", value=0)
    boundary_mask = (F.conv2d(boundary_padded, dilate_kernel).squeeze(1) > 0).float()

    # Weighted BCE: higher weight on boundary pixels
    n_boundary = boundary_mask.sum() + 1
    weight = 1.0 + boundary_mask * 4.0  # 5× weight on boundaries
    loss = F.binary_cross_entropy_with_logits(
        pred_masks, gt_masks, weight=weight, reduction="sum"
    ) / (weight.sum() + 1e-6)

    return loss


def _soft_skeleton(mask: torch.Tensor, num_iter: int = 10) -> torch.Tensor:
    """Compute soft skeleton via iterative morphological erosion.

    Based on the clDice paper (Shit et al., 2021):
    At each iteration, skeleton += relu(img - opening(img)),
    where opening = dilation(erosion(img)).

    Args:
        mask: (N, H, W) soft mask values in [0, 1].
        num_iter: number of erosion iterations.

    Returns:
        Soft skeleton (N, H, W).
    """
    img = mask.unsqueeze(1)  # (N, 1, H, W)
    skel = torch.zeros_like(img)
    for _ in range(num_iter):
        # Erosion via min-pool (negate → max-pool → negate)
        eroded = -F.max_pool2d(-img, kernel_size=3, stride=1, padding=1)
        # Opening = dilation(erosion) — features that survive erosion+dilation
        opened = F.max_pool2d(eroded, kernel_size=3, stride=1, padding=1)
        # Skeleton component = what's in img but removed by opening
        skel = skel + F.relu(img - opened)
        img = eroded
    return torch.clamp(skel.squeeze(1), 0, 1)


def _cldice_loss(pred_masks: torch.Tensor, gt_masks: torch.Tensor,
                 num_iter: int = 10) -> torch.Tensor:
    """Centerline Dice loss for topology-preserving segmentation.

    clDice = 2 * Tprec * Tsens / (Tprec + Tsens)
    where:
        Tprec = sum(skel_pred * mask_gt) / sum(skel_pred)
        Tsens = sum(skel_gt * mask_pred) / sum(skel_gt)

    Args:
        pred_masks: (K, H, W) logits.
        gt_masks: (K, H, W) binary GT masks.

    Returns:
        1 - clDice (loss).
    """
    pred_soft = pred_masks.sigmoid()
    gt_float = gt_masks.float()

    skel_pred = _soft_skeleton(pred_soft, num_iter)
    skel_gt = _soft_skeleton(gt_float, num_iter)

    eps = 1e-6
    tprec = (skel_pred * gt_float).sum(dim=(1, 2)) / (skel_pred.sum(dim=(1, 2)) + eps)
    tsens = (skel_gt * pred_soft).sum(dim=(1, 2)) / (skel_gt.sum(dim=(1, 2)) + eps)

    cldice = 2 * tprec * tsens / (tprec + tsens + eps)
    return (1 - cldice).mean()


class Mask2FormerCriterion(nn.Module):
    """Loss function for Mask2Former.

    Computes:
    - Focal classification loss
    - Binary cross-entropy mask loss
    - Dice mask loss

    Supports auxiliary losses from intermediate decoder layers.
    """

    def __init__(
        self,
        num_classes: int = 4,
        cls_weight: float = 2.0,
        mask_bce_weight: float = 5.0,
        mask_dice_weight: float = 5.0,
        boundary_weight: float = 2.0,
        cldice_weight: float = 3.0,
        aux_weight: float = 1.0,
        polyline_chamfer_weight: float = 0.0,
        instance_contrastive_weight: float = 0.0,
        topology_continuity_weight: float = 0.0,
        # v14 high-res mask losses
        hr_bce_weight: float = 0.0,
        hr_dice_weight: float = 0.0,
        hr_cldice_weight: float = 0.0,
        hr_cbdice_weight: float = 0.0,
        dyn_mask_head=None,
        # v16 GeoMask losses (polyline + width → rasterized soft mask)
        geomask_bce_weight: float = 0.0,
        geomask_dice_weight: float = 0.0,
        geomask_cldice_weight: float = 0.0,
        geomask_width_weight: float = 0.0,
        geomask_raster_size: int = 1024,
        geomask_temperature: float = 0.7,
    ):
        super().__init__()
        self.num_classes = num_classes
        self.cls_weight = cls_weight
        self.mask_bce_weight = mask_bce_weight
        self.mask_dice_weight = mask_dice_weight
        self.boundary_weight = boundary_weight
        self.cldice_weight = cldice_weight
        self.aux_weight = aux_weight
        # IGM2F-PL (all 0 → disabled)
        self.polyline_chamfer_weight = polyline_chamfer_weight
        self.instance_contrastive_weight = instance_contrastive_weight
        self.topology_continuity_weight = topology_continuity_weight
        # v14 HR (all 0 → disabled)
        self.hr_bce_weight = hr_bce_weight
        self.hr_dice_weight = hr_dice_weight
        self.hr_cldice_weight = hr_cldice_weight
        self.hr_cbdice_weight = hr_cbdice_weight
        self.dyn_mask_head = dyn_mask_head  # shared DynamicMaskHead reference
        # v16 GeoMask
        self.geomask_bce_weight = geomask_bce_weight
        self.geomask_dice_weight = geomask_dice_weight
        self.geomask_cldice_weight = geomask_cldice_weight
        self.geomask_width_weight = geomask_width_weight
        self.geomask_raster_size = geomask_raster_size
        self.geomask_temperature = geomask_temperature

        self.matcher = HungarianMatcher(
            cost_class=cls_weight,
            cost_mask_bce=mask_bce_weight,
            cost_mask_dice=mask_dice_weight,
        )

    def forward(
        self,
        outputs: Dict[str, torch.Tensor],
        targets: List[Dict[str, torch.Tensor]],
    ) -> Dict[str, torch.Tensor]:
        """Compute total loss.

        Args:
            outputs: Model outputs with pred_logits, pred_masks, aux_outputs.
            targets: List of target dicts with labels and masks.

        Returns:
            Dict of named losses.
        """
        # Match predictions to ground truth
        indices = self.matcher(
            outputs["pred_logits"],
            outputs["pred_masks"],
            targets,
        )

        # Compute losses for final predictions
        losses = self._compute_losses(
            outputs["pred_logits"],
            outputs["pred_masks"],
            targets,
            indices,
        )

        # Auxiliary losses from intermediate layers
        if "aux_outputs" in outputs:
            for i, aux in enumerate(outputs["aux_outputs"]):
                aux_indices = self.matcher(
                    aux["pred_logits"],
                    aux["pred_masks"],
                    targets,
                )
                aux_losses = self._compute_losses(
                    aux["pred_logits"],
                    aux["pred_masks"],
                    targets,
                    aux_indices,
                )
                for k, v in aux_losses.items():
                    losses[f"aux_{i}_{k}"] = v * self.aux_weight

        # IGM2F-PL Phase B losses (opt-in via weights > 0)
        if self.polyline_chamfer_weight > 0 and "pred_polyline_coords" in outputs:
            losses["loss_polyline"] = self.polyline_chamfer_weight * self._polyline_loss(
                outputs["pred_polyline_coords"],
                outputs["pred_polyline_valid"],
                targets,
                indices,
            )
        if self.instance_contrastive_weight > 0 and "pred_instance_embed" in outputs:
            losses["loss_contrastive"] = self.instance_contrastive_weight * self._contrastive_loss(
                outputs["pred_instance_embed"],
                targets,
                indices,
            )
        if self.topology_continuity_weight > 0 and "pred_polyline_coords" in outputs:
            losses["loss_topology"] = self.topology_continuity_weight * self._topology_loss(
                outputs["pred_polyline_coords"],
                outputs["pred_polyline_valid"],
                targets,
                indices,
            )

        # v14 high-res mask losses (only on matched queries, native 1024² resolution)
        if self.dyn_mask_head is not None and "pred_hr_E" in outputs and (
            self.hr_bce_weight > 0 or self.hr_dice_weight > 0
            or self.hr_cldice_weight > 0 or self.hr_cbdice_weight > 0
        ):
            hr_losses = self._compute_hr_mask_loss(outputs, targets, indices)
            losses.update(hr_losses)

        # v16 GeoMask losses (rasterize polyline+width → soft mask at native res)
        if "pred_polyline_widths" in outputs and (
            self.geomask_bce_weight > 0 or self.geomask_dice_weight > 0
            or self.geomask_cldice_weight > 0 or self.geomask_width_weight > 0
        ):
            gm_losses = self._compute_geomask_loss(outputs, targets, indices)
            losses.update(gm_losses)

        return losses

    def _compute_geomask_loss(self, outputs, targets, indices):
        """Rasterize (polyline, width) → soft mask at native resolution; compute BCE+Dice+clDice.
        Also regression loss on width against GT mask-sampled widths.
        Only matched queries.
        """
        import torch.nn.functional as F
        from sperm_final.models.geomask_heads import (
            rasterize_polyline_tube, sample_gt_width_from_mask,
            polyraster_masks_loss, width_regression_loss,
        )

        coords_norm = outputs["pred_polyline_coords"]       # (B, Q, K, 2)
        valid_logits = outputs["pred_polyline_valid"]       # (B, Q, K)
        widths = outputs["pred_polyline_widths"]            # (B, Q, K)
        B, Q, K, _ = coords_norm.shape
        device = coords_norm.device

        Hr = Wr = int(self.geomask_raster_size)

        pred_coords_all, pred_valid_all, pred_width_all = [], [], []
        gt_mask_all, gt_width_all, cls_all = [], [], []

        for b, (pred_idx, gt_idx) in enumerate(indices):
            if len(pred_idx) == 0:
                continue
            gt_m = targets[b]["masks"][gt_idx].float()              # (K_m, H_gt, W_gt)
            if gt_m.shape[-2:] != (Hr, Wr):
                gt_m_rs = F.interpolate(gt_m.unsqueeze(1), size=(Hr, Wr),
                                        mode="nearest").squeeze(1)
            else:
                gt_m_rs = gt_m
            # Predicted polyline in pixel coords at target resolution
            pc = coords_norm[b, pred_idx].float()                   # (K_m, K, 2) in [0,1]
            pc_px = torch.stack([pc[..., 0] * (Wr - 1), pc[..., 1] * (Hr - 1)], dim=-1)
            pv = torch.sigmoid(valid_logits[b, pred_idx].float())   # (K_m, K)
            pw = widths[b, pred_idx].float()                         # (K_m, K) already pixels

            # GT widths sampled from GT mask along GT polyline points (if available)
            if "polyline_points" in targets[b]:
                gt_polys = targets[b]["polyline_points"]
                gt_w = torch.zeros_like(pw)
                # For each matched query, sample GT widths from GT mask along the
                # GT polyline (resampled to K_max points via linear interp).
                for i, g_idx in enumerate(gt_idx.tolist()):
                    gp = gt_polys[g_idx].to(device).float()     # (K_i, 2)
                    if gp.numel() == 0 or gp.shape[0] < 2:
                        continue
                    # Resample GT polyline to K points via linear interp along arc length
                    gp_rs = _resample_polyline(gp, K)
                    # Scale gp from its own image coords to (Hr, Wr)
                    # GT polyline coords are at original image resolution =
                    # same as GT mask resolution (gt_m.shape).
                    g_src_h, g_src_w = gt_m.shape[-2:]
                    gp_rs = torch.stack([
                        gp_rs[..., 0] * (Wr - 1) / max(g_src_w - 1, 1),
                        gp_rs[..., 1] * (Hr - 1) / max(g_src_h - 1, 1),
                    ], dim=-1)
                    gw = sample_gt_width_from_mask(
                        gt_m_rs[i], gp_rs, max_width=40.0,
                    )
                    gt_w[i] = gw
            else:
                gt_w = torch.zeros_like(pw)

            pred_coords_all.append(pc_px)
            pred_valid_all.append(pv)
            pred_width_all.append(pw)
            gt_mask_all.append(gt_m_rs)
            gt_width_all.append(gt_w)
            cls_all.append(targets[b]["labels"][gt_idx])

        if not pred_coords_all:
            z = coords_norm.sum() * 0.0
            return {"loss_geomask_bce": z, "loss_geomask_dice": z,
                    "loss_geomask_cldice": z, "loss_geomask_width": z}

        pc_cat = torch.cat(pred_coords_all, dim=0)    # (M, K, 2)
        pv_cat = torch.cat(pred_valid_all, dim=0)     # (M, K)
        pw_cat = torch.cat(pred_width_all, dim=0)     # (M, K)
        gt_cat = torch.cat(gt_mask_all, dim=0)        # (M, Hr, Wr)
        gw_cat = torch.cat(gt_width_all, dim=0)       # (M, K)
        cls_cat = torch.cat(cls_all, dim=0)           # (M,)

        # Rasterize (segment-chunked for memory + grad checkpointing)
        from torch.utils.checkpoint import checkpoint as _ckpt

        def _rasterize_fn(pc, pv, pw):
            return rasterize_polyline_tube(
                pc, pv, pw, image_size=(Hr, Wr),
                temperature=self.geomask_temperature, chunk_segments=True,
            )
        # Process in chunks of max 8 queries at a time to bound memory
        CHUNK = 8
        M = pc_cat.shape[0]
        parts = []
        for i in range(0, M, CHUNK):
            sl = slice(i, i + CHUNK)
            pred_i = _ckpt(
                _rasterize_fn, pc_cat[sl], pv_cat[sl], pw_cat[sl],
                use_reentrant=False,
            )
            parts.append(pred_i)
        pred_soft = torch.cat(parts, dim=0)

        mask_losses = polyraster_masks_loss(pred_soft, gt_cat)

        out = {}
        if self.geomask_bce_weight > 0:
            out["loss_geomask_bce"] = self.geomask_bce_weight * mask_losses["bce"]
        if self.geomask_dice_weight > 0:
            out["loss_geomask_dice"] = self.geomask_dice_weight * mask_losses["dice"]
        if self.geomask_cldice_weight > 0:
            out["loss_geomask_cldice"] = self.geomask_cldice_weight * mask_losses["cldice"]
        if self.geomask_width_weight > 0:
            out["loss_geomask_width"] = self.geomask_width_weight * width_regression_loss(
                pw_cat, gw_cat, pv_cat,
            )
        return out

    def _compute_hr_mask_loss(self, outputs, targets, indices):
        """Native-resolution mask losses via CondInst dynamic head. Matched queries only."""
        import torch.nn.functional as F
        E = outputs["pred_hr_E"]          # (B, D, H, W)  H,W at native res
        theta = outputs["pred_hr_theta"]  # (B, Q, 169)
        B, _, H, W = E.shape
        device = E.device

        # Gather matched thetas + centers + GT masks (upsampled if needed)
        theta_all, centers_all, batch_idx_all = [], [], []
        gt_all, cls_all = [], []
        for b, (pred_idx, gt_idx) in enumerate(indices):
            if len(pred_idx) == 0:
                continue
            t = theta[b, pred_idx]                                # (K, 169)
            gt_m = targets[b]["masks"][gt_idx].float()            # (K, H_gt, W_gt)
            # Compute normalized centers from GT masks (or bbox fallback)
            k = gt_m.shape[0]
            centers = torch.zeros(k, 2, device=device, dtype=theta.dtype)
            for i in range(k):
                ys, xs = torch.where(gt_m[i] > 0)
                if ys.numel() > 0:
                    centers[i, 0] = xs.float().mean() / max(gt_m.shape[-1] - 1, 1)
                    centers[i, 1] = ys.float().mean() / max(gt_m.shape[-2] - 1, 1)
                else:
                    centers[i] = 0.5
            # Resize GT masks to native HR resolution (H, W)
            if gt_m.shape[-2:] != (H, W):
                gt_m = F.interpolate(gt_m.unsqueeze(1), size=(H, W),
                                      mode="nearest").squeeze(1)
            theta_all.append(t)
            centers_all.append(centers)
            batch_idx_all.append(torch.full((k,), b, device=device, dtype=torch.long))
            gt_all.append(gt_m)
            cls_all.append(targets[b]["labels"][gt_idx])

        if not theta_all:
            zero = theta.sum() * 0.0
            return {"loss_hr_bce": zero, "loss_hr_dice": zero,
                    "loss_hr_cldice": zero, "loss_hr_cbdice": zero}

        theta_cat = torch.cat(theta_all, dim=0)
        centers_cat = torch.cat(centers_all, dim=0)
        batch_idx = torch.cat(batch_idx_all, dim=0)
        gt_cat = torch.cat(gt_all, dim=0)
        cls_cat = torch.cat(cls_all, dim=0)

        # Produce native-res masks for matched queries
        mask_logits = self.dyn_mask_head(E, theta_cat, centers_cat, batch_idx)  # (M, H, W)
        mask_prob = mask_logits.sigmoid()

        # Per-class loss weights (same as low-res path)
        weights = torch.tensor(
            [CLASS_LOSS_WEIGHTS.get(int(l), 1.0) for l in cls_cat],
            device=device, dtype=mask_prob.dtype,
        )

        out = {}
        if self.hr_bce_weight > 0:
            per_bce = F.binary_cross_entropy_with_logits(
                mask_logits, gt_cat, reduction="none"
            ).mean(dim=(1, 2))
            out["loss_hr_bce"] = self.hr_bce_weight * (per_bce * weights).mean()

        if self.hr_dice_weight > 0:
            inter = (mask_prob * gt_cat).sum(dim=(1, 2))
            den = mask_prob.sum(dim=(1, 2)) + gt_cat.sum(dim=(1, 2))
            per_dice = 1.0 - 2.0 * inter / (den + 1e-6)
            out["loss_hr_dice"] = self.hr_dice_weight * (per_dice * weights).mean()

        if self.hr_cldice_weight > 0:
            # Reuse low-res clDice on Tail-only
            tail_mask = cls_cat == 3
            if tail_mask.any():
                tp = mask_logits[tail_mask]
                tg = gt_cat[tail_mask]
                out["loss_hr_cldice"] = self.hr_cldice_weight * _cldice_loss(tp, tg)

        if self.hr_cbdice_weight > 0:
            from sperm_final.models.cbdice_loss import cbdice_loss
            tail_mask = cls_cat == 3
            if tail_mask.any():
                out["loss_hr_cbdice"] = self.hr_cbdice_weight * cbdice_loss(
                    mask_prob[tail_mask], gt_cat[tail_mask]
                )

        return out

    def _polyline_loss(self, pred_coords, pred_valid, targets, indices):
        """Chamfer between predicted polyline (per matched query) and GT polyline."""
        from sperm_final.models.igm2f_heads import chamfer_polyline_loss
        B, Q, K, _ = pred_coords.shape
        device = pred_coords.device
        total = torch.zeros((), device=device)
        n = 0
        for b, (pred_idx, gt_idx) in enumerate(indices):
            if len(pred_idx) == 0 or "polyline_points" not in targets[b]:
                continue
            # Get image size in pixels for denormalization (masks are at full patch res)
            ph, pw = targets[b]["masks"].shape[-2:]
            pc = pred_coords[b, pred_idx]  # (K, K_max, 2) in [0,1]
            pc_px = pc.clone()
            pc_px[..., 0] *= pw
            pc_px[..., 1] *= ph
            pv = pred_valid[b, pred_idx]   # (K, K_max)
            gt_polys = [targets[b]["polyline_points"][int(g)].to(device)
                        for g in gt_idx.tolist()]
            total = total + chamfer_polyline_loss(pc_px, pv, gt_polys, (ph, pw))
            n += 1
        return total / max(n, 1)

    def _contrastive_loss(self, pred_embed, targets, indices):
        """InfoNCE over matched queries using instance_ids."""
        from sperm_final.models.igm2f_heads import instance_contrastive_loss
        # Gather matched embeddings + their instance IDs across batch
        embeds = []
        inst_ids = []
        for b, (pred_idx, gt_idx) in enumerate(indices):
            if len(pred_idx) == 0 or "instance_ids" not in targets[b]:
                continue
            embeds.append(pred_embed[b, pred_idx])
            # Offset instance IDs by batch idx to avoid cross-image collisions
            iid = targets[b]["instance_ids"][gt_idx].to(pred_embed.device)
            inst_ids.append(iid + b * 100000)  # 100k instance cap per image
        if not embeds:
            return pred_embed.sum() * 0.0
        embeds_cat = torch.cat(embeds, dim=0)
        ids_cat = torch.cat(inst_ids, dim=0)
        return instance_contrastive_loss(embeds_cat, ids_cat)

    def _topology_loss(self, pred_coords, pred_valid, targets, indices):
        """H_end ≈ M_start + M_end ≈ T_start per instance."""
        from sperm_final.models.igm2f_heads import topology_continuity_loss
        total = torch.zeros((), device=pred_coords.device)
        n = 0
        for b, (pred_idx, gt_idx) in enumerate(indices):
            if len(pred_idx) == 0 or "instance_ids" not in targets[b]:
                continue
            ph, pw = targets[b]["masks"].shape[-2:]
            pc = pred_coords[b, pred_idx].clone()
            pc[..., 0] *= pw
            pc[..., 1] *= ph
            pv = pred_valid[b, pred_idx]
            cids = targets[b]["labels"][gt_idx].to(pc.device)
            iids = targets[b]["instance_ids"][gt_idx].to(pc.device)
            total = total + topology_continuity_loss(pc, pv, cids, iids, (ph, pw))
            n += 1
        return total / max(n, 1)

    def _compute_losses(
        self,
        pred_logits: torch.Tensor,
        pred_masks: torch.Tensor,
        targets: List[Dict[str, torch.Tensor]],
        indices: List[Tuple[torch.Tensor, torch.Tensor]],
    ) -> Dict[str, torch.Tensor]:
        """Compute classification and mask losses for a set of predictions."""
        B = pred_logits.shape[0]
        device = pred_logits.device

        # Classification loss
        # Create target labels: matched queries get GT class, others get 0 (background)
        target_classes = torch.zeros(
            pred_logits.shape[:2], dtype=torch.int64, device=device
        )
        for b, (pred_idx, gt_idx) in enumerate(indices):
            if len(pred_idx) > 0:
                target_classes[b, pred_idx] = targets[b]["labels"][gt_idx]

        loss_cls = _focal_loss(
            pred_logits.flatten(0, 1),
            target_classes.flatten(),
            self.num_classes,
        )

        # Mask losses (only for matched queries)
        loss_bce = torch.tensor(0.0, device=device)
        loss_dice = torch.tensor(0.0, device=device)
        loss_boundary = torch.tensor(0.0, device=device)
        loss_cldice = torch.tensor(0.0, device=device)
        n_masks = 0
        n_tail = 0

        for b, (pred_idx, gt_idx) in enumerate(indices):
            if len(pred_idx) == 0:
                continue

            pred_m = pred_masks[b, pred_idx]  # (K, H, W)
            gt_m = targets[b]["masks"][gt_idx].float()  # (K, H_gt, W_gt)

            # Resize GT masks to match prediction resolution
            pred_h, pred_w = pred_m.shape[-2:]
            gt_h, gt_w = gt_m.shape[-2:]
            if (gt_h, gt_w) != (pred_h, pred_w):
                gt_m = F.interpolate(
                    gt_m.unsqueeze(1),
                    size=(pred_h, pred_w),
                    mode="nearest",
                ).squeeze(1)

            # Per-instance class weights
            matched_labels = targets[b]["labels"][gt_idx]
            weights = torch.tensor(
                [CLASS_LOSS_WEIGHTS.get(int(l), 1.0) for l in matched_labels],
                device=device, dtype=pred_m.dtype,
            )

            # Weighted BCE loss (per-instance then weighted mean)
            per_instance_bce = F.binary_cross_entropy_with_logits(
                pred_m, gt_m, reduction="none"
            ).mean(dim=(1, 2))
            loss_bce = loss_bce + (per_instance_bce * weights).mean()

            # Lovász hinge loss (replaces Dice, direct IoU surrogate)
            loss_dice = loss_dice + _lovasz_hinge_loss(pred_m, gt_m, weights)

            # Boundary loss
            loss_boundary = loss_boundary + _boundary_loss(pred_m, gt_m)

            # clDice loss — only for Tail instances (cls=3)
            tail_mask = (matched_labels == 3)
            if tail_mask.any():
                tail_pred = pred_m[tail_mask]
                tail_gt = gt_m[tail_mask]
                loss_cldice = loss_cldice + _cldice_loss(tail_pred, tail_gt)
                n_tail += 1

            n_masks += 1

        if n_masks > 0:
            loss_bce = loss_bce / n_masks
            loss_dice = loss_dice / n_masks
            loss_boundary = loss_boundary / n_masks
        if n_tail > 0:
            loss_cldice = loss_cldice / n_tail

        return {
            "loss_cls": self.cls_weight * loss_cls,
            "loss_bce": self.mask_bce_weight * loss_bce,
            "loss_dice": self.mask_dice_weight * loss_dice,
            "loss_boundary": self.boundary_weight * loss_boundary,
            "loss_cldice": self.cldice_weight * loss_cldice,
        }


def _resample_polyline(pts: "torch.Tensor", n: int) -> "torch.Tensor":
    """Resample a polyline (K_in, 2) to n points uniformly along arc length."""
    import torch
    K = pts.shape[0]
    if K < 2 or n < 2:
        if K == 0:
            return pts.new_zeros(n, 2)
        return pts[:1].repeat(n, 1)
    seg = pts[1:] - pts[:-1]
    seg_len = seg.norm(dim=-1).clamp_min(1e-8)
    cum = torch.cat([seg_len.new_zeros(1), seg_len.cumsum(0)])  # (K,)
    total = cum[-1].clamp_min(1e-8)
    target = torch.linspace(0.0, total.item(), n, device=pts.device)
    idx = torch.bucketize(target, cum)
    idx = idx.clamp(1, K - 1)
    t0 = cum[idx - 1]
    t1 = cum[idx].clamp_min(t0 + 1e-8)
    w = ((target - t0) / (t1 - t0)).clamp(0, 1).unsqueeze(-1)
    p0 = pts[idx - 1]
    p1 = pts[idx]
    return p0 * (1 - w) + p1 * w

