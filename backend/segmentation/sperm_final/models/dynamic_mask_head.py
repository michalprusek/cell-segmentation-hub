"""CondInst-style dynamic mask head for native-resolution instance segmentation.

Implements the memory-efficient pattern from Tian et al. "Instance and Panoptic
Segmentation Using Conditional Convolutions" (TPAMI 2022, arxiv 2102.03026):

  - `MaskFeatureHead`: upsamples stride-4 features (256×256×C) to native
    resolution (1024×1024×D) via 2 bilinear + conv stages. Computed ONCE
    per image.
  - `DynamicMaskHead`: per-query mask = 3-layer 1×1 conv applied to
    concat(E, relative_coords). Per-query cost is 169 params instead of a
    full 1024×1024 tensor.

This lets us store O(H·W·D + Q·|θ|) instead of O(Q·H·W), making native-res
instance segmentation feasible on a single 80 GB GPU.

Integration: emitted by `Mask2FormerModel.forward()` when
`config.use_high_res_mask=True`. Applied in `criterion._compute_hr_mask_loss()`
only for matched queries (after Hungarian on coarse 256² masks).
"""

from typing import Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


# Dynamic conv layer shapes. MUST match `CONTROLLER_OUT_DIM` for the 169
# parameter count assumed elsewhere.
# Layer 1: in = (D_embed + 2_coords), out = 8    → (10*8 + 8) = 88 params
# Layer 2: in = 8,                     out = 8    → (8*8 + 8)   = 72 params
# Layer 3: in = 8,                     out = 1    → (8*1 + 1)   = 9 params
# Total = 169
_LAYER_SHAPES = ((10, 8), (8, 8), (8, 1))
CONTROLLER_OUT_DIM = sum(c_in * c_out + c_out for c_in, c_out in _LAYER_SHAPES)  # 169


