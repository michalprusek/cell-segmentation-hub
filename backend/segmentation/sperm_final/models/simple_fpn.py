"""Simple FPN to convert single-scale ViT features into multi-scale feature maps."""

from typing import Dict, List

import torch
import torch.nn as nn
import torch.nn.functional as F


class SimpleFPN(nn.Module):
    """Convert 1-scale ViT features to 4-scale FPN features.

    Takes features from multiple ViT layers (all at patch_size stride)
    and produces features at 4 scales: 1/4, 1/8, 1/16, 1/32 of input.

    For DINOv2 ViT-L with patch_size=14 and input 512:
        - Input features are at stride 14 (~1/14)
        - We produce: 1/4 (via 2x upsample + conv), 1/8, 1/16, 1/32

    Args:
        in_channels: Input feature channels (1024 for ViT-L).
        out_channels: Output channels per FPN level (256).
        num_levels: Number of FPN levels (4).
    """

    def __init__(
        self,
        in_channels: int = 1024,
        out_channels: int = 256,
        num_levels: int = 4,
    ):
        super().__init__()
        self.out_channels = out_channels
        self.num_levels = num_levels

        # Lateral connections from each ViT layer
        self.lateral_convs = nn.ModuleList()
        for _ in range(num_levels):
            self.lateral_convs.append(nn.Sequential(
                nn.Conv2d(in_channels, out_channels, 1),
                nn.GroupNorm(32, out_channels),
                nn.GELU(),
            ))

        # Scale adjustment convolutions
        # Level 0: 2x upsample (stride 14 → ~stride 7, closest to 1/4)
        self.scale_convs = nn.ModuleList([
            nn.Sequential(
                nn.ConvTranspose2d(out_channels, out_channels, 2, stride=2),
                nn.GroupNorm(32, out_channels),
                nn.GELU(),
                nn.Conv2d(out_channels, out_channels, 3, padding=1),
                nn.GroupNorm(32, out_channels),
                nn.GELU(),
            ),
            # Level 1: keep at native stride (~1/8)
            nn.Sequential(
                nn.Conv2d(out_channels, out_channels, 3, padding=1),
                nn.GroupNorm(32, out_channels),
                nn.GELU(),
            ),
            # Level 2: 2x downsample (~1/16)
            nn.Sequential(
                nn.Conv2d(out_channels, out_channels, 3, stride=2, padding=1),
                nn.GroupNorm(32, out_channels),
                nn.GELU(),
            ),
            # Level 3: 4x downsample (~1/32)
            nn.Sequential(
                nn.Conv2d(out_channels, out_channels, 3, stride=2, padding=1),
                nn.GroupNorm(32, out_channels),
                nn.GELU(),
                nn.Conv2d(out_channels, out_channels, 3, stride=2, padding=1),
                nn.GroupNorm(32, out_channels),
                nn.GELU(),
            ),
        ])

    def forward(self, features: Dict[str, torch.Tensor]) -> List[torch.Tensor]:
        """Convert multi-layer ViT features to multi-scale FPN features.

        Args:
            features: Dict from backbone, e.g. {"layer_5": ..., "layer_11": ...}
                Each value is (B, C, fH, fW).

        Returns:
            List of 4 feature maps at different scales, from finest to coarsest.
        """
        feature_list = list(features.values())
        assert len(feature_list) == self.num_levels, \
            f"Expected {self.num_levels} feature levels, got {len(feature_list)}"

        fpn_features = []
        for i in range(self.num_levels):
            lateral = self.lateral_convs[i](feature_list[i])
            scaled = self.scale_convs[i](lateral)
            fpn_features.append(scaled)

        return fpn_features
