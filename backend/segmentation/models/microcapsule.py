"""Microcapsule instance-segmentation model wrapper (Meta SAM 3).

Segments every microcapsule (round object) in a bright-field microscopy image
using SAM 3 Promptable Concept Segmentation with the text prompt "circle".

Why SAM 3 (not a distilled YOLO student): SAM 3 produces instance masks at the
full image resolution, so capsule boundaries are clean and circular — they do
NOT show the low-resolution block / "flat edges on the sides" artifact of a
small YOLO-seg mask grid, and the polygon is simplified with `approxPolyDP`
(points stay ON the contour) rather than smoothed inward, so edges are never
clipped.

SAM 3 with the prompt "circle" returns several overlapping masks per capsule
(the outer shell, the inner wall, an interior bubble). These are collapsed to
one OUTER boundary per capsule with `_merge_nested` — the exact convention the
original distillation used (`training/make_yolo_dataset.py: merge_nested`).

Each instance carries:
  - ``confidence`` : SAM 3 detection score (0..1)
  - ``complete``   : ``False`` if the mask touches the image border (the capsule
                     is cut off by the frame). Incomplete capsules are drawn
                     grey and excluded from metrics downstream.

SAM 3 weights (~3.4 GB ``sam3.pt``) and the CLIP BPE vocab download from
HuggingFace on first load (HF_TOKEN required) and cache under ``HF_HOME``.
"""

import logging
import os
import urllib.request

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Capsules whose mask comes within this many pixels of any image edge are cut
# off by the frame (inherited from the reference pipeline).
_BORDER_MARGIN_PX = 3
# Two SAM 3 "circle" masks are the same capsule when one is >88% contained in
# the other (its inner wall / interior bubble). Matches the original distillation.
_NEST_CONTAINMENT = 0.88
# Polygon simplification tolerance (px). approxPolyDP keeps points ON the
# contour — no inward shrink — so capsule edges are never clipped.
_APPROX_EPS_PX = 1.5
_MIN_AREA_PX = 200
# SAM 3 internal working resolution (logits are interpolated back to native size).
_RESOLUTION = 1008

_BPE_URL = (
    "https://openaipublic.blob.core.windows.net/clip/bpe_simple_vocab_16e6.txt.gz"
)


def _touches_border(polygon: np.ndarray, height: int, width: int,
                    margin: int = _BORDER_MARGIN_PX) -> bool:
    """Return True if the polygon comes within ``margin`` px of any image edge."""
    xs, ys = polygon[:, 0], polygon[:, 1]
    return bool(
        xs.min() <= margin or ys.min() <= margin
        or xs.max() >= width - margin or ys.max() >= height - margin
    )


def _merge_nested(masks, containment: float = _NEST_CONTAINMENT):
    """Indices of masks to KEEP: largest first, drop any >``containment`` nested.

    A capsule's inner wall / interior bubble is almost entirely contained in its
    outer-shell mask, so keeping only the outer mask yields one boundary per
    capsule. Mirrors `training/make_yolo_dataset.py: merge_nested`.
    """
    areas = [int(m.sum()) for m in masks]
    order = sorted(range(len(masks)), key=lambda i: -areas[i])
    kept: list[int] = []
    for i in order:
        if areas[i] == 0:
            continue
        nested = any(
            np.count_nonzero(masks[i] & masks[k]) / min(areas[i], areas[k])
            > containment
            for k in kept
        )
        if not nested:
            kept.append(i)
    return kept


def _bpe_path() -> str:
    """Path to the CLIP BPE vocab; download + cache under HF_HOME on first use."""
    cache_dir = os.environ.get("HF_HOME") or "/tmp"
    path = os.path.join(cache_dir, "sam3_bpe_simple_vocab_16e6.txt.gz")
    if not os.path.exists(path):
        os.makedirs(cache_dir, exist_ok=True)
        logger.info("Downloading CLIP BPE vocab for SAM 3 ...")
        urllib.request.urlretrieve(_BPE_URL, path)
    return path


class MicrocapsuleModel:
    """SAM 3 'circle' instance segmenter for microcapsules.

    Loaded once via ``load_weights()``; call ``predict()`` per image.
    """

    def __init__(self):
        """Initialize without loading — the model builds in load_weights()."""
        self._processor = None
        self._device = "cuda"
        logger.info("MicrocapsuleModel (SAM 3) wrapper initialized")

    def load_weights(self, weights_path, device):
        """Build the SAM 3 image model (downloads sam3.pt from HF, cached).

        ``weights_path`` is accepted for interface symmetry but unused — SAM 3
        loads its checkpoint from HuggingFace (facebook/sam3).
        """
        import sam3
        from sam3.model.sam3_image_processor import Sam3Processor

        dev_type = getattr(device, "type", str(device))
        self._device = "cuda" if dev_type == "cuda" else "cpu"
        model = sam3.build_sam3_image_model(
            bpe_path=_bpe_path(),
            device=self._device,
            eval_mode=True,
            checkpoint_path=None,
            load_from_HF=True,
            enable_segmentation=True,
        )
        # Keep the processor threshold low; the per-call user threshold is applied
        # as a score filter in predict() so it can vary per request.
        self._processor = Sam3Processor(
            model,
            resolution=_RESOLUTION,
            device=self._device,
            confidence_threshold=0.15,
        )
        logger.info(f"SAM 3 microcapsule model loaded (device={self._device})")

    def predict(self, image_bgr: np.ndarray, conf: float = 0.3):
        """Segment every microcapsule in a BGR image with the "circle" prompt.

        Returns a list of instance dicts (sorted largest-area first), each:
            polygon_xy        : (M, 2) float32 pixel coordinates (outer boundary)
            confidence        : float 0..1 (SAM 3 score)
            complete          : bool  (False if cut off by the frame)
            area_px           : float (cv2.contourArea)
            equiv_diameter_px : float (2*sqrt(area/pi))
        """
        if self._processor is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")
        from PIL import Image

        height, width = image_bgr.shape[:2]
        pil = Image.fromarray(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))

        state = self._processor.set_image(pil)
        state = self._processor.set_text_prompt(prompt="circle", state=state)

        masks_t = state.get("masks")
        scores_t = state.get("scores")
        if masks_t is None or len(masks_t) == 0:
            return []

        masks = [
            masks_t[i, 0].cpu().numpy().astype(bool) for i in range(masks_t.shape[0])
        ]
        scores = (
            [float(s) for s in scores_t.cpu().numpy()]
            if scores_t is not None
            else [1.0] * len(masks)
        )

        # Collapse nested capsule detections to one outer mask each, then apply
        # the per-request confidence threshold as a score filter.
        instances = []
        for i in _merge_nested(masks):
            if scores[i] < conf:
                continue
            cnts, _ = cv2.findContours(
                masks[i].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
            )
            if not cnts:
                continue
            contour = max(cnts, key=cv2.contourArea)
            if cv2.contourArea(contour) < _MIN_AREA_PX:
                continue
            poly = (
                cv2.approxPolyDP(contour, _APPROX_EPS_PX, True)
                .reshape(-1, 2)
                .astype(np.float32)
            )
            if len(poly) < 3:
                continue
            area = float(cv2.contourArea(poly))
            instances.append({
                "polygon_xy": poly,
                "confidence": scores[i],
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
        """No-op — SAM 3 is built in eval mode."""
        return self

    def to(self, device):
        """No-op — device is pinned during load_weights()."""
        return self

    def parameters(self):
        """No torch parameters are exposed (SAM 3 owns its modules internally)."""
        return iter([])