class MaskFeatureHead(nn.Module):
    """Lift pixel-decoder features to native resolution per-pixel embeddings.

    For DINOv3 ViT-L/16 at 1024 input, `mask_features` is stride-8 (128×128).
    Three bilinear ×2 upsamples take it to stride-1 (1024×1024).

    Input:  F ∈ R^(B, in_channels, H_in, W_in)
    Output: E ∈ R^(B, out_dim, H_in×target_upscale, W_in×target_upscale)

    Args:
        target_upscale: total upsample factor. 8 for stride-8 ViT-L/16 features
                        at 1024 input. Set to 4 for stride-4 decoders.
    """

    def __init__(self, in_channels: int = 256, mid_channels: int = 128,
                  out_dim: int = 8, target_upscale: int = 8):
        super().__init__()
        assert target_upscale in (4, 8), f"target_upscale must be 4 or 8, got {target_upscale}"
        mid2 = max(mid_channels // 2, out_dim * 2)
        self.target_upscale = target_upscale
        self.conv1 = nn.Sequential(
            nn.Conv2d(in_channels, mid_channels, kernel_size=3, padding=1),
            nn.GroupNorm(32, mid_channels),
            nn.GELU(),
        )
        self.conv2 = nn.Sequential(
            nn.Conv2d(mid_channels, mid2, kernel_size=3, padding=1),
            nn.GroupNorm(min(32, mid2), mid2),
            nn.GELU(),
        )
        # Extra refinement conv after 3rd upsample (only used when target_upscale=8)
        if target_upscale == 8:
            self.conv3 = nn.Sequential(
                nn.Conv2d(mid2, mid2, kernel_size=3, padding=1),
                nn.GroupNorm(min(32, mid2), mid2),
                nn.GELU(),
            )
        self.proj = nn.Conv2d(mid2, out_dim, kernel_size=1)
        self.out_dim = out_dim

    def forward(self, f4: torch.Tensor) -> torch.Tensor:
        x = self.conv1(f4)
        x = F.interpolate(x, scale_factor=2, mode="bilinear", align_corners=False)
        x = self.conv2(x)
        x = F.interpolate(x, scale_factor=2, mode="bilinear", align_corners=False)
        if self.target_upscale == 8:
            x = self.conv3(x)
            x = F.interpolate(x, scale_factor=2, mode="bilinear", align_corners=False)
        return self.proj(x)


def _parse_dynamic_params(theta: torch.Tensor):
    """Split flat (M, 169) theta into per-layer conv weights + biases.

    Returns list of (weights, biases) triples, one per layer. Weights are
    shape (M, c_out, c_in, 1, 1) for 1×1 convs; biases shape (M, c_out).
    """
    assert theta.shape[-1] == CONTROLLER_OUT_DIM, (
        f"theta must have {CONTROLLER_OUT_DIM} params, got {theta.shape}"
    )
    M = theta.shape[0]
    params = []
    offset = 0
    for c_in, c_out in _LAYER_SHAPES:
        w_size = c_in * c_out
        b_size = c_out
        w = theta[:, offset:offset + w_size].reshape(M, c_out, c_in, 1, 1)
        offset += w_size
        b = theta[:, offset:offset + b_size]
        offset += b_size
        params.append((w, b))
    return params


class DynamicMaskHead(nn.Module):
    """Per-instance mask via dynamic 1×1 conv stack.

    At every query, θ_i (169 params) encodes 3 × 1×1 convs that, applied to
    concat(E, rel_coords_i), predict the mask logit map at native resolution.

    Forward:
        E:            (B, D_embed, H, W)
        theta:        (M, 169)           dynamic conv params per matched query
        centers:      (M, 2)             normalized [0, 1] centers for rel coords
        batch_index:  (M,)               which batch entry each matched query comes from

    Returns:
        masks: (M, H, W)  mask logits (pre-sigmoid)
    """

    def __init__(self, embed_dim: int = 8):
        super().__init__()
        self.embed_dim = embed_dim
        expected_c1_in = _LAYER_SHAPES[0][0]
        assert embed_dim + 2 == expected_c1_in, (
            f"DynamicMaskHead expects embed_dim+2={expected_c1_in} channels at layer 1, "
            f"got embed_dim={embed_dim}"
        )

    @staticmethod
    def _relative_coords(
        H: int, W: int, centers: torch.Tensor, device: torch.device, dtype: torch.dtype
    ) -> torch.Tensor:
        """Return (M, 2, H, W) relative coordinates normalized to [-1, 1] scale.

        For each matched query at normalized center (cx, cy):
          rel_x = (pixel_x / W) - cx
          rel_y = (pixel_y / H) - cy
        Output channel order: (rel_x, rel_y).
        """
        M = centers.shape[0]
        # Build base coordinate grid (1, 2, H, W)
        ys = torch.linspace(0.5 / H, 1 - 0.5 / H, H, device=device, dtype=dtype)
        xs = torch.linspace(0.5 / W, 1 - 0.5 / W, W, device=device, dtype=dtype)
        grid_y, grid_x = torch.meshgrid(ys, xs, indexing="ij")  # each (H, W)
        grid = torch.stack([grid_x, grid_y], dim=0).unsqueeze(0)  # (1, 2, H, W)
        # Expand across M queries and subtract their centers
        c = centers.to(dtype=dtype)  # (M, 2)
        c = c.view(M, 2, 1, 1)
        rel = grid - c  # (M, 2, H, W)
        return rel

    def forward(
        self,
        E: torch.Tensor,                 # (B, D, H, W)
        theta: torch.Tensor,             # (M, 169)
        centers: torch.Tensor,           # (M, 2)
        batch_index: torch.Tensor,       # (M,) long — which batch item
    ) -> torch.Tensor:
        """Return (M, H, W) mask logits."""
        B, D, H, W = E.shape
        M = theta.shape[0]
        if M == 0:
            return torch.empty(0, H, W, device=E.device, dtype=E.dtype)

        rel = self._relative_coords(H, W, centers, E.device, E.dtype)  # (M, 2, H, W)
        e_per_match = E[batch_index]                                   # (M, D, H, W)
        x = torch.cat([e_per_match, rel], dim=1)                       # (M, D+2, H, W)

        layers = _parse_dynamic_params(theta)
        # Apply each dynamic conv via grouped convolution trick:
        #   - Treat the M×c_out×c_in×1×1 weights as a single (M·c_out, c_in, 1, 1) kernel
        #   - x is reshaped to (1, M·c_in, H, W) with groups=M
        # This batches all M instances into one conv2d call.
        for li, ((c_in, c_out), (w, b)) in enumerate(zip(_LAYER_SHAPES, layers)):
            # x shape: (M, c_in, H, W)  →  (1, M·c_in, H, W)
            x = x.reshape(1, M * c_in, H, W)
            w_flat = w.reshape(M * c_out, c_in, 1, 1)
            b_flat = b.reshape(M * c_out)
            x = F.conv2d(x, w_flat, bias=b_flat, groups=M)
            # Reshape back to (M, c_out, H, W)
            x = x.reshape(M, c_out, H, W)
            if li < len(_LAYER_SHAPES) - 1:
                x = F.gelu(x)

        # Final (M, 1, H, W) → (M, H, W)
        return x.squeeze(1)


__all__ = ["MaskFeatureHead", "DynamicMaskHead", "CONTROLLER_OUT_DIM"]
