"""Model architectures for segmentation microservice"""

from .hrnet import HRNetV2
from .cbam_resunet import ResUNetCBAM
from .unet import UNet
from .unet_attention import UNet as UNetAttention

# Sperm model: optional import (loaded only when weights file is present)
try:
    from .sperm import SpermModel
except ImportError:
    SpermModel = None

# Wound model: optional import (requires segmentation_models_pytorch)
try:
    from .wound import WoundModel
except ImportError:
    WoundModel = None

__all__ = ['HRNetV2', 'ResUNetCBAM', 'UNet', 'UNetAttention', 'SpermModel', 'WoundModel']