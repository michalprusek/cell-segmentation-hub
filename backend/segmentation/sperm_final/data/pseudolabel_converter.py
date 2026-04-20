"""Convert a COCO pseudolabels dataset into per-image .npz files.

Schema matches `generate_pseudo_labels.py:190-199`, so `PseudoLabeledPatchDataset`
consumes them identically whether they came from self-training or a pre-existing
CVAT export (e.g. `spermie_pseudolabels/annotations.json`).

One .npz per image. Empty-annotation images are skipped.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from sperm_final.config import DILATION_WIDTHS, ID_TO_CLASS
from sperm_final.data.polyline_to_mask import polyline_to_mask


def convert(coco_path: str, images_dir: str, out_dir: str,
            default_score: float = 0.8, verbose: bool = True) -> int:
    coco_path = Path(coco_path)
    images_dir = Path(images_dir)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    coco = json.loads(coco_path.read_text())
    anns_by_img = {}
    for a in coco["annotations"]:
        anns_by_img.setdefault(a["image_id"], []).append(a)

    n_written = 0
    for im in coco["images"]:
        anns = anns_by_img.get(im["id"], [])
        valid = [a for a in anns if 1 <= a["category_id"] <= 3]
        if not valid:
            continue

        img_path = images_dir / im["file_name"]
        if not img_path.exists():
            if verbose:
                print(f"  [skip] missing image: {im['file_name']}")
            continue

        img = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
        if img is None:
            if verbose:
                print(f"  [skip] unreadable: {im['file_name']}")
            continue
        h, w = img.shape[:2]

        masks = []
        labels = []
        scores = []
        for a in valid:
            seg = a.get("segmentation", [])
            if not seg or not seg[0] or len(seg[0]) < 4:
                continue
            pts = np.array(seg[0], dtype=np.float32).reshape(-1, 2)
            label_name = ID_TO_CLASS[a["category_id"]]
            m = polyline_to_mask(pts, h, w, label_name)
            if m.sum() == 0:
                continue
            masks.append(m)
            labels.append(a["category_id"])
            scores.append(float(a.get("score", default_score)))

        if not masks:
            continue

        masks_arr = np.stack(masks).astype(np.uint8)
        labels_arr = np.array(labels, dtype=np.int64)
        scores_arr = np.array(scores, dtype=np.float32)

        # Filename: use the image stem (matches what PseudoLabeledPatchDataset expects)
        stem = Path(im["file_name"]).stem
        out_path = out_dir / f"{stem}.npz"
        np.savez_compressed(
            out_path,
            masks=masks_arr,
            labels=labels_arr,
            scores=scores_arr,
            image_name=im["file_name"],
            image_h=h,
            image_w=w,
        )
        n_written += 1
        if verbose and n_written % 100 == 0:
            print(f"  wrote {n_written} npz so far")

    print(f"done: wrote {n_written} .npz files to {out_dir}")
    return n_written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--coco", required=True)
    ap.add_argument("--images-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--default-score", type=float, default=0.8,
                    help="Score assigned to pseudolabels that lack a score field.")
    args = ap.parse_args()
    convert(args.coco, args.images_dir, args.out, default_score=args.default_score)


if __name__ == "__main__":
    main()
