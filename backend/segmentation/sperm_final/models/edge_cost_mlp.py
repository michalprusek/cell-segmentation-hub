"""Learned Edge-Cost MLP for min-cost max-flow sperm assembly.

Replaces hand-tuned cost function in `graph_assembly.py` (w_dist=3, w_angle=5, ...)
with a small MLP trained on pair labels derived from `instance_id` in unified COCO.

Pattern follows Brasó & Leal-Taixé "Learning a Neural Solver for MOT" (CVPR 2020):
per-edge binary classifier + MCMF at inference preserves flow-conservation ~99% of
the time, so no differentiable solver needed.

The MLP consumes:
  - z_i, z_j: 256-dim embeddings from InstanceEmbedHead (v12 IGM2F-PL)
  - geom_ij: 10-dim hand-computed geometric features (distance, tangent, orientation, etc.)
  - interaction: elementwise diff² and dot-product

Outputs 3 logits, one per edge type (H→M, M→T, same-class merge).
"""

from typing import Dict, Tuple

import numpy as np
import torch
import torch.nn as nn

# Edge type indices for the 3-logit output
EDGE_H_TO_M = 0   # Head (class 1) → Midpiece (class 2) connection
EDGE_M_TO_T = 1   # Midpiece (class 2) → Tail (class 3) connection
EDGE_SAME_MERGE = 2  # Same-class fragment merge

GEOM_DIM = 10


class EdgeCostMLP(nn.Module):
    """Predicts MCMF edge costs supervisedly.

    Args:
        embed_dim: Dimension of per-query instance embeddings (InstanceEmbedHead output).
        geom_dim: Dimension of hand-crafted geometric features.
        hidden: Tuple of hidden layer widths for the trunk MLP.
        dropout: Dropout probability (helps with overfitting on <20k pairs).
    """

    def __init__(
        self,
        embed_dim: int = 256,
        geom_dim: int = GEOM_DIM,
        hidden: Tuple[int, int] = (256, 128),
        dropout: float = 0.2,
    ):
        super().__init__()
        self.embed_dim = embed_dim
        self.geom_dim = geom_dim
        # z_i + z_j + geom + (z_i - z_j)² + (z_i · z_j)
        in_dim = 2 * embed_dim + geom_dim + embed_dim + 1
        self.trunk = nn.Sequential(
            nn.Linear(in_dim, hidden[0]),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden[0], hidden[1]),
            nn.GELU(),
            nn.Dropout(dropout),
        )
        self.head = nn.Linear(hidden[1], 3)

    def forward(
        self,
        z_i: torch.Tensor,
        z_j: torch.Tensor,
        geom_ij: torch.Tensor,
    ) -> torch.Tensor:
        """Return (N, 3) logits per edge type for N candidate pairs."""
        diff_sq = (z_i - z_j) ** 2
        dot = (z_i * z_j).sum(-1, keepdim=True)
        x = torch.cat([z_i, z_j, geom_ij, diff_sq, dot], dim=-1)
        return self.head(self.trunk(x))


def _bbox_iou(bbox_a, bbox_b) -> float:
    ax1, ay1, ax2, ay2 = bbox_a
    bx1, by1, bx2, by2 = bbox_b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def extract_geom_features(feat_i: Dict, feat_j: Dict, image_diag: float) -> np.ndarray:
    """Compute 10-dim geometric feature vector for a pair of instance features.

    `feat_i`, `feat_j` follow the dict schema of `graph_assembly.compute_instance_features`:
    keys centroid, orientation, ep_tangents, bbox, cls, score.

    Features (all normalized so that values lie roughly in [-1, 1] or [0, 1]):
      0: centroid-to-centroid distance / image_diag
      1: min endpoint-endpoint distance / image_diag  (inf → 1.0 sentinel)
      2: cos(angle between tangents) — alignment of skeleton directions
      3: cos(difference in global orientation)
      4: bbox IoU
      5-6: relative centroid direction (unit vector)
      7: log(area_i / area_j) bounded to [-3, 3] then /3
      8: class_i / 3.0
      9: class_j / 3.0
    """
    feat = np.zeros(GEOM_DIM, dtype=np.float32)

    ci = np.array(feat_i["centroid"], dtype=np.float32)
    cj = np.array(feat_j["centroid"], dtype=np.float32)
    cd = float(np.linalg.norm(ci - cj))
    feat[0] = min(cd / image_diag, 1.0)

    # Min endpoint distance (nan-safe)
    eps_i = [p for p, _ in feat_i.get("ep_tangents", [])]
    eps_j = [p for p, _ in feat_j.get("ep_tangents", [])]
    if eps_i and eps_j:
        dists = [float(np.linalg.norm(np.array(a) - np.array(b)))
                 for a in eps_i for b in eps_j]
        feat[1] = min(min(dists) / image_diag, 1.0)
    else:
        feat[1] = 1.0

    # Tangent alignment (cosine of min angle between any tangent pair)
    ts_i = [t for _, t in feat_i.get("ep_tangents", [])]
    ts_j = [t for _, t in feat_j.get("ep_tangents", [])]
    if ts_i and ts_j:
        cos_max = max(
            float(np.clip(np.dot(np.array(a), np.array(b)), -1.0, 1.0))
            for a in ts_i for b in ts_j
        )
        feat[2] = cos_max  # in [-1, 1]
    else:
        feat[2] = 0.0

    # Orientation difference (principal-axis based, cyclic 180°)
    ori_diff = abs(feat_i["orientation"] - feat_j["orientation"])
    ori_diff = min(ori_diff, 180.0 - ori_diff)
    feat[3] = float(np.cos(np.deg2rad(2.0 * ori_diff)))  # in [-1, 1]

    feat[4] = _bbox_iou(feat_i["bbox"], feat_j["bbox"])

    dir_vec = cj - ci
    if cd > 1e-6:
        feat[5] = float(dir_vec[0] / cd)
        feat[6] = float(dir_vec[1] / cd)

    area_i = max(1, feat_i.get("area", 1))
    area_j = max(1, feat_j.get("area", 1))
    log_ratio = float(np.log(area_i / area_j))
    feat[7] = max(-1.0, min(1.0, log_ratio / 3.0))

    feat[8] = feat_i["cls"] / 3.0
    feat[9] = feat_j["cls"] / 3.0

    return feat


class EdgeCostBilinear(nn.Module):
    """Simpler stretch variant: z_i^T W_k z_j + b_k per edge type k.

    Fewer params than full MLP — useful when dataset <5k pairs.
    """

    def __init__(self, embed_dim: int = 256, num_edge_types: int = 3):
        super().__init__()
        self.W = nn.Parameter(torch.randn(num_edge_types, embed_dim, embed_dim) * 0.01)
        self.b = nn.Parameter(torch.zeros(num_edge_types))

    def forward(self, z_i: torch.Tensor, z_j: torch.Tensor, geom_ij: torch.Tensor = None) -> torch.Tensor:
        # z_i: (N, D), z_j: (N, D), W: (K, D, D)
        # Output (N, K) = einsum("nd,kde,ne->nk", z_i, W, z_j) + b
        out = torch.einsum("nd,kde,ne->nk", z_i, self.W, z_j) + self.b
        return out
