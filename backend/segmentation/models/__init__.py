"""Model architectures for segmentation microservice"""

from .hrnet import HRNetV2
from .cbam_resunet import ResUNetCBAM
from .unet import UNet

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

# Microtubule v7 model: optional import. The package brings in DINOv3 (gated,
# needs HF_TOKEN) plus PySOAX postprocessing; ImportError here means transformers
# isn't installed or the weights aren't downloaded yet.
try:
    from .microtubule import MicrotubuleModel
except ImportError:
    MicrotubuleModel = None

# SegFormer-B0 spheroid model: optional import (requires transformers).
try:
    from .segformer import SegFormerModel
except ImportError:
    SegFormerModel = None

# Microcapsule model: optional import (distilled U-Net — needs
# segmentation_models_pytorch + scikit-image).
try:
    from .microcapsule import MicrocapsuleModel
except ImportError:
    MicrocapsuleModel = None

# Mamba-UNet spheroid model: optional import (requires mamba_ssm CUDA kernels).
# Catch OSError too: a present-but-ABI-mismatched .so raises OSError/ImportError
# on load, and we want that to disable only this model (with a log), not crash
# the whole package import.
try:
    from .mamba_unet import UMamba
except (ImportError, OSError) as _e:
    import logging as _logging

    _logging.getLogger(__name__).warning(
        "Could not import UMamba (Mamba-UNet): %s. Model unavailable.", _e
    )
    UMamba = None

__all__ = ['HRNetV2', 'ResUNetCBAM', 'UNet', 'SpermModel',
           'WoundModel', 'MicrotubuleModel', 'SegFormerModel', 'UMamba',
           'MicrocapsuleModel']