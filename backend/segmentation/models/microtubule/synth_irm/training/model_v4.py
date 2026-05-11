"""v4: DINOv3 ViT-B/16 + DPT decoder + positional channels + 32-dim embedding.

Differences vs v3:
  1. Positional channels: append normalized (y, x) coordinates to the decoder
     feature map BEFORE the heads. Breaks symmetry between two parallel-close
     filaments — same texture, different position → different embedding.
  2. embed_dim: 16 → 32. More capacity to separate close instances.
  3. Larger receptive head: 3×3 conv before final 1×1 in heads, gives heads
     a small spatial context (helps U-turn pixels see neighborhood).
"""
from __future__ import annotations

import os
import torch
import torch.nn as nn
import torch.nn.functional as F
from transformers import AutoModel

from synth_irm.training.model_v3 import ResidualConvBlock, FusionBlock, Reassemble


class FilamentInstanceModelV4(nn.Module):
    def __init__(
        self,
        backbone_name: str = "facebook/dinov3-vitb16-pretrain-lvd1689m",
        embed_dim: int = 32,
        decoder_ch: int = 192,
        freeze_backbone_blocks: int = 6,
        fuse_layers: tuple = (3, 6, 9, 12),
        reassemble_factors: tuple = (4, 2, 1, 0.5),
        n_register_tokens: int = 4,
        use_positional: bool = True,   # v5 sets False — pos channels fragment long MTs
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
        self.use_positional = use_positional

        for p in self.backbone.embeddings.parameters():
            p.requires_grad = False
        if hasattr(self.backbone, "rope_embeddings"):
            for p in self.backbone.rope_embeddings.parameters():
                p.requires_grad = False
        blocks = getattr(self.backbone, "layer", None)
        if blocks is None and hasattr(self.backbone, "encoder"):
            blocks = getattr(self.backbone.encoder, "layers", None) \
                or getattr(self.backbone.encoder, "layer", None)
        for i, blk in enumerate(blocks):
            if i < freeze_backbone_blocks:
                for p in blk.parameters():
                    p.requires_grad = False

        self.reassembles = nn.ModuleList([
            Reassemble(self.feat_dim, decoder_ch, factor=f)
            for f in reassemble_factors
        ])
        self.fusions = nn.ModuleList([FusionBlock(decoder_ch) for _ in fuse_layers])
        # Refinement BEFORE positional concat
        self.refine = nn.Sequential(
            nn.Conv2d(decoder_ch, decoder_ch, 3, padding=1, bias=False),
            nn.GroupNorm(8, decoder_ch),
            nn.GELU(),
            nn.Conv2d(decoder_ch, decoder_ch, 3, padding=1, bias=False),
            nn.GroupNorm(8, decoder_ch),
            nn.GELU(),
        )
        # After (optional) concat: decoder_ch + 2 if positional else decoder_ch
        head_in = decoder_ch + (2 if use_positional else 0)
        n_groups = 2 if use_positional else 8  # head_in=194 (÷2) or 192 (÷8)
        # Larger receptive head: 3×3 → 1×1 instead of just 1×1 in v3.
        self.embed_head = nn.Sequential(
            nn.Conv2d(head_in, head_in, 3, padding=1, bias=False),
            nn.GroupNorm(n_groups, head_in),
            nn.GELU(),
            nn.Conv2d(head_in, embed_dim, 1),
        )
        self.seed_head = nn.Sequential(
            nn.Conv2d(head_in, head_in, 3, padding=1, bias=False),
            nn.GroupNorm(n_groups, head_in),
            nn.GELU(),
            nn.Conv2d(head_in, 1, 1),
        )

    def _positional_grid(self, B, H, W, device):
        ys = torch.linspace(-1.0, 1.0, H, device=device)
        xs = torch.linspace(-1.0, 1.0, W, device=device)
        gy, gx = torch.meshgrid(ys, xs, indexing="ij")
        return torch.stack([gy, gx], dim=0).unsqueeze(0).expand(B, 2, H, W)

    def forward(self, x: torch.Tensor):
        B, _, H, W = x.shape
        mean = torch.tensor([0.485, 0.456, 0.406], device=x.device).view(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225], device=x.device).view(1, 3, 1, 1)
        x_norm = (x - mean) / std

        out = self.backbone(pixel_values=x_norm, output_hidden_states=True)
        hidden = out.hidden_states

        gh = H // self.patch_size
        gw = W // self.patch_size
        n_special = 1 + self.n_register_tokens

        feats_2d = []
        for fl in self.fuse_layers:
            tok = hidden[fl]
            patches = tok[:, n_special:]
            f = patches.transpose(1, 2).reshape(B, self.feat_dim, gh, gw)
            feats_2d.append(f)
        reassembled = [r(f) for r, f in zip(self.reassembles, feats_2d)]

        order = sorted(range(len(reassembled)), key=lambda i: reassembled[i].shape[-1])
        x_dec = None
        for o in order:
            x_dec = self.fusions[o](reassembled[o] if x_dec is None else x_dec, reassembled[o])

        if x_dec.shape[-2:] != (H, W):
            x_dec = F.interpolate(x_dec, size=(H, W), mode="bilinear",
                                  align_corners=False)
        x_dec = self.refine(x_dec)

        if self.use_positional:
            pos = self._positional_grid(B, H, W, x_dec.device)
            x_dec = torch.cat([x_dec, pos], dim=1)

        embed = F.normalize(self.embed_head(x_dec), dim=1)
        seed = self.seed_head(x_dec)
        return {"embedding": embed, "seed_logit": seed}
