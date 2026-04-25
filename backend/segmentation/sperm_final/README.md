# Sperm Morphology Analysis Pipeline

Automated detection, segmentation, and measurement of sperm cells in microscopy images. The pipeline identifies individual sperm, segments their three parts (Head, Midpiece, Tail), groups them into complete sperm assemblies, and outputs polyline annotations along each part's centerline.

## Quick Start

```bash
# Single image
CUDA_VISIBLE_DEVICES=1 python -m sperm_final.run_pipeline \
    --ckpt outputs_dinov3_v8/best_model_train.pth \
    --image path/to/image.jpg \
    --output_dir results/ \
    --device cuda:0

# Batch mode (directory of images)
CUDA_VISIBLE_DEVICES=1 python -m sperm_final.run_pipeline \
    --ckpt outputs_dinov3_v8/best_model_train.pth \
    --images_dir path/to/images/ \
    --output_dir results/ \
    --max_images 20 \
    --device cuda:0
```

Output: side-by-side visualization (masks left, connected polylines right) saved as JPEG.

## Pipeline Overview

The pipeline has 4 stages:

```
Image (JPG)
  |
  v
[1] Instance Segmentation (Mask2Former + ConvNeXt)
  |  Sliding window patches (1024x1024, overlap 300)
  |  Per-patch: 100 query predictions → soft masks + class scores
  |  Post-processing: soft accumulation → split disconnected → split branching
  |
  v
[2] Graph Assembly (Min-Cost Flow)
  |  Build directed graph: S → Head → Midpiece → Tail → T
  |  Solve min-cost max-flow → optimal H+M+T grouping
  |  Only complete sperm (all 3 parts) are returned
  |
  v
[3] Polyline Extraction (Skeleton + RDP + Uniform Resample)
  |  For each part: mask → skeleton → BFS longest path → RDP simplify → resample
  |  Adaptive point count: 8 points per 100px of arc length
  |
  v
[4] Polyline Connection
     Orient parts: Head → Midpiece → Tail
     At junctions: average meeting endpoints
     Output: connected polylines per sperm
```

---

## Stage 1: Instance Segmentation

### Model Architecture

**Mask2Former** with **DINOv3 ConvNeXt-Large** backbone (pretrained on LVD-142M).

```
Input image (1024x1024 patch)
  |
  v
ConvNeXt-Large backbone (frozen, then partially unfrozen during training)
  |  4 native scales: stride 4/8/16/32
  |  Channels: [192, 384, 768, 1536]
  |
  v
MSDeformAttn Pixel Decoder
  |  Stride-4 features kept OUT of transformer (too large for O(n^2) attention)
  |  3 coarser scales (stride 8/16/32) processed by 6-layer transformer encoder
  |  Top-down FPN refinement + lateral bridge to stride-4
  |  Output: mask features at 512x512 (upsample_factor=2)
  |
  v
Transformer Decoder (6 layers, 100 queries)
  |  Self-attention → masked cross-attention (round-robin 3 scales) → FFN
  |  Each query predicts: class logits (4 classes) + mask (512x512)
  |
  v
Output: pred_logits (100, 4), pred_masks (100, 512, 512)
```

4 classes: background (0), Head (1), Midpiece (2), Tail (3).

### Sliding Window Inference

Full images are processed via overlapping patches because sperm can appear anywhere:

- **Patch size**: 1024x1024 (divisible by ConvNeXt stride 32)
- **Overlap**: 300px between adjacent patches
- **Padding**: Reflect-pad to make image dimensions divisible by 32

Each patch independently produces up to 100 instance predictions. These are collected across all patches and then post-processed.

### Post-Processing (before graph assembly)

Three cleaning steps are applied to the raw patch predictions:

1. **Soft mask accumulation**: When multiple overlapping patches predict the same instance (IoU > 0.5), their soft sigmoid masks are averaged. This produces smoother masks at patch boundaries.

2. **Split disconnected components**: If an instance mask has multiple disconnected blobs (e.g., from merging predictions across distant patches), each blob becomes a separate instance.

3. **Split branching skeletons**: If a mask's skeleton has junction points (degree >= 3), it means two crossing sperm were merged. The mask is split at junction points into separate instances. Only applied to Midpiece and Tail (Head is blob-like).

**File**: `inference/predict.py` → `predict_full_image_for_graph()`

### Default Parameters

| Parameter         | Value | Purpose                                                              |
| ----------------- | ----- | -------------------------------------------------------------------- |
| `score_threshold` | 0.95  | High confidence — model is very certain (0.99-1.00 typical)          |
| `mask_threshold`  | 0.3   | Lower than default 0.5 to avoid fragmented masks at patch boundaries |
| `patch_size`      | 1024  | Matches training patch size                                          |
| `overlap`         | 300   | ~29% overlap for smooth transitions                                  |

