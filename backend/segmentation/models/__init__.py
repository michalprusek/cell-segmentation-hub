"""Model architectures for segmentation microservice"""

from .hrnet import HRNetV2
from .resunet_advanced import AdvancedResUNet
from .resunet_small import ResUNetSmall

__all__ = ['HRNetV2', 'AdvancedResUNet', 'ResUNetSmall']