"""Microcapsule instance-segmentation model wrapper (distilled U-Net).

Segments every microcapsule (round object) in a bright-field microscopy image
with a compact U-Net (MobileNetV3-Small encoder, ~14.5 MB) distilled offline
from Meta SAM 3: SAM 3 (3.4 GB) auto-labelled the training images and this small
student was trained to reproduce its masks (mAP 0.977 vs the teacher on a
held-out split). SAM 3 is NOT needed at runtime — inference is bbox-free, prompt-
free and runs on CPU.

The model is fully convolutional: it predicts a *solid foreground* + a
*per-instance distance map*, then separates touching capsules with an
h-maxima-seeded watershed. This avoids both the bounding-box edge artifacts of
detection models (e.g. YOLO-seg) and the over-segmentation of thick translucent
shells.

Each instance carries:
  - ``confidence`` : mean foreground probability inside the mask (0..1). The
                     model is deterministic (no detection score), so this is a
                     foreground-certainty proxy that keeps the export's
                     confidence column and the threshold slider meaningful.
  - ``complete``   : ``False`` if the mask touches the image border (the capsule
                     is cut off by the frame). Incomplete capsules are drawn grey
                     and excluded from metrics downstream.

Weights load from a local ``microcapsule_unet.pt`` checkpoint (no network, no
HuggingFace token).
"""

import logging

import cv2
import numpy as np
import torch

from .unet_lite import SIZE, build_model, predict_instances

logger = logging.getLogger(__name__)

# ImageNet normalization (the MobileNetV3 encoder was trained with it).
_IMEAN = np.array([0.485, 0.456, 0.406], np.float32)
_ISTD = np.array([0.229, 0.224, 0.225], np.float32)
# Encoders tried in order when matching the checkpoint to an architecture.
_ENCODERS = ("timm-mobilenetv3_small_100", "resnet18")
# Watershed seed prominence (raise if a capsule splits, lower if two touching
# capsules merge). Not exposed per-request; the threshold slider drives the
# foreground cutoff instead.
_WATERSHED_H = 0.3
# Contours smaller than this (px^2) at native resolution are dropped as noise.
_MIN_AREA_PX = 60
# A capsule whose contour comes within this many native px of any image edge is
# treated as cut off by the frame (``complete=False``) and excluded from the
# metrics aggregation. 20 px (≈1.5% of the 1280-wide frame) so capsules that
# only just reach into the border are excluded, not only those flush against it.
_BORDER_MARGIN_PX = 20


def _letterbox(img, size, interp):
    """Resize ``img`` to a ``size``x``size`` square, aspect preserved, zero-padded.

    Returns the padded image plus the (x0, y0, nw, nh) of the real content inside
    it, so predictions can be cropped back out and resized to native resolution.
    """
    h, w = img.shape[:2]
    s = size / max(h, w)
    nh, nw = int(round(h * s)), int(round(w * s))
    resized = cv2.resize(img, (nw, nh), interpolation=interp)
    pad = np.zeros((size, size, 3), img.dtype)
    y0, x0 = (size - nh) // 2, (size - nw) // 2
    pad[y0:y0 + nh, x0:x0 + nw] = resized
    return pad, x0, y0, nw, nh


def _touches_border(polygon: np.ndarray, height: int, width: int,
                    margin: int = _BORDER_MARGIN_PX) -> bool:
    """Return True if the polygon comes within ``margin`` px of any image edge."""
    xs, ys = polygon[:, 0], polygon[:, 1]
    return bool(
        xs.min() <= margin or ys.min() <= margin
        or xs.max() >= width - 1 - margin or ys.max() >= height - 1 - margin
    )


