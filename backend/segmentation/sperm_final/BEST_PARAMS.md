# Best Parameters (validated pipeline)

## Inference

| Parameter | Value | Notes |
|-----------|-------|-------|
| `score_threshold` | 0.95 | Model is very confident (0.99-1.00 typical), high threshold filters noise |
| `mask_threshold` | 0.3 | Lower than default 0.5 to prevent mask fragmentation at patch boundaries |
| `patch_size` | 1024 | Matches ConvNeXt training patch size (divisible by 32) |
| `patch_overlap` | 300 | ~29% overlap for smooth patch transitions |
| `nms_iou_threshold` | 0.5 | Permissive NMS — graph assembly handles proper deduplication |

## Polyline Extraction

| Parameter | Value | Notes |
|-----------|-------|-------|
| `simplify_eps` | 5.0 | RDP epsilon — removes pixel-level skeleton zigzag while preserving curvature |
| `pts_per_100px` | 8.0 | Uniform resampling density — 8 points per 100px of arc length |
| `min_pts` | 2 | Minimum output points per polyline |
| `min_branch_length` | 5 | Skeleton pruning — remove branches shorter than 5px |
| Smoothing method | Uniform resample | NOT B-spline (causes overshoot outside mask) |

## Graph Assembly

| Parameter | Value | Notes |
|-----------|-------|-------|
| `alpha` | 0.5 | Detection reward scaling |
| `effective_area_discount` | 0.9 | Near-full subtraction of overlap with higher-scoring same-class instances |
| `max_connection_dist` | 150px | Max endpoint distance for Head→Midpiece or Midpiece→Tail links |
| `w_dist` | 3.0 | Weight for endpoint distance in connection cost |
| `w_angle` | 5.0 | Weight for tangent angle penalty in connection cost |
| `merge_overlap_bonus` | 200 | Reward for merging overlapping same-class fragments |
| `max_merge_gap` | 60px | Max gap distance for adjacent fragment merging |
| `merge_max_angle_diff` | 30 deg | Orientation guard — don't merge if angle > 30 degrees |
| `bbox_prune_gap` | 200px | Skip cost computation for pairs further apart |

## Model (ConvNeXt v8)

| Parameter | Value |
|-----------|-------|
| Backbone | facebook/dinov3-convnext-large-pretrain-lvd1689m |
| Patch size | 1024x1024 |
| Mask resolution | 512x512 (upsample_factor=2) |
| Num queries | 100 |
| Decoder layers | 6 |
| FPN channels | 256 |
| Training epochs | 200 |
| Batch size | 2 (gradient accumulation 4 → effective 8) |
| LR | 1e-4 (backbone 5e-6) |
| Unfreeze backbone | Epoch 30 (last 2 stages) |
| Test IoU | 0.8849 (Head 0.871, Midpiece 0.907, Tail 0.829) |
| Checkpoint | `best_model.pth` (2.4GB) |
