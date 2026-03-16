"""Mask2Former decoder for instance segmentation.

Supports two backbone types:
- DINOv2 ViT: single-scale features → SimpleFPN → 4-scale
- DINOv3 ConvNeXt: native 4-scale hierarchical features

Architecture (faithful to original Mask2Former):
- Pixel decoder processes stride-8/16/32 features through transformer encoder
  (stride-4 features are kept out of transformer, used only for mask prediction)
- Top-down FPN + lateral connection from finest refined scale to stride-4
- Transformer decoder: query-based masked cross-attention to 3 refined scales
- Per-query class + mask prediction
"""

from typing import Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F

from sperm_final.config import ModelConfig


class MSDeformAttnPixelDecoder(nn.Module):
    """Multi-Scale Pixel Decoder (standard attention, no custom CUDA ops).

    Faithful to original Mask2Former design:
    - Stride-4 features are NOT processed by transformer (too high-res for O(n²))
    - 3 coarser scales (stride 8/16/32) refined by transformer encoder
    - Top-down FPN propagates information coarse → fine
    - Lateral connection from finest refined scale up to stride-4 mask features
    """

    def __init__(
        self,
        high_res_channels: int = 256,
        in_channels_list: Optional[List[int]] = None,
        hidden_dim: int = 256,
        num_layers: int = 6,
        nhead: int = 8,
    ):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.num_layers = num_layers

        if in_channels_list is None:
            in_channels_list = [256, 256, 256]

        # Projection for high-res stride-4 features
        self.high_res_proj = nn.Sequential(
            nn.Conv2d(high_res_channels, hidden_dim, 1),
            nn.GroupNorm(32, hidden_dim),
        )

        # Input projection for each transformer scale (stride 8/16/32)
        self.input_proj = nn.ModuleList([
            nn.Sequential(
                nn.Conv2d(ch, hidden_dim, 1),
                nn.GroupNorm(32, hidden_dim),
            )
            for ch in in_channels_list
        ])

        # Transformer encoder layers — round-robin across 3 scales
        self.layers = nn.ModuleList([
            nn.TransformerEncoderLayer(
                d_model=hidden_dim,
                nhead=nhead,
                dim_feedforward=hidden_dim * 4,
                dropout=0.0,
                activation="gelu",
                batch_first=True,
                norm_first=True,
            )
            for _ in range(num_layers)
        ])

        # Top-down FPN lateral connections among transformer scales
        # fpn_laterals[0]: s2→s1, fpn_laterals[1]: s3→s2
        self.fpn_laterals = nn.ModuleList([
            nn.Sequential(
                nn.Conv2d(hidden_dim, hidden_dim, 3, padding=1),
                nn.GroupNorm(32, hidden_dim),
                nn.GELU(),
            )
            for _ in range(2)
        ])

        # Bridge: finest refined scale (s1) → high-res mask features
        self.bridge_lateral = nn.Sequential(
            nn.Conv2d(hidden_dim, hidden_dim, 3, padding=1),
            nn.GroupNorm(32, hidden_dim),
            nn.GELU(),
        )

        # Final mask feature projection
        self.mask_feature_proj = nn.Sequential(
            nn.Conv2d(hidden_dim, hidden_dim, 3, padding=1),
            nn.GroupNorm(32, hidden_dim),
            nn.GELU(),
            nn.Conv2d(hidden_dim, hidden_dim, 1),
        )

    def forward(
        self,
        high_res_features: torch.Tensor,
        multi_scale_features: List[torch.Tensor],
    ) -> Tuple[torch.Tensor, List[torch.Tensor]]:
        """Process multi-scale features.

        Args:
            high_res_features: (B, C0, H0, W0) stride-4 features.
            multi_scale_features: 3 feature maps [stride-8, stride-16, stride-32],
                ordered finest to coarsest.

        Returns:
            mask_features: (B, hidden_dim, H0, W0) for mask prediction.
            multi_scale_out: 3 refined features for decoder cross-attention.
        """
        n_scales = len(multi_scale_features)

        # Project high-res features
        high_res = self.high_res_proj(high_res_features)

        # Project transformer scales
        projected = []
        for i, feat in enumerate(multi_scale_features):
            projected.append(self.input_proj[i](feat))

        # Transformer encoder: round-robin across 3 scales
        for layer_idx, layer in enumerate(self.layers):
            scale_idx = layer_idx % n_scales
            B, C, H, W = projected[scale_idx].shape
            x = projected[scale_idx].flatten(2).permute(0, 2, 1)  # (B, H*W, C)
            x = layer(x)
            projected[scale_idx] = x.permute(0, 2, 1).reshape(B, C, H, W)

        # Top-down FPN: coarsest → finest (s3→s2→s1)
        for i in range(n_scales - 2, -1, -1):
            top_down = F.interpolate(
                projected[i + 1],
                size=projected[i].shape[-2:],
                mode="bilinear",
                align_corners=False,
            )
            projected[i] = projected[i] + self.fpn_laterals[i](top_down)

        # Bridge: upsample finest refined scale (s1) to high-res and add
        s1_upsampled = F.interpolate(
            projected[0],
            size=high_res.shape[-2:],
            mode="bilinear",
            align_corners=False,
        )
        mask_features = high_res + self.bridge_lateral(s1_upsampled)
        mask_features = self.mask_feature_proj(mask_features)

        return mask_features, projected


