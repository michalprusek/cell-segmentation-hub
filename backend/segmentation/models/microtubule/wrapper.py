"""Microtubule instance segmentation model wrapper.

Wraps the v7 DINOv3-L + DPT + PySOAX pipeline (sources copied from
``microtubules_v7_pysoax/`` at repo root) so the ModelLoader can drive it
through the same ``load_weights`` / ``predict`` surface used by the other
models.

The microtubule pipeline differs from the other registered models:

- DINOv3 ViT-L/16 backbone is gated on HuggingFace — the first run needs
  ``HF_TOKEN`` set or available at ``~/.cache/huggingface/token``.
- The DPT decoder has two output heads: a seed-probability map (used by
  PySOAX as the binary foreground for snake initialisation) and a
  32-channel L2-normalised embedding that disambiguates crossings and
  later powers cross-frame MT tracking.
- PySOAX is an iterative stretching-open-active-contour postprocessor;
  it produces per-instance centerlines (open polylines), not closed masks.
- We sample the 32-d embedding at each centerline pixel and persist it as
  float16 so the tracking pipeline can run as pure CPU postprocessing.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Directory holding the copied microtubule sources (segment_mt, pysoax, synth_irm/).
# segment_mt.py uses absolute imports of ``synth_irm.training.*`` and ``pysoax``
# so this directory must be on sys.path before either is imported.
_MICROTUBULE_PKG_DIR: Path = Path(__file__).resolve().parent


class MicrotubuleModel:
    """Wrapper around ``segment_microtubules`` for the ML service.

    Unlike HRNet / UNet / CBAM (pure ``nn.Module`` networks), this class is a
    thin orchestrator: the actual network is :class:`FilamentInstanceModelV4`
    and the postprocessing is :func:`pysoax.extract_soax_instances`.
    """

    DEFAULT_SEED_THRESHOLD: float = 0.5

    def __init__(self) -> None:
        self._model: Optional[Any] = None
        self._device: Optional[str] = None
        self._ckpt_path: Optional[Path] = None
        logger.info("MicrotubuleModel wrapper initialized")

    def load_weights(self, weights_path: str | os.PathLike,
                     device: str | Any) -> "MicrotubuleModel":
        """Load the v7 checkpoint and prepare the model for inference.

        Args:
            weights_path: Path to ``microtubule_v7.pt`` (~1.2 GB). Must exist
                — first run also downloads ~1.1 GB DINOv3 backbone to the HF
                cache, requiring ``HF_TOKEN`` to be set.
            device: ``"cuda"``, ``"cpu"`` or a ``torch.device`` instance.

        Raises:
            FileNotFoundError: if the checkpoint is missing.
        """
        ckpt_path = Path(weights_path)
        if not ckpt_path.exists():
            raise FileNotFoundError(
                f"Microtubule v7 checkpoint missing at {ckpt_path}. "
                "Run scripts/download-microtubule-weights.sh to fetch it."
            )

        # HF_TOKEN is required to download the gated DINOv3 backbone. The
        # checkpoint itself does not contain backbone weights — transformers
        # downloads them on the first call to AutoModel.from_pretrained.
        if "HF_TOKEN" not in os.environ:
            token_file = os.path.expanduser("~/.cache/huggingface/token")
            if os.path.exists(token_file):
                with open(token_file) as fh:
                    os.environ["HF_TOKEN"] = fh.read().strip()

        # Add our package dir to sys.path BEFORE importing segment_mt — the
        # upstream module uses absolute imports of synth_irm.training.*.
        if str(_MICROTUBULE_PKG_DIR) not in sys.path:
            sys.path.insert(0, str(_MICROTUBULE_PKG_DIR))

        from .segment_mt import load_v7_model

        device_str = str(device) if not isinstance(device, str) else device
        self._model = load_v7_model(ckpt_path, device=device_str)
        self._device = device_str
        self._ckpt_path = ckpt_path
        logger.info(f"Microtubule v7 loaded from {ckpt_path} on {device_str}")
        return self

    def predict(self, image_np, seed_threshold: Optional[float] = None,
                pysoax_params: Optional[dict] = None) -> dict:
        """Run v7 + PySOAX on a single 2D grayscale frame.

        Args:
            image_np: numpy ndarray of shape (H, W) — IRM/TIRF intensity frame.
                Higher-dimension arrays are reduced to grayscale (mean over
                channel axis) for convenience.
            seed_threshold: Override for binarising ``seed_prob`` before the
                PySOAX snakes are initialised. Defaults to 0.5.
            pysoax_params: Override of the production
                ``PYSOAX_PARAMS_DEFAULT`` hyperparameters (Optuna-tuned).

        Returns:
            ``{
                'centerlines_rc': list[(M_i, 2) float64],  # row, col px coords
                'seed_prob':       (H, W) float32,         # sigmoid output
                'embedding_samples': list[(M_i, 32) float16],
            }``
        """
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")

        import numpy as np

        if str(_MICROTUBULE_PKG_DIR) not in sys.path:
            sys.path.insert(0, str(_MICROTUBULE_PKG_DIR))

        from .segment_mt import (
            PYSOAX_PARAMS_DEFAULT,
            _normalize,
            predict_seed_embed,
        )

        if image_np.ndim == 3:
            image_np = image_np.mean(axis=-1)
        if image_np.ndim != 2:
            raise ValueError(f"expected 2D image, got shape {image_np.shape}")

        norm = (
            _normalize(image_np)
            if image_np.dtype != np.float32 or image_np.max() > 2
            else image_np.astype(np.float32)
        )

        seed_prob, embed = predict_seed_embed(
            self._model, norm, device=self._device or "cuda"
        )

        thresh = (
            seed_threshold
            if seed_threshold is not None
            else self.DEFAULT_SEED_THRESHOLD
        )
        binary = (seed_prob > thresh).astype(np.uint8) * 255

        from pysoax import extract_soax_instances  # absolute import via sys.path

        params = pysoax_params or PYSOAX_PARAMS_DEFAULT
        instances = extract_soax_instances(binary, params, embeddings=embed)

        import cv2

        centerlines_rc: list = []
        embedding_samples: list = []
        H, W = norm.shape
        # Ramer-Douglas-Peucker tolerance — drops near-collinear points
        # while preserving curvature. RDP is adaptive: straight runs lose
        # the most points, sharp bends keep them, so a smaller eps mostly
        # buys density in the *curves* of an MT (which is where the user
        # cares most). Dropped from 2.0 → 1.0 px to roughly double sample
        # density along bends while leaving straight segments nearly
        # untouched. Also tightens embedding sampling for tracking.
        polyline_eps_px = 1.0
        for inst in instances:
            cl = np.asarray(inst["centerline"], dtype=np.float64)
            if cl.ndim != 2 or cl.shape[0] < 2 or cl.shape[1] != 2:
                continue

            if cl.shape[0] > 3:
                try:
                    cv_pts = cl.astype(np.float32).reshape(-1, 1, 2)
                    simplified = cv2.approxPolyDP(
                        cv_pts, polyline_eps_px, closed=False
                    )
                    cl_simp = simplified.reshape(-1, 2).astype(np.float64)
                    if cl_simp.shape[0] >= 2:
                        cl = cl_simp
                    else:
                        # RDP over-simplified (eps too large for this curve).
                        # Keep the original so the MT isn't dropped from the
                        # output; surface the tuning issue via log.
                        logger.warning(
                            "RDP collapsed centerline to %d pts (eps=%.2f); "
                            "keeping original (%d pts)",
                            cl_simp.shape[0],
                            polyline_eps_px,
                            cl.shape[0],
                        )
                except cv2.error as exc:
                    # One malformed centerline must not abort the whole
                    # inference (would lose every other MT in the frame).
                    logger.warning(
                        "approxPolyDP failed on centerline shape=%s: %s; "
                        "using unsimplified",
                        cl.shape,
                        exc,
                    )

            centerlines_rc.append(cl)

            # Nearest-pixel sampling — cosine similarity is robust to a
            # single-pixel offset, and bilinear interpolation would be
            # ~3x slower for negligible quality gain on tracking.
            rows = np.clip(cl[:, 0].astype(np.int32), 0, H - 1)
            cols = np.clip(cl[:, 1].astype(np.int32), 0, W - 1)
            emb_samples = embed[:, rows, cols].T.astype(np.float16)
            embedding_samples.append(emb_samples)

        return {
            "centerlines_rc": centerlines_rc,
            "seed_prob": seed_prob,
            "embedding_samples": embedding_samples,
        }
