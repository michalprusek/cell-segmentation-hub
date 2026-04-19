"""Wound-healing segmentation model wrapper.

Wraps a U-Net++ (ResNeXt-50 32x4d encoder) trained on scratch-assay microscopy
images. Produces a binary mask where foreground = wound (cell-free region).

Architecture decisions:
- Wrapper (not nn.Module subclass) — keeps ``.model`` as a raw smp nn.Module
  so the global InferenceExecutor can run it unmodified, and preprocessing /
  postprocessing lives on the same object instead of a sibling utility module.
  (Dependency isolation is handled separately by the try/import guard in
  ``models/__init__.py`` plus the ``WoundModel is None`` check in the model
  loader.)
- Preprocessing baked into the class — wound uses grayscale input with a
  custom ``x/255 - 0.5`` normalization that differs from the shared ImageNet
  normalization used by spheroid models.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Tuple, Union

import numpy as np
import torch
from PIL import Image

logger = logging.getLogger(__name__)

try:
    import segmentation_models_pytorch as smp
except ImportError as e:
    smp = None
    _smp_import_error = e
else:
    _smp_import_error = None


class WoundModel:
    """Loads the wound-healing segmentation checkpoint and exposes standard
    preprocess / forward / postprocess primitives."""

    IMAGE_SIZE = 512
    ENCODER = "resnext50_32x4d"
    ARCH = "unetplusplus"

    def __init__(self) -> None:
        if smp is None:
            raise ImportError(
                "segmentation_models_pytorch is required for WoundModel. "
                f"Install it via requirements.txt. Original error: {_smp_import_error}"
            )
        self.model = smp.create_model(
            self.ARCH,
            encoder_name=self.ENCODER,
            encoder_weights=None,
            in_channels=1,
            classes=1,
        )
        self.model.eval()
        self.device: torch.device = torch.device("cpu")

    def load_weights(self, weights_path: Union[str, Path],
                     device: Union[str, torch.device]) -> "WoundModel":
        """Load the `.pt` checkpoint and move to the target device.

        Falls back to ``weights_only=False`` only when
        ``ALLOW_UNSAFE_WEIGHTS=1`` is set in the environment — the fallback
        path uses Python pickle, which can execute arbitrary code (see
        CVE-2025-32434). In production the weights are our own shipped
        artifacts, so the env flag defaults to 1 in the ML Dockerfile; on
        unknown-provenance checkpoints the service should refuse to load
        rather than silently unpickle.
        """
        import os

        self.device = torch.device(device) if isinstance(device, str) else device

        try:
            state = torch.load(
                str(weights_path), map_location="cpu", weights_only=True
            )
        except Exception as e1:
            if os.getenv("ALLOW_UNSAFE_WEIGHTS", "1") != "1":
                logger.error(
                    f"WoundModel: weights_only=True failed ({e1}) and "
                    f"ALLOW_UNSAFE_WEIGHTS is not set — refusing to load."
                )
                raise
            logger.error(
                f"WoundModel: SECURITY — weights_only=True failed ({e1}); "
                f"falling back to weights_only=False (arbitrary pickle). "
                f"Safe only for trusted checkpoints (our own). "
                f"Set ALLOW_UNSAFE_WEIGHTS=0 to refuse this fallback."
            )
            state = torch.load(
                str(weights_path), map_location="cpu", weights_only=False
            )

        if isinstance(state, dict) and "state_dict" in state:
            sd = state["state_dict"]
        elif isinstance(state, dict) and "model_state_dict" in state:
            sd = state["model_state_dict"]
        else:
            sd = state

        result = self.model.load_state_dict(sd, strict=True)
        if result.missing_keys or result.unexpected_keys:
            raise RuntimeError(
                f"WoundModel state_dict mismatch: "
                f"missing={result.missing_keys} unexpected={result.unexpected_keys}"
            )

        self.model.to(self.device).eval()
        logger.info(f"WoundModel loaded from {weights_path} on {self.device}")
        return self

    def to(self, device: Union[str, torch.device]) -> "WoundModel":
        self.device = torch.device(device) if isinstance(device, str) else device
        self.model.to(self.device)
        return self

    def eval(self) -> "WoundModel":
        self.model.eval()
        return self

    def preprocess(self, image: Image.Image) -> torch.Tensor:
        """PIL → grayscale → resize 512×512 BILINEAR → normalize `[−0.5, 0.5]`.

        The model was trained on brightfield scratch-assay microscopy (bright
        background = wound, dark = cells). RGB inputs are converted to L mode
        via PIL's luminance formula before normalization.
        """
        gray = image if image.mode == "L" else image.convert("L")
        resized = gray.resize((self.IMAGE_SIZE, self.IMAGE_SIZE), Image.BILINEAR)
        arr = np.array(resized, dtype=np.uint8, copy=True)
        t = torch.from_numpy(arr).unsqueeze(0).unsqueeze(0).to(self.device)
        return t.float() / 255.0 - 0.5

    def postprocess_to_mask(self, logits: torch.Tensor,
                            original_size: Tuple[int, int],
                            threshold: float = 0.5) -> np.ndarray:
        """Sigmoid → bilinear upsample → threshold. Returns uint8 {0, 255}.

        ``original_size`` uses PIL's ``(width, height)`` convention.
        """
        prob = torch.sigmoid(logits)
        if prob.dim() == 4:
            prob = prob[0, 0]
        elif prob.dim() == 3:
            prob = prob[0]

        orig_w, orig_h = original_size
        prob = torch.nn.functional.interpolate(
            prob[None, None],
            size=(orig_h, orig_w),
            mode="bilinear",
            align_corners=False,
        )[0, 0]

        prob_np = prob.detach().cpu().numpy().astype(np.float32)
        return ((prob_np > threshold).astype(np.uint8)) * 255