class TransformerDecoder(nn.Module):
    """Transformer decoder with masked cross-attention for Mask2Former."""

    def __init__(
        self,
        hidden_dim: int = 256,
        num_layers: int = 6,
        nhead: int = 8,
        num_queries: int = 100,
        num_classes: int = 4,
        dropout: float = 0.1,
        per_layer_heads: bool = False,
    ):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.num_queries = num_queries
        self.num_layers = num_layers
        self.per_layer_heads = per_layer_heads

        # Learnable object queries
        self.query_embed = nn.Embedding(num_queries, hidden_dim)
        self.query_feat = nn.Embedding(num_queries, hidden_dim)

        # Decoder layers
        self.decoder_layers = nn.ModuleList()
        for _ in range(num_layers):
            self.decoder_layers.append(
                TransformerDecoderLayer(hidden_dim, nhead, dropout=dropout)
            )

        self.decoder_norm = nn.LayerNorm(hidden_dim)

        if per_layer_heads:
            # Per-layer prediction heads (as in original Mask2Former)
            self.class_heads = nn.ModuleList([
                nn.Linear(hidden_dim, num_classes) for _ in range(num_layers)
            ])
            self.mask_heads = nn.ModuleList([
                nn.Sequential(
                    nn.Linear(hidden_dim, hidden_dim),
                    nn.GELU(),
                    nn.Linear(hidden_dim, hidden_dim),
                ) for _ in range(num_layers)
            ])
        else:
            # Shared prediction heads across all layers
            self.class_head = nn.Linear(hidden_dim, num_classes)
            self.mask_head = nn.Sequential(
                nn.Linear(hidden_dim, hidden_dim),
                nn.GELU(),
                nn.Linear(hidden_dim, hidden_dim),
            )

        self._reset_parameters()

    def _reset_parameters(self):
        for p in self.parameters():
            if p.dim() > 1:
                nn.init.xavier_uniform_(p)

    def forward(
        self,
        mask_features: torch.Tensor,
        multi_scale_features: List[torch.Tensor],
    ) -> Dict[str, torch.Tensor]:
        """Run transformer decoder.

        Args:
            mask_features: (B, C, H, W) from pixel decoder (upsampled).
            multi_scale_features: List of (B, C, Hi, Wi) — 3 refined scales.

        Returns:
            pred_logits: (B, Q, num_classes) class predictions.
            pred_masks: (B, Q, H, W) mask predictions.
            aux_outputs: List of (pred_logits, pred_masks) from intermediate layers.
        """
        B = mask_features.shape[0]

        # Initialize queries
        query_pos = self.query_embed.weight.unsqueeze(0).expand(B, -1, -1)
        query = self.query_feat.weight.unsqueeze(0).expand(B, -1, -1)

        # Flatten multi-scale features for cross-attention
        memory_list = []
        for feat in multi_scale_features:
            b, c, h, w = feat.shape
            memory_list.append(feat.flatten(2).permute(0, 2, 1))  # (B, H*W, C)

        aux_outputs = []

        for i, layer in enumerate(self.decoder_layers):
            # Select which memory to attend to (round-robin across scales)
            scale_idx = i % len(memory_list)
            memory = memory_list[scale_idx]

            # Compute attention mask from current predictions
            attn_mask = None
            if i > 0:
                # Use previous layer's mask predictions as attention mask
                mask_pred = self._predict_masks(query, mask_features, layer_idx=i - 1)
                attn_mask = (mask_pred.sigmoid() < 0.5)
                # Resize to match memory spatial dims
                _, _, mh, mw = multi_scale_features[scale_idx].shape
                attn_mask = F.interpolate(
                    attn_mask.float(),
                    size=(mh, mw),
                    mode="nearest",
                ).flatten(2).bool()  # (B, Q, H*W)
                # CRITICAL: if all positions are masked for a query, fall back to
                # full attention to prevent softmax(all -inf) = NaN
                all_masked = attn_mask.all(dim=-1, keepdim=True)
                attn_mask = attn_mask & ~all_masked

            query = layer(query, memory, query_pos, attn_mask)

            # Intermediate predictions for auxiliary losses
            normed = self.decoder_norm(query)
            if self.per_layer_heads:
                aux_logits = self.class_heads[i](normed)
            else:
                aux_logits = self.class_head(normed)
            aux_masks = self._predict_masks(normed, mask_features, layer_idx=i)
            aux_outputs.append({
                "pred_logits": aux_logits,
                "pred_masks": aux_masks,
            })

        # Final predictions
        query = self.decoder_norm(query)
        if self.per_layer_heads:
            pred_logits = self.class_heads[-1](query)
        else:
            pred_logits = self.class_head(query)
        pred_masks = self._predict_masks(query, mask_features, layer_idx=-1)

        return {
            "pred_logits": pred_logits,
            "pred_masks": pred_masks,
            "aux_outputs": aux_outputs[:-1],  # exclude last (same as final)
        }

    def _predict_masks(
        self, query: torch.Tensor, mask_features: torch.Tensor,
        layer_idx: int = -1,
    ) -> torch.Tensor:
        """Predict masks via dot product between queries and mask features."""
        if self.per_layer_heads:
            mask_embed = self.mask_heads[layer_idx](query)
        else:
            mask_embed = self.mask_head(query)
        B, C, H, W = mask_features.shape
        masks = torch.bmm(mask_embed, mask_features.flatten(2))
        return masks.reshape(B, -1, H, W)


