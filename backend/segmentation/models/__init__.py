"""Model architectures for segmentation microservice"""

from .hrnet import HRNetV2
from .cbam_resunet import ResUNetCBAM
from .unet import UNet

__all__ = ['HRNetV2', 'ResUNetCBAM', 'UNet']