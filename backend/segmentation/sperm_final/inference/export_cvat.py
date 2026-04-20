"""Export predictions to CVAT XML format.

Reuses CVAT template handling from Sperm-Detection/test_maskrcnn.py:376-433.
"""

import argparse
import os
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch

from sperm_final.config import ID_TO_CLASS, GraphAssemblyConfig, InferenceConfig, ModelConfig
from sperm_final.data.cvat_parser import parse_cvat_xml
from sperm_final.inference.predict import predict_full_image, predict_full_image_for_graph
from sperm_final.inference.postprocess import mask_to_polyline
from sperm_final.inference.group_sperm import (
    group_sperm_parts,
    find_closest_tails_for_midpieces,
)
from sperm_final.inference.graph_assembly import assemble_sperm_graph


def load_cvat_template(template_path: str):
    """Load CVAT XML template. From test_maskrcnn.py:376-400."""
    p = Path(template_path)
    if not p.exists():
        raise FileNotFoundError(template_path)

    if p.suffix.lower() == ".zip":
        with zipfile.ZipFile(p, "r") as z:
            names = z.namelist()
            if "annotations.xml" in names:
                data = z.read("annotations.xml")
            else:
                cand = [n for n in names if n.endswith("annotations.xml")]
                cand = cand or [n for n in names if n.lower().endswith(".xml")]
                if not cand:
                    raise RuntimeError("No XML found in template zip.")
                data = z.read(cand[0])
        root = ET.fromstring(data)
    else:
        root = ET.parse(str(p)).getroot()

    images_by_name = {img.get("name"): img for img in root.findall("image")}
    return root, images_by_name


def remove_existing_shapes(image_el: ET.Element):
    """Remove existing shape annotations. From test_maskrcnn.py:403-407."""
    shape_tags = {"box", "polyline", "polygon", "points", "mask", "ellipse", "cuboid"}
    for child in list(image_el):
        if child.tag in shape_tags:
            image_el.remove(child)


def add_cvat_polyline(
    image_el: ET.Element,
    label: str,
    poly_pts: List[Tuple[float, float]],
    source: Optional[str] = None,
):
    """Add polyline to CVAT image element. From test_maskrcnn.py:410-418."""
    pl = ET.SubElement(image_el, "polyline")
    pl.set("label", label)
    pl.set("points", ";".join([f"{x:.2f},{y:.2f}" for (x, y) in poly_pts]))
    pl.set("occluded", "0")
    pl.set("z_order", "0")
    if source is not None:
        pl.set("source", source)
    return pl


def indent_xml(elem, level=0):
    """Pretty-print XML. From test_maskrcnn.py:421-432."""
    i = "\n" + level * "  "
    if len(elem):
        if not elem.text or not elem.text.strip():
            elem.text = i + "  "
        for e in elem:
            indent_xml(e, level + 1)
        if not elem.tail or not elem.tail.strip():
            elem.tail = i
    else:
        if level and (not elem.tail or not elem.tail.strip()):
            elem.tail = i


