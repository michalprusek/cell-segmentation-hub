"""Extract patches from full images with associated instance masks."""

import random
from typing import Dict, List, Tuple

import numpy as np


def generate_patch_coords(
    height: int,
    width: int,
    patch_size: int,
    overlap: int,
) -> List[Tuple[int, int]]:
    """Generate (x, y) top-left coordinates for overlapping patches.

    Adapted from combined_pipeline.py:48-54.
    """
    step = patch_size - overlap
    coords = set()
    for y in range(0, height, step):
        for x in range(0, width, step):
            cx = min(x, max(0, width - patch_size))
            cy = min(y, max(0, height - patch_size))
            coords.add((cx, cy))
    return list(coords)


def extract_patches_for_image(
    image: np.ndarray,
    masks: np.ndarray,
    labels: np.ndarray,
    boxes: np.ndarray,
    patch_size: int = 512,
    overlap: int = 128,
    hard_negative_fraction: float = 0.1,
    rng: random.Random = None,
    instance_ids: np.ndarray = None,
    polyline_points: List[np.ndarray] = None,
) -> List[Dict]:
    """Extract patches from a single image with overlapping instances.

    Args:
        image: (H, W, 3) uint8 RGB image.
        masks: (N, H, W) uint8 binary instance masks.
        labels: (N,) int64 class IDs.
        boxes: (N, 4) float32 bounding boxes.
        patch_size: Size of square patches.
        overlap: Overlap between adjacent patches.
        hard_negative_fraction: Fraction of empty patches to keep.
        rng: Random instance for reproducibility.

    Returns:
        List of patch dicts with:
            "image": (ps, ps, 3) uint8
            "masks": (K, ps, ps) uint8
            "labels": (K,) int64
            "boxes": (K, 4) float32 (relative to patch)
    """
    if rng is None:
        rng = random.Random()

    h, w = image.shape[:2]
    coords = generate_patch_coords(h, w, patch_size, overlap)

    patches = []
    empty_patches = []

    for (px, py) in coords:
        # Extract image patch
        img_patch = _extract_region(image, px, py, patch_size)

        # Find instances overlapping this patch
        patch_masks = []
        patch_labels = []
        patch_boxes = []
        patch_inst_ids = []
        patch_polylines = []

        for i in range(len(labels)):
            # Check if bounding box overlaps with patch
            bx1, by1, bx2, by2 = boxes[i]
            if bx2 <= px or bx1 >= px + patch_size:
                continue
            if by2 <= py or by1 >= py + patch_size:
                continue

            # Crop mask to patch region
            mask_patch = _extract_region_2d(masks[i], px, py, patch_size)
            if mask_patch.sum() == 0:
                continue

            # Compute new bounding box relative to patch
            ys, xs = np.where(mask_patch > 0)
            new_box = [float(xs.min()), float(ys.min()),
                       float(xs.max()), float(ys.max())]

            patch_masks.append(mask_patch)
            patch_labels.append(labels[i])
            patch_boxes.append(new_box)
            if instance_ids is not None:
                patch_inst_ids.append(int(instance_ids[i]))
            if polyline_points is not None:
                # Transform polyline to patch-local coords; keep only points inside patch
                pts = polyline_points[i].copy()
                pts[:, 0] -= px
                pts[:, 1] -= py
                in_patch = ((pts[:, 0] >= 0) & (pts[:, 0] < patch_size)
                            & (pts[:, 1] >= 0) & (pts[:, 1] < patch_size))
                patch_polylines.append(pts[in_patch] if in_patch.any()
                                       else np.zeros((0, 2), dtype=np.float32))

        if len(patch_masks) == 0:
            # Empty patch — candidate for hard negative
            entry = {
                "image": img_patch,
                "masks": np.zeros((0, patch_size, patch_size), dtype=np.uint8),
                "labels": np.zeros((0,), dtype=np.int64),
                "boxes": np.zeros((0, 4), dtype=np.float32),
            }
            if instance_ids is not None:
                entry["instance_ids"] = np.zeros((0,), dtype=np.int64)
            if polyline_points is not None:
                entry["polyline_points"] = []
            empty_patches.append(entry)
        else:
            entry = {
                "image": img_patch,
                "masks": np.stack(patch_masks).astype(np.uint8),
                "labels": np.array(patch_labels, dtype=np.int64),
                "boxes": np.array(patch_boxes, dtype=np.float32),
            }
            if instance_ids is not None:
                entry["instance_ids"] = np.array(patch_inst_ids, dtype=np.int64)
            if polyline_points is not None:
                entry["polyline_points"] = patch_polylines
            patches.append(entry)

    # Keep a fraction of empty patches as hard negatives
    if empty_patches and hard_negative_fraction > 0:
        n_keep = max(1, int(len(empty_patches) * hard_negative_fraction))
        rng.shuffle(empty_patches)
        patches.extend(empty_patches[:n_keep])

    return patches


def _extract_region(img: np.ndarray, x: int, y: int, size: int) -> np.ndarray:
    """Extract a square region from a 3D image, zero-padding if needed."""
    h, w = img.shape[:2]
    patch = np.zeros((size, size, img.shape[2]), dtype=img.dtype)
    src_y1, src_y2 = y, min(y + size, h)
    src_x1, src_x2 = x, min(x + size, w)
    ph, pw = src_y2 - src_y1, src_x2 - src_x1
    patch[:ph, :pw] = img[src_y1:src_y2, src_x1:src_x2]
    return patch


def _extract_region_2d(arr: np.ndarray, x: int, y: int, size: int) -> np.ndarray:
    """Extract a square region from a 2D array, zero-padding if needed."""
    h, w = arr.shape[:2]
    patch = np.zeros((size, size), dtype=arr.dtype)
    src_y1, src_y2 = y, min(y + size, h)
    src_x1, src_x2 = x, min(x + size, w)
    ph, pw = src_y2 - src_y1, src_x2 - src_x1
    patch[:ph, :pw] = arr[src_y1:src_y2, src_x1:src_x2]
    return patch
