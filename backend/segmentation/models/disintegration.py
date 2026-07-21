"""Spheroid-disintegration segmentation model (UNet++ / EfficientNet-B5, 3-class).

Semantic segmentation of bright-field tumour-spheroid images into three classes:

    0 = background, 1 = corona (dispersing cells), 2 = dense core

The model predicts the dense **core directly** (not via intensity thresholding),
so the core anchor for the core-anchored Disintegration Index (DI) is correct at
both the intact (0 h) and disintegrated (48 h) time points — this is exactly the
0 h core mis-scaling the previous heuristic-core model suffered from.

This replaces the earlier ``unet_attention_aspp`` architecture (a binary U-Net +
Attention/ASPP whose core was inferred post-hoc by an Otsu/solidity heuristic).
The model key ``unet_attention_aspp`` is kept for continuity (project-type
mapping, stored segmentations, the frontend), but its implementation and weights
are now this UNet++/EffB5 network.

Weights load from a local ``spheroid_disintegration_unetpp_effb5_3class.pth``
checkpoint (dict with ``model`` state + ``arch``/``encoder``/``num_classes``
metadata); no network, no HuggingFace token.
"""

import logging

import cv2
import numpy as np
import torch

logger = logging.getLogger(__name__)

# ImageNet normalisation — the EfficientNet-B5 encoder was trained with it and
# the segmentation model's training preprocessing applies it after CLAHE.
_IMEAN = np.array([0.485, 0.456, 0.406], np.float32)
_ISTD = np.array([0.229, 0.224, 0.225], np.float32)
_ENCODER = "tu-tf_efficientnet_b5"
_NUM_CLASSES = 3  # 0 = background, 1 = corona, 2 = core
# The EfficientNet-B5 encoder downsamples by 32, so height/width must be a
# multiple of 32; images are reflect-padded up to the next multiple and the
# prediction is cropped back to the native size.
_STRIDE = 32


class DisintegrationModel:
    """UNet++/EfficientNet-B5 3-class spheroid-disintegration segmenter.

    Loaded once via ``load_weights()``; call ``predict()`` per image.
    """

    def __init__(self):
        """Initialize without loading — the architecture is built in load_weights()."""
        self._model = None
        self._device = "cpu"
        logger.info("DisintegrationModel (UNet++/EffB5 3-class) wrapper initialized")

    def load_weights(self, weights_path, device):
        """Build the UNet++/EffB5 network and load the local 3-class checkpoint."""
        import segmentation_models_pytorch as smp

        dev_type = getattr(device, "type", str(device))
        self._device = "cuda" if dev_type == "cuda" else "cpu"
        ck = torch.load(weights_path, map_location=self._device, weights_only=False)
        state = ck["model"] if isinstance(ck, dict) and "model" in ck else ck
        model = smp.UnetPlusPlus(
            encoder_name=_ENCODER,
            encoder_weights=None,
            in_channels=3,
            classes=_NUM_CLASSES,
        )
        # strict=True: the checkpoint matches this architecture exactly; a silent
        # key mismatch would degrade the masks, so fail loudly instead.
        model.load_state_dict(state)
        self._model = model.to(self._device).eval()
        logger.info(
            "Disintegration UNet++/EffB5 loaded (device=%s%s)",
            self._device,
            f", val={ck['val']}" if isinstance(ck, dict) and "val" in ck else "",
        )

    def _preprocess(self, rgb: np.ndarray) -> torch.Tensor:
        """Replicate the training preprocessing exactly: CLAHE then ImageNet norm.

        ``albumentations.CLAHE(clip_limit=3.0, tile_grid_size=(8, 8))`` on a
        3-channel image converts to LAB, equalises the L channel with
        ``cv2.createCLAHE`` and converts back — reproduced here with cv2 so no
        albumentations dependency is needed. ``rgb`` is uint8 H×W×3.
        """
        lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        lab[:, :, 0] = clahe.apply(lab[:, :, 0])
        norm = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB).astype(np.float32) / 255.0
        norm = (norm - _IMEAN) / _ISTD
        return torch.from_numpy(norm).permute(2, 0, 1)[None]

    def predict(self, rgb: np.ndarray) -> np.ndarray:
        """Segment one image at its native resolution.

        ``rgb`` is a uint8 H×W×3 array. Returns a uint8 H×W mask with values
        0 = background, 1 = corona, 2 = core (argmax over the 3 class logits).
        """
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")
        h, w = rgb.shape[:2]
        x = self._preprocess(rgb)
        pad_h = (_STRIDE - h % _STRIDE) % _STRIDE
        pad_w = (_STRIDE - w % _STRIDE) % _STRIDE
        if pad_h or pad_w:
            # Reflect-pad the bottom/right up to the encoder stride; cropped off
            # again below so padding only touches the (discarded) border.
            x = torch.nn.functional.pad(x, (0, pad_w, 0, pad_h), mode="reflect")
        x = x.to(self._device)
        with torch.no_grad():
            logits = self._model(x)
        mask = logits.argmax(dim=1)[0].to("cpu").numpy().astype(np.uint8)
        return mask[:h, :w]

    # ---- PyTorch-compatible stubs (for ModelLoader uniformity) ---------------
    def eval(self):
        """Put the underlying model in eval mode (already set during load)."""
        if self._model is not None:
            self._model.eval()
        return self

    def to(self, device):
        """Move the underlying model; device is normally pinned in load_weights()."""
        if self._model is not None:
            dev_type = getattr(device, "type", str(device))
            self._device = "cuda" if dev_type == "cuda" else "cpu"
            self._model.to(self._device)
        return self

    def parameters(self):
        """Expose the network's parameters (used only for device introspection)."""
        return self._model.parameters() if self._model is not None else iter([])