---

## Stage 2: Graph Assembly

### Problem

After instance segmentation, we have a flat list of instances (e.g., 15 instances: 3 Heads, 5 Midpieces, 4 Tails, 3 fragments). We need to:

- Group them into complete sperm (Head + Midpiece + Tail)
- Merge same-class fragments (e.g., Midpiece split at patch boundary)
- NOT merge different instances of the same class (e.g., two parallel Midpieces)

### Min-Cost Max-Flow Formulation

Each flow path from Source (S) to Sink (T) represents one complete sperm.

**Nodes**: S, T, plus (i_in, i_out) for each instance i.

**Edges**:

| Edge                      | Capacity | Cost            | Purpose                                          |
| ------------------------- | -------- | --------------- | ------------------------------------------------ |
| i_in → i_out              | 1        | -reward(i)      | Reward for using instance (negative = incentive) |
| S → head_in               | 1        | 0               | Only Heads can start a path                      |
| tail_out → T              | 1        | 0               | Only Tails can end a path                        |
| head_out → midpiece_in    | 1        | conn_cost(h,m)  | Head→Midpiece connection                         |
| midpiece_out → tail_in    | 1        | conn_cost(m,t)  | Midpiece→Tail connection                         |
| i_out → j_in (same class) | 1        | merge_cost(i,j) | Same-class fragment merging                      |
| S → T                     | N        | 0               | Bypass (absorbs unused supply)                   |

The solver (NetworkX network simplex) finds the minimum-cost flow, which simultaneously:

- Selects which instances to use (high reward = used)
- Groups them into H+M+T chains
- Merges compatible same-class fragments
- Leaves incompatible instances ungrouped (flow goes through bypass)

### Cost Functions

**Detection reward**: `reward(i) = alpha * effective_area(i) * score(i)`

- Larger, higher-confidence instances get bigger rewards
- Effective area discounts overlap with higher-scoring same-class instances (handles containment)

**Connection cost** (cross-class, Head→Midpiece or Midpiece→Tail):

- Based on endpoint distance + tangent angle penalty
- Head uses centroid (blob-like, no reliable skeleton endpoints)
- Midpiece and Tail use skeleton endpoints with tangent vectors
- No edge if distance > 150px

**Merge cost** (same-class fragments):

- Overlapping fragments: negative cost (reward for merging)
- Adjacent fragments (gap < 60px): cost based on gap distance + tangent alignment
- **Orientation guard**: no merge if angle difference > 30 degrees (prevents merging parallel Midpieces from different sperm)
- **Crossing detection**: no merge if union skeleton has junctions (the instances cross, not merge)

### Completeness Constraint

Only complete sperm (all 3 parts: Head + Midpiece + Tail) are returned. Incomplete paths (e.g., Midpiece + Tail without Head) are discarded. This is enforced by the graph structure: only Heads connect to S, only Tails connect to T.

**File**: `inference/graph_assembly.py` → `assemble_sperm_graph()`

### Configuration (`GraphAssemblyConfig`)

| Parameter                 | Default | Purpose                                  |
| ------------------------- | ------- | ---------------------------------------- |
| `alpha`                   | 0.5     | Detection reward scaling                 |
| `effective_area_discount` | 0.9     | Overlap discounting for containment      |
| `max_connection_dist`     | 150px   | Max distance for cross-class connections |
| `w_dist`                  | 3.0     | Distance weight in connection cost       |
| `w_angle`                 | 5.0     | Tangent angle weight in connection cost  |
| `merge_overlap_bonus`     | 200     | Reward for merging overlapping fragments |
| `max_merge_gap`           | 60px    | Max gap for adjacent fragment merging    |
| `merge_max_angle_diff`    | 30 deg  | Orientation guard for non-Head merging   |

---

## Stage 3: Polyline Extraction

For each sperm part mask, a polyline (centerline) is extracted:

### Pipeline

```
Binary mask (threshold >= 0.3)
  |
  v
Skeletonization (scikit-image morphological thinning)
  |  Reduces mask to 1-pixel-wide skeleton
  |
  v
Skeleton pruning (remove branches < 5px)
  |  Eliminates small spurs from skeletonization noise
  |
  v
BFS longest path
  |  Find two most distant skeleton endpoints
  |  Trace the longest path between them (the main centerline)
  |
  v
RDP simplification (epsilon = 5.0)
  |  Ramer-Douglas-Peucker removes pixel-level zigzag
  |  Preserves overall curvature, removes skeleton discretization noise
  |
  v
Uniform resampling (8 points per 100px of arc length)
  |  Evenly spaces points along the simplified polyline
  |  Adaptive: short structures get few points, long ones get many
  |
  v
Output: List of (x, y) coordinate tuples
```

