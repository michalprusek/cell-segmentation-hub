"""Neurite / soma semantic segmentation (nnU-Net v2 ResEnc-M, 2D, 3 classes)."""

from .wrapper import FOREGROUND_CLASSES as NEURITE_SOMA_CLASSES
from .wrapper import NeuriteSomaModel

__all__ = ["NeuriteSomaModel", "NEURITE_SOMA_CLASSES"]
