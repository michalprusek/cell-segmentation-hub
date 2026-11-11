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

Ensemble serving (optional). ``SPHEROID_DISINTEGRATION_CHECKPOINTS`` may name
several checkpoints of this architecture (comma-separated file names inside
``weights/``). With more than one, each network sees the same preprocessed
tensor, its logits are turned into class probabilities (softmax over the three
classes, float32), the probabilities are averaged per pixel in the listed
order, and the mask is the argmax of that mean. Unset, empty, or naming a
single file, the model is one network and ``predict`` is exactly the
single-network argmax it always was (no softmax on that path). See
``resolve_checkpoints``.
"""

import contextlib
import logging
import os
from pathlib import Path
from typing import List, Optional, Sequence, Union

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
# Environment variable that lists the checkpoints to serve (see the module
# docstring). Read once, when the model is loaded.
CHECKPOINTS_ENV = "SPHEROID_DISINTEGRATION_CHECKPOINTS"


def resolve_checkpoints(
    spec: Optional[str], weights_dir: Union[str, Path], default: Union[str, Path]
) -> List[Path]:
    """The checkpoint files to serve, in order.

    ``spec`` is the raw value of ``CHECKPOINTS_ENV``: comma-separated file
    names relative to ``weights_dir``. ``None``, an empty string or only
    separators and blanks mean "not configured" and return ``[default]``
    unchanged, so the default deployment loads exactly the file it always
    loaded. Every listed file must exist and must lie inside ``weights_dir``
    (an absolute path or a ``..`` that escapes it is refused), and no file may
    be listed twice: a duplicate would silently weight one network twice.
    Raises ``ValueError`` / ``FileNotFoundError`` rather than falling back,
    because serving a different model than the one configured is worse than
    not serving.
    """
    names = [n.strip() for n in (spec or "").split(",")]
    names = [n for n in names if n]
    if not names:
        return [Path(default)]
    root = Path(weights_dir).resolve()
    out: List[Path] = []
    for name in names:
        if os.path.isabs(name):
            raise ValueError(
                f"{CHECKPOINTS_ENV}: {name!r} is absolute; list file names inside {root}"
            )
        path = (root / name).resolve()
        if root not in path.parents:
            raise ValueError(f"{CHECKPOINTS_ENV}: {name!r} lies outside {root}")
        if not path.is_file():
            raise FileNotFoundError(f"{CHECKPOINTS_ENV}: checkpoint not found: {path}")
        if path in out:
            raise ValueError(f"{CHECKPOINTS_ENV}: {name!r} is listed twice")
        out.append(path)
    return out


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

    Loaded once via ``load_weights()``; call ``predict()`` per image. Holds one
    network, or several of the same architecture served as an ensemble (see the
    module docstring).
    """

    def __init__(self):
        """Initialize without loading — the architecture is built in load_weights()."""
        self._nets = []
        self._device = "cpu"
        # Base names of the loaded checkpoints, in load order (provenance only).
        self.checkpoints: List[str] = []
        logger.info("DisintegrationModel (UNet++/EffB5 3-class) wrapper initialized")

    # The single-network view: the first network, or None before loading.
    # Assigning it replaces the whole ensemble with that one network.
    @property
    def _model(self):
        return self._nets[0] if self._nets else None

    @_model.setter
    def _model(self, net):
        self._nets = [] if net is None else [net]

    def _load_one(self, weights_path):
        import segmentation_models_pytorch as smp

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
        logger.info(
            "Disintegration UNet++/EffB5 loaded from %s (device=%s%s)",
            Path(weights_path).name,
            self._device,
            f", val={ck['val']}" if isinstance(ck, dict) and "val" in ck else "",
        )
        return model.to(self._device).eval()

    def load_weights(self, weights_path: Union[str, Path, Sequence[Union[str, Path]]], device):
        """Build the UNet++/EffB5 network(s) and load the local 3-class checkpoint(s).

        ``weights_path`` is one path, or a non-empty sequence of paths for an
        ensemble. Nothing is kept unless every checkpoint loads.
        """
        dev_type = getattr(device, "type", str(device))
        self._device = "cuda" if dev_type == "cuda" else "cpu"
        if isinstance(weights_path, (str, Path)):
            paths = [weights_path]
        else:
            paths = list(weights_path)
        if not paths:
            raise ValueError("load_weights: no checkpoint given")
        nets = [self._load_one(p) for p in paths]
        self._nets = nets
        self.checkpoints = [Path(p).name for p in paths]
        if len(nets) > 1:
            logger.info(
                "Disintegration ensemble of %d networks: mean of softmax, then argmax (%s)",
                len(nets), ", ".join(self.checkpoints),
            )

    def _preprocess(self, rgb: np.ndarray) -> torch.Tensor:
        """``preprocess_array`` wrapped as a 1x3xHxW float32 tensor."""
        return torch.from_numpy(preprocess_array(rgb)).permute(2, 0, 1)[None]

    def predict(self, rgb: np.ndarray) -> np.ndarray:
        """Segment one image at its native resolution.

        ``rgb`` is a uint8 H×W×3 array. Returns a uint8 H×W mask with values
        0 = background, 1 = corona, 2 = core: the argmax over the 3 class logits
        of the one network, or, for an ensemble, the argmax over the per-pixel
        mean of the networks' softmax probabilities.
        """
        if not self._nets:
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
        # A fresh context per forward pass (the ensemble enters one per network).
        def amp():
            return (
                torch.autocast("cuda", dtype=torch.bfloat16)
                if use_bf16
                else contextlib.nullcontext()
            )

        if len(self._nets) == 1:
            # One network: the argmax of its logits, exactly as before the
            # ensemble existed. Not routed through softmax, which can turn two
            # distinct logits into equal probabilities and so change which
            # class an argmax tie picks.
            with torch.no_grad(), amp():
                scores = self._nets[0](x).float()
        else:
            # Ensemble, as the paper's predict.py serves one (ENSEMBLE_RULE
            # there): each network's float32 logits leave the autocast region,
            # a softmax over the three classes turns them into probabilities,
            # these are summed in the listed order and divided by the count,
            # and the argmax picks the class (a tie goes to the lower index).
            # The forward passes run one after another, so the activation
            # peak is one network's.
            scores = None
            with torch.no_grad():
                for net in self._nets:
                    with amp():
                        logits = net(x).float()
                    prob = torch.softmax(logits, dim=1)
                    scores = prob if scores is None else scores + prob
                scores = scores / len(self._nets)
        mask = scores.argmax(dim=1)[0].to("cpu").numpy().astype(np.uint8)
        return mask[:h, :w]

    # ---- PyTorch-compatible stubs (for ModelLoader uniformity) ---------------
    def eval(self):
        """Put the underlying network(s) in eval mode (already set during load)."""
        for net in self._nets:
            net.eval()
        return self

    def to(self, device):
        """Move the underlying network(s); device is normally pinned in load_weights()."""
        if self._nets:
            dev_type = getattr(device, "type", str(device))
            self._device = "cuda" if dev_type == "cuda" else "cpu"
            for net in self._nets:
                net.to(self._device)
        return self

    def parameters(self):
        """Expose the networks' parameters (used only for device introspection)."""
        return (p for net in self._nets for p in net.parameters())
