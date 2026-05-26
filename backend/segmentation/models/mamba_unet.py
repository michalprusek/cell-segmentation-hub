"""U-Mamba: U-Net with Mamba blocks in the bottleneck.

Inspired by Ma et al. 2024 (bowang-lab/U-Mamba). Standard CNN encoder/decoder
(same as our UNet) preserves 2D spatial locality where it matters; the
bottleneck is augmented with Mamba SSM blocks operating on the flattened
spatial sequence -- at 1024^2 input the bottleneck is 32x32 = 1024 tokens,
well within Mamba's effective range.

Rationale: placing Mamba only at the deepest (32x32) feature level gives Mamba
long-range modelling power without the sequence-length blowup; the CNN portions
handle local pattern extraction.

Requires ``mamba_ssm`` (CUDA-compiled selective-scan kernels). The import is
guarded one level up (``models/__init__.py`` + ``ml/model_loader.py``) so a
missing build disables only this model, not the whole service.
"""
from __future__ import annotations

import torch
import torch.nn as nn
from mamba_ssm import Mamba


def get_norm_layer(num_features: int, use_instance_norm: bool = True) -> nn.Module:
    return nn.InstanceNorm2d(num_features, affine=True) if use_instance_norm else nn.BatchNorm2d(num_features)


class DoubleConv(nn.Module):
    def __init__(self, in_channels: int, out_channels: int, use_instance_norm: bool = True, dropout: float = 0.0):
        super().__init__()
        self.double_conv = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=False),
            get_norm_layer(out_channels, use_instance_norm),
            nn.ReLU(inplace=True),
            nn.Dropout2d(p=dropout) if dropout > 0 else nn.Identity(),
            nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1, bias=False),
            get_norm_layer(out_channels, use_instance_norm),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.double_conv(x)


class MambaBottleneckBlock(nn.Module):
    """Bidirectional Mamba on flattened 2D bottleneck features.

    Forward and reversed scans are summed (poor man's bi-directional Mamba),
    which mitigates the 1D-raster asymmetry on 2D inputs. Adds a residual
    connection to keep gradient flow stable when Mamba is small relative to
    the surrounding CNN.
    """

    def __init__(self, channels: int, d_state: int = 16, d_conv: int = 4, expand: int = 2):
        super().__init__()
        self.norm = nn.LayerNorm(channels)
        self.mamba_fwd = Mamba(d_model=channels, d_state=d_state, d_conv=d_conv, expand=expand)
        self.mamba_bwd = Mamba(d_model=channels, d_state=d_state, d_conv=d_conv, expand=expand)
        self.skip_scale = nn.Parameter(torch.ones(1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, C, H, W)
        if x.dtype == torch.float16:
            x = x.float()
        B, C, H, W = x.shape
        x_seq = x.flatten(2).transpose(1, 2)        # (B, H*W, C)
        x_norm = self.norm(x_seq)
        y_fwd = self.mamba_fwd(x_norm)
        y_bwd = torch.flip(self.mamba_bwd(torch.flip(x_norm, dims=[1])), dims=[1])
        y = y_fwd + y_bwd + self.skip_scale * x_seq
        return y.transpose(1, 2).reshape(B, C, H, W)


class UMamba(nn.Module):
    """U-Net with Mamba bottleneck."""

    def __init__(
        self,
        in_channels: int = 3,
        out_channels: int = 1,
        features: list[int] | None = None,
        use_instance_norm: bool = True,
        dropout_rate: float = 0.1,
        num_mamba_blocks: int = 2,
    ):
        super().__init__()
        if features is None:
            features = [64, 128, 256, 512, 1024]

        self.init_conv = DoubleConv(in_channels, features[0], use_instance_norm, dropout=0.0)

        # Encoder path
        self.downs = nn.ModuleList()
        self.pools = nn.ModuleList()
        for i in range(len(features) - 1):
            self.downs.append(
                DoubleConv(features[i], features[i + 1], use_instance_norm, dropout=dropout_rate if i > 0 else 0.0)
            )
            self.pools.append(nn.MaxPool2d(kernel_size=2, stride=2))

        # Bottleneck = CNN conv + Mamba block(s) + CNN conv
        self.bottleneck_pre = DoubleConv(features[-2], features[-1], use_instance_norm, dropout=dropout_rate * 1.5)
        self.bottleneck_mamba = nn.Sequential(
            *[MambaBottleneckBlock(features[-1]) for _ in range(num_mamba_blocks)]
        )
        self.bottleneck_post = DoubleConv(features[-1], features[-1], use_instance_norm, dropout=dropout_rate)

        # Decoder path
        self.ups = nn.ModuleList()
        self.decoder_blocks = nn.ModuleList()
        for i in range(len(features) - 1, 0, -1):
            self.ups.append(nn.ConvTranspose2d(features[i], features[i - 1], kernel_size=2, stride=2))
            self.decoder_blocks.append(
                DoubleConv(features[i], features[i - 1], use_instance_norm, dropout=dropout_rate if i > 1 else 0.0)
            )

        # Final 1x1
        self.final_conv = nn.Conv2d(features[0], out_channels, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.init_conv(x)
        skips = [x]
        # Encoder loop excludes the last down (last down is fused with bottleneck)
        for pool, down in zip(self.pools[:-1], self.downs[:-1]):
            x = pool(x)
            x = down(x)
            skips.append(x)

        # Bottleneck: pool to lowest resolution, then DoubleConv features[-2]->features[-1],
        # Mamba blocks at the bottleneck spatial resolution, then DoubleConv keeps features[-1]
        x = self.pools[-1](x)
        x = self.bottleneck_pre(x)
        x = self.bottleneck_mamba(x)
        x = self.bottleneck_post(x)

        # Decoder loop: 4 stages, mirroring encoder + initial down
        skips_rev = skips[::-1]
        for i, (up, dec) in enumerate(zip(self.ups, self.decoder_blocks)):
            x = up(x)
            skip = skips_rev[i]
            if x.shape[-2:] != skip.shape[-2:]:
                x = nn.functional.interpolate(x, size=skip.shape[-2:], mode="bilinear", align_corners=False)
            x = torch.cat([skip, x], dim=1)
            x = dec(x)

        return self.final_conv(x)
