"""SegFormer-B0 spheroid-segmentation wrapper.

Wraps a SegFormer-B0 (HuggingFace ``SegformerForSemanticSegmentation``)
fine-tuned on the SpheroMix dataset (32,367 bright-field cancer-spheroid
images). Reports 0.9335 Unified IoU on the HQ+DTS test split — the most
accurate spheroid model in the platform — while being the smallest (3.71M
params) and fastest (~13 ms / 1024x1024 image on an L40S).

Design — why a thin ``nn.Module`` wrapper rather than a wound-style plain
wrapper: SegFormer's preprocessing (1024 resize + ImageNet normalization) is
identical to the other spheroid models, and its output is a binary mask ->
closed polygons. So the model is exposed as an ``nn.Module`` whose ``forward``
returns a single-channel ``(B, 1, H, W)`` foreground logit (``fg - bg``). That
lets it flow through the shared ``ModelLoader.predict`` / ``predict_batch``
pipeline unchanged: ``sigmoid(fg - bg) > 0.5`` is exactly the model's native
two-class ``argmax``, so the existing sigmoid+threshold postprocessor and
contour/hole/polygon extraction work without a dedicated ``predict_segformer``.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Union

import torch
import torch.nn.functional as F

logger = logging.getLogger(__name__)

try:
    from transformers import SegformerConfig, SegformerForSemanticSegmentation
except ImportError as e:  # transformers missing -> model disabled by loader
    SegformerConfig = None
    SegformerForSemanticSegmentation = None
    _segformer_import_error = e
else:
    _segformer_import_error = None


class SegFormerModel(torch.nn.Module):
    """SegFormer-B0 fine-tuned on SpheroMix, exposed as a single-channel
    ``nn.Module`` so the shared spheroid inference path can drive it."""

    HF_BASE = "nvidia/segformer-b0-finetuned-ade-512-512"

    def __init__(self) -> None:
        super().__init__()
        if SegformerForSemanticSegmentation is None:
            raise ImportError(
                "transformers is required for SegFormerModel. "
                f"Install it via requirements.txt. Original error: "
                f"{_segformer_import_error}"
            )
        # Build the architecture from config only: this fetches the tiny
        # config.json (cached in .hf-cache) but NOT the ADE pretrained weights,
        # which we would immediately overwrite with our own checkpoint. The
        # decode-head classifier gets 2 output channels because num_labels=2.
        cfg = SegformerConfig.from_pretrained(self.HF_BASE, num_labels=2)
        self.seg = SegformerForSemanticSegmentation(cfg)
        self.seg.eval()
        self.device: torch.device = torch.device("cpu")

    def load_weights(self, weights_path: Union[str, Path],
                     device: Union[str, torch.device]) -> "SegFormerModel":
        """Load the ``.pth`` checkpoint and move to the target device.

        Mirrors the wound model's safe-load policy: try ``weights_only=True``
        first (mitigates CVE-2025-32434), fall back to ``weights_only=False``
        (arbitrary pickle) only when ``ALLOW_UNSAFE_WEIGHTS`` is set — which it
        is in the ML Dockerfile, because the checkpoints are our own shipped
        artifacts.
        """
        self.device = torch.device(device) if isinstance(device, str) else device

        try:
            state = torch.load(
                str(weights_path), map_location="cpu", weights_only=True
            )
        except Exception as e1:
            if os.getenv("ALLOW_UNSAFE_WEIGHTS", "1") != "1":
                logger.error(
                    f"SegFormerModel: weights_only=True failed ({e1}) and "
                    f"ALLOW_UNSAFE_WEIGHTS is not set — refusing to load."
                )
                raise
            logger.error(
                f"SegFormerModel: SECURITY — weights_only=True failed ({e1}); "
                f"falling back to weights_only=False (arbitrary pickle). "
                f"Safe only for trusted checkpoints (our own). "
                f"Set ALLOW_UNSAFE_WEIGHTS=0 to refuse this fallback."
            )
            state = torch.load(
                str(weights_path), map_location="cpu", weights_only=False
            )

        if isinstance(state, dict) and "model_state_dict" in state:
            sd = state["model_state_dict"]
        elif isinstance(state, dict) and "state_dict" in state:
            sd = state["state_dict"]
        else:
            sd = state

        # Tolerate finetuned-wrapper checkpoints that prefix every key with
        # "net." (matches the released inference.py loader).
        if any(k.startswith("net.") for k in list(sd.keys())[:3]):
            sd = {(k[4:] if k.startswith("net.") else k): v for k, v in sd.items()}

        self.seg.load_state_dict(sd, strict=True)
        self.seg.to(self.device).eval()
        logger.info(f"SegFormerModel loaded from {weights_path} on {self.device}")
        return self

    def to(self, device: Union[str, torch.device]) -> "SegFormerModel":
        self.device = torch.device(device) if isinstance(device, str) else device
        self.seg.to(self.device)
        return self

    def eval(self) -> "SegFormerModel":
        self.seg.eval()
        return self

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """``x``: ImageNet-normalized ``(B, 3, H, W)`` tensor from the shared
        ``preprocess_image`` (H=W=1024). Returns a single-channel
        ``(B, 1, H, W)`` foreground logit so the shared sigmoid+threshold
        postprocessor reproduces the model's two-class argmax."""
        out = self.seg(pixel_values=x)
        # SegFormer logits are at 1/4 input resolution; upsample to input size.
        logits = F.interpolate(
            out.logits, size=x.shape[-2:], mode="bilinear", align_corners=False
        )
        # fg - bg: sigmoid(.) > 0.5  <=>  argmax([bg, fg]) == 1
        return logits[:, 1:2, :, :] - logits[:, 0:1, :, :]
