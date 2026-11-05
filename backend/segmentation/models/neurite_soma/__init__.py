"""Neurite / soma semantic segmentation (nnU-Net v2 ResEnc-M, 2D, 3 classes)."""

from .wrapper import FOREGROUND_CLASSES as NEURITE_SOMA_CLASSES
from .wrapper import MERGED_PARAMS_PATH, NeuriteSomaModel

__all__ = ["MERGED_PARAMS_PATH", "NeuriteSomaModel", "NEURITE_SOMA_CLASSES"]