class MicrocapsuleModel:
    """Distilled U-Net instance segmenter for microcapsules.

    Loaded once via ``load_weights()``; call ``predict()`` per image.
    """

    def __init__(self):
        """Initialize without loading — the model builds in load_weights()."""
        self._model = None
        self._device = "cpu"
        logger.info("MicrocapsuleModel (distilled U-Net) wrapper initialized")

    def load_weights(self, weights_path, device):
        """Build the U-Net and load the local ``microcapsule_unet.pt`` checkpoint."""
        dev_type = getattr(device, "type", str(device))
        self._device = "cuda" if dev_type == "cuda" else "cpu"
        state = torch.load(weights_path, map_location=self._device)
        model = None
        for enc in _ENCODERS:
            try:
                m = build_model(enc)
                m.load_state_dict(state)
                model = m
                logger.info(f"Microcapsule U-Net matched encoder '{enc}'")
                break
            except Exception:  # noqa: BLE001 - try the next candidate encoder
                continue
        if model is None:
            raise RuntimeError(
                f"Could not match {weights_path} to a known encoder {_ENCODERS}"
            )
        self._model = model.to(self._device).eval()
        logger.info(f"Microcapsule U-Net loaded (device={self._device})")

    def predict(self, image_bgr: np.ndarray, conf: float = 0.5):
        """Segment every microcapsule in a BGR image.

        ``conf`` is the per-request foreground cutoff (the U-Net ``fg_thresh``).
        Returns a list of instance dicts (sorted largest-area first), each:
            polygon_xy        : (M, 2) float32 pixel coordinates (outer boundary)
            confidence        : float 0..1 (mean foreground probability in mask)
            complete          : bool  (False if cut off by the frame)
            area_px           : float (cv2.contourArea)
            equiv_diameter_px : float (2*sqrt(area/pi))
        """
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")

        height, width = image_bgr.shape[:2]
        rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        lb, x0, y0, nw, nh = _letterbox(rgb, SIZE, cv2.INTER_AREA)
        x = (lb.astype(np.float32) / 255.0 - _IMEAN) / _ISTD
        x = torch.from_numpy(x).permute(2, 0, 1)[None].to(self._device)
        with torch.no_grad():
            out = self._model(x)[0].cpu().numpy()

        fg = 1.0 / (1.0 + np.exp(-out[0]))      # foreground probability (896x896)
        dist = 1.0 / (1.0 + np.exp(-out[1]))    # per-instance distance (896x896)
        lab896 = predict_instances(fg, dist, fg_thresh=conf, h=_WATERSHED_H,
                                   min_size=_MIN_AREA_PX)

        # Crop the real (un-padded) content and resize back to native resolution.
        crop = slice(y0, y0 + nh), slice(x0, x0 + nw)
        lab = cv2.resize(lab896[crop], (width, height),
                         interpolation=cv2.INTER_NEAREST)
        fg_native = cv2.resize(fg[crop], (width, height),
                               interpolation=cv2.INTER_LINEAR)

        instances = []
        for k in (i for i in np.unique(lab) if i):
            mask = (lab == k).astype(np.uint8)
            cnts, _ = cv2.findContours(
                mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if not cnts:
                continue
            contour = max(cnts, key=cv2.contourArea)
            if cv2.contourArea(contour) < _MIN_AREA_PX:
                continue
            # Use the full CHAIN_APPROX_SIMPLE boundary directly — NO
            # Douglas-Peucker (approxPolyDP) simplification — so the polygon
            # follows the capsule edge faithfully. CHAIN_APPROX_SIMPLE already
            # collapses only exactly-collinear runs, so this is the most faithful
            # boundary the segmentation mask carries.
            poly = contour.reshape(-1, 2).astype(np.float32)
            if len(poly) < 3:
                continue
            area = float(cv2.contourArea(poly))
            if area < _MIN_AREA_PX:
                continue
            confidence = float(fg_native[lab == k].mean())
            instances.append({
                "polygon_xy": poly,
                "confidence": confidence,
                "complete": not _touches_border(poly, height, width),
                "area_px": area,
                "equiv_diameter_px": 2.0 * float(np.sqrt(area / np.pi)),
            })

        instances.sort(key=lambda inst: -inst["area_px"])
        return instances

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
        """Expose the U-Net's parameters (used only for device introspection)."""
        return self._model.parameters() if self._model is not None else iter([])
