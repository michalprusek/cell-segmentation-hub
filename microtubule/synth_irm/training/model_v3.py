"""DINOv3 ViT-B/16 + DPT-style decoder for high-res dense prediction.

Decoder follows DPT (Ranftl ICCV 2021): take features from 4 ViT layers,
project to common channel count via "Reassemble" (1×1 conv + spatial resize
to multi-scale pyramid), then progressive Fusion blocks combine coarsest →
finest with residual conv blocks. Final 1/2 resolution → bilinear to input.
This is the standard SOTA recipe for dense prediction over plain ViT.

DINOv3 token layout: 1 CLS + 4 register tokens + (gh*gw) patch tokens.
Patch size 16; for 448² input → 28×28 patch grid.
"""
from __future__ import annotations

import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import AutoModel


class ResidualConvBlock(nn.Module):
    def __init__(self, ch):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(ch, ch, 3, padding=1, bias=False),
            nn.GroupNorm(8, ch),
            nn.GELU(),
            nn.Conv2d(ch, ch, 3, padding=1, bias=False),
            nn.GroupNorm(8, ch),
        )

    def forward(self, x):
        return F.gelu(x + self.conv(x))


class FusionBlock(nn.Module):
    """DPT fusion: combine deeper feature with finer one, then upsample."""

    def __init__(self, ch):
        super().__init__()
        self.res1 = ResidualConvBlock(ch)
        self.res2 = ResidualConvBlock(ch)

    def forward(self, x_lower, x_higher=None):
        if x_higher is not None:
            # Align spatial sizes (input may not be multiple of needed factor)
            if x_higher.shape[-2:] != x_lower.shape[-2:]:
                x_higher = F.interpolate(x_higher, size=x_lower.shape[-2:],
                                          mode="bilinear", align_corners=False)
            x_lower = x_lower + self.res1(x_higher)
        x_lower = self.res2(x_lower)
        x_lower = F.interpolate(x_lower, scale_factor=2.0, mode="bilinear",
                                align_corners=False)
        return x_lower


class Reassemble(nn.Module):
    """Project ViT patch tokens to a 2D map at a target spatial scale.

    factor: 4 = ×4 upsample (deconv-like), 2 = ×2, 1 = same, 0.5 = downsample ×0.5.
    Implements DPT-style ConvTranspose for upsampling and Conv stride for down.
    """

    def __init__(self, in_ch, out_ch, factor: float):
        super().__init__()
        self.proj = nn.Conv2d(in_ch, out_ch, kernel_size=1)
        if factor == 4:
            self.resize = nn.ConvTranspose2d(out_ch, out_ch, kernel_size=4, stride=4)
        elif factor == 2:
            self.resize = nn.ConvTranspose2d(out_ch, out_ch, kernel_size=2, stride=2)
        elif factor == 1:
            self.resize = nn.Identity()
        elif factor == 0.5:
            self.resize = nn.Conv2d(out_ch, out_ch, kernel_size=3, stride=2, padding=1)
        else:
            raise ValueError(f"Unsupported factor: {factor}")

    def forward(self, x):
        x = self.proj(x)
        return self.resize(x)


