"""GeoMask: Geometric-parametric instance segmentation for thin structures.

Core idea: represent each instance as a centerline polyline + per-point width,
and rasterize to mask via differentiable Gaussian-like tube rendering. Trained
at native resolution (1024²) without storing H×W masks per query — peak memory
is O(H·W) per matched query, not O(Q·H·W).

Complements v12 IGM2F-PL (polyline head already exists). What's new here:

1. WidthHead      — per-query per-point half-width (K scalars) in pixels.
2. rasterize_polyline_tube  — differentiable polyline → soft mask at any resolution.
3. polyraster_loss — BCE+Dice+clDice on rasterized mask vs GT mask at 1024².
4. width_regression_loss — MSE between pred width and GT width sampled from
                            GT mask along matched polyline.

Memory: chunked by segment (loop over K-1), peak = O(N·H·W) not O(N·K·H·W).
For N=20 matched queries at 1024²: ~80 MB fp32 or 40 MB fp16.

Design note: the rasterizer uses a sigmoid soft-threshold `sigmoid((w - d)/T)`
rather than Gaussian so that width has direct pixel-space meaning. T=0.5-1.0
gives sharp-but-differentiable tubes.
"""

from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


class WidthHead(nn.Module):
    """Predicts per-point half-width (pixels) for each polyline query.

    Output: (B, Q, K) softplus-activated width values scaled by `max_width_px`.
    The softplus ensures non-negativity; max_width_px prevents early-training
    unbounded widths that would dominate the loss.
    """

    def __init__(self, hidden_dim: int = 256, k_max: int = 32,
                 mlp_layers: int = 2, max_width_px: float = 40.0,
                 init_width_px: float = 5.0):
        super().__init__()
        self.k_max = k_max
        self.max_width_px = max_width_px
        layers = []
        d = hidden_dim
        for _ in range(mlp_layers - 1):
            layers += [nn.Linear(d, d), nn.GELU()]
        last = nn.Linear(d, k_max)
        # Bias init so sigmoid(bias) * max_width ≈ init_width_px.
        # Typical sperm parts: Head ~8px, Midpiece ~4px, Tail ~2-3px half-width.
        # init=5 gives sigmoid⁻¹(5/40) = sigmoid⁻¹(0.125) ≈ -1.95
        with torch.no_grad():
            last.weight.zero_()
            import math
            p = init_width_px / max_width_px
            p = min(max(p, 1e-3), 1 - 1e-3)
            last.bias.fill_(math.log(p / (1 - p)))
        layers += [last]
        self.mlp = nn.Sequential(*layers)

    def forward(self, query_features: torch.Tensor) -> torch.Tensor:
        qf = query_features.float()
        raw = self.mlp(qf)                           # (B, Q, K)
        # Sigmoid * max_width bounds widths to [0, max_width_px] cleanly.
        return torch.sigmoid(raw) * self.max_width_px


