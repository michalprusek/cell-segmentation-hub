"""Adapter for the spermie_v17 model behind the existing SpermModel contract.

Exposes `load_model(weights_path, device)` → model (duck-typed Mask2FormerModel)
and `process_image(model, image_bgr, device, mask_threshold, score_threshold)`
→ `(sperm_list, polylines_list)`, where `polylines_list[i]` is a
`{"head": [(x, y)..], "midpiece": [..], "tail": [..]}` dict.

This is what `backend/segmentation/models/sperm.py::SpermModel.predict` calls,
so keeping the shape intact means no ML-service wrapper changes are needed.

The v17 release ships with a `predict_sperm.py` that uses a newer
`predict_full_image` signature than the bundled `inference/predict.py`
actually provides (no `return_embeddings`/`min_mask_area` params). We
therefore use `predict_full_image_for_graph` and run graph assembly with
hand-tuned costs (`use_learned_costs=False`). The DINOv2-L backbone
+ Mask2Former + IGM2F heads still carry the main quality win. Wiring
up the learned MCMF edge-cost MLP is a follow-up: it needs the bundled
predict.py to propagate `outputs["pred_instance_embed"]` onto each
per-instance dict.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Tuple

import cv2
import numpy as np
import torch

from sperm_final.config import (
    GraphAssemblyConfig,
    ID_TO_CLASS,
    ModelConfig,
)
from sperm_final.data.dataset import IMAGENET_MEAN, IMAGENET_STD
from sperm_final.inference.graph_assembly import assemble_sperm_graph
from sperm_final.inference.postprocess import mask_to_polyline
from sperm_final.inference.predict import predict_full_image_for_graph
from sperm_final.models.mask2former import Mask2FormerModel

logger = logging.getLogger(__name__)

# Matches the order of ID_TO_CLASS in config.py. Lowercase keys to match
# the polygonValidation.ts whitelist and the existing DB/export contract.
PART_KEY_BY_CLS: Dict[int, str] = {1: "head", 2: "midpiece", 3: "tail"}


def load_model(weights_path: str, device: torch.device) -> Mask2FormerModel:
    """Load the v17 Mask2Former checkpoint.

    The checkpoint embeds its own `ModelConfig`. When absent (e.g. legacy
    formats) we fall back to the v17 expected config: DINOv2-L backbone
    with polyline + instance-embed heads.
    """
    ckpt = torch.load(weights_path, map_location="cpu", weights_only=False)
    if "config" in ckpt and "model" in ckpt["config"]:
        cfg = ModelConfig(**ckpt["config"]["model"])
    else:
        cfg = ModelConfig(
            backbone="facebook/dinov2-large",
            use_polyline_head=True,
            use_instance_embed=True,
        )
    cfg.use_polyline_head = True
    cfg.use_instance_embed = True

    model = Mask2FormerModel(cfg)
    state = ckpt.get("model_state_dict", ckpt)
    model.load_state_dict(state, strict=False)
    model.to(device).eval()
    logger.info("Loaded spermie_v17 Mask2Former from %s", weights_path)
    return model


def _to_normalized_tensor(image_rgb: np.ndarray) -> torch.Tensor:
    tensor = torch.from_numpy(image_rgb).permute(2, 0, 1).float() / 255.0
    mean = torch.tensor(IMAGENET_MEAN, dtype=tensor.dtype).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD, dtype=tensor.dtype).view(3, 1, 1)
    return (tensor - mean) / std


def _polyline_from_part(part_inst: Dict, cls_id: int, mask_threshold: float) -> List[Tuple[float, float]]:
    if part_inst is None:
        return []
    mask = part_inst.get("mask")
    if mask is None:
        return []
    return mask_to_polyline(mask, cls_id, mask_threshold=mask_threshold)


def process_image(
    model: Mask2FormerModel,
    image_bgr: np.ndarray,
    device: torch.device,
    mask_threshold: float = 0.5,
    score_threshold: float = 0.5,
    patch_size: int = 1022,
    overlap: int = 200,
) -> Tuple[List[Dict], List[Dict[str, List[Tuple[float, float]]]]]:
    """Run v17 inference + graph assembly + per-part polyline extraction.

    Returns `(sperm_list, polylines_list)` with the existing contract:
      - sperm_list: list of assembled-sperm dicts from graph_assembly (raw),
        each with `head`/`midpiece`/`tail` keys pointing to an instance dict.
      - polylines_list[i]: {"head": [(x, y)..], "midpiece": [..], "tail": [..]}
        for the i-th sperm in `sperm_list`. Matches what the upstream
        `SpermModel.predict` wrapper expects.
    """
    h, w = image_bgr.shape[:2]
    image_rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    tensor = _to_normalized_tensor(image_rgb)

    instances = predict_full_image_for_graph(
        model,
        tensor,
        device,
        patch_size=patch_size,
        overlap=overlap,
        score_threshold=score_threshold,
        mask_threshold=mask_threshold,
    )

    # Hand-tuned graph assembly. Switching to `use_learned_costs=True` will
    # require `predict_full_image_for_graph` to also attach
    # `outputs["pred_instance_embed"]` onto each instance dict — follow-up.
    graph_cfg = GraphAssemblyConfig(use_learned_costs=False)
    sperm_list = assemble_sperm_graph(
        instances,
        mask_threshold=mask_threshold,
        config=graph_cfg,
        edge_cost_mlp=None,
        image_diag=float(np.hypot(h, w)),
    )

    polylines_list: List[Dict[str, List[Tuple[float, float]]]] = []
    for sperm in sperm_list:
        parts: Dict[str, List[Tuple[float, float]]] = {}
        for cls_id, key in PART_KEY_BY_CLS.items():
            parts[key] = _polyline_from_part(sperm.get(key), cls_id, mask_threshold)
        polylines_list.append(parts)

    logger.info(
        "spermie_v17 inference: %d sperm assembled from %d raw instances (%dx%d)",
        len(sperm_list), len(instances), w, h,
    )
    return sperm_list, polylines_list
