#!/usr/bin/env python3
"""Inference for the deployed fine-tuned ResNet-18 ensemble.

Averages the sigmoids of the three seeds, which is exactly the quantity that
was cross-validated (0.956 AUC). Taking one seed would be using a model whose
performance was never measured.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
import torchvision as tv
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
# VENDOR EDIT (3 of 4): the default weight path was a laptop Desktop path.
# `scripts/download-neurite-classifier-weights.sh` stages the bundle into the
# service weights tree, which is where the container's `SOMA_CLF` points.
DEFAULT = Path(os.environ.get(
    'SOMA_CLF', str(Path(__file__).resolve().parents[2]
                    / 'weights' / 'neurite_soma_classifier.pt')))

# VENDOR EDIT (4 of 4): CUDA added to the device ladder. The research code ran
# on a Mac, so it chose between `mps` and `cpu` and would have pinned this
# server's 3-seed ResNet-18 ensemble to the CPU -- for ~170 soma crops per
# frame that is the difference between seconds and minutes, on a box that also
# serves interactive segmentation.
if torch.cuda.is_available():
    DEV = 'cuda'
elif torch.backends.mps.is_available():
    DEV = 'mps'
else:
    DEV = 'cpu'
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
TF = tv.transforms.Compose([
    tv.transforms.Resize(256), tv.transforms.CenterCrop(224),
    tv.transforms.ToTensor(), tv.transforms.Normalize(MEAN, STD),
])


@lru_cache(maxsize=2)
def _load(path: str):
    b = torch.load(path, map_location='cpu', weights_only=False)
    nets = []
    for sd in b['state_dicts']:
        net = getattr(tv.models, b['arch'])()
        net.fc = torch.nn.Linear(net.fc.in_features, 1)
        net.load_state_dict(sd)
        net.eval().to(DEV)
        nets.append(net)
    return nets, b


def predict_images(images, path: Path = DEFAULT, batch: int = 32) -> np.ndarray:
    """p(NOT a neuronal soma) for in-memory PIL crops.

    The deployed model is embedding-only, so a crop image is everything it
    needs -- no expert polygon, no manifest row. That is what lets the
    classifier score instances the instancer invented, rather than only the
    3849 crops that were cut from expert annotation.
    """
    nets, _ = _load(str(path))
    out = []
    with torch.no_grad():
        for i in range(0, len(images), batch):
            x = torch.stack([TF(im.convert('RGB'))
                             for im in images[i:i + batch]]).to(DEV)
            ps = [torch.sigmoid(n(x).squeeze(1)).cpu().numpy() for n in nets]
            out.append(np.mean(ps, axis=0))
    return np.concatenate(out) if out else np.zeros(0)


def predict(samples, path: Path = DEFAULT, batch: int = 32) -> np.ndarray:
    """p(NOT a neuronal soma) for each sample, averaged over the seed ensemble."""
    nets, _ = _load(str(path))
    out = []
    with torch.no_grad():
        for i in range(0, len(samples), batch):
            x = torch.stack([TF(Image.open(s.path).convert('RGB'))
                             for s in samples[i:i + batch]]).to(DEV)
            ps = [torch.sigmoid(n(x).squeeze(1)).cpu().numpy() for n in nets]
            out.append(np.mean(ps, axis=0))
    return np.concatenate(out) if out else np.zeros(0)


def info(path: Path = DEFAULT) -> dict:
    return _load(str(path))[1]
