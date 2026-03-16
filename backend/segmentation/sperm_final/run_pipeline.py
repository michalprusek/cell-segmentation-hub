"""Complete sperm segmentation pipeline: image → masks → graph assembly → connected polylines.

Usage:
    CUDA_VISIBLE_DEVICES=1 python -m sperm_final.run_pipeline \
        --ckpt outputs_dinov3_v8/best_model_train.pth \
        --image data/sada1/images/cvat_polylines/images/images_CMR22B_130_1.jpg \
        --output_dir sperm_final_output \
        --device cuda:0

    # Or batch mode on a directory:
    CUDA_VISIBLE_DEVICES=1 python -m sperm_final.run_pipeline \
        --ckpt outputs_dinov3_v8/best_model_train.pth \
        --images_dir data/sada1/images/cvat_polylines/images \
        --output_dir sperm_final_output \
        --max_images 10 \
        --device cuda:0
"""

import argparse
from pathlib import Path

import cv2
import numpy as np
import torch

from sperm_final.config import ModelConfig, GraphAssemblyConfig, ID_TO_CLASS
from sperm_final.data.dataset import IMAGENET_MEAN, IMAGENET_STD
from sperm_final.models.mask2former import Mask2FormerModel
from sperm_final.inference.predict import predict_full_image_for_graph
from sperm_final.inference.graph_assembly import assemble_sperm_graph
from sperm_final.inference.postprocess import connect_sperm_polylines


# --- Model loading ---

def load_model(ckpt_path: str, device: torch.device) -> Mask2FormerModel:
    """Load Mask2Former from checkpoint."""
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    if "config" in ckpt and "model" in ckpt["config"]:
        model_cfg = ModelConfig(**ckpt["config"]["model"])
    else:
        model_cfg = ModelConfig()
    model = Mask2FormerModel(model_cfg)
    model.load_state_dict(ckpt["model_state_dict"])
    model.to(device).eval()
    return model


def normalize_imagenet(tensor: torch.Tensor) -> torch.Tensor:
    """Apply ImageNet normalization to a (3, H, W) tensor in [0, 1]."""
    mean = torch.tensor(IMAGENET_MEAN, dtype=tensor.dtype, device=tensor.device).view(3, 1, 1)
    std = torch.tensor(IMAGENET_STD, dtype=tensor.dtype, device=tensor.device).view(3, 1, 1)
    return (tensor - mean) / std


# --- Visualization ---

SPERM_COLORS = [
    (255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 0), (255, 0, 255),
    (0, 255, 255), (128, 0, 255), (255, 128, 0), (0, 128, 255), (128, 255, 0),
]
PART_SHADES = {"head": 0.6, "midpiece": 1.0, "tail": 0.4}


def visualize_result(
    img_bgr: np.ndarray,
    sperm_list: list,
    connected_polylines: list,
    mask_threshold: float = 0.3,
    alpha: float = 0.5,
) -> np.ndarray:
    """Draw masks (left) and connected polylines (right) side by side."""
    font = cv2.FONT_HERSHEY_SIMPLEX

    left = img_bgr.copy()
    right = img_bgr.copy()

    for si, (sperm, polys) in enumerate(zip(sperm_list, connected_polylines)):
        base_color = np.array(SPERM_COLORS[si % len(SPERM_COLORS)], dtype=float)

        for pk in ["head", "midpiece", "tail"]:
            shade = PART_SHADES[pk]
            color = np.clip(base_color * shade, 0, 255).astype(np.uint8)
            cl = color.tolist()

            # Left: masks
            part = sperm.get(pk)
            if part is not None:
                binary = (part["mask"] >= mask_threshold).astype(np.uint8)
                if binary.sum() >= 10:
                    left[binary > 0] = (
                        left[binary > 0].astype(float) * (1 - alpha)
                        + color.astype(float) * alpha
                    ).astype(np.uint8)
                    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    cv2.drawContours(left, contours, -1, cl, 2)

            # Right: polylines
            poly = polys[pk]
            if len(poly) >= 2:
                pts = np.array(poly, dtype=np.int32)
                thickness = 4 if pk == "head" else 3 if pk == "midpiece" else 2
                cv2.polylines(right, [pts], False, cl, thickness)
                for pt in pts:
                    cv2.circle(right, tuple(pt), 3, cl, -1)
                cv2.circle(right, tuple(pts[0]), 5, cl, -1)
                cv2.circle(right, tuple(pts[-1]), 5, cl, -1)
                mid_idx = len(pts) // 2
                label = f"S{si+1} {pk} ({len(poly)})"
                cv2.putText(right, label, (pts[mid_idx][0] - 30, pts[mid_idx][1] - 10),
                            font, 0.4, (0, 0, 0), 3, cv2.LINE_AA)
                cv2.putText(right, label, (pts[mid_idx][0] - 30, pts[mid_idx][1] - 10),
                            font, 0.4, (255, 255, 255), 1, cv2.LINE_AA)

    cv2.putText(left, f"Masks ({len(sperm_list)} sperm)", (10, 35),
                font, 1.0, (255, 255, 255), 3)
    cv2.putText(left, f"Masks ({len(sperm_list)} sperm)", (10, 35),
                font, 1.0, (0, 0, 0), 1)
    cv2.putText(right, "Connected polylines", (10, 35),
                font, 1.0, (255, 255, 255), 3)
    cv2.putText(right, "Connected polylines", (10, 35),
                font, 1.0, (0, 0, 0), 1)

    return np.concatenate([left, right], axis=1)


