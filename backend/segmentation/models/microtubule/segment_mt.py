"""Microtubule instance segmentation via v7 (DINOv3-L + DPT + 32d embed) +
PySOAX postprocess.

Designed to run on tulen with:
  - dinov3_env activated (torch 2.5, transformers 4.57)
  - HF_TOKEN set or available at ~/.cache/huggingface/token
  - v7 ckpt at /home/prusek/BIOCEV/results/training_v7_dinov3l_v5arch/ckpt_ep09.pt
  - synth_irm package importable from .../synthmt_irm
  - pysoax module importable from .../convnext_instance_seg

Importing this module does NOT load torch — it only imports torch on demand
inside `segment_microtubules()`. Safe to import on any host.
"""
from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


PYSOAX_PARAMS_DEFAULT = {
    "min_snake_length": 17,
    "gaussian_std": 0.8784,
    "grouping_distance": 17.1466,
    "direction_threshold": 0.87,
    "orient_weight": 0.0,
    "embed_weight": 0.5,
    "ridge_threshold": 0.0354,
    "stretch_factor": 0.998,
    "alpha": 0.25,
    "beta": 0.06,
    "gamma": 4.597,
    "external_factor": 1.918,
    "max_iterations": 5000,
    "change_threshold": 0.001,
    "check_period": 100,
    "point_spacing": 1.0,
}


@dataclass
class SegmentationResult:
    centerlines_rc: list[np.ndarray]   # each (M_i, 2) row, col px coords
    seed_prob: np.ndarray              # (H, W) sigmoid map
    embedding: np.ndarray | None = None  # (32, H, W) — kept for diagnostics, may be None
    extra: dict = field(default_factory=dict)


def _ensure_imports(pysoax_module_dir: Path, synthmt_module_dir: Path):
    """Insert tulen-resident modules onto sys.path and import torch lazily."""
    if str(pysoax_module_dir) not in sys.path:
        sys.path.insert(0, str(pysoax_module_dir))
    if str(synthmt_module_dir) not in sys.path:
        sys.path.insert(0, str(synthmt_module_dir))

    if "HF_TOKEN" not in os.environ:
        token_path = os.path.expanduser("~/.cache/huggingface/token")
        if os.path.exists(token_path):
            os.environ["HF_TOKEN"] = open(token_path).read().strip()


def _normalize(img: np.ndarray) -> np.ndarray:
    img = img.astype(np.float32)
    if img.ndim != 2:
        img = img.squeeze()
    lo, hi = np.percentile(img, [1, 99.5])
    return np.clip((img - lo) / max(hi - lo, 1e-9), 0.0, 1.0)


def load_v7_model(ckpt_path: Path, device: str = "cuda"):
    """Load v7 model checkpoint. Requires synth_irm on sys.path.

    Follows the same safe-load policy as WoundModel and SegFormerModel: try
    ``weights_only=True`` first (mitigates CVE-2025-32434). The v7 checkpoint
    embeds custom dataclass instances (``ckpt["args"]``) that pickle cannot
    reconstruct under ``weights_only=True``, so the fallback is almost always
    needed. The fallback is enabled by default (``ALLOW_UNSAFE_WEIGHTS``
    defaults to ``"1"`` in the ML Dockerfile) because this is our own shipped
    checkpoint; set ``ALLOW_UNSAFE_WEIGHTS=0`` to refuse the fallback.
    """
    import torch
    from synth_irm.training.model_v4 import FilamentInstanceModelV4

    try:
        ckpt = torch.load(str(ckpt_path), map_location="cpu", weights_only=True)
    except Exception as e1:
        if os.getenv("ALLOW_UNSAFE_WEIGHTS", "1") != "1":
            logger.error(
                "load_v7_model: weights_only=True failed (%s) and "
                "ALLOW_UNSAFE_WEIGHTS is not set — refusing to load.",
                e1,
            )
            raise
        logger.warning(
            "load_v7_model: SECURITY — weights_only=True failed (%s); "
            "falling back to weights_only=False (arbitrary pickle). "
            "Safe only for trusted checkpoints (our own). "
            "Set ALLOW_UNSAFE_WEIGHTS=0 to refuse this fallback.",
            e1,
        )
        ckpt = torch.load(str(ckpt_path), map_location="cpu", weights_only=False)

    backbone = ckpt["args"].get("backbone", "facebook/dinov3-vitl16-pretrain-lvd1689m")
    model = FilamentInstanceModelV4(
        backbone_name=backbone,
        use_positional=False,
        fuse_layers=(6, 12, 18, 24),
        freeze_backbone_blocks=12,
    )
    model.load_state_dict(ckpt["model_state"])
    model.to(device).eval()
    return model