def rasterize_polyline_tube(
    coords: torch.Tensor,        # (N, K, 2) in pixels
    valid: torch.Tensor,         # (N, K) probability of validity (sigmoid-applied)
    widths: torch.Tensor,        # (N, K) half-widths in pixels
    image_size: Tuple[int, int],
    temperature: float = 0.7,
    chunk_segments: bool = True,
) -> torch.Tensor:
    """Differentiable rasterization of (polyline, width) → soft mask.

    For each pixel p in the image grid and each segment A_k→A_{k+1} with
    interpolated half-width w_k, compute signed tube distance:
        t = clamp(((p-A)·(B-A)) / ||B-A||², 0, 1)
        proj = A + t * (B-A)
        d = ||p - proj||
        seg_mask = sigmoid((w - d) / temperature)

    Output mask = max over segments (soft union). Invalid segments masked out.

    Args:
        coords: polyline points in pixel coords (N, K, 2).
        valid: per-point validity prob in [0, 1] (N, K).
        widths: per-point half-width in pixels (N, K).
        image_size: (H, W) target raster resolution.
        temperature: sigmoid softness (smaller = sharper edge).
        chunk_segments: if True, loops over segments to save memory (recommended).

    Returns:
        (N, H, W) soft mask in [0, 1].
    """
    N, K, _ = coords.shape
    if N == 0:
        return coords.new_zeros(0, *image_size)

    H, W = image_size
    device = coords.device
    dtype = torch.float32  # rasterizer needs fp32 for stable sqrt/sigmoid

    # Segment endpoints
    A = coords[:, :-1].to(dtype)             # (N, K-1, 2)
    B = coords[:, 1:].to(dtype)              # (N, K-1, 2)
    seg_valid = (valid[:, :-1] * valid[:, 1:]).to(dtype)   # (N, K-1)
    seg_w = 0.5 * (widths[:, :-1] + widths[:, 1:]).to(dtype)  # (N, K-1)

    AB = B - A                               # (N, K-1, 2)
    AB_len_sq = (AB ** 2).sum(-1).clamp_min(1e-6)  # (N, K-1)

    # Pixel grid (H, W, 2) in (x, y)
    yy = torch.arange(H, device=device, dtype=dtype)
    xx = torch.arange(W, device=device, dtype=dtype)
    grid_y, grid_x = torch.meshgrid(yy, xx, indexing="ij")
    P = torch.stack([grid_x, grid_y], dim=-1)  # (H, W, 2)

    if chunk_segments:
        # Loop over segments; accumulate max. Peak mem = O(N·H·W).
        mask = coords.new_zeros(N, H, W, dtype=dtype)
        for k in range(K - 1):
            A_k = A[:, k]                # (N, 2)
            B_k = B[:, k]                # (N, 2)
            AB_k = AB[:, k]              # (N, 2)
            len_sq_k = AB_len_sq[:, k]   # (N,)
            w_k = seg_w[:, k]            # (N,)
            v_k = seg_valid[:, k]        # (N,)

            # Broadcast: P(H,W,2) - A_k(N,1,1,2) → (N,H,W,2)
            AP = P[None] - A_k[:, None, None, :]
            AP_dot_AB = (AP * AB_k[:, None, None, :]).sum(-1)  # (N,H,W)
            t = (AP_dot_AB / len_sq_k[:, None, None]).clamp(0, 1)
            proj = A_k[:, None, None, :] + t[..., None] * AB_k[:, None, None, :]
            d = ((P[None] - proj) ** 2).sum(-1).clamp_min(1e-8).sqrt()  # (N,H,W)
            seg_mask_k = torch.sigmoid((w_k[:, None, None] - d) / temperature)
            seg_mask_k = seg_mask_k * v_k[:, None, None]
            mask = torch.maximum(mask, seg_mask_k)
        return mask
    else:
        # Vectorized across segments — uses N·K·H·W memory. Only for small K.
        AP = P[None, None] - A[:, :, None, None, :]        # (N, K-1, H, W, 2)
        AP_dot_AB = (AP * AB[:, :, None, None, :]).sum(-1)  # (N, K-1, H, W)
        t = (AP_dot_AB / AB_len_sq[:, :, None, None]).clamp(0, 1)
        proj = A[:, :, None, None, :] + t[..., None] * AB[:, :, None, None, :]
        d = ((P[None, None] - proj) ** 2).sum(-1).clamp_min(1e-8).sqrt()
        seg_mask = torch.sigmoid((seg_w[:, :, None, None] - d) / temperature)
        seg_mask = seg_mask * seg_valid[:, :, None, None]
        return seg_mask.max(dim=1).values


