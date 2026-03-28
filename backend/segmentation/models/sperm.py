"""Sperm segmentation model wrapper.

Wraps the sperm_final pipeline (Mask2Former + ConvNeXt + graph assembly + polyline extraction)
to conform to the ModelLoader interface used by the rest of the ML service.

The sperm pipeline is fundamentally different from the other models:
- It's a multi-class instance segmentation model (Head/Midpiece/Tail)
- It has its own sliding window inference, graph assembly, and polyline extraction
- It produces polylines natively (skeleton extraction + BFS + RDP simplification)

This wrapper exposes the pipeline through a simple interface that model_loader.py can call.
"""

import logging
import sys
import os

logger = logging.getLogger(__name__)

# Add parent directory to path so sperm_final can import itself
_parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)


class SpermModel:
    """Wrapper around the sperm_final pipeline for integration with ModelLoader.

    Unlike HRNet/UNet/CBAM which are pure nn.Module models, SpermModel wraps
    a full pipeline (Mask2Former + graph assembly + polyline extraction).
    """

    def __init__(self):
        """Initialize without loading — model is loaded separately via load_weights()."""
        self._model = None
        self._device = None
        logger.info("SpermModel wrapper initialized")

    def load_weights(self, weights_path: str, device):
        """Load Mask2Former checkpoint and prepare for inference."""
        from sperm_final.run_pipeline import load_model
        self._model = load_model(weights_path, device)
        self._device = device
        logger.info(f"Sperm model loaded from {weights_path}")

    # Max dimension for inference — larger images are downscaled to prevent GPU OOM
    MAX_INFERENCE_DIM = 2048

    def predict(self, image_bgr, mask_threshold=0.3, score_threshold=0.95):
        """Run the full sperm pipeline on a BGR image.

        Large images (>MAX_INFERENCE_DIM px) are downscaled for inference,
        then polyline coordinates are scaled back to the original resolution.

        Args:
            image_bgr: numpy array (H, W, 3) in BGR format
            mask_threshold: Threshold for mask binarization (default 0.3)
            score_threshold: Minimum confidence for detections (default 0.95)

        Returns:
            dict with:
                - sperm_list: List of grouped sperm instances
                - polylines: List of dicts per sperm, each with head/midpiece/tail polylines
                - num_sperm: Number of detected complete sperm
        """
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")

        import cv2 as _cv2
        from sperm_final.run_pipeline import process_image

        # Downscale large images to prevent GPU OOM
        h, w = image_bgr.shape[:2]
        max_dim = max(h, w)
        scale = 1.0
        if max_dim > self.MAX_INFERENCE_DIM:
            scale = self.MAX_INFERENCE_DIM / max_dim
            new_w, new_h = int(w * scale), int(h * scale)
            logger.info(f"Downscaling {w}x{h} → {new_w}x{new_h} for inference (scale={scale:.3f})")
            image_bgr = _cv2.resize(image_bgr, (new_w, new_h), interpolation=_cv2.INTER_AREA)

        sperm_list, polylines_list = process_image(
            self._model, image_bgr, self._device,
            mask_threshold=mask_threshold,
            score_threshold=score_threshold,
        )

        # Scale polyline coordinates back to original resolution
        if scale != 1.0 and polylines_list:
            inv_scale = 1.0 / scale
            for polys in polylines_list:
                for part_key in ('head', 'midpiece', 'tail'):
                    pts = polys.get(part_key, [])
                    polys[part_key] = [(x * inv_scale, y * inv_scale) for x, y in pts]

        if len(sperm_list) == 0:
            logger.warning(
                f"Sperm model: 0 detections. Image shape: {image_bgr.shape}, "
                f"mask_threshold: {mask_threshold}"
            )

        return {
            "sperm_list": sperm_list,
            "polylines": polylines_list,
            "num_sperm": len(sperm_list),
        }

    # PyTorch-compatible interface stubs (for ModelLoader compatibility)
    def eval(self):
        """No-op — model is always in eval mode after loading."""
        return self

    def to(self, device):
        """No-op — device is set during load_weights()."""
        return self

    def parameters(self):
        """Return underlying model parameters if loaded."""
        if self._model is not None:
            return self._model.parameters()
        return iter([])
