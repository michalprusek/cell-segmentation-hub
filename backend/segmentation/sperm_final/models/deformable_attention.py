"""Multi-Scale Deformable Attention — pure PyTorch implementation (no custom CUDA ops).

Based on Deformable DETR (Zhu et al., 2021) and Mask2Former pixel decoder.
Uses F.grid_sample for bilinear sampling at learned offset locations.
"""

import math
from typing import List, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


class MSDeformAttn(nn.Module):
    """Multi-Scale Deformable Attention Module.

    Each query attends to a small set of sampling points (n_points)
    around a reference point on each feature level (n_levels).
    Complexity: O(N * n_heads * n_levels * n_points) — linear in N.
    """

    def __init__(self, d_model: int = 256, n_heads: int = 8,
                 n_levels: int = 4, n_points: int = 4):
        super().__init__()
        assert d_model % n_heads == 0
        self.d_model = d_model
        self.n_heads = n_heads
        self.n_levels = n_levels
        self.n_points = n_points
        self.head_dim = d_model // n_heads

        self.sampling_offsets = nn.Linear(d_model, n_heads * n_levels * n_points * 2)
        self.attention_weights = nn.Linear(d_model, n_heads * n_levels * n_points)
        self.value_proj = nn.Linear(d_model, d_model)
        self.output_proj = nn.Linear(d_model, d_model)

        self._reset_parameters()

    def _reset_parameters(self):
        nn.init.constant_(self.sampling_offsets.weight, 0.0)
        # Initialize offsets in a circular pattern around reference points
        thetas = torch.arange(self.n_heads, dtype=torch.float32) * (
            2.0 * math.pi / self.n_heads
        )
        grid_init = torch.stack([thetas.cos(), thetas.sin()], -1)
        grid_init = grid_init / grid_init.abs().max(-1, keepdim=True)[0]
        grid_init = grid_init.view(self.n_heads, 1, 1, 2).repeat(
            1, self.n_levels, self.n_points, 1
        )
        for i in range(self.n_points):
            grid_init[:, :, i, :] *= i + 1
        with torch.no_grad():
            self.sampling_offsets.bias = nn.Parameter(grid_init.view(-1))

        nn.init.constant_(self.attention_weights.weight, 0.0)
        nn.init.constant_(self.attention_weights.bias, 0.0)
        nn.init.xavier_uniform_(self.value_proj.weight)
        nn.init.constant_(self.value_proj.bias, 0.0)
        nn.init.xavier_uniform_(self.output_proj.weight)
        nn.init.constant_(self.output_proj.bias, 0.0)

    def forward(
        self,
        query: torch.Tensor,
        reference_points: torch.Tensor,
        value_flatten: torch.Tensor,
        spatial_shapes: List[Tuple[int, int]],
    ) -> torch.Tensor:
        """
        Args:
            query: (B, N_q, C) — flattened multi-scale queries.
            reference_points: (B, N_q, n_levels, 2) — normalized [0, 1].
            value_flatten: (B, N_v, C) — flattened multi-scale values (N_v == N_q).
            spatial_shapes: list of (H, W) per level.

        Returns:
            (B, N_q, C) — attended output.
        """
        B, N_q, _ = query.shape
        N_v = value_flatten.shape[1]

        value = self.value_proj(value_flatten)
        value = value.view(B, N_v, self.n_heads, self.head_dim)

        # Predict offsets and attention weights
        offsets = self.sampling_offsets(query).view(
            B, N_q, self.n_heads, self.n_levels, self.n_points, 2
        )
        attn_weights = self.attention_weights(query).view(
            B, N_q, self.n_heads, self.n_levels * self.n_points
        )
        attn_weights = F.softmax(attn_weights, dim=-1).view(
            B, N_q, self.n_heads, self.n_levels, self.n_points
        )

        # Normalize offsets by each level's spatial shape
        offset_normalizer = torch.tensor(
            [[w, h] for h, w in spatial_shapes],
            dtype=query.dtype, device=query.device,
        )  # (n_levels, 2)
        sampling_locations = (
            reference_points[:, :, None, :, None, :]
            + offsets / offset_normalizer[None, None, None, :, None, :]
        )  # (B, N_q, n_heads, n_levels, n_points, 2)

        # Sample values using F.grid_sample per level
        output = torch.zeros(
            B, N_q, self.n_heads, self.head_dim,
            device=query.device, dtype=query.dtype,
        )

        start_idx = 0
        for lvl, (H, W) in enumerate(spatial_shapes):
            HW = H * W
            # Reshape value for this level: (B*n_heads, head_dim, H, W)
            val_lvl = (
                value[:, start_idx : start_idx + HW]
                .permute(0, 2, 3, 1)
                .reshape(B * self.n_heads, self.head_dim, H, W)
            )

            # Grid for this level: (B, N_q, n_heads, n_points, 2) → (B*n_heads, N_q, n_points, 2)
            grid = sampling_locations[:, :, :, lvl, :, :]  # (B, N_q, n_heads, n_points, 2)
            grid = grid.permute(0, 2, 1, 3, 4).reshape(
                B * self.n_heads, N_q, self.n_points, 2
            )
            grid = 2.0 * grid - 1.0  # [0,1] → [-1,1] for grid_sample

            # Sample: (B*n_heads, head_dim, N_q, n_points)
            sampled = F.grid_sample(
                val_lvl, grid, mode="bilinear", padding_mode="zeros", align_corners=False
            )
            sampled = sampled.view(
                B, self.n_heads, self.head_dim, N_q, self.n_points
            ).permute(0, 3, 1, 2, 4)
            # sampled: (B, N_q, n_heads, head_dim, n_points)

            # Weighted sum for this level
            w = attn_weights[:, :, :, lvl, :]  # (B, N_q, n_heads, n_points)
            output += (sampled * w.unsqueeze(3)).sum(-1)

            start_idx += HW

        output = output.reshape(B, N_q, self.d_model)
        return self.output_proj(output)