def sample_gt_width_from_mask(
    gt_mask: torch.Tensor,       # (H, W) binary GT mask
    polyline: torch.Tensor,      # (K, 2) polyline pixel coords
    max_width: float = 40.0,
    samples_perpendicular: int = 16,
) -> torch.Tensor:
    """Sample GT half-width at each polyline point from the mask.

    Shoots rays perpendicular to the local tangent at each point, counts mask
    pixels hit, returns half-width (pixels) per point. Used as regression
    target for WidthHead.
    """
    K = polyline.shape[0]
    if K < 2 or gt_mask.sum() == 0:
        return polyline.new_zeros(K)

    H, W = gt_mask.shape
    device = polyline.device

    # Tangent at each point: forward difference except last (backward)
    tang = torch.zeros_like(polyline)
    tang[:-1] = polyline[1:] - polyline[:-1]
    tang[-1] = polyline[-1] - polyline[-2]
    tang_norm = tang.norm(dim=-1, keepdim=True).clamp_min(1e-6)
    tang = tang / tang_norm
    # Perpendicular: rotate 90°
    perp = torch.stack([-tang[:, 1], tang[:, 0]], dim=-1)   # (K, 2)

    # Sample distances from -max_width to +max_width
    offsets = torch.linspace(-max_width, max_width, samples_perpendicular, device=device)
    # Rays: (K, S, 2) = polyline[:,None] + perp[:,None]*offset[None,:]
    ray_pts = polyline[:, None, :] + perp[:, None, :] * offsets[None, :, None]  # (K, S, 2)

    # Sample mask values via bilinear
    # Normalize to [-1, 1] for grid_sample: x_n = 2x/(W-1) - 1
    gx = 2 * ray_pts[..., 0] / (W - 1) - 1
    gy = 2 * ray_pts[..., 1] / (H - 1) - 1
    grid = torch.stack([gx, gy], dim=-1).unsqueeze(0)  # (1, K, S, 2)
    mask_in = gt_mask.unsqueeze(0).unsqueeze(0).float()  # (1, 1, H, W)
    vals = F.grid_sample(mask_in, grid, mode="bilinear", padding_mode="zeros",
                         align_corners=True).squeeze(0).squeeze(0)  # (K, S)

    # For each point, half-width = max |offset| where vals > 0.5
    inside = vals > 0.5  # (K, S)
    # Get max abs offset per point where inside
    abs_off = offsets.abs()[None, :].expand(K, -1)  # (K, S)
    off_inside = torch.where(inside, abs_off, torch.zeros_like(abs_off))
    half_w = off_inside.max(dim=-1).values  # (K,)
    return half_w


def polyraster_masks_loss(
    pred_mask_soft: torch.Tensor,   # (N, H, W) in [0,1]
    gt_mask_hard: torch.Tensor,     # (N, H, W) binary
    cldice_iter: int = 3,
) -> Dict[str, torch.Tensor]:
    """BCE + Dice + clDice on rasterized mask.

    clDice iteratively skeletonizes via soft-skel approximation (min-pool of
    dilation gaps), suitable for fp32 autograd on tubular structures.
    """
    if pred_mask_soft.numel() == 0:
        z = pred_mask_soft.sum() * 0.0
        return {"bce": z, "dice": z, "cldice": z}

    pred = pred_mask_soft.float().clamp(1e-4, 1 - 1e-4)
    gt = gt_mask_hard.float()

    # BCE — manual implementation to avoid autocast-unsafe F.binary_cross_entropy
    bce = -(gt * torch.log(pred) + (1 - gt) * torch.log(1 - pred)).mean()

    # Dice
    inter = (pred * gt).sum(dim=(-2, -1))
    union = pred.sum(dim=(-2, -1)) + gt.sum(dim=(-2, -1))
    dice = 1 - (2 * inter + 1) / (union + 1)
    dice = dice.mean()

    # clDice via soft-skel approximation
    def soft_skel(x, n_iters):
        x_ = x.unsqueeze(1)  # (N, 1, H, W)
        for _ in range(n_iters):
            erode = -F.max_pool2d(-x_, kernel_size=3, stride=1, padding=1)
            dilate = F.max_pool2d(erode, kernel_size=3, stride=1, padding=1)
            delta = F.relu(x_ - dilate)
            x_ = erode + delta
        return x_.squeeze(1)

    pred_skel = soft_skel(pred, cldice_iter)
    gt_skel = soft_skel(gt, cldice_iter)
    tprec = (pred_skel * gt).sum(dim=(-2, -1)) / (pred_skel.sum(dim=(-2, -1)) + 1e-6)
    tsens = (gt_skel * pred).sum(dim=(-2, -1)) / (gt_skel.sum(dim=(-2, -1)) + 1e-6)
    cldice = 1 - 2 * (tprec * tsens) / (tprec + tsens + 1e-6)
    cldice = cldice.mean()

    return {"bce": bce, "dice": dice, "cldice": cldice}


def width_regression_loss(
    pred_widths: torch.Tensor,   # (N, K) pixels
    gt_widths: torch.Tensor,     # (N, K) pixels — from sample_gt_width_from_mask
    pred_valid: torch.Tensor,    # (N, K) probs
) -> torch.Tensor:
    """MSE between pred and GT widths, weighted by predicted validity.

    GT widths come from perpendicular sampling of the GT mask along the GT
    polyline (via sample_gt_width_from_mask).
    """
    if pred_widths.numel() == 0:
        return pred_widths.sum() * 0.0
    w = pred_valid.float()
    diff = (pred_widths.float() - gt_widths.float()) ** 2
    return (w * diff).sum() / (w.sum().clamp_min(1e-6))
