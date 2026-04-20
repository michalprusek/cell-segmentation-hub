"""Instance-level evaluation for unified COCO datasets.

Adds metrics beyond per-class IoU (which `evaluate.py` covers):
  - Per-sperm F1 at IoU=0.5 — does the model localize each sperm instance?
  - Per-sperm completeness — fraction of GT sperm where all 3 parts
    (Head/Midpiece/Tail) are matched.
  - Per-class Chamfer distance — predicted polyline vs GT polyline for each
    matched part (normalized by image diagonal).

GT grouping uses `instance_id` from the unified COCO (globally unique across
images). Predictions are grouped via `assemble_sperm_graph` (same final
pipeline as v8 inference), producing {"head","midpiece","tail"} dicts.

Usage:
  python -m training.evaluate_instance \
    --checkpoint outputs_dinov3_v11/best_model_train.pth \
    --coco /disk1/prusek/spermie/datasets/spermie_unified/annotations.json \
    --images-dir /disk1/prusek/spermie/datasets/spermie_unified/images \
    --split test
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np
import torch

from sperm_final.config import ID_TO_CLASS, InferenceConfig, ModelConfig, NUM_CLASSES
from sperm_final.data.coco_loader import load_coco_dataset
from sperm_final.data.polyline_to_mask import polyline_to_mask
from sperm_final.inference.graph_assembly import assemble_sperm_graph
from sperm_final.inference.postprocess import mask_to_polyline
from sperm_final.inference.predict import predict_full_image_for_graph
from sperm_final.models.mask2former import Mask2FormerModel


def load_checkpoint(ckpt_path: str, device: torch.device) -> Mask2FormerModel:
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    model_cfg = ModelConfig(**ckpt["config"]["model"]) if "config" in ckpt else ModelConfig()
    model = Mask2FormerModel(model_cfg)
    state = ckpt["model_state_dict"] if "model_state_dict" in ckpt else ckpt
    model.load_state_dict(state)
    model.to(device).eval()
    return model


def build_gt_sperm_per_image(images_info: List[Dict], img_shapes: Dict[str, Tuple[int, int]]):
    """Return {file_name: [sperm_dict, ...]} where sperm_dict = {cls_name: mask, 'polyline': dict}."""
    out = {}
    for im in images_info:
        fname = Path(im["file_name"]).name
        H, W = img_shapes.get(fname, (im["height"], im["width"]))
        sperms = defaultdict(lambda: {"polylines": {}, "masks": {}})
        for pl in im["polylines"]:
            iid = pl.get("instance_id", -1)
            if iid < 0:
                continue
            cls = pl["label"]
            sperms[iid]["polylines"][cls] = pl["points"]
            sperms[iid]["masks"][cls] = polyline_to_mask(pl["points"], H, W, cls)
        out[fname] = list(sperms.values())
    return out


def mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    inter = float(np.logical_and(a, b).sum())
    union = float(np.logical_or(a, b).sum())
    return inter / union if union > 0 else 0.0


def chamfer_polyline(a: np.ndarray, b: np.ndarray, diag: float) -> float:
    """Symmetric Chamfer distance between 2 polylines (K,2) and (K',2), normalized."""
    if a.size == 0 or b.size == 0:
        return 1.0
    d2 = ((a[:, None, :] - b[None, :, :]) ** 2).sum(-1)
    return float((np.sqrt(d2.min(axis=1)).mean() + np.sqrt(d2.min(axis=0)).mean()) / (2 * diag))


def match_sperm(pred_list, gt_list, iou_thr: float = 0.5):
    """Bipartite match predicted sperm to GT sperm by mean-IoU across shared parts."""
    if not pred_list or not gt_list:
        return [], list(range(len(pred_list))), list(range(len(gt_list)))
    cost = np.full((len(pred_list), len(gt_list)), 1.0)
    cls_map = {"head": "Head", "midpiece": "Midpiece", "tail": "Tail"}
    for i, p in enumerate(pred_list):
        for j, g in enumerate(gt_list):
            shared = 0
            total_iou = 0.0
            for pcls, gcls in cls_map.items():
                pm = p.get(pcls)
                gm = g["masks"].get(gcls)
                if pm is None or gm is None:
                    continue
                pm_bin = (pm["mask"] > 0.5).astype(np.uint8) if isinstance(pm, dict) else pm
                total_iou += mask_iou(pm_bin, gm)
                shared += 1
            if shared > 0:
                cost[i, j] = 1.0 - total_iou / shared
    # Hungarian
    from scipy.optimize import linear_sum_assignment
    r, c = linear_sum_assignment(cost)
    matches = []
    used_p = set()
    used_g = set()
    for ri, ci in zip(r, c):
        if cost[ri, ci] < 1.0 - iou_thr:
            matches.append((ri, ci))
            used_p.add(ri)
            used_g.add(ci)
    unm_p = [i for i in range(len(pred_list)) if i not in used_p]
    unm_g = [j for j in range(len(gt_list)) if j not in used_g]
    return matches, unm_p, unm_g


def evaluate_instance_level(
    model, images_info: List[Dict], device: torch.device,
    inf_cfg: InferenceConfig, iou_thr: float = 0.5,
    edge_cost_mlp=None, graph_cfg=None, use_hr: bool = False,
) -> Dict:
    # Cache image shapes by loading each image once
    img_shapes = {}
    for im in images_info:
        fname = Path(im["file_name"]).name
        path = Path(im["_images_dir"]) / fname
        if path.exists():
            arr = cv2.imread(str(path))
            if arr is not None:
                img_shapes[fname] = arr.shape[:2]

    gt_by_img = build_gt_sperm_per_image(images_info, img_shapes)

    agg = {"tp": 0, "fp": 0, "fn": 0, "per_class_iou": defaultdict(list),
           "per_class_chamfer": defaultdict(list), "completeness": []}

    for im in images_info:
        fname = Path(im["file_name"]).name
        path = Path(im["_images_dir"]) / fname
        if not path.exists():
            continue
        img_bgr = cv2.imread(str(path))
        if img_bgr is None:
            continue
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        H, W = img_rgb.shape[:2]
        diag = float(np.hypot(H, W))

        # Predict -> raw instances -> graph assembly -> list of sperm dicts
        if edge_cost_mlp is not None:
            # Need embeddings; use the train_edge_cost prediction helper
            from sperm_final.train_edge_cost import _predict_with_embeddings
            raw_instances = _predict_with_embeddings(
                model, img_rgb, device,
                patch_size=inf_cfg.patch_size, overlap=inf_cfg.patch_overlap,
                score_threshold=inf_cfg.score_threshold,
                mask_threshold=inf_cfg.mask_threshold,
                min_mask_area=inf_cfg.min_mask_area,
            )
        else:
            # predict_full_image_for_graph expects a normalized image TENSOR
            img_tensor = torch.from_numpy(img_rgb).permute(2, 0, 1).float() / 255.0
            from sperm_final.data.dataset import IMAGENET_MEAN, IMAGENET_STD
            mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
            std = torch.tensor(IMAGENET_STD).view(3, 1, 1)
            img_tensor = (img_tensor - mean) / std
            raw_instances = predict_full_image_for_graph(
                model, img_tensor, device,
                patch_size=inf_cfg.patch_size, overlap=inf_cfg.patch_overlap,
                score_threshold=inf_cfg.score_threshold,
                mask_threshold=inf_cfg.mask_threshold,
                use_hr=use_hr,
            )
        pred_sperm = assemble_sperm_graph(
            raw_instances, mask_threshold=inf_cfg.mask_threshold,
            config=graph_cfg, edge_cost_mlp=edge_cost_mlp, image_diag=diag,
        )

        gt_sperm = gt_by_img.get(fname, [])
        matches, unm_p, unm_g = match_sperm(pred_sperm, gt_sperm, iou_thr=iou_thr)

        agg["tp"] += len(matches)
        agg["fp"] += len(unm_p)
        agg["fn"] += len(unm_g)

        for pi, gi in matches:
            p = pred_sperm[pi]
            g = gt_sperm[gi]
            cls_map = {"head": "Head", "midpiece": "Midpiece", "tail": "Tail"}
            for pcls, gcls in cls_map.items():
                if pcls in p and gcls in g["masks"]:
                    pm = p[pcls]
                    pm_bin = (pm["mask"] > 0.5).astype(np.uint8) if isinstance(pm, dict) else pm
                    agg["per_class_iou"][gcls].append(mask_iou(pm_bin, g["masks"][gcls]))
                    # Polyline Chamfer
                    try:
                        pred_poly = np.array(mask_to_polyline(
                            pm["mask"] if isinstance(pm, dict) else pm.astype(np.float32),
                            class_id={"Head": 1, "Midpiece": 2, "Tail": 3}[gcls],
                            mask_threshold=inf_cfg.mask_threshold,
                        ), dtype=np.float32).reshape(-1, 2)
                        gt_poly = np.asarray(g["polylines"][gcls], dtype=np.float32).reshape(-1, 2)
                        agg["per_class_chamfer"][gcls].append(chamfer_polyline(pred_poly, gt_poly, diag))
                    except Exception:
                        pass
            completeness = sum(1 for pcls, gcls in cls_map.items()
                               if pcls in p and gcls in g["masks"]) / 3.0
            agg["completeness"].append(completeness)

    # Reduce
    eps = 1e-6
    tp, fp, fn = agg["tp"], agg["fp"], agg["fn"]
    prec = tp / (tp + fp + eps)
    rec = tp / (tp + fn + eps)
    f1 = 2 * prec * rec / (prec + rec + eps)
    metrics = {
        "instance_precision": prec,
        "instance_recall": rec,
        "instance_f1": f1,
        "mean_completeness": float(np.mean(agg["completeness"])) if agg["completeness"] else 0.0,
    }
    for cls_name, vals in agg["per_class_iou"].items():
        metrics[f"iou_{cls_name}"] = float(np.mean(vals)) if vals else 0.0
    for cls_name, vals in agg["per_class_chamfer"].items():
        metrics[f"chamfer_{cls_name}"] = float(np.mean(vals)) if vals else 0.0
    return metrics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--coco", required=True)
    ap.add_argument("--images-dir", required=True)
    ap.add_argument("--split", choices=["val", "test", "all"], default="test")
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--patch-size", type=int, default=1024, help="Inference patch size (must be divisible by backbone patch_size)")
    ap.add_argument("--overlap", type=int, default=200)
    ap.add_argument("--edge-cost-mlp", default=None,
                    help="Path to trained EdgeCostMLP checkpoint (enables learned MCMF costs)")
    ap.add_argument("--hybrid-weight", type=float, default=1.0,
                    help="0=hand-tuned only, 1=learned only, 0.5=blend (applies when --edge-cost-mlp given)")
    ap.add_argument("--use-hr", action="store_true",
                    help="Use v14 native-res dyn_mask_head output for masks instead of upsampled 256²")
    # Tunable inference thresholds (override InferenceConfig defaults)
    ap.add_argument("--score-threshold", type=float, default=None)
    ap.add_argument("--mask-threshold", type=float, default=None)
    ap.add_argument("--min-mask-area", type=int, default=None)
    ap.add_argument("--max-connection-dist", type=float, default=None,
                    help="Override GraphAssemblyConfig.max_connection_dist")
    args = ap.parse_args()

    device = torch.device(args.device)
    model = load_checkpoint(args.checkpoint, device)

    info = load_coco_dataset(args.coco, args.images_dir)
    # Filter to split matching train.py's grouped split (seed=42, 80/10/10)
    if args.split != "all":
        from sperm_final.train import make_grouped_split
        info_with_ann = [im for im in info if im["polylines"]]
        train_imgs, val_imgs, test_imgs = make_grouped_split(
            info_with_ann, train_frac=0.8, val_frac=0.1, seed=42,
        )
        chosen = {"val": val_imgs, "test": test_imgs, "train": train_imgs}[args.split]
        info = chosen
        print(f"Split='{args.split}' -> {len(info)} images")

    inf_cfg = InferenceConfig()
    inf_cfg.patch_size = args.patch_size
    inf_cfg.patch_overlap = args.overlap
    if args.score_threshold is not None:
        inf_cfg.score_threshold = args.score_threshold
    if args.mask_threshold is not None:
        inf_cfg.mask_threshold = args.mask_threshold
    if args.min_mask_area is not None:
        inf_cfg.min_mask_area = args.min_mask_area

    edge_mlp = None
    graph_cfg = None
    if args.edge_cost_mlp:
        from sperm_final.models.edge_cost_mlp import EdgeCostMLP, EdgeCostBilinear
        from sperm_final.config import GraphAssemblyConfig
        ckpt = torch.load(args.edge_cost_mlp, map_location=device, weights_only=False)
        arch = ckpt.get("arch", "mlp")
        cls = EdgeCostMLP if arch == "mlp" else EdgeCostBilinear
        edge_mlp = cls(embed_dim=ckpt["embed_dim"],
                        geom_dim=ckpt.get("geom_dim", 10) if arch == "mlp" else None)
        if arch == "bilinear":
            edge_mlp = EdgeCostBilinear(embed_dim=ckpt["embed_dim"])
        edge_mlp.load_state_dict(ckpt["model_state_dict"])
        edge_mlp.to(device).eval()
        graph_cfg = GraphAssemblyConfig(use_learned_costs=True,
                                         hybrid_weight=args.hybrid_weight)
        if args.max_connection_dist is not None:
            graph_cfg.max_connection_dist = args.max_connection_dist
        print(f"Loaded EdgeCostMLP ({arch}, val F1={ckpt.get('val_f1', 'N/A'):.4f}) "
              f"with hybrid_weight={args.hybrid_weight}")

    metrics = evaluate_instance_level(
        model, info, device, inf_cfg,
        edge_cost_mlp=edge_mlp, graph_cfg=graph_cfg,
        use_hr=args.use_hr,
    )
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
