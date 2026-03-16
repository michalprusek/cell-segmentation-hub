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

    def predict(self, image_bgr, mask_threshold=0.3, score_threshold=0.95):
        """Run the full sperm pipeline on a BGR image.

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

        from sperm_final.run_pipeline import process_image

        sperm_list, polylines_list = process_image(
            self._model, image_bgr, self._device,
            mask_threshold=mask_threshold,
            score_threshold=score_threshold,
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