# --- Main pipeline ---

def process_image(
    model,
    img_bgr: np.ndarray,
    device: torch.device,
    mask_threshold: float = 0.3,
    score_threshold: float = 0.95,
) -> tuple:
    """Run full pipeline on one image.

    Returns:
        (sperm_list, connected_polylines_list)
        sperm_list: List of {"head": inst, "midpiece": inst, "tail": inst}
        connected_polylines_list: List of {"head": [...], "midpiece": [...], "tail": [...]}
    """
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    tensor = torch.from_numpy(img_rgb).permute(2, 0, 1).float() / 255.0
    tensor = normalize_imagenet(tensor)

    # Step 1: Instance segmentation
    instances = predict_full_image_for_graph(
        model, tensor, device,
        patch_size=1024, overlap=300,
        score_threshold=score_threshold,
        mask_threshold=mask_threshold,
    )

    # Step 2: Graph assembly (H+M+T grouping)
    config = GraphAssemblyConfig()
    sperm_list = assemble_sperm_graph(instances, mask_threshold, config)

    # Step 3: Connected polylines
    polylines_list = []
    for sperm in sperm_list:
        polys = connect_sperm_polylines(sperm, mask_threshold=mask_threshold)
        polylines_list.append(polys)

    return sperm_list, polylines_list


def main():
    parser = argparse.ArgumentParser(description="Sperm segmentation pipeline")
    parser.add_argument("--ckpt", default="sperm_final/best_model.pth", help="Model checkpoint path")
    parser.add_argument("--image", help="Single image path")
    parser.add_argument("--images_dir", help="Directory of images (batch mode)")
    parser.add_argument("--output_dir", default="sperm_final_output")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--max_images", type=int, default=0, help="0 = all")
    parser.add_argument("--mask_threshold", type=float, default=0.3)
    parser.add_argument("--score_threshold", type=float, default=0.95)
    args = parser.parse_args()

    device = torch.device(args.device if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    print(f"Loading model: {args.ckpt}")
    model = load_model(args.ckpt, device)

    # Collect images
    image_paths = []
    if args.image:
        image_paths = [Path(args.image)]
    elif args.images_dir:
        image_paths = sorted(Path(args.images_dir).glob("*.jpg"))
        if args.max_images > 0:
            image_paths = image_paths[:args.max_images]
    else:
        parser.error("Provide --image or --images_dir")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    for i, img_path in enumerate(image_paths):
        img_bgr = cv2.imread(str(img_path))
        if img_bgr is None:
            print(f"  Skip (cannot read): {img_path}")
            continue
        h, w = img_bgr.shape[:2]
        print(f"[{i+1}/{len(image_paths)}] {img_path.name} ({w}x{h})")

        sperm_list, polylines_list = process_image(
            model, img_bgr, device,
            mask_threshold=args.mask_threshold,
            score_threshold=args.score_threshold,
        )
        print(f"  {len(sperm_list)} sperm detected")

        # Visualize
        viz = visualize_result(img_bgr, sperm_list, polylines_list,
                               mask_threshold=args.mask_threshold)
        out_path = out_dir / f"{img_path.stem}.jpg"
        cv2.imwrite(str(out_path), viz, [cv2.IMWRITE_JPEG_QUALITY, 95])
        print(f"  Saved: {out_path}")

        # Print polyline summary
        for si, polys in enumerate(polylines_list):
            parts_info = []
            for pk in ["head", "midpiece", "tail"]:
                n = len(polys[pk])
                parts_info.append(f"{pk}={n}pts")
            print(f"    S{si+1}: {', '.join(parts_info)}")

    print(f"\nDone! Results in {out_dir}/")


if __name__ == "__main__":
    main()
