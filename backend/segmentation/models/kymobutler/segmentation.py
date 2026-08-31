"""Neural-network segmentation pipeline.

Vendored from upstream ``src/kymobutler/segmentation.py`` (corresponds to
``UniKymoButlerSegment`` / ``BiKymoButlerSegment`` in ``KymoButler.wl``). The
only change is the input: upstream took a path and called
``load_and_preprocess``; these take the already-preprocessed array, so the
caller preprocesses ONCE and reuses it for both the net and the tracker (which
also needs it, as ``kym_preprocessed``).
"""

from __future__ import annotations

import numpy as np
import torch
from skimage.transform import resize

from .preprocessing import resize_to_multiple_of_16


def segment_bidirectional(
    preprocessed: np.ndarray,
    net: torch.nn.Module,
    device: str = "cpu",
) -> np.ndarray:
    """Run the bidirectional trackness U-Net.

    Returns:
        ``(F, X)`` float32 foreground-probability map, resized back to the
        preprocessed image's own dimensions.
    """
    original_dims = preprocessed.shape
    resized = resize_to_multiple_of_16(preprocessed)

    tensor = torch.from_numpy(resized).unsqueeze(0).unsqueeze(0).float().to(device)
    net.eval()
    with torch.no_grad():
        pred = net(tensor)  # (1, 2, H, W)

    pred_map = pred[0, 0].cpu().numpy()
    if pred_map.shape != original_dims:
        pred_map = resize(
            pred_map, original_dims, anti_aliasing=True, preserve_range=True
        )
    return pred_map.astype(np.float32)


def segment_unidirectional(
    preprocessed: np.ndarray,
    net: torch.nn.Module,
    device: str = "cpu",
) -> dict[str, np.ndarray]:
    """Run the two-headed unidirectional trackness U-Net.

    Returns:
        ``{"ant": (F, X) float32, "ret": (F, X) float32}`` probability maps,
        resized back to the preprocessed image's own dimensions.
    """
    original_dims = preprocessed.shape
    resized = resize_to_multiple_of_16(preprocessed)

    tensor = torch.from_numpy(resized).unsqueeze(0).unsqueeze(0).float().to(device)
    net.eval()
    with torch.no_grad():
        pred = net(tensor)  # {"ant": (1, 2, H, W), "ret": (1, 2, H, W)}

    pred_dict: dict[str, np.ndarray] = {}
    for key in ("ant", "ret"):
        p = pred[key][0, 0].cpu().numpy()
        if p.shape != original_dims:
            p = resize(p, original_dims, anti_aliasing=True, preserve_range=True)
        pred_dict[key] = p.astype(np.float32)
    return pred_dict
