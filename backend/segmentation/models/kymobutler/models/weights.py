"""ONNX model loading for the vendored KymoButler nets.

Vendored from upstream ``src/kymobutler/models/weights.py``, ONNX path only.

**The ``.pt`` path upstream falls back to is not merely unused here, it is
broken, and vendoring it would be shipping a landmine.** Upstream's
``scripts/convert_weights.py`` maps Mathematica parameters onto its own
hand-written ``nn.Module`` definitions by matching shape and sequential order,
and when a parameter finds no match it *keeps the randomly initialised tensor*
and prints a warning. Measured on this repo's copies of the four graphs:
bidirectional 112 of 136 tensors unmatched, unidirectional 109/138, decision
107/136, classifier 34/46. The resulting ``.pt`` models correlate with the ONNX
originals at r = 0.016 and segment the entire image as track. So
``convert_weights.py``, the ``.pt`` loader, and the ``models/unet.py`` /
``vision_net.py`` / ``classnet.py`` architecture definitions it needs are all
absent from this vendor tree by intent — see ``README.md``.

``onnx2torch`` is load-bearing rather than a convenience. The graphs declare a
STATIC ``[1, 1, 256, 256]`` input, so onnxruntime refuses every other size
outright; ``onnx2torch`` rebuilds the graph as an ordinary shape-agnostic torch
``nn.Module``, which is the only reason a 299x201 kymograph runs at all.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

import torch
import torch.nn as nn

from ..config import DEFAULT_MODEL_DIR, ONNX_FILES

logger = logging.getLogger(__name__)


class OnnxBiNet(nn.Module):
    """Bidirectional segmentation net: (B,1,H,W) -> (B,2,H,W) trackness."""

    def __init__(self, onnx_model: nn.Module):
        super().__init__()
        self.model = onnx_model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = self.model(x)  # (B, H, W) foreground probability
        if out.dim() == 3:
            return torch.stack([out, 1.0 - out], dim=1)
        return out


class OnnxUniNet(nn.Module):
    """Unidirectional segmentation net: two heads, ``ant`` and ``ret``."""

    def __init__(self, onnx_model: nn.Module):
        super().__init__()
        self.model = onnx_model

    def forward(self, x: torch.Tensor) -> dict:
        out = self.model(x)  # list of 2 tensors, each (B, H, W)
        ant = out[0] if isinstance(out, (list, tuple)) else out
        ret = (
            out[1]
            if isinstance(out, (list, tuple)) and len(out) > 1
            else torch.zeros_like(ant)
        )
        if ant.dim() == 3:
            ant = torch.stack([ant, 1.0 - ant], dim=1)
        if ret.dim() == 3:
            ret = torch.stack([ret, 1.0 - ret], dim=1)
        return {"ant": ant, "ret": ret}


class OnnxDecNet(nn.Module):
    """Decision module: image crop + track mask + skeleton mask -> (B,2,48,48)."""

    def __init__(self, onnx_model: nn.Module):
        super().__init__()
        self.model = onnx_model

    def forward(
        self,
        img: torch.Tensor,
        bin_mask: torch.Tensor,
        fullbin_mask: torch.Tensor,
    ) -> torch.Tensor:
        combined = torch.cat([img, bin_mask, fullbin_mask], dim=1)
        out = self.model(combined)  # (B, H, W, 2)
        if out.dim() == 4 and out.shape[-1] == 2:
            out = out.permute(0, 3, 1, 2)
        return out


_WRAPPERS = {"binet": OnnxBiNet, "uninet": OnnxUniNet, "decnet": OnnxDecNet}

# Process-wide model cache. The ML service is long-lived and answers many
# /kymograph calls; converting the three ONNX graphs costs ~4.6 s and ~275 MB,
# which is not something to pay per request. Keyed by (model_dir, device) so a
# test pointing KYMOBUTLER_MODEL_DIR at a fixture cannot be served the
# production nets. The lock makes the FIRST load exclusive: /kymograph is
# `async def` today, but the two other endpoints in this router are `def` and
# run on anyio's 40-slot threadpool, so concurrent first-touch is reachable.
_CACHE: dict[tuple[str, str], dict[str, nn.Module]] = {}
_CACHE_LOCK = threading.Lock()


def load_models(
    keys: tuple[str, ...],
    model_dir: str | Path | None = None,
    device: str = "cpu",
) -> dict[str, nn.Module]:
    """Load (and memoise) the requested KymoButler ONNX nets.

    Args:
        keys: any of ``"binet"``, ``"uninet"``, ``"decnet"``. Only what is asked
            for is loaded — the bidirectional path never touches the 124 MB
            unidirectional net, and vice versa.
        model_dir: directory holding the ``.onnx`` files. Defaults to
            ``backend/segmentation/weights/kymobutler``.
        device: ``"cpu"`` or ``"cuda"``.

    Raises:
        FileNotFoundError: naming the missing file and the staging script, so a
            fresh checkout gets an actionable message rather than an ONNX parse
            error.
    """
    directory = Path(model_dir) if model_dir else DEFAULT_MODEL_DIR
    cache_key = (str(directory.resolve()), device)

    with _CACHE_LOCK:
        loaded = _CACHE.setdefault(cache_key, {})
        missing = [k for k in keys if k not in loaded]
        for key in missing:
            path = directory / ONNX_FILES[key]
            if not path.exists():
                raise FileNotFoundError(
                    f"KymoButler weights missing: {path}. "
                    "Stage them with scripts/download-kymobutler-weights.sh"
                )
            logger.info("Loading KymoButler %s from %s on %s", key, path, device)
            loaded[key] = _load_onnx(key, path, device)
        return {k: loaded[k] for k in keys}


def _load_onnx(key: str, path: Path, device: str) -> nn.Module:
    import onnx
    from onnx2torch import convert

    torch_model = convert(onnx.load(str(path)))
    wrapped = _WRAPPERS[key](torch_model)
    wrapped.to(device)
    wrapped.eval()
    return wrapped
