"""Augmentations for instance segmentation training.

Applies geometric and photometric transforms jointly to image + masks + boxes.
Adapted from Sperm-Detection/run_sweep_maskrcnn.py:259-321.
"""

import random
from typing import Dict, Tuple

import numpy as np
import torch


def detection_transforms(
    image: torch.Tensor,
    target: Dict[str, torch.Tensor],
    p_hflip: float = 0.5,
    p_vflip: float = 0.5,
    p_rot90: float = 0.5,
    p_brightness: float = 0.5,
    p_contrast: float = 0.5,
    p_noise: float = 0.3,
    brightness_delta: float = 0.2,
    contrast_range: Tuple[float, float] = (0.8, 1.2),
    noise_sigma: float = 0.02,
) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
    """Apply augmentations to image and target.

    Args:
        image: (C, H, W) float tensor in [0, 1].
        target: dict with "boxes", "labels", "masks".
    """
    _, h, w = image.shape

    # Random horizontal flip
    if random.random() < p_hflip:
        image = torch.flip(image, dims=[2])
        if target["boxes"].numel() > 0:
            boxes = target["boxes"].clone()
            boxes[:, [0, 2]] = w - boxes[:, [2, 0]]
            target["boxes"] = boxes
        target["masks"] = torch.flip(target["masks"], dims=[2])

    # Random vertical flip
    if random.random() < p_vflip:
        image = torch.flip(image, dims=[1])
        if target["boxes"].numel() > 0:
            boxes = target["boxes"].clone()
            boxes[:, [1, 3]] = h - boxes[:, [3, 1]]
            target["boxes"] = boxes
        target["masks"] = torch.flip(target["masks"], dims=[1])

    # Random 90-degree rotation
    if random.random() < p_rot90:
        k = random.choice([1, 2, 3])
        image = torch.rot90(image, k, dims=[1, 2])
        target["masks"] = torch.rot90(target["masks"], k, dims=[1, 2])
        if target["boxes"].numel() > 0:
            target["boxes"] = _rotate_boxes_90(target["boxes"], h, w, k)
        # Update h, w after rotation
        if k % 2 == 1:
            h, w = w, h

    # Random brightness
    if random.random() < p_brightness:
        delta = random.uniform(-brightness_delta, brightness_delta)
        image = torch.clamp(image + delta, 0.0, 1.0)

    # Random contrast
    if random.random() < p_contrast:
        scale = random.uniform(contrast_range[0], contrast_range[1])
        image = torch.clamp(0.5 + (image - 0.5) * scale, 0.0, 1.0)

    # Gaussian noise
    if random.random() < p_noise:
        noise = torch.randn_like(image) * noise_sigma
        image = torch.clamp(image + noise, 0.0, 1.0)

    return image, target


def _rotate_boxes_90(
    boxes: torch.Tensor, h: int, w: int, k: int
) -> torch.Tensor:
    """Rotate bounding boxes by k*90 degrees."""
    for _ in range(k % 4):
        x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
        new_x1 = y1
        new_y1 = w - x2
        new_x2 = y2
        new_y2 = w - x1
        boxes = torch.stack([new_x1, new_y1, new_x2, new_y2], dim=1)
        h, w = w, h
    return boxes


def copy_paste_augmentation(
    image: torch.Tensor,
    target: Dict[str, torch.Tensor],
    donor_image: torch.Tensor,
    donor_target: Dict[str, torch.Tensor],
    max_paste: int = 3,
    p: float = 0.5,
) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
    """Paste instances from a donor image onto the current image.

    Critical augmentation for small datasets (~750 instances).
    """
    if random.random() > p:
        return image, target
    if donor_target["masks"].shape[0] == 0:
        return image, target

    n_donor = donor_target["masks"].shape[0]
    n_paste = min(random.randint(1, max_paste), n_donor)
    indices = random.sample(range(n_donor), n_paste)

    _, h, w = image.shape
    new_masks = [target["masks"]]
    new_labels = [target["labels"]]
    new_boxes = [target["boxes"]]

    for idx in indices:
        mask = donor_target["masks"][idx]  # (H_d, W_d)
        label = donor_target["labels"][idx]

        # Crop mask to its bounding box
        mh, mw = mask.shape
        ys = torch.where(mask.any(dim=1))[0]
        xs = torch.where(mask.any(dim=0))[0]
        if len(ys) == 0 or len(xs) == 0:
            continue

        y1, y2 = int(ys[0]), int(ys[-1]) + 1
        x1, x2 = int(xs[0]), int(xs[-1]) + 1
        crop_mask = mask[y1:y2, x1:x2]
        crop_img = donor_image[:, y1:y2, x1:x2]
        ch, cw = crop_mask.shape

        if ch >= h or cw >= w:
            continue

        # Random placement
        py = random.randint(0, h - ch)
        px = random.randint(0, w - cw)

        # Paste
        paste_region = crop_mask > 0
        image[:, py:py+ch, px:px+cw][:, paste_region] = crop_img[:, paste_region]

        # Create full-size mask for this pasted instance
        full_mask = torch.zeros(h, w, dtype=mask.dtype, device=mask.device)
        full_mask[py:py+ch, px:px+cw] = crop_mask

        new_masks.append(full_mask.unsqueeze(0))
        new_labels.append(label.unsqueeze(0))
        new_boxes.append(torch.tensor([[px, py, px+cw, py+ch]], dtype=torch.float32))

    target["masks"] = torch.cat(new_masks, dim=0)
    target["labels"] = torch.cat(new_labels, dim=0)
    target["boxes"] = torch.cat(new_boxes, dim=0)

    return image, target
