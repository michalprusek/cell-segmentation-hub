"""PyTorch Dataset for DINOv2 + Mask2Former training."""

import random
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch
from torch.utils.data import Dataset

from sperm_final.config import DataConfig
from sperm_final.data.cvat_parser import parse_cvat_xml
from sperm_final.data.polyline_to_mask import image_polylines_to_masks
from sperm_final.data.patch_extractor import extract_patches_for_image

# ImageNet normalization (DINOv2 expects this)
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]


class SpermPatchDataset(Dataset):
    """Dataset that loads images, generates masks from polylines, extracts patches.

    Pre-computes all patches at init time for deterministic indexing.
    """

    def __init__(
        self,
        images_info: List[Dict],
        images_dir: str,
        patch_size: int = 512,
        patch_overlap: int = 128,
        hard_negative_fraction: float = 0.1,
        transforms: Optional[Callable] = None,
        seed: int = 42,
        include_instance_ids: bool = False,
        include_polylines: bool = False,
    ):
        self.images_dir = Path(images_dir)
        self.transforms = transforms
        self.patch_size = patch_size
        self.include_instance_ids = include_instance_ids
        self.include_polylines = include_polylines

        rng = random.Random(seed)

        # Pre-compute all patches
        self.patches: List[Dict] = []
        self.image_indices: List[int] = []  # track which image each patch came from

        for img_idx, info in enumerate(images_info):
            img_path = self._find_image(info["file_name"])
            if img_path is None:
                continue

            img = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
            if img is None:
                continue
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            h, w = img.shape[:2]

            extras = {}
            out = image_polylines_to_masks(
                info["polylines"], h, w,
                return_instance_ids=include_instance_ids,
                return_polylines=include_polylines,
            )
            masks, labels, boxes = out[0], out[1], out[2]
            rest = list(out[3:])
            if include_instance_ids:
                extras["instance_ids"] = rest.pop(0)
            if include_polylines:
                extras["polyline_points"] = rest.pop(0)

            img_patches = extract_patches_for_image(
                img, masks, labels, boxes,
                patch_size=patch_size,
                overlap=patch_overlap,
                hard_negative_fraction=hard_negative_fraction,
                rng=rng,
                instance_ids=extras.get("instance_ids"),
                polyline_points=extras.get("polyline_points"),
            )

            for p in img_patches:
                self.patches.append(p)
                self.image_indices.append(img_idx)

    def _find_image(self, file_name: str) -> Optional[Path]:
        """Try to locate image file (handles nested paths in CVAT names)."""
        # Direct name match
        name = Path(file_name).name
        candidate = self.images_dir / name
        if candidate.exists():
            return candidate
        # Try with full relative path
        candidate = self.images_dir / file_name
        if candidate.exists():
            return candidate
        # Try parent directory
        candidate = self.images_dir.parent / file_name
        if candidate.exists():
            return candidate
        return None

    def __len__(self) -> int:
        return len(self.patches)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        patch = self.patches[idx]

        # Convert grayscale to RGB by repeating channels
        img = patch["image"]
        if img.ndim == 2:
            img = np.stack([img, img, img], axis=2)
        elif img.shape[2] == 1:
            img = np.repeat(img, 3, axis=2)

        # To tensor and normalize
        img_tensor = torch.from_numpy(img).permute(2, 0, 1).float() / 255.0
        img_tensor = _normalize_imagenet(img_tensor)

        target = {
            "masks": torch.as_tensor(patch["masks"], dtype=torch.uint8),
            "labels": torch.as_tensor(patch["labels"], dtype=torch.int64),
            "boxes": torch.as_tensor(patch["boxes"], dtype=torch.float32),
        }
        if "instance_ids" in patch:
            target["instance_ids"] = torch.as_tensor(patch["instance_ids"], dtype=torch.int64)
        if "polyline_points" in patch:
            # List of variable-length tensors (kept as list — collate leaves as-is)
            target["polyline_points"] = [torch.as_tensor(p, dtype=torch.float32)
                                          for p in patch["polyline_points"]]

        if self.transforms is not None:
            # Denormalize for augmentation, then re-normalize
            img_tensor = _denormalize_imagenet(img_tensor)
            img_tensor, target = self.transforms(img_tensor, target)
            img_tensor = _normalize_imagenet(img_tensor)

        return img_tensor, target


class SpermFullImageDataset(Dataset):
    """Dataset that returns full images (for validation / inference)."""

    def __init__(
        self,
        images_info: List[Dict],
        images_dir: str,
    ):
        self.images_dir = Path(images_dir)
        self.images_info = []

        for info in images_info:
            img_path = self._find_image(info["file_name"])
            if img_path is not None:
                self.images_info.append({**info, "_resolved_path": str(img_path)})

    def _find_image(self, file_name: str) -> Optional[Path]:
        name = Path(file_name).name
        candidate = self.images_dir / name
        if candidate.exists():
            return candidate
        candidate = self.images_dir / file_name
        if candidate.exists():
            return candidate
        candidate = self.images_dir.parent / file_name
        if candidate.exists():
            return candidate
        return None

    def __len__(self) -> int:
        return len(self.images_info)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, Dict]:
        info = self.images_info[idx]
        img = cv2.imread(info["_resolved_path"], cv2.IMREAD_COLOR)
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        h, w = img.shape[:2]

        # Grayscale → RGB
        if img.ndim == 2:
            img = np.stack([img, img, img], axis=2)

        img_tensor = torch.from_numpy(img).permute(2, 0, 1).float() / 255.0
        img_tensor = _normalize_imagenet(img_tensor)

        masks, labels, boxes = image_polylines_to_masks(
            info["polylines"], h, w
        )

        target = {
            "masks": torch.as_tensor(masks, dtype=torch.uint8),
            "labels": torch.as_tensor(labels, dtype=torch.int64),
            "boxes": torch.as_tensor(boxes, dtype=torch.float32),
            "image_info": info,
        }

        return img_tensor, target


