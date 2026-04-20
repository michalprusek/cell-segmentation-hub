"""Inference utilities for DINOv2/DINOv3 + Mask2Former.

Includes:
- Patch-based prediction with configurable overlap
- Per-class NMS with low IoU threshold for elongated masks
- Post-processing merge of fragmented same-class instances
"""

from typing import List, Tuple

import numpy as np
import torch
import torch.nn.functional as F
from torch.amp import autocast

from sperm_final.config import NUM_CLASSES, InferenceConfig
from sperm_final.data.dataset import IMAGENET_MEAN, IMAGENET_STD


def normalize_imagenet(tensor: torch.Tensor) -> torch.Tensor:
    mean = torch.tensor(IMAGENET_MEAN, dtype=tensor.dtype, device=tensor.device).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD, dtype=tensor.dtype, device=tensor.device).view(3, 1, 1)
    return (tensor - mean) / std


def predict_instances(
    model,
    img_rgb: np.ndarray,
    device: torch.device,
    cfg: InferenceConfig = None,
) -> List[Tuple[int, float, np.ndarray]]:
    """Run patch-based inference with NMS and fragment merging.

    Returns:
        List of (class_id, score, mask) tuples.
    """
    if cfg is None:
        cfg = InferenceConfig()

    h, w = img_rgb.shape[:2]
    tensor = torch.from_numpy(img_rgb).permute(2, 0, 1).float() / 255.0
    tensor = normalize_imagenet(tensor)

    ps = cfg.patch_size
    step = ps - cfg.patch_overlap

    # Collect raw instances from all patches
    raw_instances = []

    coords = set()
    for y in range(0, h, step):
        for x in range(0, w, step):
            coords.add((min(x, max(0, w - ps)), min(y, max(0, h - ps))))

    with torch.no_grad():
        for (px, py) in coords:
            patch = torch.zeros(3, ps, ps, dtype=tensor.dtype)
            ph, pw = min(ps, h - py), min(ps, w - px)
            patch[:, :ph, :pw] = tensor[:, py:py+ph, px:px+pw]

            with autocast("cuda"):
                outputs = model(patch.unsqueeze(0).to(device))

            pred_logits = outputs["pred_logits"][0]
            pred_masks = outputs["pred_masks"][0]

            probs = pred_logits.softmax(-1)
            pred_classes = probs[:, 1:].max(-1)
            scores = pred_classes.values.cpu().numpy()
            classes = pred_classes.indices.cpu().numpy() + 1

            mask_probs = pred_masks.sigmoid().cpu()
            if mask_probs.shape[-2:] != (ps, ps):
                mask_probs = F.interpolate(
                    mask_probs.unsqueeze(1).float(),
                    size=(ps, ps), mode="bilinear", align_corners=False,
                ).squeeze(1)
            mask_probs = mask_probs.numpy()

            for q in range(len(scores)):
                if scores[q] < cfg.score_threshold:
                    continue
                c = int(classes[q])
                if c < 1 or c >= NUM_CLASSES:
                    continue
                m = (mask_probs[q] > cfg.mask_threshold).astype(np.uint8)
                if m[:ph, :pw].sum() < cfg.min_mask_area:
                    continue
                full_mask = np.zeros((h, w), dtype=np.uint8)
                full_mask[py:py+ph, px:px+pw] = m[:ph, :pw]
                raw_instances.append((c, float(scores[q]), full_mask))

    # NMS per class
    instances = _nms_per_class(raw_instances, cfg.nms_iou_threshold)

    # Merge fragmented same-class instances
    instances = _merge_fragments(instances, cfg.merge_iou_threshold)

    return instances


def _nms_per_class(
    raw_instances: List[Tuple[int, float, np.ndarray]],
    iou_threshold: float,
) -> List[Tuple[int, float, np.ndarray]]:
    """Per-class NMS using mask IoU."""
    instances = []
    for c in range(1, NUM_CLASSES):
        cls_insts = sorted(
            [(s, m) for (ci, s, m) in raw_instances if ci == c],
            key=lambda x: -x[0],
        )
        kept = []
        for score, mask in cls_insts:
            suppress = False
            mask_area = mask.sum()
            for _, km in kept:
                inter = (mask & km).sum()
                union = mask_area + km.sum() - inter
                if union > 0 and inter / union > iou_threshold:
                    suppress = True
                    break
            if not suppress:
                kept.append((score, mask))
                instances.append((c, score, mask))
    return instances


def _merge_fragments(
    instances: List[Tuple[int, float, np.ndarray]],
    merge_iou_threshold: float,
) -> List[Tuple[int, float, np.ndarray]]:
    """Merge fragmented same-class instances that overlap.

    Two same-class masks are merged if their intersection over the
    SMALLER mask area exceeds merge_iou_threshold. This catches cases
    where a midpiece is split into two overlapping fragments.
    """
    merged = list(instances)
    changed = True
    while changed:
        changed = False
        new_merged = []
        used = set()
        for i in range(len(merged)):
            if i in used:
                continue
            ci, si, mi = merged[i]
            mi_area = mi.sum()
            for j in range(i + 1, len(merged)):
                if j in used:
                    continue
                cj, sj, mj = merged[j]
                if ci != cj:
                    continue
                inter = (mi & mj).sum()
                smaller = min(mi_area, mj.sum())
                if smaller > 0 and inter / smaller > merge_iou_threshold:
                    # Merge: union masks, keep higher score
                    mi = (mi | mj).astype(np.uint8)
                    mi_area = mi.sum()
                    si = max(si, sj)
                    used.add(j)
                    changed = True
            new_merged.append((ci, si, mi))
            used.add(i)
        merged = new_merged
    return merged
