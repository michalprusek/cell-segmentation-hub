"""Convert polyline annotations to instance masks via dilation."""

from typing import Dict, List, Tuple

import cv2
import numpy as np

from sperm_final.config import CLASS_TO_ID, DILATION_WIDTHS


def polyline_to_mask(
    points: np.ndarray,
    height: int,
    width: int,
    label: str,
    thickness: int = 2,
) -> np.ndarray:
    """Convert a polyline to a binary mask by drawing + dilation.

    Args:
        points: (N, 2) array of (x, y) coordinates.
        height: Image height.
        width: Image width.
        label: Class label ("Head", "Midpiece", "Tail").
        thickness: Base line thickness for drawing.

    Returns:
        Binary mask (height, width) with uint8 values {0, 1}.
    """
    mask = np.zeros((height, width), dtype=np.uint8)
    if points.size == 0:
        return mask

    pts_int = points.round().astype(np.int32)
    cv2.polylines(mask, [pts_int], isClosed=False, color=1, thickness=thickness)

    # Dilate with class-specific width
    dilation_px = DILATION_WIDTHS.get(label, 6)
    if dilation_px > 0:
        kernel_size = 2 * dilation_px + 1
        kernel = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
        )
        mask = cv2.dilate(mask, kernel, iterations=1)

    return mask


def image_polylines_to_masks(
    polylines: List[Dict],
    height: int,
    width: int,
    return_instance_ids: bool = False,
    return_polylines: bool = False,
) -> Tuple[np.ndarray, ...]:
    """Convert all polylines for one image to instance masks.

    Args:
        polylines: List of {"label": str, "class_id": int, "points": np.ndarray,
                            "instance_id": int (optional)}.
        height: Image height.
        width: Image width.
        return_instance_ids: Append a (N,) int64 array of instance_ids (unknown=-1).
        return_polylines: Append a list of (K_i, 2) float32 arrays of polyline points.

    Returns:
        masks: (N, H, W) uint8 binary masks.
        labels: (N,) int64 class IDs.
        boxes: (N, 4) float32 bounding boxes [x1, y1, x2, y2].
        instance_ids (optional): (N,) int64 — -1 when missing on input.
        polyline_points (optional): list[(K_i, 2) float32].
    """
    empty = (
        np.zeros((0, height, width), dtype=np.uint8),
        np.zeros((0,), dtype=np.int64),
        np.zeros((0, 4), dtype=np.float32),
    )
    extras = []
    if return_instance_ids:
        extras.append(np.zeros((0,), dtype=np.int64))
    if return_polylines:
        extras.append([])

    if not polylines:
        return (*empty, *extras) if extras else empty

    masks = []
    labels = []
    boxes = []
    instance_ids = []
    polyline_points = []

    for pl in polylines:
        mask = polyline_to_mask(pl["points"], height, width, pl["label"])
        if mask.sum() == 0:
            continue

        ys, xs = np.where(mask > 0)
        x1, y1 = float(xs.min()), float(ys.min())
        x2, y2 = float(xs.max()), float(ys.max())

        masks.append(mask)
        labels.append(pl["class_id"])
        boxes.append([x1, y1, x2, y2])
        instance_ids.append(int(pl.get("instance_id", -1)))
        polyline_points.append(np.asarray(pl["points"], dtype=np.float32).reshape(-1, 2))

    if not masks:
        return (*empty, *extras) if extras else empty

    result = (
        np.stack(masks).astype(np.uint8),
        np.array(labels, dtype=np.int64),
        np.array(boxes, dtype=np.float32),
    )
    if return_instance_ids:
        result = (*result, np.array(instance_ids, dtype=np.int64))
    if return_polylines:
        result = (*result, polyline_points)
    return result
