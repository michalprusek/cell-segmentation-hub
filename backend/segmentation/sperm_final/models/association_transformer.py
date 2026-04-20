"""Context-aware association transformer for sperm assembly.

Upgrades `EdgeCostMLP` (pairwise, scores each pair in isolation) to a
Set-Transformer / Graph-Transformer hybrid that first processes ALL detections
in an image with multi-head self-attention, then scores each candidate pair
using the context-aware embeddings.

Why this matters for sperm assembly: whether Head_i should connect to Midpiece_j
often depends on what OTHER midpieces and heads are nearby. A pairwise classifier
cannot see "oh wait, Midpiece_k is much closer to Head_i, that one wins". The
transformer sees the whole scene.

Architecture:
  Inputs (per image):
    - node_feats: (N, D_in) = [embed_256, class_onehot_3, centroid_norm_2,
                               bbox_norm_4, area_log_1, orient_sincos_2] = 268
    - pair_idx:   (M, 2) — which (i, j) pairs to score from this image
    - geom_ij:    (M, 10) — precomputed geometric features per pair

  Pipeline:
    1. Linear project node_feats → d_model=256
    2. Self-attention encoder × n_layers=3 (GELU, pre-norm)
    3. For each pair (i, j): concat[h_i, h_j, h_i ⊙ h_j, |h_i - h_j|, geom_ij]
    4. MLP edge head → 3 logits (H→M, M→T, same-merge)

  Ground-truth label stays the same 3-hot vector as EdgeCostMLP, so the existing
  pair cache works with only a small extension (per-image node features saved
  alongside the pair list).
"""

from typing import Dict, List, Tuple

import torch
import torch.nn as nn


# Per-node self-features (fixed layout, concatenated to the 256-d embedding):
#   class_onehot (3) + centroid_x/y normalized (2) + bbox normalized (4)
#   + log(area) normalized (1) + orientation sin/cos (2) = 12
NODE_SELF_DIM = 12


def extract_node_self_features(feat: Dict, image_diag: float,
                               image_hw: Tuple[int, int]) -> "torch.Tensor":
    """Produce (12,)-dim per-detection self features (in addition to 256-d embed).

    Consistent ordering with EdgeCostMLP.extract_geom_features (cls, area, etc.)
    so both architectures can reuse the same cache fields.
    """
    import numpy as np
    H, W = image_hw
    cls = int(feat["cls"])
    cls_oh = np.zeros(3, dtype=np.float32)
    if 1 <= cls <= 3:
        cls_oh[cls - 1] = 1.0

    cx, cy = feat["centroid"]
    cent = np.array([cx / max(W - 1, 1), cy / max(H - 1, 1)], dtype=np.float32)

    bx1, by1, bx2, by2 = feat["bbox"]
    bbox = np.array([
        bx1 / max(W - 1, 1), by1 / max(H - 1, 1),
        bx2 / max(W - 1, 1), by2 / max(H - 1, 1),
    ], dtype=np.float32)

    area = max(1.0, float(feat.get("area", 1)))
    log_area = np.log(area) / 10.0   # typical areas 100-10000 → log ~2-9 → /10
    log_area = np.array([max(-1.0, min(1.0, log_area))], dtype=np.float32)

    ori = float(feat.get("orientation", 0.0))
    sincos = np.array([
        np.sin(np.deg2rad(2 * ori)),     # 2× for 180° symmetry
        np.cos(np.deg2rad(2 * ori)),
    ], dtype=np.float32)

    return torch.from_numpy(
        np.concatenate([cls_oh, cent, bbox, log_area, sincos], axis=0)
    )


class AssociationTransformer(nn.Module):
    """Context-aware pair scorer. Drop-in replacement for EdgeCostMLP.

    Args:
        embed_dim: per-node instance embedding dimension (256 for v12+).
        node_self_dim: per-node self features (12, see NODE_SELF_DIM).
        geom_dim: per-pair geometric features (10, same as EdgeCostMLP).
        d_model: transformer hidden dim.
        n_heads: attention heads.
        n_layers: encoder layers.
        dropout: dropout prob.
    """

    def __init__(
        self,
        embed_dim: int = 256,
        node_self_dim: int = NODE_SELF_DIM,
        geom_dim: int = 10,
        d_model: int = 256,
        n_heads: int = 4,
        n_layers: int = 3,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.embed_dim = embed_dim
        self.geom_dim = geom_dim

        self.input_proj = nn.Linear(embed_dim + node_self_dim, d_model)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=4 * d_model,
            dropout=dropout, activation="gelu", batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(enc_layer, num_layers=n_layers)
        self.encoder_norm = nn.LayerNorm(d_model)

        edge_in = 4 * d_model + geom_dim
        self.edge_head = nn.Sequential(
            nn.Linear(edge_in, 256),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(128, 3),
        )

    def encode_nodes(
        self,
        node_feats: torch.Tensor,        # (B, N_max, embed+self)
        key_padding_mask: torch.Tensor,  # (B, N_max) bool, True = pad
    ) -> torch.Tensor:
        x = self.input_proj(node_feats)
        x = self.encoder(x, src_key_padding_mask=key_padding_mask)
        return self.encoder_norm(x)

    def score_pairs(
        self,
        h: torch.Tensor,          # (B, N_max, d_model)
        pair_batch: torch.Tensor, # (M,) batch indices
        pair_i: torch.Tensor,     # (M,) node i indices
        pair_j: torch.Tensor,     # (M,) node j indices
        geom_ij: torch.Tensor,    # (M, geom_dim)
    ) -> torch.Tensor:
        h_i = h[pair_batch, pair_i]
        h_j = h[pair_batch, pair_j]
        feat = torch.cat([h_i, h_j, h_i * h_j, (h_i - h_j).abs(), geom_ij], dim=-1)
        return self.edge_head(feat)

    def forward(
        self,
        node_feats: torch.Tensor,
        key_padding_mask: torch.Tensor,
        pair_batch: torch.Tensor,
        pair_i: torch.Tensor,
        pair_j: torch.Tensor,
        geom_ij: torch.Tensor,
    ) -> torch.Tensor:
        h = self.encode_nodes(node_feats, key_padding_mask)
        return self.score_pairs(h, pair_batch, pair_i, pair_j, geom_ij)


# ============================================================================
#  Inference-time single-image convenience (no batching)
# ============================================================================


@torch.no_grad()
def score_pairs_single_image(
    model: AssociationTransformer,
    node_feats: torch.Tensor,   # (N, embed+self)
    pair_idx: torch.Tensor,      # (M, 2) with i, j
    geom_ij: torch.Tensor,       # (M, geom_dim)
    device: torch.device,
) -> torch.Tensor:
    """Score candidate pairs from a single image. Returns (M, 3) logits."""
    node_feats = node_feats.to(device).unsqueeze(0)       # (1, N, D)
    mask = torch.zeros(1, node_feats.shape[1], dtype=torch.bool, device=device)
    h = model.encode_nodes(node_feats, mask)              # (1, N, d)
    M = pair_idx.shape[0]
    pair_batch = torch.zeros(M, dtype=torch.long, device=device)
    pair_i = pair_idx[:, 0].to(device)
    pair_j = pair_idx[:, 1].to(device)
    geom_ij = geom_ij.to(device)
    return model.score_pairs(h, pair_batch, pair_i, pair_j, geom_ij)
