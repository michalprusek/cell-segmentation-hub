"""Central configuration for the DINOv2 + Mask2Former training pipeline."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


# Class mapping (same as existing codebase)
CLASS_TO_ID = {"Head": 1, "Midpiece": 2, "Tail": 3}
ID_TO_CLASS = {v: k for k, v in CLASS_TO_ID.items()}
NUM_CLASSES = 4  # bg + Head + Midpiece + Tail

# Map alternative CVAT label names
LABEL_ALIASES = {
    "HeadJ": "Head",
    "MidpieceJ": "Midpiece",
    "TailJ": "Tail",
}

# Polyline target point counts per spec
TARGET_POINTS = {1: 2, 2: 16, 3: 8}

# Per-class dilation widths for polyline-to-mask conversion (pixels)
# These are in original image pixels. At mask prediction resolution:
#   DINOv2 (74x74 for 518px): 10px -> ~1.4px on feature map
#   DINOv3 ConvNeXt (129x129 for 518px): 6px -> ~1.5px on feature map
DILATION_WIDTHS = {"Head": 10, "Midpiece": 8, "Tail": 5}


@dataclass
class DataConfig:
    xml_path: str = "data/sada1/annotations.xml"
    images_dir: str = "data/sada1/images/cvat_polylines/images"
    patch_size: int = 518  # 37*14, divisible by DINOv2 patch_size=14
    patch_overlap: int = 200  # ~39% overlap, reduces edge artifacts
    hard_negative_fraction: float = 0.1  # fraction of empty patches to keep
    num_workers: int = 4


@dataclass
class ModelConfig:
    backbone: str = "facebook/dinov2-large"  # DINOv2-L
    backbone_frozen: bool = True
    feature_layers: List[int] = field(default_factory=lambda: [5, 11, 17, 23])
    fpn_channels: int = 256
    num_queries: int = 100
    num_decoder_layers: int = 6
    num_classes: int = NUM_CLASSES
    decoder_dropout: float = 0.1
    mask_upsample_factor: int = 2  # DINOv2: 2→148, 4→296 | ConvNeXt-512: 2→256 | ConvNeXt-640: 2→320
    per_layer_heads: bool = False  # True = per-layer prediction heads (original Mask2Former)
    use_deformable: bool = False  # True = deformable attention pixel decoder (all 4 scales in transformer)


@dataclass
class TrainConfig:
    batch_size: int = 8
    lr: float = 1e-4
    backbone_lr: float = 5e-6  # for optional fine-tuning
    weight_decay: float = 0.01
    num_epochs: int = 100
    warmup_epochs: int = 10
    scheduler: str = "cosine"
    num_folds: int = 3
    seed: int = 42

    # Loss weights
    cls_weight: float = 2.0
    mask_bce_weight: float = 5.0
    mask_dice_weight: float = 5.0
    boundary_weight: float = 2.0

    # Optional backbone fine-tuning
    unfreeze_backbone_epoch: Optional[int] = 30  # unfreeze last 2 stages after this epoch
    unfreeze_last_n_stages: int = 2

    # W&B
    wandb_project: str = "sperm_dinov2_mask2former"
    use_wandb: bool = True

    # Output
    output_dir: str = "outputs_dinov2"


@dataclass
class InferenceConfig:
    patch_size: int = 518  # 37*14, divisible by DINOv2 patch_size=14
    patch_overlap: int = 300  # increased to reduce edge artifacts
    nms_iou_threshold: float = 0.2  # lower threshold for elongated masks
    score_threshold: float = 0.5
    mask_threshold: float = 0.5
    min_mask_area: int = 30
    simplify_eps: float = 1.5
    distance_threshold: float = 50.0  # for part grouping
    merge_iou_threshold: float = 0.15  # merge fragmented same-class instances
    proximity_gap: int = 15            # max pixel gap for fragment merging
    max_angle_diff: float = 45.0       # degrees, orientation guard for merging


@dataclass
class GraphAssemblyConfig:
    # Detection reward scaling: reward = alpha * effective_area * score
    # Typical instance area ~200-2000px, score ~0.7-1.0 → reward ~70-1000
    alpha: float = 0.5

    # Effective area: discount overlap with higher-scoring same-class instances
    effective_area_discount: float = 0.9  # 0=ignore overlap, 1=full subtraction

    # Bbox pruning: skip cost computation for distant instance pairs
    bbox_prune_gap: float = 200.0  # max bbox gap (pixels) to consider edge

    # Cross-class connection costs (Head→Midpiece, Midpiece→Tail)
    max_connection_dist: float = 150.0  # no edge beyond this distance
    w_dist: float = 3.0  # weight for endpoint distance
    w_angle: float = 5.0  # weight for tangent angle penalty (degrees → cost)
    tangent_n_pts: int = 8  # skeleton points for tangent estimation

    # Same-class merge costs
    merge_overlap_bonus: float = 200.0  # reward multiplier for overlapping fragments
    max_merge_gap: float = 60.0  # no merge edge beyond this gap
    merge_w_gap: float = 3.0  # weight for gap distance
    merge_w_tangent: float = 5.0  # weight for tangent mismatch
    merge_max_angle_diff: float = 30.0  # degrees, orientation guard for non-Head merge