class MSDeformAttnEncoderLayer(nn.Module):
    """Transformer encoder layer with multi-scale deformable attention."""

    def __init__(self, d_model: int = 256, n_heads: int = 8,
                 n_levels: int = 4, n_points: int = 4,
                 dim_feedforward: int = 1024, dropout: float = 0.1):
        super().__init__()

        self.self_attn = MSDeformAttn(d_model, n_heads, n_levels, n_points)
        self.norm1 = nn.LayerNorm(d_model)
        self.dropout1 = nn.Dropout(dropout)

        self.ffn = nn.Sequential(
            nn.Linear(d_model, dim_feedforward),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(dim_feedforward, d_model),
            nn.Dropout(dropout),
        )
        self.norm2 = nn.LayerNorm(d_model)

    def forward(self, src, reference_points, spatial_shapes):
        # Self-attention (deformable)
        src2 = self.self_attn(src, reference_points, src, spatial_shapes)
        src = self.norm1(src + self.dropout1(src2))
        # FFN
        src = self.norm2(src + self.ffn(src))
        return src


def get_reference_points(spatial_shapes: List[Tuple[int, int]],
                         device: torch.device) -> torch.Tensor:
    """Generate normalized reference points for all spatial positions.

    Args:
        spatial_shapes: list of (H, W) per level.
        device: torch device.

    Returns:
        (1, N_total, n_levels, 2) reference points in [0, 1].
    """
    ref_list = []
    for H, W in spatial_shapes:
        ref_y, ref_x = torch.meshgrid(
            torch.linspace(0.5, H - 0.5, H, device=device) / H,
            torch.linspace(0.5, W - 0.5, W, device=device) / W,
            indexing="ij",
        )
        ref = torch.stack([ref_x.flatten(), ref_y.flatten()], -1)  # (HW, 2)
        ref_list.append(ref)

    all_ref = torch.cat(ref_list, 0)  # (N_total, 2)
    n_levels = len(spatial_shapes)
    # Same reference point on all levels (it's in normalized image coords)
    return all_ref[None, :, None, :].expand(-1, -1, n_levels, -1)  # (1, N_total, n_levels, 2)


