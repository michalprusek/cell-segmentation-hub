"""Microcapsule instance-segmentation model wrapper.

Wraps the distilled YOLO11n-seg model (Ultralytics) that detects and segments
every microcapsule in a bright-field microscopy image.

Unlike the semantic-mask models (HRNet/UNet/CBAM/...), YOLO returns per-instance
polygons natively, so each detection maps directly onto one closed *external*
polygon — exactly the shape the backend already uses for spheroids. No
polyline/instanceId machinery is needed: multiple external polygons already mean
multiple instances.

Each instance additionally carries:
  - ``confidence`` — YOLO detection score (0..1)
  - ``complete``   — ``False`` if the mask touches the image border (the capsule
                     is cut off by the frame). Downstream, incomplete capsules
                     are drawn grey and excluded from metrics.

The wrapper exposes the same minimal interface as SpermModel/WoundModel so
ModelLoader can drive it uniformly. It is intentionally NOT an ``nn.Module`` —
YOLO owns its own module/loader internally.
"""

import logging

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Capsules whose mask comes within this many pixels of any image edge are treated
# as cut off by the frame. Inherited verbatim from the model's reference infer.py
# (``_touches_border(..., m=3)``) so the completeness flag matches what the model
# authors validated.
_BORDER_MARGIN_PX = 3


def _touches_border(polygon: np.ndarray, height: int, width: int,
                    margin: int = _BORDER_MARGIN_PX) -> bool:
    """Return True if the polygon comes within ``margin`` px of any image edge."""
    xs, ys = polygon[:, 0], polygon[:, 1]
    return bool(
        xs.min() <= margin or ys.min() <= margin
        or xs.max() >= width - margin or ys.max() >= height - margin
    )


class MicrocapsuleModel:
    """YOLO11n-seg instance segmenter for microcapsules.

    Loaded once via ``load_weights()``; call ``predict()`` per image.
    """

    # YOLO inference resolution (the reference pipeline runs the model at 1024).
    IMGSZ = 1024

    def __init__(self):
        """Initialize without loading — weights load separately via load_weights()."""
        self._model = None
        self._device = "cpu"
        logger.info("MicrocapsuleModel wrapper initialized")

    def load_weights(self, weights_path: str, device):
        """Load the YOLO ``.pt`` checkpoint and pin the inference device."""
        from ultralytics import YOLO  # local import keeps package import light

        self._model = YOLO(weights_path)
        # ultralytics accepts 'cpu', a CUDA index, or a 'cuda:N' string.
        dev_type = getattr(device, "type", str(device))
        if dev_type == "cuda":
            idx = getattr(device, "index", 0) or 0
            self._device = f"cuda:{idx}"
        else:
            self._device = "cpu"
        logger.info(
            f"Microcapsule YOLO model loaded from {weights_path} "
            f"(device={self._device})"
        )

    def predict(self, image_bgr: np.ndarray, conf: float = 0.25):
        """Segment every microcapsule in a BGR image.

        Args:
            image_bgr: numpy array (H, W, 3) in BGR order.
            conf: YOLO confidence cutoff (0..1).

        Returns:
            A list of instance dicts, sorted largest-area first (deterministic,
            stable numbering), each with:
                polygon_xy        : (N, 2) float32 pixel coordinates
                confidence        : float 0..1
                complete          : bool  (False if cut off by the frame)
                area_px           : float (cv2.contourArea)
                equiv_diameter_px : float (2*sqrt(area/pi))
        """
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")

        height, width = image_bgr.shape[:2]
        res = self._model(
            image_bgr, imgsz=self.IMGSZ, conf=conf,
            device=self._device, verbose=False,
        )[0]

        if res.masks is None or res.boxes is None:
            return []

        polys = list(res.masks.xy)
        confs = res.boxes.conf.cpu().numpy()

        instances = []
        for poly, score in zip(polys, confs):
            poly = np.asarray(poly, dtype=np.float32)
            if len(poly) < 3:
                continue
            area = float(cv2.contourArea(poly))
            instances.append({
                "polygon_xy": poly,
                "confidence": float(score),
                "complete": not _touches_border(poly, height, width),
                "area_px": area,
                "equiv_diameter_px": (
                    2.0 * float(np.sqrt(area / np.pi)) if area > 0 else 0.0
                ),
            })

        instances.sort(key=lambda inst: -inst["area_px"])
        return instances

    # ---- PyTorch-compatible stubs (for ModelLoader uniformity) ---------------
    def eval(self):
        """No-op — YOLO is always in eval mode after loading."""
        return self

    def to(self, device):
        """No-op — device is pinned during load_weights()."""
        return self

    def parameters(self):
        """No torch parameters are exposed (YOLO owns its module internally)."""
        return iter([])
