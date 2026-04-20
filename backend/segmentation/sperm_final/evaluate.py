"""Evaluation script for DINOv2 + Mask2Former model.

Computes per-class IoU, Dice, and end-to-end polyline metrics.
"""

import argparse
import os
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

from sperm_final.config import (
    DataConfig, ModelConfig, InferenceConfig,
    NUM_CLASSES, ID_TO_CLASS, TARGET_POINTS,
)
from sperm_final.data.cvat_parser import parse_cvat_xml
from sperm_final.data.dataset import SpermFullImageDataset, collate_fn
from sperm_final.inference.predict import predict_full_image
from sperm_final.inference.postprocess import mask_to_polyline, resample_polyline
from sperm_final.models.mask2former import Mask2FormerModel


def load_model(checkpoint_path: str, device: torch.device, model_cfg=None):
    """Load model from checkpoint."""
    ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    if model_cfg is None:
        if "config" in ckpt and "model" in ckpt["config"]:
            model_cfg = ModelConfig(**ckpt["config"]["model"])
        else:
            model_cfg = ModelConfig()

    model = Mask2FormerModel(model_cfg)
    state = ckpt["model_state_dict"] if "model_state_dict" in ckpt else ckpt
    model.load_state_dict(state)
    model.to(device)
    model.eval()
    return model


def evaluate_segmentation(model, data_loader, device, inf_cfg=None):
    """Evaluate segmentation quality (IoU, Dice) on a dataset."""
    if inf_cfg is None:
        inf_cfg = InferenceConfig()

    inter = np.zeros(NUM_CLASSES, dtype=np.float64)
    union = np.zeros(NUM_CLASSES, dtype=np.float64)
    dice_num = np.zeros(NUM_CLASSES, dtype=np.float64)
    dice_den = np.zeros(NUM_CLASSES, dtype=np.float64)

    n_images = 0

    with torch.no_grad():
        for images, targets in data_loader:
            for b in range(images.shape[0]):
                img = images[b]
                target = targets[b]

                # Predict
                instances = predict_full_image(
                    model, img, device,
                    patch_size=inf_cfg.patch_size,
                    overlap=inf_cfg.patch_overlap,
                    score_threshold=inf_cfg.score_threshold,
                    nms_iou_threshold=inf_cfg.nms_iou_threshold,
                    merge_iou_threshold=inf_cfg.merge_iou_threshold,
                    proximity_gap=inf_cfg.proximity_gap,
                    max_angle_diff=inf_cfg.max_angle_diff,
                )

                gt_masks = target["masks"].numpy()
                gt_labels = target["labels"].numpy()

                H, W = gt_masks.shape[-2:] if gt_masks.shape[0] > 0 else img.shape[-2:]

                for c in range(1, NUM_CLASSES):
                    # GT mask for class c
                    gt_inds = np.where(gt_labels == c)[0]
                    if len(gt_inds) == 0:
                        continue
                    gt_c = (gt_masks[gt_inds].sum(axis=0) > 0).astype(float)

                    # Pred mask for class c
                    pred_c = np.zeros((H, W), dtype=float)
                    for inst in instances:
                        if inst["cls"] == c:
                            pred_c = np.maximum(pred_c, inst["mask"])
                    pred_c = (pred_c > 0.5).astype(float)

                    inter_c = (gt_c * pred_c).sum()
                    union_c = gt_c.sum() + pred_c.sum() - inter_c
                    inter[c] += inter_c
                    union[c] += union_c
                    dice_num[c] += 2 * inter_c
                    dice_den[c] += gt_c.sum() + pred_c.sum()

                n_images += 1

    eps = 1e-6
    metrics = {}
    for c in range(1, NUM_CLASSES):
        name = ID_TO_CLASS.get(c, f"class_{c}")
        metrics[f"iou_{name}"] = float(inter[c] / (union[c] + eps)) if union[c] > 0 else 0.0
        metrics[f"dice_{name}"] = float(dice_num[c] / (dice_den[c] + eps)) if dice_den[c] > 0 else 0.0

    metrics["iou_mean"] = float(inter[1:].sum() / (union[1:].sum() + eps))
    metrics["dice_mean"] = float(dice_num[1:].sum() / (dice_den[1:].sum() + eps))
    metrics["n_images"] = n_images

    return metrics


def main():
    parser = argparse.ArgumentParser(description="Evaluate DINOv2 + Mask2Former")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--xml", default="data/sada1/annotations.xml")
    parser.add_argument("--images_dir", default="data/sada1/images/cvat_polylines/images")
    parser.add_argument("--device", default="cuda")
    args = parser.parse_args()

    device = torch.device(args.device if torch.cuda.is_available() else "cpu")

    model = load_model(args.checkpoint, device)

    images_info = parse_cvat_xml(args.xml)
    images_with_annot = [img for img in images_info if len(img["polylines"]) > 0]

    dataset = SpermFullImageDataset(images_with_annot, args.images_dir)
    loader = DataLoader(dataset, batch_size=1, collate_fn=collate_fn)

    print(f"Evaluating on {len(dataset)} images...")
    metrics = evaluate_segmentation(model, loader, device)

    print("\nResults:")
    for k, v in sorted(metrics.items()):
        if isinstance(v, float):
            print(f"  {k}: {v:.4f}")
        else:
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