class DeformablePixelDecoder(nn.Module):
    """Pixel decoder with multi-scale deformable attention.

    Unlike the standard pixel decoder, this processes ALL scales (including stride-4)
    through the deformable transformer, since deformable attention is O(n·K) not O(n²).
    """

    def __init__(
        self,
        in_channels_list: List[int],
        hidden_dim: int = 256,
        num_layers: int = 6,
        nhead: int = 8,
        n_points: int = 4,
    ):
        """
        Args:
            in_channels_list: Channel dimensions for ALL scales [stride4, stride8, stride16, stride32].
            hidden_dim: Unified projection dimension.
            num_layers: Number of deformable transformer encoder layers.
            nhead: Number of attention heads.
            n_points: Sampling points per head per level.
        """
        super().__init__()
        self.hidden_dim = hidden_dim
        self.n_levels = len(in_channels_list)

        # Input projections for all scales
        self.input_proj = nn.ModuleList()
        for in_ch in in_channels_list:
            self.input_proj.append(nn.Sequential(
                nn.Conv2d(in_ch, hidden_dim, 1),
                nn.GroupNorm(32, hidden_dim),
            ))

        # Learnable level embeddings
        self.level_embed = nn.Parameter(torch.randn(self.n_levels, hidden_dim))

        # Deformable transformer encoder
        self.layers = nn.ModuleList()
        for _ in range(num_layers):
            self.layers.append(
                MSDeformAttnEncoderLayer(
                    d_model=hidden_dim,
                    n_heads=nhead,
                    n_levels=self.n_levels,
                    n_points=n_points,
                    dim_feedforward=hidden_dim * 4,
                )
            )

        # Top-down FPN lateral + output convolutions
        self.lateral_convs = nn.ModuleList()
        self.output_convs = nn.ModuleList()
        # FPN goes from coarsest to finest (excluding finest which becomes mask_features)
        for _ in range(self.n_levels - 1):
            self.lateral_convs.append(nn.Sequential(
                nn.Conv2d(hidden_dim, hidden_dim, 1),
                nn.GroupNorm(32, hidden_dim),
            ))
            self.output_convs.append(nn.Sequential(
                nn.Conv2d(hidden_dim, hidden_dim, 3, padding=1),
                nn.GroupNorm(32, hidden_dim),
                nn.GELU(),
            ))

        # Mask feature projection (from finest FPN level)
        self.mask_proj = nn.Sequential(
            nn.Conv2d(hidden_dim, hidden_dim, 3, padding=1),
            nn.GroupNorm(32, hidden_dim),
            nn.GELU(),
        )

    def forward(
        self, features: List[torch.Tensor],
    ) -> Tuple[torch.Tensor, List[torch.Tensor]]:
        """
        Args:
            features: List of (B, C_i, H_i, W_i) for ALL scales
                      [stride-4, stride-8, stride-16, stride-32], finest first.

        Returns:
            mask_features: (B, hidden_dim, H_0, W_0) — finest scale for mask prediction.
            multi_scale_out: List of 3 tensors (stride 8/16/32) for decoder cross-attention.
        """
        B = features[0].shape[0]

        # 1. Project all scales and add level embeddings
        projected = []
        spatial_shapes = []
        for i, feat in enumerate(features):
            proj = self.input_proj[i](feat)
            proj = proj + self.level_embed[i].view(1, -1, 1, 1)
            projected.append(proj)
            spatial_shapes.append((proj.shape[2], proj.shape[3]))

        # 2. Flatten and concatenate all scales
        flat_list = []
        for proj in projected:
            flat_list.append(proj.flatten(2).permute(0, 2, 1))  # (B, HW, C)
        src = torch.cat(flat_list, dim=1)  # (B, N_total, C)

        # 3. Reference points
        ref_pts = get_reference_points(spatial_shapes, device=src.device)
        ref_pts = ref_pts.expand(B, -1, -1, -1)  # (B, N_total, n_levels, 2)

        # 4. Deformable transformer encoder
        for layer in self.layers:
            src = layer(src, ref_pts, spatial_shapes)

        # 5. Split back to per-scale features
        split_sizes = [h * w for h, w in spatial_shapes]
        split_features = src.split(split_sizes, dim=1)
        refined = []
        for feat, (h, w) in zip(split_features, spatial_shapes):
            refined.append(feat.permute(0, 2, 1).reshape(B, self.hidden_dim, h, w))

        # 6. Top-down FPN: coarsest → finest
        # refined[0] = stride-4 (finest), refined[-1] = stride-32 (coarsest)
        fpn_out = [None] * self.n_levels
        fpn_out[-1] = refined[-1]  # coarsest stays as-is

        for i in range(self.n_levels - 2, -1, -1):
            # Lateral connection from refined features
            lateral = self.lateral_convs[i](refined[i])
            # Upsample coarser FPN level
            upsampled = F.interpolate(
                fpn_out[i + 1], size=lateral.shape[-2:],
                mode="bilinear", align_corners=False,
            )
            fpn_out[i] = self.output_convs[i](lateral + upsampled)

        # 7. Mask features from finest scale
        mask_features = self.mask_proj(fpn_out[0])

        # Return mask_features + 3 coarser scales for decoder cross-attention
        return mask_features, fpn_out[1:]
