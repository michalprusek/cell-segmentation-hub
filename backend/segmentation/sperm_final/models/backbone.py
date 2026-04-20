"""Unified DINOv2 / DINOv3 ViT backbone with multi-scale feature extraction.

Handles both DINOv2 ViT-L (1 CLS, patch 14) and DINOv3 ViT-L (1 CLS + 4 registers,
patch 16). Token skip count auto-detected from model config.

For 1024-input:
    DINOv2 ViT-L/14: 73×73 patches  (1024/14≈73, not divisible — use padded)
    DINOv3 ViT-L/16: 64×64 patches  (1024/16=64, clean)
"""

from typing import Dict, List, Optional

import torch
import torch.nn as nn


class DINOv2Backbone(nn.Module):
    """Unified DINOv2 / DINOv3 ViT backbone.

    Uses AutoModel to support both `facebook/dinov2-*` and `facebook/dinov3-vit*`
    checkpoints. Extracts patch-level features from specified transformer layers
    (register + CLS tokens stripped).

    Args:
        model_name: HuggingFace model name or local path.
        feature_layers: Which transformer layers to extract features from.
            For ViT-L with 24 layers, default is [5, 11, 17, 23].
        frozen: Whether to freeze all backbone parameters.
    """

    def __init__(
        self,
        model_name: str = "facebook/dinov2-large",
        feature_layers: Optional[List[int]] = None,
        frozen: bool = True,
    ):
        super().__init__()

        from transformers import AutoModel

        self.backbone = AutoModel.from_pretrained(model_name)
        config = self.backbone.config
        self.hidden_size = config.hidden_size
        self.patch_size = config.patch_size

        # Number of prefix tokens before patch tokens:
        #   DINOv2: 1 (CLS only)                      skip 1
        #   DINOv3: 1 + num_register_tokens (4)       skip 5
        num_registers = getattr(config, "num_register_tokens", 0) or 0
        self.num_prefix_tokens = 1 + num_registers  # always 1 CLS
        self._is_dinov3 = getattr(config, "model_type", "") == "dinov3_vit"

        if feature_layers is not None:
            self.feature_layers = feature_layers
        else:
            num_layers = config.num_hidden_layers
            step = num_layers // 4
            self.feature_layers = [step - 1, 2 * step - 1, 3 * step - 1, num_layers - 1]

        if frozen:
            self.freeze()

    def freeze(self):
        for param in self.backbone.parameters():
            param.requires_grad = False
        self.backbone.eval()

    def _get_layer_list(self):
        """Return the encoder layer list. Supported paths:
          - DINOv2 ViT: self.backbone.encoder.layer
          - DINOv3 ViT: self.backbone.model.layer
          - Fallback: discover first ModuleList with >10 entries.
        """
        if hasattr(self.backbone, "encoder") and hasattr(self.backbone.encoder, "layer"):
            return self.backbone.encoder.layer
        if hasattr(self.backbone, "model") and hasattr(self.backbone.model, "layer"):
            return self.backbone.model.layer
        if hasattr(self.backbone, "layer"):
            return self.backbone.layer
        if hasattr(self.backbone, "encoder") and hasattr(self.backbone.encoder, "layers"):
            return self.backbone.encoder.layers
        if hasattr(self.backbone, "layers"):
            return self.backbone.layers
        # Last-resort discovery
        import torch.nn as nn
        for name, mod in self.backbone.named_modules():
            if isinstance(mod, nn.ModuleList) and len(list(mod)) > 10:
                return mod
        raise AttributeError(f"Cannot locate transformer layer list on {type(self.backbone).__name__}")

    def unfreeze_last_n_layers(self, n: int):
        layers = self._get_layer_list()
        total = len(layers)
        for i in range(total - n, total):
            for param in layers[i].parameters():
                param.requires_grad = True

    def train(self, mode: bool = True):
        super().train(mode)
        if not any(p.requires_grad for p in self.backbone.parameters()):
            self.backbone.eval()
        return self

    @torch.no_grad()
    def _get_spatial_dims(self, h: int, w: int):
        fh = h // self.patch_size
        fw = w // self.patch_size
        return fh, fw

    def forward(self, pixel_values: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Extract multi-scale features from DINOv2 or DINOv3.

        Args:
            pixel_values: (B, 3, H, W) normalized images. H,W must be divisible by patch_size.

        Returns:
            Dict {"layer_{i}": (B, D, fH, fW)}.
        """
        B, C, H, W = pixel_values.shape
        fh, fw = self._get_spatial_dims(H, W)

        outputs = self.backbone(
            pixel_values=pixel_values,
            output_hidden_states=True,
            return_dict=True,
        )
        hidden_states = outputs.hidden_states  # tuple of (B, 1+num_reg+N, D)

        features = {}
        for layer_idx in self.feature_layers:
            hs = hidden_states[layer_idx + 1]
            tokens = hs[:, self.num_prefix_tokens:, :]  # drop CLS + register tokens
            feat_map = tokens.permute(0, 2, 1).reshape(B, -1, fh, fw)
            features[f"layer_{layer_idx}"] = feat_map
        return features