def predict_seed_embed(model, image_norm: np.ndarray, device: str = "cuda"):
    """Forward pass: returns (seed_prob (H, W), embed (32, H, W))."""
    import torch

    H, W = image_norm.shape
    Hp = ((H + 15) // 16) * 16
    Wp = ((W + 15) // 16) * 16
    pad = np.zeros((Hp, Wp), dtype=np.float32)
    pad[:H, :W] = image_norm
    x = (
        torch.from_numpy(pad)
        .float()
        .unsqueeze(0)
        .unsqueeze(0)
        .repeat(1, 3, 1, 1)
        .to(device)
    )
    with torch.no_grad():
        out = model(x)
    seed_prob = torch.sigmoid(out["seed_logit"])[0, 0].cpu().numpy()[:H, :W]
    embed = out["embedding"][0].cpu().numpy()[:, :H, :W]
    return seed_prob, embed


def segment_microtubules(
    irm: np.ndarray,
    *,
    ckpt_path: Path,
    pysoax_module_dir: Path,
    synthmt_module_dir: Path,
    device: str = "cuda",
    seed_thresh: float = 0.5,
    pysoax_params: dict | None = None,
    keep_embedding: bool = False,
) -> SegmentationResult:
    """End-to-end IRM → list of MT centerlines.

    Parameters
    ----------
    irm : (H, W) np.ndarray
        Single IRM frame. Will be percentile-normalized internally.
    ckpt_path : Path
        v7 checkpoint .pt file.
    pysoax_module_dir, synthmt_module_dir : Path
        Directories containing `pysoax.py` and the `synth_irm` package.

    Returns
    -------
    SegmentationResult with centerlines as list of (M_i, 2) row,col arrays.
    """
    if irm.ndim != 2:
        raise ValueError(f"expected (H, W) IRM, got {irm.shape}")
    _ensure_imports(Path(pysoax_module_dir), Path(synthmt_module_dir))

    image_norm = _normalize(irm) if irm.dtype != np.float32 or irm.max() > 2 else irm.astype(np.float32)

    model = load_v7_model(Path(ckpt_path), device=device)
    seed_prob, embed = predict_seed_embed(model, image_norm, device=device)

    binary = (seed_prob > seed_thresh).astype(np.uint8) * 255
    from pysoax import extract_soax_instances  # noqa: WPS433  (lazy import)
    instances = extract_soax_instances(
        binary, pysoax_params or PYSOAX_PARAMS_DEFAULT, embeddings=embed
    )
    centerlines: list[np.ndarray] = []
    for inst in instances:
        cl = np.asarray(inst["centerline"], dtype=np.float64)
        if cl.ndim == 2 and cl.shape[0] >= 2 and cl.shape[1] == 2:
            centerlines.append(cl)

    return SegmentationResult(
        centerlines_rc=centerlines,
        seed_prob=seed_prob,
        embedding=embed if keep_embedding else None,
        extra={"n_instances": len(centerlines), "seed_thresh": seed_thresh},
    )


if __name__ == "__main__":
    # Smoke test only runs on tulen.
    import argparse
    import time

    import tifffile

    ap = argparse.ArgumentParser()
    ap.add_argument("--irm", required=True, type=Path,
                    help="IRM frame (TIFF or npy)")
    ap.add_argument("--ckpt", type=Path,
                    default=Path("/home/prusek/BIOCEV/results/training_v7_dinov3l_v5arch/ckpt_ep09.pt"))
    ap.add_argument("--pysoax_dir", type=Path,
                    default=Path("/home/prusek/BIOCEV/code/microtubules/convnext_instance_seg"))
    ap.add_argument("--synthmt_dir", type=Path,
                    default=Path("/home/prusek/BIOCEV/code/microtubules/synthmt_irm"))
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()

    if args.irm.suffix.lower() in {".tif", ".tiff"}:
        irm = tifffile.imread(args.irm)
    else:
        irm = np.load(args.irm)
    t0 = time.time()
    res = segment_microtubules(
        irm,
        ckpt_path=args.ckpt,
        pysoax_module_dir=args.pysoax_dir,
        synthmt_module_dir=args.synthmt_dir,
        device=args.device,
    )
    print(f"segmented {len(res.centerlines_rc)} MTs in {time.time()-t0:.1f}s",
          flush=True)
