"""cbDice: Centerline Boundary Dice Loss (MICCAI 2024, arxiv 2407.01517).

Generalization of clDice for tubular structures where diameter varies within
the same shape — fixes the "diameter imbalance" weakness of clDice by
weighting centerline points with local radius information.

Formulation (simplified from the paper for single-channel binary masks):

  P  = predicted mask probability (H, W)
  G  = GT mask                     (H, W)
  P* = soft skeleton of P          (same shape, obtained via iterative soft erosion)
  G* = soft skeleton of G

  t_prec = (P* · G) / (P* + ε)                           standard clDice precision
  t_rec  = (G* · P) / (G* + ε)                           standard clDice recall
  clDice = 2 · (t_prec · t_rec) / (t_prec + t_rec + ε)

  cb_prec = (P* · G · r_G) / (P* · r_G + ε)              r-weighted: radius of G at centerline points
  cb_rec  = (G* · P · r_P) / (G* · r_P + ε)              r-weighted: radius of P at centerline points
  cbDice  = 2 · (cb_prec · cb_rec) / (cb_prec + cb_rec + ε)

  loss = 1 - cbDice

Radius map `r_X` is a soft distance-transform style map: distance to nearest
background pixel. Approximated here by repeated min-pooling (max over neighborhood
of inverse mask) for differentiability.

Reduces to clDice when r_X = 1 everywhere (no radius info). For thin tails
with varying thickness, cbDice down-weights thick regions and up-weights thin
ones so clDice's single-pixel-centerline bias is preserved without over-
emphasizing narrow spots.
"""

from typing import Optional

import torch
import torch.nn as nn
import torch.nn.functional as F


def _soft_erode(x: torch.Tensor) -> torch.Tensor:
    """Soft binary erosion via 3×3 min-pooling, differentiable."""
    # Min-pool = -max_pool(-x)
    return -F.max_pool2d(-x, kernel_size=3, stride=1, padding=1)


def _soft_dilate(x: torch.Tensor) -> torch.Tensor:
    return F.max_pool2d(x, kernel_size=3, stride=1, padding=1)


def _soft_open(x: torch.Tensor) -> torch.Tensor:
    return _soft_dilate(_soft_erode(x))


def soft_skeleton(x: torch.Tensor, n_iter: int = 10) -> torch.Tensor:
    """Approximate soft skeleton via iterative morphological opening subtraction.

    Input: x in [0, 1] with shape (..., H, W). Output: same shape, centerline
    activations in [0, 1].
    """
    skel = F.relu(x - _soft_open(x))
    x_t = x
    for _ in range(n_iter):
        x_t = _soft_erode(x_t)
        opened = _soft_open(x_t)
        delta = F.relu(x_t - opened)
        skel = torch.clamp(skel + (1.0 - skel) * delta, 0.0, 1.0)
    return skel


def soft_radius_map(mask: torch.Tensor, n_iter: int = 16) -> torch.Tensor:
    """Approximate distance-to-boundary for each pixel inside `mask`.

    Iteratively erodes: pixels surviving k erosions get value k (normalized to
    [0, 1] by n_iter). Fully differentiable via soft min-pool.

    Returns tensor same shape as `mask`, values in [0, 1]: 0 at boundary, 1 deep
    inside thick structures. For thin tails this is ~0 everywhere, for wide
    heads it approaches 1 in center.
    """
    x = mask
    acc = torch.zeros_like(mask)
    for k in range(1, n_iter + 1):
        x = _soft_erode(x)
        acc = acc + x  # sum survival indicators
    # Normalize so thick region max → 1
    acc = acc / float(n_iter)
    # Clamp and keep only within-mask values
    return acc.clamp(0.0, 1.0) * mask


def cbdice_loss(
    pred: torch.Tensor,     # (..., H, W) sigmoid probability in [0, 1]
    target: torch.Tensor,   # (..., H, W) binary {0, 1}
    eps: float = 1e-6,
    skel_iters: int = 10,
    radius_iters: int = 16,
) -> torch.Tensor:
    """Centerline-Boundary Dice loss for single-channel probability maps.

    Accepts 2-D (H, W), 3-D (N, H, W), or 4-D (N, 1, H, W) tensors. Averages
    across the batch dimension.
    """
    if pred.dim() == 2:
        pred = pred.unsqueeze(0).unsqueeze(0)
        target = target.unsqueeze(0).unsqueeze(0)
    elif pred.dim() == 3:
        pred = pred.unsqueeze(1)
        target = target.unsqueeze(1)

    P = pred
    G = target.float()

    P_skel = soft_skeleton(P, n_iter=skel_iters)
    G_skel = soft_skeleton(G, n_iter=skel_iters)

    # Radius maps
    r_G = soft_radius_map(G, n_iter=radius_iters) + eps
    r_P = soft_radius_map(P, n_iter=radius_iters) + eps

    # Precision: "how much of predicted skeleton lies on GT?", r_G-weighted
    cb_prec_num = (P_skel * G * r_G).sum(dim=(-1, -2))
    cb_prec_den = (P_skel * r_G).sum(dim=(-1, -2)) + eps
    cb_prec = cb_prec_num / cb_prec_den

    # Recall: "how much of GT skeleton is covered by prediction?", r_P-weighted
    cb_rec_num = (G_skel * P * r_P).sum(dim=(-1, -2))
    cb_rec_den = (G_skel * r_P).sum(dim=(-1, -2)) + eps
    cb_rec = cb_rec_num / cb_rec_den

    cbdice = 2.0 * cb_prec * cb_rec / (cb_prec + cb_rec + eps)
    return (1.0 - cbdice).mean()


class CBDiceLoss(nn.Module):
    """Module wrapper around `cbdice_loss`. Stateless, for config convenience."""

    def __init__(self, eps: float = 1e-6, skel_iters: int = 10, radius_iters: int = 16):
        super().__init__()
        self.eps = eps
        self.skel_iters = skel_iters
        self.radius_iters = radius_iters

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        return cbdice_loss(pred, target, eps=self.eps,
                            skel_iters=self.skel_iters, radius_iters=self.radius_iters)


__all__ = ["cbdice_loss", "CBDiceLoss", "soft_skeleton", "soft_radius_map"]
