"""DINOv3 ConvNeXt-Large backbone — pure PyTorch implementation.

Matches the exact state_dict key structure from the training checkpoint:
  stages.X.downsample_layers.{0,1}.{weight,bias}
  stages.X.layers.Y.{depthwise_conv,layer_norm,pointwise_conv1,pointwise_conv2,gamma}
  layer_norm.{weight,bias}

No HuggingFace or timm dependency — avoids gated model / version issues.
"""

from typing import Dict
import logging

import torch
import torch.nn as nn
import torch.nn.functional as F

logger = logging.getLogger(__name__)


class ConvNeXtV2Block(nn.Module):
    """Single ConvNeXtV2 block matching checkpoint keys:
      depthwise_conv, layer_norm, pointwise_conv1, pointwise_conv2, gamma
    """
    def __init__(self, dim: int, expansion: int = 4):
        super().__init__()
        self.depthwise_conv = nn.Conv2d(dim, dim, kernel_size=7, padding=3, groups=dim)
        self.layer_norm = nn.LayerNorm(dim, eps=1e-6)
        self.pointwise_conv1 = nn.Linear(dim, dim * expansion)
        self.pointwise_conv2 = nn.Linear(dim * expansion, dim)
        # LayerScale: gamma * block_output (shape (dim,))
        # This is NOT GRN — it's a simple per-channel scaling of the residual branch
        self.gamma = nn.Parameter(torch.zeros(dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = x
        x = self.depthwise_conv(x)
        x = x.permute(0, 2, 3, 1)  # (B, C, H, W) → (B, H, W, C)
        x = self.layer_norm(x)
        x = self.pointwise_conv1(x)
        x = F.gelu(x)
        x = self.pointwise_conv2(x)
        # LayerScale: scale output by learned per-channel gamma
        x = x * self.gamma
        x = x.permute(0, 3, 1, 2)  # (B, H, W, C) → (B, C, H, W)
        return residual + x


class ConvNeXtV2Stage(nn.Module):
    """One stage: optional downsample + N blocks.

    Checkpoint keys per stage:
      downsample_layers.0.{weight,bias}  — conv or layernorm
      downsample_layers.1.{weight,bias}  — conv or layernorm
      layers.Y.{...}                     — blocks
    """
    def __init__(self, in_channels: int, out_channels: int, depth: int, stage_idx: int):
        super().__init__()
        if stage_idx == 0:
            # Stem: patch embed (4×4 conv stride 4) + LayerNorm
            self.downsample_layers = nn.Sequential(
                nn.Conv2d(in_channels, out_channels, kernel_size=4, stride=4),
                nn.LayerNorm2dCompat(out_channels),
            )
        else:
            # Downsample: LayerNorm + 2×2 conv stride 2
            self.downsample_layers = nn.Sequential(
                nn.LayerNorm2dCompat(in_channels),
                nn.Conv2d(in_channels, out_channels, kernel_size=2, stride=2),
            )
        self.layers = nn.ModuleList([ConvNeXtV2Block(out_channels) for _ in range(depth)])

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.downsample_layers(x)
        for block in self.layers:
            x = block(x)
        return x


class LayerNorm2dCompat(nn.Module):
    """LayerNorm for (B, C, H, W) that matches checkpoint key names."""
    def __init__(self, num_channels: int, eps: float = 1e-6):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(num_channels))
        self.bias = nn.Parameter(torch.zeros(num_channels))
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        u = x.mean(1, keepdim=True)
        s = (x - u).pow(2).mean(1, keepdim=True)
        x = (x - u) / torch.sqrt(s + self.eps)
        x = self.weight.view(1, -1, 1, 1) * x + self.bias.view(1, -1, 1, 1)
        return x


# Monkey-patch nn module so ConvNeXtV2Stage can use nn.LayerNorm2dCompat
nn.LayerNorm2dCompat = LayerNorm2dCompat


class ConvNeXtV2Large(nn.Module):
    """ConvNeXtV2-Large matching checkpoint state_dict structure.

    Architecture: [192, 384, 768, 1536] channels, [3, 3, 27, 3] depths.
    Final layer_norm applied to last stage output.
    """
    def __init__(self):
        super().__init__()
        channels = [192, 384, 768, 1536]
        depths = [3, 3, 27, 3]

        self.stages = nn.ModuleList()
        in_ch = 3  # RGB input
        for i, (out_ch, depth) in enumerate(zip(channels, depths)):
            self.stages.append(ConvNeXtV2Stage(in_ch, out_ch, depth, stage_idx=i))
            in_ch = out_ch

        self.layer_norm = LayerNorm2dCompat(channels[-1])

    def forward(self, x: torch.Tensor):
        features = []
        for stage in self.stages:
            x = stage(x)
            features.append(x)
        return features


class DINOv3ConvNeXtBackbone(nn.Module):
    """Frozen ConvNeXt-Large backbone for Mask2Former.

    Args:
        model_name: Ignored (kept for config compat). Architecture is fixed.
        frozen: Whether to freeze all backbone parameters.
    """

    def __init__(
        self,
        model_name: str = "facebook/dinov3-convnext-large-pretrain-lvd1689m",
        frozen: bool = True,
    ):
        super().__init__()
        self.backbone = ConvNeXtV2Large()
        self.hidden_sizes = [192, 384, 768, 1536]
        self.num_stages = 4

        logger.info("ConvNeXtV2-Large backbone created (pure PyTorch, weights from checkpoint)")

        if frozen:
            self.freeze()

    def freeze(self):
        for param in self.backbone.parameters():
            param.requires_grad = False
        self.backbone.eval()

    def unfreeze_last_n_stages(self, n: int):
        stages = self.backbone.stages
        total = len(stages)
        for i in range(total - n, total):
            for param in stages[i].parameters():
                param.requires_grad = True

    def train(self, mode: bool = True):
        super().train(mode)
        if not any(p.requires_grad for p in self.backbone.parameters()):
            self.backbone.eval()
        return self

    def forward(self, pixel_values: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Extract multi-scale features.

        Returns:
            Dict with keys "stage_0" .. "stage_3" → (B, C_i, H_i, W_i).
        """
        stage_outputs = self.backbone(pixel_values)
        return {f"stage_{i}": feat for i, feat in enumerate(stage_outputs)}
