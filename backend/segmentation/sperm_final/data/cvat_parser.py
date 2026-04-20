"""Parse CVAT XML polyline annotations for sperm morphology."""

import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np

from sperm_final.config import CLASS_TO_ID, LABEL_ALIASES


def parse_cvat_xml(xml_path: str) -> List[Dict]:
    """Parse CVAT XML with polyline annotations.

    Returns list of dicts, one per image:
        {
            "file_name": str,
            "width": int,
            "height": int,
            "polylines": [{"label": str, "class_id": int, "points": np.ndarray (N,2)}]
        }
    """
    tree = ET.parse(xml_path)
    root = tree.getroot()

    images = []
    for img_el in root.findall("image"):
        img_name = img_el.get("name")
        width = int(float(img_el.get("width")))
        height = int(float(img_el.get("height")))

        polylines = []
        for pl_el in img_el.findall("polyline"):
            raw_label = pl_el.get("label")
            # Map aliases (HeadJ -> Head, etc.)
            label = LABEL_ALIASES.get(raw_label, raw_label)
            if label not in CLASS_TO_ID:
                continue

            points_str = pl_el.get("points", "")
            if not points_str:
                continue

            pts = []
            for p in points_str.split(";"):
                p = p.strip()
                if not p:
                    continue
                x, y = p.split(",")
                pts.append((float(x), float(y)))

            if len(pts) < 2:
                continue

            polylines.append({
                "label": label,
                "class_id": CLASS_TO_ID[label],
                "points": np.array(pts, dtype=np.float32),
            })

        images.append({
            "file_name": img_name,
            "width": width,
            "height": height,
            "polylines": polylines,
        })

    return images


def get_annotation_stats(images: List[Dict]) -> Dict:
    """Return summary statistics for parsed annotations."""
    total_images = len(images)
    images_with_annot = sum(1 for img in images if len(img["polylines"]) > 0)

    counts = {"Head": 0, "Midpiece": 0, "Tail": 0}
    for img in images:
        for pl in img["polylines"]:
            counts[pl["label"]] = counts.get(pl["label"], 0) + 1

    return {
        "total_images": total_images,
        "images_with_annotations": images_with_annot,
        "head_count": counts.get("Head", 0),
        "midpiece_count": counts.get("Midpiece", 0),
        "tail_count": counts.get("Tail", 0),
        "total_polylines": sum(counts.values()),
    }
