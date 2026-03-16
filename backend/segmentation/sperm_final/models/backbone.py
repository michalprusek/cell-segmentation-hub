"""Frozen DINOv2 ViT backbone with multi-scale feature extraction."""

from typing import Dict, List

import torch
import torch.nn as nn


class DINOv2Backbone(nn.Module):
    """Load a frozen DINOv2 ViT and extract intermediate features.

    Extracts features from specified transformer layers to create
    multi-scale representations for the FPN.

    Args:
        model_name: HuggingFace model name or local path.
        feature_layers: Which transformer layers to extract features from.
            For ViT-L/14 with 24 layers, default is [5, 11, 17, 23].
        frozen: Whether to freeze all backbone parameters.
    """

    def __init__(
        self,
        model_name: str = "facebook/dinov2-large",
        feature_layers: List[int] = None,
        frozen: bool = True,
    ):
        super().__init__()

        # Load DINOv2 via transformers
        from transformers import Dinov2Model

        self.backbone = Dinov2Model.from_pretrained(model_name)
        self.hidden_size = self.backbone.config.hidden_size  # 1024 for ViT-L, 1536 for ViT-g
        self.patch_size = self.backbone.config.patch_size  # 14 for DINOv2

        # Auto-detect feature layers based on model depth
        if feature_layers is not None:
            self.feature_layers = feature_layers
        else:
            num_layers = self.backbone.config.num_hidden_layers  # 24 for L, 40 for g
            step = num_layers // 4
            self.feature_layers = [step - 1, 2 * step - 1, 3 * step - 1, num_layers - 1]

        if frozen:
            self.freeze()

    def freeze(self):
        """Freeze all backbone parameters."""
        for param in self.backbone.parameters():
            param.requires_grad = False
        self.backbone.eval()

    def unfreeze_last_n_layers(self, n: int):
        """Unfreeze the last n transformer layers for fine-tuning."""
        total_layers = len(self.backbone.encoder.layer)
        for i in range(total_layers - n, total_layers):
            for param in self.backbone.encoder.layer[i].parameters():
                param.requires_grad = True

    def train(self, mode: bool = True):
        """Override train to keep frozen parts in eval mode."""
        super().train(mode)
        # Keep backbone in eval if frozen
        if not any(p.requires_grad for p in self.backbone.parameters()):
            self.backbone.eval()
        return self

    @torch.no_grad()
    def _get_spatial_dims(self, h: int, w: int):
        """Compute spatial dimensions of feature map."""
        fh = h // self.patch_size
        fw = w // self.patch_size
        return fh, fw

    def forward(self, pixel_values: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Extract multi-scale features from DINOv2.

        Args:
            pixel_values: (B, 3, H, W) normalized input images.
                H and W must be divisible by patch_size (14).

        Returns:
            Dict with keys "layer_{i}" mapping to (B, C, fH, fW) feature maps.
        """
        B, C, H, W = pixel_values.shape
        fh, fw = self._get_spatial_dims(H, W)

        # Forward with hidden state output
        outputs = self.backbone(
            pixel_values=pixel_values,
            output_hidden_states=True,
            return_dict=True,
        )

        # hidden_states: tuple of (B, N+1, D) where N = fh*fw, +1 for CLS
        hidden_states = outputs.hidden_states  # includes embedding output as [0]

        features = {}
        for layer_idx in self.feature_layers:
            # hidden_states[0] is the embedding output, so layer i is at index i+1
            hs = hidden_states[layer_idx + 1]
            # Remove CLS token
            tokens = hs[:, 1:, :]  # (B, fh*fw, D)
            # Reshape to spatial
            feat_map = tokens.permute(0, 2, 1).reshape(B, -1, fh, fw)
            features[f"layer_{layer_idx}"] = feat_map

        return features
