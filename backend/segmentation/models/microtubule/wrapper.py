"""Microtubule instance segmentation model wrapper (v5H).

Wraps the v5H package -- an nnU-Net ResEnc-M semantic stage plus a
curvature-bounded instancer -- so the ModelLoader can drive it through the same
``load_weights`` / ``predict`` surface used by the other models.

TWO callers share this package, so it is not free to change:

- the ML service's interactive per-frame segmentation (this repo's queue), and
- the Automated Essays batch assay (``backend/essays/module``), which imports
  it via ``_mt_package.ensure_on_path()`` rather than keeping its own copy.

They used to be separate copies that silently drifted apart. Re-verify BOTH
paths when changing this file or anything under ``instance/``.

How this differs from the v7 wrapper it replaces
------------------------------------------------
- **No frozen backbone.** v7 was DINOv3-L + DPT and fetched a gated backbone
  from HuggingFace on first use. This checkpoint is a complete state_dict, so
  there is no ``HF_TOKEN``, no download, and no network access at run time.
- **One output channel, not a seed map plus a 32-d embedding field.** Nothing
  downstream receives ``embedding_samples`` any more. Cross-frame identity is
  established geometrically in ``api/mt_geometry_cost.py``.
- **The postprocessor is the instancer, not PySOAX.** Junction clusters are
  contracted, tangents fitted over a window, and each junction resolved by a
  min-cost perfect matching over its arms with a priced "leave this arm open"
  option. Every join is constrained by ``kappa <= 0.25 rad/px`` as a HARD
  constraint -- derived, not tuned: just above the 0.239 rad/px maximum over
  957 human-annotated microtubules at an 8 px baseline. Microtubules bend;
  they do not kink.

Inference runs at 1.5x upscale internally because that is the scale the model
was trained and evaluated at. Output coordinates are mapped back, so callers
never see the 1.5x.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Optional

import numpy as np

logger = logging.getLogger(__name__)

_PKG_DIR: Path = Path(__file__).resolve().parent

# ``instance.*`` and ``dynamic_network_architectures.*`` are absolute imports
# inside the vendored code, kept verbatim so the package can be re-synced from
# upstream without carrying a patch. They resolve only once these are on
# sys.path, so the insert happens at import time rather than inside predict().
for _extra_path in (_PKG_DIR, _PKG_DIR / "vendor"):
    if str(_extra_path) not in sys.path:
        sys.path.insert(0, str(_extra_path))

#: Internal working scale. Fixed by training; not a tunable.
UP = 1.5

#: Hard curvature bound, rad/px. Derived from data, never read from the params
#: file -- see the module docstring.
KAPPA_MAX = 0.25

DEFAULT_PARAMS_PATH = _PKG_DIR / "params_v5h.json"


def _normalize(a: np.ndarray, p: tuple[float, float] = (1.0, 99.0)) -> np.ndarray:
    """Percentile stretch over the whole frame -- exactly what training used.

    An FOV-restricted variant was tested upstream and lost on validation
    (0.412 vs 0.438). Do not "improve" this without re-measuring: the model was
    fitted to this input distribution.
    """
    lo, hi = np.percentile(a, p)
    return np.clip((a - lo) / (hi - lo + 1e-6), 0.0, 1.0)


class MicrotubuleModel:
    """Semantic stage + instancer. Load once, then predict many frames.

    Unlike HRNet / UNet / CBAM (pure ``nn.Module`` networks), this class is a
    thin orchestrator: the network is a ``ResidualEncoderUNet`` and the
    postprocessing is :func:`instance.instancer_a.instance_a`, which has no
    learned weights at all.
    """

    #: Foreground cut. The shipped params vector carries 0.97, fitted to this
    #: model's (very confident) foreground; the ModelLoader's generic 0.5
    #: default would flood the instancer with noise.
    DEFAULT_SEED_THRESHOLD: float = 0.97

    def __init__(self) -> None:
        self._model: Optional[Any] = None
        self._device: Optional[str] = None
        self._ckpt_path: Optional[Path] = None
        self._params: Optional[dict] = None

    @property
    def params(self) -> dict:
        """Instancer hyperparameters, fitted to THIS model's foreground.

        A large junction-contraction radius suits a shattered mask and damages
        a clean one, so v4b's vector would actively penalise this foreground.
        """
        if self._params is None:
            params = json.loads(DEFAULT_PARAMS_PATH.read_text())
            params.pop("kappa_max", None)   # derived, never read from a file
            self._params = params
        return self._params

    def load_weights(
        self,
        weights_path: str | os.PathLike,
        device: Optional[str] = None,
    ) -> "MicrotubuleModel":
        """Build the ResEnc-M network and load the checkpoint into it.

        The head width is read OFF the checkpoint rather than assumed. Upstream,
        a hard-coded default happened to match the models tested first, so the
        detection went unexercised until a 1-channel checkpoint reached it.
        """
        import torch

        from net import build, head_width

        path = Path(weights_path)
        if not path.is_file():
            raise FileNotFoundError(
                f"microtubule v5H checkpoint not found at {path} (~535 MB). "
                "Stage it with scripts/download-microtubule-weights.sh."
            )

        self._device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        state = torch.load(str(path), map_location=self._device)
        width = head_width(state)
        model = build(width).to(self._device).eval()
        model.load_state_dict(state)

        self._model = model
        self._ckpt_path = path
        logger.info(
            "Loaded microtubule v5H from %s on %s (head width %d)",
            path,
            self._device,
            width,
        )
        return self

    def _channels(self, img01: np.ndarray) -> np.ndarray:
        """Tiled prediction over an already-upscaled, already-normalised frame.

        Returns ``(C, H, W)`` in [0, 1]; C is 1 for this checkpoint. Tiles
        overlap and are averaged, so a filament crossing a tile seam is not cut
        in two. The tile is 512 because the eight-stage plan downsamples seven
        times and the residual adds need the input divisible by 128 -- the v4b
        package's 518 (DINOv2's /14 patch grid) is not, and would fail at run
        time rather than at load time.
        """
        import torch

        from net import IMA_M, IMA_S, TILE

        mean = torch.tensor(IMA_M).view(3, 1, 1)
        std = torch.tensor(IMA_S).view(3, 1, 1)
        stride = int(round(TILE * 0.757))
        height, width = img01.shape

        def _starts(extent: int) -> list[int]:
            starts = list(range(0, max(1, extent - TILE + 1), stride)) or [0]
            if starts[-1] != max(0, extent - TILE):
                starts.append(max(0, extent - TILE))
            return starts

        acc = cnt = None
        with torch.no_grad():
            for y in _starts(height):
                for x in _starts(width):
                    tile = img01[y : y + TILE, x : x + TILE]
                    th, tw = tile.shape
                    t = torch.from_numpy(tile.astype(np.float32))[None].repeat(3, 1, 1)
                    t = ((t - mean) / std)[None].to(self._device)
                    out = self._model(t)
                    if isinstance(out, (tuple, list)):
                        out = out[0]   # deep supervision off, but be defensive
                    out = torch.sigmoid(out)[0].float().cpu().numpy()
                    if acc is None:
                        acc = np.zeros((out.shape[0], height, width), dtype=np.float32)
                        cnt = np.zeros((height, width), dtype=np.float32)
                    acc[:, y : y + th, x : x + tw] += out[:, :th, :tw]
                    cnt[y : y + th, x : x + tw] += 1
        return acc / np.maximum(cnt, 1)[None]

    def predict(
        self,
        image_np: np.ndarray,
        seed_threshold: Optional[float] = None,
        params: Optional[dict] = None,
    ) -> dict:
        """Run v5H on a single 2D grayscale frame.

        Args:
            image_np: numpy ndarray of shape ``(H, W)`` -- an IRM/TIRF intensity
                frame. Higher-dimension arrays are reduced to grayscale (mean
                over the channel axis) for convenience.
            seed_threshold: Foreground cut applied to the probability map before
                instancing. ``None`` uses the shipped params vector's
                ``prob_thr`` (0.97), which is what the model was tuned with.
            params: Overrides of the instancer hyperparameters.

        Returns:
            ``{
                'centerlines_rc': list[(M_i, 2) float64],  # row, col, INPUT px
                'prob':           (H, W) float32,          # foreground prob
            }``

            Note the absence of ``embedding_samples``: it is gone rather than
            empty, so a consumer that was not updated fails loudly instead of
            silently tracking on zeros.
        """
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")

        from scipy.ndimage import zoom

        from instance.instancer_a import instance_a

        img = np.asarray(image_np)
        if img.ndim == 3:
            img = img.mean(axis=-1)
        if img.ndim != 2:
            raise ValueError(f"expected 2D image, got shape {img.shape}")

        height, width = img.shape
        merged = {**self.params, **(params or {})}
        thr = (
            seed_threshold
            if seed_threshold is not None
            else merged.get("prob_thr", self.DEFAULT_SEED_THRESHOLD)
        )

        img01 = zoom(_normalize(img.astype(np.float64)), UP, order=1)
        chans = self._channels(img01)
        prob_up = chans.max(axis=0)

        polylines, _ = instance_a(
            prob_up > thr, KAPPA_MAX, merged, channels=chans, prob=prob_up
        )

        # instance_a returns (x=col, y=row) at the 1.5x working scale. Every
        # downstream consumer -- mt_measure, mt_metrics, the essays adapter --
        # reads (row, col) at INPUT scale, so transpose and rescale here. A
        # silent flip is the single most expensive bug this pipeline has
        # shipped, twice; test_microtubule_model.py pins the orientation.
        centerlines_rc = [
            np.asarray(pl, dtype=np.float64)[:, ::-1] / UP for pl in polylines
        ]

        # Map the probability map back so callers see the frame they passed in.
        prob = zoom(prob_up, 1.0 / UP, order=1).astype(np.float32)
        if prob.shape != (height, width):
            fitted = np.zeros((height, width), dtype=np.float32)
            rows = min(height, prob.shape[0])
            cols = min(width, prob.shape[1])
            fitted[:rows, :cols] = prob[:rows, :cols]
            prob = fitted

        return {"centerlines_rc": centerlines_rc, "prob": prob}
