"""Load unified COCO annotations into images_info format compatible with SpermPatchDataset.

The unified COCO (`/scratch/prusek/spermie/datasets/spermie_unified/annotations.json`)
has per-annotation `instance_id` (global sperm grouping) plus standard polyline segmentation.
This adapter produces the same images_info structure as `parse_cvat_xml()` so
`SpermPatchDataset` and eval/visualization code can consume it unchanged.

Each image dict gets an extra field `_images_dir` that train.py sets later; we populate it
here so downstream `images_info` is self-contained.
"""

import json
from pathlib import Path
from typing import Dict, List

import numpy as np

from sperm_final.config import CLASS_TO_ID, ID_TO_CLASS


def load_coco_dataset(coco_path: str, images_dir: str) -> List[Dict]:
    """Load COCO-format annotations, return images_info for SpermPatchDataset.

    Args:
        coco_path: Path to annotations.json (unified COCO or pseudolabels COCO).
        images_dir: Directory containing the image files referenced by file_name.

    Returns:
        List of image dicts with:
            file_name: str
            width, height: int
            polylines: [{label, class_id, points (N,2), instance_id, is_junction}]
            _images_dir: str
            _coco_image_id: int (for mapping predictions back)
            source: str (from image entry when present, else "coco")
    """
    with open(coco_path) as f:
        coco = json.load(f)

    anns_by_img: Dict[int, List[Dict]] = {}
    for a in coco["annotations"]:
        anns_by_img.setdefault(a["image_id"], []).append(a)

    images_info = []
    for im in coco["images"]:
        polylines = []
        for a in anns_by_img.get(im["id"], []):
            cat_id = a["category_id"]
            if cat_id < 1 or cat_id > 3:
                # Skip unknown/uncategorised (e.g. -1 sentinels from broken viz)
                continue
            seg = a.get("segmentation", [])
            if not seg or not seg[0]:
                continue
            flat = seg[0]
            if len(flat) < 4:
                continue
            pts = np.array(flat, dtype=np.float32).reshape(-1, 2)
            polylines.append({
                "label": ID_TO_CLASS[cat_id],
                "class_id": cat_id,
                "points": pts,
                "instance_id": a.get("instance_id", -1),
                "is_junction": bool(a.get("is_junction", False)),
            })

        images_info.append({
            "file_name": im["file_name"],
            "width": int(im["width"]),
            "height": int(im["height"]),
            "polylines": polylines,
            "_images_dir": images_dir,
            "_coco_image_id": im["id"],
            "source": im.get("source", "coco"),
        })

    return images_info


def get_coco_stats(images_info: List[Dict]) -> Dict:
    """Summary counters matching parse_cvat_xml / get_annotation_stats output."""
    total = len(images_info)
    with_annot = sum(1 for im in images_info if im["polylines"])
    counts = {"Head": 0, "Midpiece": 0, "Tail": 0}
    instances = set()
    for im in images_info:
        for pl in im["polylines"]:
            counts[pl["label"]] = counts.get(pl["label"], 0) + 1
            iid = pl.get("instance_id", -1)
            if iid >= 0:
                instances.add(iid)
    return {
        "total_images": total,
        "images_with_annotations": with_annot,
        "head_count": counts["Head"],
        "midpiece_count": counts["Midpiece"],
        "tail_count": counts["Tail"],
        "total_polylines": sum(counts.values()),
        "unique_instances": len(instances),
    }
