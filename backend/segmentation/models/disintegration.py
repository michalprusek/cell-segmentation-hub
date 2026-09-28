"""Spheroid-disintegration segmentation model (UNet++ / EfficientNet-B5, 3-class).

Semantic segmentation of bright-field tumour-spheroid images into three classes:

    0 = background, 1 = corona (dispersing cells), 2 = dense core

The model predicts the dense **core directly** (not via intensity thresholding),
so the core anchor for the core-anchored Disintegration Index (DI) is correct at
both the intact (0 h) and disintegrated (48 h) time points — this is exactly the
0 h core mis-scaling the previous heuristic-core model suffered from.

This replaced an earlier binary U-Net + Attention/ASPP architecture whose core was
inferred post-hoc by an Otsu/solidity heuristic. When the architecture changed the
public model key was renamed from ``unet_attention_aspp`` to
``spheroid_disintegration``.

Weights load from a local ``spheroid_disintegration_unetpp_effb5_3class.pth``
checkpoint (dict with ``model`` state + ``arch``/``encoder``/``num_classes``
metadata); no network, no HuggingFace token. The file served is the paper's
deposited production replicate ``prod_s42`` (SHA-256 d47d28ad…ea15, Zenodo
10.5281/zenodo.22295117) under the unchanged filename — ONE replicate, whereas
the paper reports five-replicate means; see ``scripts/download_weights.py``.
"""

import contextlib
import logging

import cv2
import numpy as np
import torch

logger = logging.getLogger(__name__)

# ImageNet normalisation — the EfficientNet-B5 encoder was trained with it and
# the segmentation model's training preprocessing applies it after CLAHE.
_IMEAN = np.array([0.485, 0.456, 0.406], np.float32)
_ISTD = np.array([0.229, 0.224, 0.225], np.float32)
# Applied as albumentations.Normalize applies it to a uint8 image: a per-channel
# float32 look-up table (v - 255*mean) * (1 / (255*std)). Algebraically the same
# as (v/255 - mean)/std, but the float32 rounding differs by up to ~5e-7, and on
# a 48 h frame that was enough to flip argmax ties on a handful of pixels; with
# the table the app's tensor is bit-identical to the paper's.
_NORM_LUT = (
    np.arange(256, dtype=np.float32)[None, :] - (_IMEAN * 255.0)[:, None]
) * np.reciprocal(_ISTD * 255.0)[:, None]  # (3, 256) float32
_ENCODER = "tu-tf_efficientnet_b5"
_NUM_CLASSES = 3  # 0 = background, 1 = corona, 2 = core
# CLAHE at inference: clip limit PINNED at 2.0 on 8 x 8 tiles, as the paper's
# released spheroid_seg/predict.py now does (spheroid_rozpad
# paper/PREREG_F_CLAHE_PIN.md, 2026-09-28). Training drew the clip limit from
# Uniform[1, 3] per image (albumentations reads a scalar ``clip_limit=3.0`` as the
# range (1, 3)); 2.0 is the midpoint of that training distribution, chosen from
# the training recipe alone. The earlier released script inherited the same
# random draw at inference, and that draw -- not GPU non-determinism -- was the
# run-to-run jitter the paper used to report. Hard-coded on purpose: no
# environment or request knob, so one image always maps to one mask.
CLAHE_CLIP_LIMIT = 2.0
CLAHE_TILE_GRID = (8, 8)
# The EfficientNet-B5 encoder downsamples by 32, so height/width must be a
# multiple of 32; images are replicate-padded up to the next multiple and the
# prediction is cropped back to the native size.
_STRIDE = 32


def preprocess_array(rgb: np.ndarray) -> np.ndarray:
    """CLAHE then ImageNet norm, as the paper's released ``predict.py``.

    ``rgb`` is uint8 HxWx3; returns float32 HxWx3. ``predict.py`` applies
    ``albumentations.CLAHE(clip_limit=(2.0, 2.0), tile_grid_size=(8, 8))``,
    which on a 3-channel image converts to LAB, equalises the L channel with
    ``cv2.createCLAHE`` and converts back; this reproduces it with cv2 alone so
    the app needs no albumentations, and normalises through ``_NORM_LUT`` so
    the result is bit-identical to the paper's (pinned by
    ``segmentation_cpu_tests/test_disintegration_preprocessing.py``).

    The clip limit is ``CLAHE_CLIP_LIMIT`` = 2.0 (see the comment there). Until
    2026-09-28 the app pinned 3.0 while the released script drew a random clip
    limit in [1, 3] per image; the paper now pins 2.0 at inference and re-scored
    every reported number that way, so app and paper agree by construction. Do
    not turn this back into a random draw, and do not make it configurable: one
    image must map to one mask. Determinism is not correctness -- a mask that
    splits a core (the paper's intact spheroid 251201_0 (20), flagged by
    ``core_fragmented``) now does so reproducibly, not less often.
    """
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    clahe = cv2.createCLAHE(clipLimit=CLAHE_CLIP_LIMIT, tileGridSize=CLAHE_TILE_GRID)
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])
    eq = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB)
    return np.stack([_NORM_LUT[c][eq[:, :, c]] for c in range(3)], axis=2)


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
        """``preprocess_array`` wrapped as a 1x3xHxW float32 tensor."""
        return torch.from_numpy(preprocess_array(rgb)).permute(2, 0, 1)[None]

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
            # Pad the bottom/right up to the encoder stride; cropped off again
            # below so padding only touches the (discarded) border. "replicate"
            # (not "reflect") so it also works when a dimension is <= the pad
            # width — reflect requires pad < dim and would raise on tiny images.
            x = torch.nn.functional.pad(x, (0, pad_w, 0, pad_h), mode="replicate")
        x = x.to(self._device)
        # The paper's released predict.py runs the forward pass under bfloat16
        # autocast on CUDA (and plain fp32 on CPU), and every reported number
        # came from that path; mirror it so the app's mask is the paper's mask.
        # Guarded for pre-Ampere cards, which have no bf16.
        use_bf16 = (
            self._device == "cuda"
            and torch.cuda.is_available()
            and torch.cuda.is_bf16_supported()
        )
        amp = (
            torch.autocast("cuda", dtype=torch.bfloat16)
            if use_bf16
            else contextlib.nullcontext()
        )
        with torch.no_grad(), amp:
            logits = self._model(x).float()
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