### Fallbacks

If skeletonization fails (mask too small or degenerate):

1. **Contour midline**: Extract contour, find two most distant points, take the shorter arc
2. **Distant pixels**: Find two most distant mask pixels, connect them

### Why Uniform Resampling (not B-spline)

B-spline smoothing was tested but causes overshoot — the spline can deviate outside the mask between control points. Uniform resampling along the RDP-simplified path is stable and exactly follows the skeleton centerline.

**File**: `inference/postprocess.py` → `mask_to_polyline()`

---

## Stage 4: Polyline Connection

After extracting polylines for each part, they need to be connected into a continuous chain per sperm.

### Algorithm

1. **Orient Midpiece**: Start endpoint closer to Head centroid, end closer to Tail centroid
2. **Orient Head**: End endpoint closest to Midpiece start
3. **Orient Tail**: Start endpoint closest to Midpiece end
4. **Connect Head↔Midpiece**: Replace Head's last point and Midpiece's first point with their average
5. **Connect Midpiece↔Tail**: Replace Midpiece's last point and Tail's first point with their average

This ensures the polylines share exact junction points — no gaps between parts.

**File**: `inference/postprocess.py` → `connect_sperm_polylines()`

---

## Directory Structure

```
sperm_final/
├── __init__.py
├── config.py                  # All configuration dataclasses
├── run_pipeline.py            # Main entry point (CLI + process_image API)
├── README.md                  # This file
├── models/
│   ├── mask2former.py         # Full Mask2Former architecture
│   ├── convnext_backbone.py   # DINOv3 ConvNeXt-Large backbone
│   ├── backbone.py            # DINOv2 ViT backbone (alternative)
│   └── simple_fpn.py          # SimpleFPN for DINOv2 (single→multi-scale)
├── inference/
│   ├── predict.py             # Sliding window inference + post-processing
│   ├── graph_assembly.py      # Min-cost flow graph optimization
│   ├── postprocess.py         # Mask → polyline conversion + connection
│   └── group_sperm.py         # Endpoint-based grouping (legacy fallback)
└── data/
    ├── dataset.py             # ImageNet normalization constants
    ├── cvat_parser.py         # CVAT XML annotation parser
    └── polyline_to_mask.py    # Polyline → mask (for training data preparation)
```

## Python API

```python
from sperm_final.run_pipeline import load_model, process_image
import cv2, torch

device = torch.device("cuda:0")
model = load_model("outputs_dinov3_v8/best_model_train.pth", device)

img = cv2.imread("image.jpg")
sperm_list, polylines_list = process_image(model, img, device)

for i, (sperm, polys) in enumerate(zip(sperm_list, polylines_list)):
    print(f"Sperm {i+1}:")
    for part in ["head", "midpiece", "tail"]:
        pts = polys[part]  # List of (x, y) tuples
        print(f"  {part}: {len(pts)} points")
        # pts[0] connects to previous part's pts[-1] (shared junction point)
```

## Dependencies

- PyTorch >= 2.0
- torchvision
- numpy
- opencv-python (cv2)
- scikit-image (skeletonize)
- scipy (splprep/splev — used in B-spline, kept as dependency)
- networkx (min-cost flow solver)
- transformers (HuggingFace — loads pretrained ConvNeXt/DINOv2 weights)

## Model Checkpoint

Best model weights are included: **`best_model.pth`** (2.4GB, ConvNeXt-Large, 200 epochs, test IoU 0.8849).

```bash
# Default usage (weights in sperm_final/):
python -m sperm_final.run_pipeline --ckpt sperm_final/best_model.pth --image img.jpg
```

The checkpoint contains:

- `model_state_dict`: Model weights
- `config`: Training configuration (automatically loaded)

## Best Parameters

All validated parameters are documented in **[BEST_PARAMS.md](BEST_PARAMS.md)** — inference thresholds, polyline extraction settings, graph assembly costs, and model training hyperparameters.

## Training Data

- **443 annotated images** (sada1 + sada2) from CVAT with polyline annotations
- 3 classes: Head, Midpiece, Tail
- Polylines converted to dilated masks for training (Head: 10px, Midpiece: 8px, Tail: 5px)
- Train/Val/Test split: 80/10/10 by video group
