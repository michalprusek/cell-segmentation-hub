"""Model architectures for segmentation microservice"""

from .hrnet import HRNetV2
from .cbam_resunet import ResUNetCBAM

__all__ = ['HRNetV2', 'ResUNetCBAM']