class TransformerDecoderLayer(nn.Module):
    """Single Mask2Former decoder layer with masked cross-attention."""

    def __init__(self, hidden_dim: int = 256, nhead: int = 8, dropout: float = 0.1):
        super().__init__()

        # Self-attention
        self.self_attn = nn.MultiheadAttention(
            hidden_dim, nhead, dropout=dropout, batch_first=True
        )
        self.norm1 = nn.LayerNorm(hidden_dim)
        self.dropout1 = nn.Dropout(dropout)

        # Cross-attention (masked)
        self.cross_attn = nn.MultiheadAttention(
            hidden_dim, nhead, dropout=dropout, batch_first=True
        )
        self.norm2 = nn.LayerNorm(hidden_dim)
        self.dropout2 = nn.Dropout(dropout)

        # FFN
        self.ffn = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim * 4),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim * 4, hidden_dim),
            nn.Dropout(dropout),
        )
        self.norm3 = nn.LayerNorm(hidden_dim)

    def forward(
        self,
        query: torch.Tensor,
        memory: torch.Tensor,
        query_pos: torch.Tensor,
        attn_mask: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Args:
            query: (B, Q, C)
            memory: (B, N, C) flattened spatial features
            query_pos: (B, Q, C) positional embedding
            attn_mask: (B, Q, N) bool mask for cross-attention (True = mask out)
        """
        # Self-attention
        q = k = query + query_pos
        sa_out = self.self_attn(q, k, query)[0]
        query = self.norm1(query + self.dropout1(sa_out))

        # Cross-attention with optional mask
        q = query + query_pos
        if attn_mask is not None:
            # Reshape for multi-head: (B, Q, N) -> (B*nhead, Q, N)
            nhead = self.cross_attn.num_heads
            B, Q, N = attn_mask.shape
            attn_mask_expanded = attn_mask.unsqueeze(1).expand(B, nhead, Q, N)
            attn_mask_expanded = attn_mask_expanded.reshape(B * nhead, Q, N)
            ca_out = self.cross_attn(q, memory, memory, attn_mask=attn_mask_expanded)[0]
        else:
            ca_out = self.cross_attn(q, memory, memory)[0]
        query = self.norm2(query + self.dropout2(ca_out))

        # FFN
        ffn_out = self.ffn(query)
        query = self.norm3(query + ffn_out)

        return query


class Mask2FormerModel(nn.Module):
    """Mask2Former model supporting DINOv2 ViT and DINOv3 ConvNeXt backbones.

    DINOv2 path:
        Frozen DINOv2 ViT → SimpleFPN (1-scale → 4-scale) → Pixel Decoder
        → Transformer Decoder → per-query class + mask

    DINOv3 ConvNeXt path:
        Frozen DINOv3 ConvNeXt (native 4-scale) → Pixel Decoder
        → Transformer Decoder → per-query class + mask

    In both cases, the pixel decoder:
    - Keeps the finest scale (stride ~4-7) out of the transformer
    - Processes 3 coarser scales through transformer encoder
    - Uses top-down FPN + lateral connection to produce high-res mask features
    """

    # Backbone names that use the hierarchical ConvNeXt path
    CONVNEXT_BACKBONES = {"facebook/dinov3-convnext-large-pretrain-lvd1689m"}

    def __init__(self, config: ModelConfig = None):
        super().__init__()
        if config is None:
            config = ModelConfig()

        self.config = config
        self.is_convnext = config.backbone in self.CONVNEXT_BACKBONES
        self.use_deformable = getattr(config, "use_deformable", False)

        if self.is_convnext:
            from sperm_final.models.convnext_backbone import DINOv3ConvNeXtBackbone
            self.backbone = DINOv3ConvNeXtBackbone(
                model_name=config.backbone,
                frozen=config.backbone_frozen,
            )
            all_channels = list(self.backbone.hidden_sizes)  # [192, 384, 768, 1536]
            high_res_channels = all_channels[0]
            transformer_in_channels = all_channels[1:]
        else:
            from sperm_final.models.backbone import DINOv2Backbone
            from sperm_final.models.simple_fpn import SimpleFPN
            self.backbone = DINOv2Backbone(
                model_name=config.backbone,
                feature_layers=config.feature_layers,
                frozen=config.backbone_frozen,
            )
            self.fpn = SimpleFPN(
                in_channels=self.backbone.hidden_size,
                out_channels=config.fpn_channels,
            )
            all_channels = [config.fpn_channels] * 4
            high_res_channels = config.fpn_channels
            transformer_in_channels = [config.fpn_channels] * 3

        # Pixel decoder
        if self.use_deformable:
            from sperm_final.models.deformable_attention import DeformablePixelDecoder
            self.pixel_decoder = DeformablePixelDecoder(
                in_channels_list=all_channels,
                hidden_dim=config.fpn_channels,
            )
        else:
            self.pixel_decoder = MSDeformAttnPixelDecoder(
                high_res_channels=high_res_channels,
                in_channels_list=transformer_in_channels,
                hidden_dim=config.fpn_channels,
            )

        # Mask feature upsampler
        upsample_factor = getattr(config, "mask_upsample_factor", 2)
        upsampler_layers = []
        for _ in range(upsample_factor // 2):
            upsampler_layers.extend([
                nn.ConvTranspose2d(config.fpn_channels, config.fpn_channels, kernel_size=2, stride=2),
                nn.GroupNorm(32, config.fpn_channels),
                nn.GELU(),
                nn.Conv2d(config.fpn_channels, config.fpn_channels, 3, padding=1),
                nn.GroupNorm(32, config.fpn_channels),
                nn.GELU(),
            ])
        self.mask_upsampler = nn.Sequential(*upsampler_layers)

        # Transformer decoder
        self.transformer_decoder = TransformerDecoder(
            hidden_dim=config.fpn_channels,
            num_layers=config.num_decoder_layers,
            num_queries=config.num_queries,
            num_classes=config.num_classes,
            dropout=getattr(config, "decoder_dropout", 0.1),
            per_layer_heads=getattr(config, "per_layer_heads", False),
        )

    def forward(self, pixel_values: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Forward pass.

        Args:
            pixel_values: (B, 3, H, W) normalized images.

        Returns:
            pred_logits: (B, Q, num_classes)
            pred_masks: (B, Q, H_mask, W_mask)
            aux_outputs: intermediate predictions
        """
        # Extract backbone features
        backbone_features = self.backbone(pixel_values)

        if self.is_convnext:
            all_features = [backbone_features[f"stage_{i}"] for i in range(4)]
        else:
            B, C, H, W = pixel_values.shape
            ps = self.backbone.patch_size
            assert H % ps == 0 and W % ps == 0, \
                f"Input ({H}x{W}) must be divisible by patch_size ({ps})"
            all_features = self.fpn(backbone_features)  # 4-scale list

        # Pixel decoder
        if self.use_deformable:
            mask_features, multi_scale_out = self.pixel_decoder(all_features)
        else:
            high_res = all_features[0]
            multi_scale = all_features[1:]
            mask_features, multi_scale_out = self.pixel_decoder(high_res, multi_scale)

        # Upsample mask features for finer mask prediction
        mask_features_hr = self.mask_upsampler(mask_features)

        # Transformer decoder → class + mask predictions
        outputs = self.transformer_decoder(mask_features_hr, multi_scale_out)

        return outputs

    def get_trainable_params(self, llrd_decay: float = 0.0) -> List[Dict]:
        """Get parameter groups for optimizer.

        Returns separate groups for decoder (higher lr) and backbone (lower lr).
        When llrd_decay > 0, creates per-layer backbone groups with decaying LR multipliers.

        Args:
            llrd_decay: Layer-wise LR decay factor (0 = disabled, 0.75 = recommended).
                Each backbone layer i gets lr_mult = decay^(num_layers - i).
        """
        decoder_params = []
        backbone_params = []

        for name, param in self.named_parameters():
            if not param.requires_grad:
                continue
            if name.startswith("backbone."):
                backbone_params.append((name, param))
            else:
                decoder_params.append(param)

        param_groups = [
            {"params": decoder_params, "name": "decoder"},
        ]

        if not backbone_params:
            return param_groups

        if llrd_decay > 0 and llrd_decay < 1.0:
            # Layer-wise learning rate decay for backbone
            layer_params = {}  # layer_idx -> list of params

            if self.is_convnext:
                # ConvNeXt: stages 0-3, each stage is one "layer"
                num_layers = 4
                for name, param in backbone_params:
                    layer_idx = 0  # default (embeddings etc.)
                    for s in range(4):
                        if f".stages.{s}." in name or f".encoder.stages.{s}." in name:
                            layer_idx = s
                            break
                    layer_params.setdefault(layer_idx, []).append(param)
            else:
                # DINOv2 ViT: encoder.layer.0 through encoder.layer.N
                num_layers = len(self.backbone.backbone.encoder.layer)
                for name, param in backbone_params:
                    layer_idx = 0  # default for embeddings
                    for li in range(num_layers):
                        if f".encoder.layer.{li}." in name:
                            layer_idx = li
                            break
                    layer_params.setdefault(layer_idx, []).append(param)

            for layer_idx in sorted(layer_params.keys()):
                lr_mult = llrd_decay ** (num_layers - layer_idx)
                param_groups.append({
                    "params": layer_params[layer_idx],
                    "name": f"backbone_layer_{layer_idx}",
                    "lr_mult": lr_mult,
                })
        else:
            # Single backbone group (no LLRD)
            param_groups.append({
                "params": [p for _, p in backbone_params],
                "name": "backbone",
            })

        return param_groups

    def load_state_dict(self, state_dict, strict=True, **kwargs):
        """Load state dict with backward compatibility for prediction head format.

        Handles conversion between shared heads (class_head) and per-layer heads (class_heads.N).
        """
        old_prefix = "transformer_decoder.class_head."
        new_prefix = "transformer_decoder.class_heads."
        has_shared = any(k.startswith(old_prefix) for k in state_dict)
        has_per_layer = any(k.startswith(new_prefix) for k in state_dict)

        model_uses_per_layer = self.transformer_decoder.per_layer_heads

        if has_shared and not has_per_layer and model_uses_per_layer:
            # Broadcast shared → per-layer
            num_layers = self.transformer_decoder.num_layers
            new_state = {}
            for k, v in state_dict.items():
                if k.startswith("transformer_decoder.class_head."):
                    suffix = k[len("transformer_decoder.class_head."):]
                    for i in range(num_layers):
                        new_state[f"transformer_decoder.class_heads.{i}.{suffix}"] = v.clone()
                elif k.startswith("transformer_decoder.mask_head."):
                    suffix = k[len("transformer_decoder.mask_head."):]
                    for i in range(num_layers):
                        new_state[f"transformer_decoder.mask_heads.{i}.{suffix}"] = v.clone()
                else:
                    new_state[k] = v
            state_dict = new_state
        elif has_per_layer and not has_shared and not model_uses_per_layer:
            # Convert per-layer → shared (use last layer's weights)
            num_layers = self.transformer_decoder.num_layers
            last = num_layers - 1
            new_state = {}
            for k, v in state_dict.items():
                if k.startswith("transformer_decoder.class_heads."):
                    if k.startswith(f"transformer_decoder.class_heads.{last}."):
                        suffix = k[len(f"transformer_decoder.class_heads.{last}."):]
                        new_state[f"transformer_decoder.class_head.{suffix}"] = v
                elif k.startswith("transformer_decoder.mask_heads."):
                    if k.startswith(f"transformer_decoder.mask_heads.{last}."):
                        suffix = k[len(f"transformer_decoder.mask_heads.{last}."):]
                        new_state[f"transformer_decoder.mask_head.{suffix}"] = v
                else:
                    new_state[k] = v
            state_dict = new_state

        return super().load_state_dict(state_dict, strict=strict, **kwargs)