def export_predictions(
    model,
    images_dir: str,
    template_path: str,
    output_xml: str,
    device: torch.device,
    inf_cfg: InferenceConfig = None,
    source_label: Optional[str] = "model",
    keep_unconnected: bool = False,
    use_graph_assembly: bool = False,
    graph_cfg: GraphAssemblyConfig = None,
):
    """Run model on all images and export predictions to CVAT XML.

    Args:
        model: Trained Mask2FormerModel in eval mode.
        images_dir: Path to image directory.
        template_path: CVAT template XML or zip.
        output_xml: Output XML path.
        device: torch device.
        inf_cfg: Inference configuration.
        source_label: Value for polyline source attribute.
        keep_unconnected: Keep unconnected parts in output.
        use_graph_assembly: Use min-cost flow graph assembly instead of greedy grouping.
        graph_cfg: Graph assembly configuration (used when use_graph_assembly=True).
    """
    if inf_cfg is None:
        inf_cfg = InferenceConfig()

    xml_root, images_by_name = load_cvat_template(template_path)

    from sperm_final.data.dataset import IMAGENET_MEAN, IMAGENET_STD

    exts = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
    img_dir = Path(images_dir)
    img_files = sorted(
        f for f in img_dir.iterdir()
        if f.is_file() and f.suffix.lower() in exts
    )

    for img_path in img_files:
        name = img_path.name
        # Try to find matching template entry
        img_el = None
        for template_name, el in images_by_name.items():
            if Path(template_name).name == name:
                img_el = el
                break

        if img_el is None:
            print(f"Skipping (not in template): {name}")
            continue

        # Load and preprocess image
        img_bgr = cv2.imread(str(img_path), cv2.IMREAD_COLOR)
        if img_bgr is None:
            continue
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)

        # Normalize
        img_tensor = torch.from_numpy(img_rgb).permute(2, 0, 1).float() / 255.0
        mean = torch.tensor(IMAGENET_MEAN).view(3, 1, 1)
        std = torch.tensor(IMAGENET_STD).view(3, 1, 1)
        img_tensor = (img_tensor - mean) / std

        # Predict
        if use_graph_assembly:
            instances = predict_full_image_for_graph(
                model, img_tensor, device,
                patch_size=inf_cfg.patch_size,
                overlap=inf_cfg.patch_overlap,
                score_threshold=inf_cfg.score_threshold,
                mask_threshold=inf_cfg.mask_threshold,
            )
        else:
            instances = predict_full_image(
                model, img_tensor, device,
                patch_size=inf_cfg.patch_size,
                overlap=inf_cfg.patch_overlap,
                score_threshold=inf_cfg.score_threshold,
                mask_threshold=inf_cfg.mask_threshold,
                nms_iou_threshold=inf_cfg.nms_iou_threshold,
                merge_iou_threshold=inf_cfg.merge_iou_threshold,
                proximity_gap=inf_cfg.proximity_gap,
                max_angle_diff=inf_cfg.max_angle_diff,
            )

        if use_graph_assembly:
            # Graph assembly: globally optimal part grouping + fragment merging
            sperm_list = assemble_sperm_graph(instances, inf_cfg.mask_threshold, graph_cfg)

            remove_existing_shapes(img_el)
            n_polylines = 0
            for sperm in sperm_list:
                for key in ["head", "midpiece", "tail"]:
                    part = sperm[key]
                    if part is None:
                        continue
                    poly = mask_to_polyline(
                        part["mask"], part["cls"],
                        mask_threshold=inf_cfg.mask_threshold,
                        simplify_eps=inf_cfg.simplify_eps,
                    )
                    if len(poly) >= 2:
                        add_cvat_polyline(
                            img_el,
                            label=ID_TO_CLASS[part["cls"]],
                            poly_pts=poly,
                            source=source_label,
                        )
                        n_polylines += 1

            print(f"  {name}: {n_polylines} polylines (graph assembly, {len(sperm_list)} sperm)")
        else:
            # Legacy pipeline: greedy grouping with endpoint mutations
            polylines_list = []
            for inst in instances:
                poly = mask_to_polyline(
                    inst["mask"], inst["cls"],
                    mask_threshold=inf_cfg.mask_threshold,
                    simplify_eps=inf_cfg.simplify_eps,
                )
                if len(poly) >= 2:
                    polylines_list.append((poly, inst["cls"]))

            connection_lines, distances, midpiece_mutations = \
                find_closest_tails_for_midpieces(polylines_list, inf_cfg.distance_threshold)

            connected_midpieces = set(midpiece_mutations.keys())
            final_polylines = []

            for list_idx, (poly, cls) in enumerate(polylines_list):
                if cls == 2 and list_idx in midpiece_mutations:
                    new_poly = list(poly)
                    for end_pos, replacement_pt in midpiece_mutations[list_idx]:
                        if end_pos == 0:
                            new_poly = [replacement_pt] + new_poly[1:]
                        else:
                            new_poly = new_poly[:-1] + [replacement_pt]
                    final_polylines.append((new_poly, cls))
                elif cls == 2 and not keep_unconnected:
                    continue
                else:
                    final_polylines.append((poly, cls))

            remove_existing_shapes(img_el)
            for poly, cls in final_polylines:
                add_cvat_polyline(
                    img_el,
                    label=ID_TO_CLASS[cls],
                    poly_pts=poly,
                    source=source_label,
                )

            print(f"  {name}: {len(final_polylines)} polylines")

    # Save XML
    indent_xml(xml_root)
    out_path = Path(output_xml)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ET.ElementTree(xml_root).write(str(out_path), encoding="utf-8", xml_declaration=True)
    print(f"Saved CVAT XML: {out_path}")


def main():
    parser = argparse.ArgumentParser(description="Export predictions to CVAT XML")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--images_dir", required=True)
    parser.add_argument("--cvat_template", required=True)
    parser.add_argument("--output_xml", default="predictions_cvat.xml")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--score_thr", type=float, default=0.5)
    parser.add_argument("--keep_unconnected", action="store_true")
    parser.add_argument("--graph_assembly", action="store_true",
                        help="Use min-cost flow graph assembly instead of greedy grouping")
    args = parser.parse_args()

    device = torch.device(args.device if torch.cuda.is_available() else "cpu")

    from generate_pseudo_labels import load_model
    model = load_model(args.checkpoint, device)

    inf_cfg = InferenceConfig(score_threshold=args.score_thr)
    graph_cfg = GraphAssemblyConfig() if args.graph_assembly else None

    export_predictions(
        model, args.images_dir, args.cvat_template, args.output_xml,
        device, inf_cfg, keep_unconnected=args.keep_unconnected,
        use_graph_assembly=args.graph_assembly, graph_cfg=graph_cfg,
    )


if __name__ == "__main__":
    main()