class PseudoLabeledPatchDataset(Dataset):
    """Patch dataset that consumes .npz pseudo-labels produced by generate_pseudo_labels.py.

    Expected .npz schema (see generate_pseudo_labels.py:190-199):
        masks:  (N, H, W) uint8 binary masks
        labels: (N,) int64 class IDs [1,2,3]
        scores: (N,) float32 confidence
        image_name: str  image_h, image_w: int

    Matches SpermPatchDataset output format: (image_tensor, {masks, labels, boxes}).
    """

    def __init__(
        self,
        images_dirs: List[str],
        pseudo_labels_dir: str,
        patch_size: int = 512,
        patch_overlap: int = 128,
        hard_negative_fraction: float = 0.0,  # pseudo already filtered; don't add empties
        transforms: Optional[Callable] = None,
        seed: int = 42,
    ):
        self.transforms = transforms
        self.patch_size = patch_size

        rng = random.Random(seed)

        # Build stem -> image_path map across all images_dirs
        stem_to_image = {}
        for d in images_dirs:
            root = Path(d)
            for ext in ("*.jpg", "*.jpeg", "*.png", "*.tif", "*.tiff"):
                for ip in root.rglob(ext):
                    stem_to_image.setdefault(ip.stem, ip)

        pseudo_root = Path(pseudo_labels_dir)
        npz_files = sorted(pseudo_root.glob("*.npz"))

        self.patches: List[Dict] = []
        for npz_path in npz_files:
            img_path = stem_to_image.get(npz_path.stem)
            if img_path is None:
                continue
            data = np.load(npz_path, allow_pickle=True)
            masks = data["masks"]
            labels = data["labels"]
            if masks.size == 0 or labels.size == 0:
                continue
            if masks.ndim != 3:
                continue

            img = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
            if img is None:
                continue
            img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            ih, iw = img.shape[:2]

            # Resize masks to current image size if shapes disagree (pseudolabels may
            # have been generated on a downscaled copy)
            _, mh, mw = masks.shape
            if (mh, mw) != (ih, iw):
                resized = np.zeros((len(masks), ih, iw), dtype=np.uint8)
                for i in range(len(masks)):
                    resized[i] = cv2.resize(
                        masks[i], (iw, ih), interpolation=cv2.INTER_NEAREST
                    )
                masks = resized

            # Compute boxes from masks
            boxes = np.zeros((len(masks), 4), dtype=np.float32)
            keep = []
            for i in range(len(masks)):
                ys, xs = np.where(masks[i] > 0)
                if len(ys) == 0:
                    continue
                boxes[i] = [float(xs.min()), float(ys.min()),
                            float(xs.max()), float(ys.max())]
                keep.append(i)
            if not keep:
                continue
            masks = masks[keep]
            labels = labels[keep].astype(np.int64)
            boxes = boxes[keep]

            img_patches = extract_patches_for_image(
                img, masks, labels, boxes,
                patch_size=patch_size,
                overlap=patch_overlap,
                hard_negative_fraction=hard_negative_fraction,
                rng=rng,
            )
            self.patches.extend(img_patches)

    def __len__(self) -> int:
        return len(self.patches)

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, Dict[str, torch.Tensor]]:
        patch = self.patches[idx]
        img = patch["image"]
        if img.ndim == 2:
            img = np.stack([img, img, img], axis=2)
        elif img.shape[2] == 1:
            img = np.repeat(img, 3, axis=2)

        img_tensor = torch.from_numpy(img).permute(2, 0, 1).float() / 255.0
        img_tensor = _normalize_imagenet(img_tensor)

        target = {
            "masks": torch.as_tensor(patch["masks"], dtype=torch.uint8),
            "labels": torch.as_tensor(patch["labels"], dtype=torch.int64),
            "boxes": torch.as_tensor(patch["boxes"], dtype=torch.float32),
        }

        if self.transforms is not None:
            img_tensor = _denormalize_imagenet(img_tensor)
            img_tensor, target = self.transforms(img_tensor, target)
            img_tensor = _normalize_imagenet(img_tensor)

        return img_tensor, target


def collate_fn(batch):
    """Custom collate: images batched, targets as list of dicts."""
    images = torch.stack([b[0] for b in batch])
    targets = [b[1] for b in batch]
    return images, targets


def _normalize_imagenet(tensor: torch.Tensor) -> torch.Tensor:
    """Normalize with ImageNet stats. Input: (C, H, W) in [0, 1]."""
    mean = torch.tensor(IMAGENET_MEAN, dtype=tensor.dtype, device=tensor.device).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD, dtype=tensor.dtype, device=tensor.device).view(3, 1, 1)
    return (tensor - mean) / std


def _denormalize_imagenet(tensor: torch.Tensor) -> torch.Tensor:
    """Reverse ImageNet normalization. Output: (C, H, W) in [0, 1]."""
    mean = torch.tensor(IMAGENET_MEAN, dtype=tensor.dtype, device=tensor.device).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD, dtype=tensor.dtype, device=tensor.device).view(3, 1, 1)
    return tensor * std + mean
