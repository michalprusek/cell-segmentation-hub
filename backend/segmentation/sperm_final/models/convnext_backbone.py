"""DINOv3 ConvNeXt backbone with native multi-scale feature extraction.

Unlike DINOv2 (single-scale ViT with patch_size=14 producing 37x37 tokens),
DINOv3 ConvNeXt is hierarchical with stride 4/8/16/32, producing ~130x130
tokens at the finest level for 518px input — much better for thin structures.

Stage output sizes for 518x518 input:
    Stage 0: 129×129 (stride ~4), 192 channels
    Stage 1:  64×64  (stride ~8), 384 channels
    Stage 2:  32×32  (stride ~16), 768 channels
    Stage 3:  16×16  (stride ~32), 1536 channels
"""

from typing import Dict, List

import torch
import torch.nn as nn


class DINOv3ConvNeXtBackbone(nn.Module):
    """Frozen DINOv3 ConvNeXt backbone with multi-scale feature extraction.

    Args:
        model_name: HuggingFace model name.
        frozen: Whether to freeze all backbone parameters.
    """

    def __init__(
        self,
        model_name: str = "facebook/dinov3-convnext-large-pretrain-lvd1689m",
        frozen: bool = True,
    ):
        super().__init__()

        from transformers import AutoModel

        self.backbone = AutoModel.from_pretrained(model_name)
        self.hidden_sizes = list(self.backbone.config.hidden_sizes)  # [192, 384, 768, 1536]
        self.num_stages = len(self.hidden_sizes)

        if frozen:
            self.freeze()

    def freeze(self):
        for param in self.backbone.parameters():
            param.requires_grad = False
        self.backbone.eval()

    def unfreeze_last_n_stages(self, n: int):
        """Unfreeze the last n stages for fine-tuning."""
        # Support both DINOv3 (stages at top level) and ConvNeXtV2 (encoder.stages)
        if hasattr(self.backbone, 'stages'):
            stages = self.backbone.stages
        elif hasattr(self.backbone, 'encoder') and hasattr(self.backbone.encoder, 'stages'):
            stages = self.backbone.encoder.stages
        else:
            raise AttributeError("Cannot find stages in backbone model")
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

        Args:
            pixel_values: (B, 3, H, W) normalized input images.

        Returns:
            Dict with keys "stage_0" .. "stage_3" mapping to (B, C_i, H_i, W_i).
        """
        outputs = self.backbone(
            pixel_values=pixel_values,
            output_hidden_states=True,
            return_dict=True,
        )

        # hidden_states[0] = raw input, [1..4] = stage outputs
        hidden_states = outputs.hidden_states

        features = {}
        for i in range(self.num_stages):
            features[f"stage_{i}"] = hidden_states[i + 1]

        return features