class FilamentInstanceModelV3(nn.Module):
    def __init__(
        self,
        backbone_name: str = "facebook/dinov3-vitb16-pretrain-lvd1689m",
        embed_dim: int = 16,
        decoder_ch: int = 192,
        freeze_backbone_blocks: int = 6,
        fuse_layers: tuple = (3, 6, 9, 12),  # 1-indexed (block outputs)
        # Reassemble factors per fuse layer (smallest to largest scale)
        reassemble_factors: tuple = (4, 2, 1, 0.5),
        n_register_tokens: int = 4,  # DINOv3 has 4 register tokens after CLS
    ):
        super().__init__()
        token = os.environ.get("HF_TOKEN") or open(
            os.path.expanduser("~/.cache/huggingface/token")
        ).read().strip()
        self.backbone = AutoModel.from_pretrained(backbone_name, token=token)
        self.backbone_name = backbone_name
        self.feat_dim = self.backbone.config.hidden_size
        self.patch_size = 16
        self.embed_dim = embed_dim
        self.fuse_layers = tuple(fuse_layers)
        self.reassemble_factors = tuple(reassemble_factors)
        self.n_register_tokens = n_register_tokens

        # Freeze input embedding + early blocks. DINOv3 in transformers 4.57
        # has `backbone.layer` (ModuleList) directly, no `.encoder` wrapper.
        for p in self.backbone.embeddings.parameters():
            p.requires_grad = False
        if hasattr(self.backbone, "rope_embeddings"):
            for p in self.backbone.rope_embeddings.parameters():
                p.requires_grad = False
        blocks_attr = getattr(self.backbone, "layer", None)
        if blocks_attr is None and hasattr(self.backbone, "encoder"):
            blocks_attr = getattr(self.backbone.encoder, "layers", None) \
                or getattr(self.backbone.encoder, "layer", None)
        if blocks_attr is None:
            raise RuntimeError(f"Cannot find ViT blocks in {type(self.backbone).__name__}")
        for i, blk in enumerate(blocks_attr):
            if i < freeze_backbone_blocks:
                for p in blk.parameters():
                    p.requires_grad = False

        # Reassemble heads (one per fused layer)
        self.reassembles = nn.ModuleList([
            Reassemble(self.feat_dim, decoder_ch, factor=f)
            for f in reassemble_factors
        ])
        # Fusion blocks (one per level, processed coarsest first)
        self.fusions = nn.ModuleList([
            FusionBlock(decoder_ch) for _ in fuse_layers
        ])
        # Final refinement before heads
        self.refine = nn.Sequential(
            nn.Conv2d(decoder_ch, decoder_ch, 3, padding=1, bias=False),
            nn.GroupNorm(8, decoder_ch),
            nn.GELU(),
            nn.Conv2d(decoder_ch, decoder_ch, 3, padding=1, bias=False),
            nn.GroupNorm(8, decoder_ch),
            nn.GELU(),
        )
        self.embed_head = nn.Conv2d(decoder_ch, embed_dim, kernel_size=1)
        self.seed_head = nn.Conv2d(decoder_ch, 1, kernel_size=1)

    def forward(self, x: torch.Tensor):
        B, _, H, W = x.shape
        mean = torch.tensor([0.485, 0.456, 0.406], device=x.device).view(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225], device=x.device).view(1, 3, 1, 1)
        x_norm = (x - mean) / std

        out = self.backbone(pixel_values=x_norm, output_hidden_states=True)
        hidden = out.hidden_states  # tuple, includes embedding output

        gh = H // self.patch_size
        gw = W // self.patch_size
        n_special = 1 + self.n_register_tokens  # CLS + register

        # Reassemble selected layers
        feats_2d = []
        for fl in self.fuse_layers:
            tok = hidden[fl]
            patches = tok[:, n_special:]  # drop CLS + register tokens
            f = patches.transpose(1, 2).reshape(B, self.feat_dim, gh, gw)
            feats_2d.append(f)
        # Apply per-layer reassemble (now at multi-scale: ×4, ×2, ×1, ×0.5)
        reassembled = [r(f) for r, f in zip(self.reassembles, feats_2d)]

        # DPT fusion: process from coarsest (smallest) → finest. Reassemble
        # factor 0.5 is smallest (deepest), factor 4 is largest (shallowest).
        # Sort by spatial size ascending so we walk coarse→fine.
        order = sorted(range(len(reassembled)), key=lambda i: reassembled[i].shape[-1])
        x_dec = None
        for o in order:
            x_dec = self.fusions[o](reassembled[o] if x_dec is None else x_dec, reassembled[o])

        # x_dec is now at some intermediate resolution; bring to input
        if x_dec.shape[-2:] != (H, W):
            x_dec = F.interpolate(x_dec, size=(H, W), mode="bilinear",
                                  align_corners=False)
        x_dec = self.refine(x_dec)
        embed = F.normalize(self.embed_head(x_dec), dim=1)
        seed = self.seed_head(x_dec)
        return {"embedding": embed, "seed_logit": seed}
