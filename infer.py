#!/usr/bin/env python3
"""Standalone microtubule (MT) instance-segmentation inference.

Runs the v7 pipeline — DINOv3-L backbone + DPT decoder + PySOAX
postprocessing — on a single 2D microscopy frame and writes the detected
microtubule centerlines as open polylines.

This is a self-contained extract of the inference path used by the
cell-segmentation-hub ML service. It depends ONLY on the bundled
``microtubule/`` package (no FastAPI, no other models, no service code).

Pipeline
--------
1. Load a grayscale frame (PNG/JPG/BMP/TIFF/ND2/NPY).
2. Percentile-normalize (1st / 99.5th) -> [0, 1].   (done inside the model)
3. DINOv3-L + DPT forward -> seed-probability map (H, W) + 32-d embedding (32, H, W).
4. Threshold the seed map; PySOAX grows stretching-open active contours
   (snakes) into per-instance centerlines, using the embedding to
   disambiguate crossings.
5. Ramer-Douglas-Peucker simplify each centerline (eps = 1.0 px).
6. Sample the 32-d embedding at each centerline pixel (float16) so the
   output is compatible with the cross-frame tracker / kymograph tools.

Output JSON mirrors the cell-segmentation-hub ``/segment`` response for the
``microtubule`` model, so it can be fed straight into the tracking pipeline.

Examples
--------
    # Single PNG/TIFF frame, JSON next to the image + an overlay preview
    python infer.py --image frame.tif --overlay overlay.png

    # ND2 / multi-page TIFF stack: pick a frame
    python infer.py --image stack.nd2 --frame 12 --output frame12.json

    # Force device / threshold
    python infer.py --image frame.png --device cpu --threshold 0.4

First run downloads the gated DINOv3-L backbone (~1.1 GB) from HuggingFace;
set HF_TOKEN (see README) before running.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import uuid
from pathlib import Path

import numpy as np

# Make the bundled ``microtubule`` package importable regardless of CWD.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))


# --------------------------------------------------------------------------- #
# Device selection
# --------------------------------------------------------------------------- #
def resolve_device(requested: str) -> str:
    """Pick a torch device.

    ``auto`` prefers CUDA, then CPU. Apple-Silicon MPS is NOT chosen
    automatically: a few transformer ops fall back / differ on MPS, so CPU
    is the safe, reproducible default on a Mac. Pass ``--device mps``
    explicitly to opt in (we enable PYTORCH_ENABLE_MPS_FALLBACK for the
    unsupported ops).
    """
    import torch

    if requested == "auto":
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"

    if requested == "cuda" and not torch.cuda.is_available():
        print("[warn] CUDA requested but not available; falling back to CPU.")
        return "cpu"

    if requested == "mps":
        if not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
            print("[warn] MPS requested but not available; falling back to CPU.")
            return "cpu"
        # Let unsupported ops fall back to CPU instead of erroring.
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        print("[warn] MPS is experimental for this model; verify results "
              "against CPU on a known frame.")
        return "mps"

    return requested


# --------------------------------------------------------------------------- #
# Image loading
# --------------------------------------------------------------------------- #
def load_frame(path: Path, frame: int) -> np.ndarray:
    """Load a single 2D grayscale frame from common microscopy formats.

    - PNG/JPG/BMP: RGB(A) is reduced to grayscale (mean over channels).
    - TIFF/ND2/NPY: a 3-D+ array is treated as a stack; ``frame`` selects
      the slice along the leading axis.
    Native bit depth (uint8/uint16/float) is preserved — the model
    percentile-normalizes internally, so do NOT pre-scale.
    """
    ext = path.suffix.lower()
    if ext == ".npy":
        arr = np.load(path)
    elif ext in {".tif", ".tiff"}:
        import tifffile
        arr = tifffile.imread(str(path))
    elif ext == ".nd2":
        import nd2
        arr = nd2.imread(str(path))
    else:  # png / jpg / jpeg / bmp / etc.
        from PIL import Image
        arr = np.array(Image.open(path))

    arr = np.squeeze(arr)

    if arr.ndim == 2:
        return arr
    if arr.ndim == 3:
        # Channels-last RGB(A) from a regular image -> grayscale.
        if ext in {".png", ".jpg", ".jpeg", ".bmp"} and arr.shape[-1] in (3, 4):
            return arr[..., :3].astype(np.float64).mean(axis=-1)
        # Otherwise a stack: leading axis = frames.
        return _pick_frame(arr, frame)
    if arr.ndim >= 4:
        arr = arr.reshape(-1, arr.shape[-2], arr.shape[-1])
        return _pick_frame(arr, frame)
    raise ValueError(f"Unsupported array shape {arr.shape} from {path}")


def _pick_frame(stack: np.ndarray, frame: int) -> np.ndarray:
    n = stack.shape[0]
    if not -n <= frame < n:
        raise IndexError(
            f"--frame {frame} out of range for stack of {n} frames (0..{n - 1})"
        )
    return stack[frame]


# --------------------------------------------------------------------------- #
# Result formatting (mirrors the ML service /segment response for MT)
# --------------------------------------------------------------------------- #
def build_polylines(result: dict) -> list[dict]:
    """Convert the wrapper output to the app's polyline JSON schema.

    centerlines are (row, col) px; the app stores (x, y) = (col, row).
    The 32-d embedding samples are base64-encoded float16 so the tracker /
    kymograph endpoints can consume the file unchanged.
    """
    centerlines = result["centerlines_rc"]
    embeddings = result["embedding_samples"]
    polylines = []
    for i, (cl, emb) in enumerate(zip(centerlines, embeddings), start=1):
        points = [{"x": float(c), "y": float(r)} for r, c in cl]
        emb_b64 = base64.b64encode(
            np.ascontiguousarray(emb, dtype=np.float16).tobytes()
        ).decode("ascii")
        polylines.append({
            "id": f"polyline_{i}",
            "points": points,
            "type": "external",
            "class": "microtubule",
            "geometry": "polyline",
            "instanceId": f"mt_{uuid.uuid4().hex[:8]}",
            "confidence": 1.0,  # PySOAX is deterministic
            "vertices_count": len(points),
            "_embedding": emb_b64,
            "_embedding_dim": 32,
        })
    return polylines


def draw_overlay(image_2d: np.ndarray, polylines: list[dict], out_path: Path) -> None:
    """Render centerlines over the (percentile-normalized) frame for QA."""
    import cv2

    img = image_2d.astype(np.float32)
    lo, hi = np.percentile(img, [1, 99.5])
    img = np.clip((img - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    rgb = (np.repeat(img[:, :, None], 3, axis=2) * 255).astype(np.uint8)

    for idx, pl in enumerate(polylines):
        pts = np.array([[p["x"], p["y"]] for p in pl["points"]], dtype=np.int32)
        # Distinct, repeatable color per instance (BGR).
        hue = int((idx * 47) % 180)
        color = cv2.cvtColor(
            np.uint8([[[hue, 220, 255]]]), cv2.COLOR_HSV2BGR
        )[0, 0].tolist()
        cv2.polylines(rgb, [pts.reshape(-1, 1, 2)], isClosed=False,
                      color=color, thickness=1, lineType=cv2.LINE_AA)
    cv2.imwrite(str(out_path), rgb)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser(
        description="Standalone microtubule v7 segmentation inference.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    ap.add_argument("--image", required=True, type=Path,
                    help="Input frame (PNG/JPG/BMP/TIFF/ND2/NPY).")
    ap.add_argument("--weights", type=Path,
                    default=_HERE / "weights" / "microtubule_v7.pt",
                    help="Path to microtubule_v7.pt checkpoint.")
    ap.add_argument("--output", type=Path, default=None,
                    help="Output JSON path (default: <image>.mt.json).")
    ap.add_argument("--overlay", type=Path, default=None,
                    help="Optional overlay PNG visualizing the centerlines.")
    ap.add_argument("--device", default="auto",
                    choices=["auto", "cuda", "cpu", "mps"],
                    help="Compute device (auto = cuda if present else cpu).")
    ap.add_argument("--threshold", type=float, default=0.5,
                    help="Seed-probability threshold for PySOAX init.")
    ap.add_argument("--frame", type=int, default=0,
                    help="Frame index for multi-page TIFF / ND2 stacks.")
    args = ap.parse_args()

    if not args.image.exists():
        print(f"[error] image not found: {args.image}", file=sys.stderr)
        return 2
    if not args.weights.exists():
        print(f"[error] checkpoint not found: {args.weights}\n"
              "        It ships in weights/microtubule_v7.pt — see README.",
              file=sys.stderr)
        return 2

    device = resolve_device(args.device)
    print(f"[info] device={device}  threshold={args.threshold}")

    image_2d = load_frame(args.image, args.frame)
    print(f"[info] loaded {args.image.name}  shape={image_2d.shape}  "
          f"dtype={image_2d.dtype}")

    from microtubule import MicrotubuleModel

    t0 = time.time()
    model = MicrotubuleModel().load_weights(args.weights, device)
    t_load = time.time() - t0
    print(f"[info] model loaded in {t_load:.1f}s (first run also downloads "
          "the DINOv3 backbone)")

    t1 = time.time()
    result = model.predict(image_2d, seed_threshold=args.threshold)
    t_infer = time.time() - t1

    polylines = build_polylines(result)
    H, W = result["seed_prob"].shape
    payload = {
        "model_used": "microtubule",
        "threshold_used": args.threshold,
        "image_size": {"width": int(W), "height": int(H)},
        "polygons": [],            # MT outputs polylines only
        "polylines": polylines,
        "processing_info": {
            "device": device,
            "num_polylines": len(polylines),
            "processing_time_s": round(t_infer, 2),
            "source_image": str(args.image),
            "frame": args.frame,
        },
    }

    out_path = args.output or args.image.with_suffix(args.image.suffix + ".mt.json")
    out_path.write_text(json.dumps(payload, indent=2))
    print(f"[ok] {len(polylines)} microtubules in {t_infer:.1f}s "
          f"-> {out_path}")

    if args.overlay:
        draw_overlay(image_2d, polylines, args.overlay)
        print(f"[ok] overlay -> {args.overlay}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
