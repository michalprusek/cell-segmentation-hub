"""Neurite / soma semantic segmentation wrapper (nnU-Net v2 ResEnc-M, 2D).

Two-class semantic segmentation of neurons in fluorescence microscopy --
**neurite** (processes) and **soma** (cell body) -- from the tubulin channel
alone. Trained on expert annotations (Leica confocal Run_no.4, CVAT project 29
task 579) as ``Dataset102_NeuriteSoma``; 3 folds ensembled in logit space.

Held-out (grouped leave-one-condition-out) Dice: neurite 0.832, soma 0.915.

Runs WITHOUT ``nnunetv2`` installed
-----------------------------------
The ML image has torch / numpy / scipy / skimage / cv2 but not ``nnunetv2``, and
adding a dependency for one model is a much larger blast radius than
reimplementing the ~120 lines of inference it would supply. The *network* is
still nnU-Net's own (``dynamic_network_architectures``), built from the
checkpoint's own ``plans.json``; everything else -- normalisation, the sliding
window, the Gaussian tile weighting, the mirroring TTA and the fold ensemble --
is reproduced here from the upstream ``predict.py`` that was verified against
``nnUNetv2_predict`` at 99.9999 % pixel agreement (neurite IoU 0.999943).

Details that are load-bearing, and why
--------------------------------------
* **Logits accumulate; softmax happens exactly once, at the end.** Overlapping
  tiles, mirror variants and the three folds are all averaged in logit space.
  ``softmax(mean(logits)) != mean(softmax(logits))``, and the difference
  concentrates on the decision boundary -- i.e. on the thin faint processes this
  model is already weakest on. Upstream measured the mistake at 99.976 % pixel
  agreement while moving neurite coverage 0.638 % -> 0.646 %: agreement that high
  looks like success and was not. (This wrapper takes the argmax directly rather
  than softmaxing first; softmax is monotonic, so the label map is identical.
  What mattered was averaging in logit space.)
* **Tile origins come from nnU-Net's ``compute_steps_for_sliding_window``**,
  which places the LAST tile flush with the image edge. A plain ``range()``
  shifts every tile after the first.
* **The Gaussian tile weight floors its zeros** at the smallest non-zero value,
  so a pixel covered by exactly one tile cannot divide by zero.
* **Mirroring TTA** over the axes recorded in the checkpoint
  (``inference_allowed_mirroring_axes = (0, 1)`` -> 4 variants).

Normalisation -- read this before touching ``_preprocess``
-----------------------------------------------------------
There are TWO stages and both are part of the input definition:

1. a 1 - 99.5 percentile stretch to 8-bit, then
2. nnU-Net's per-image z-score.

The training polygons were drawn on frames that had already been through (1).
Upstream's CLI made (1) opt-in behind ``--raw-input`` because the operator knew
whether their frames were already stretched. **This service cannot know that** --
an upload is a PNG or a 16-bit TIFF with no provenance -- so (1) is applied
unconditionally here.

That costs nothing on input that was already stretched, and the reason is
structural rather than lucky: the stretch clips at least 1 % of pixels to 0 and
0.5 % to 255, so the 1.0 and 99.5 percentiles of its own output are exactly 0
and 255 and re-applying it is the identity map. **Measured** on the bundled
already-normalised 6657x6664 sample (2026-08-28, A5000, in this ML image):
percentiles of the stretched frame come back ``lo=0.0 hi=255.0``, **0 of
44 362 248 uint8 pixels change**, and the two label maps are **bit-identical** --
100.0000000 % pixel agreement, neurite and soma IoU 1.000000, coverage
0.6380 % / 3.2576 % either way. Both paths sit the same 51 px from the bundled
reference, which is the fp16 scatter between two GPU generations, not a
normalisation effect. (The z-score also washes out the affine part on its own:
``zscore(a*x + b) == zscore(x)`` for ``a > 0``. What survives it, and what stage
1 is actually for, is the CLIPPING -- on a raw 16-bit frame that is what removes
the long bright tail that would otherwise inflate the std and flatten exactly
the faint processes this model is already weakest on.)
"""

from __future__ import annotations

import importlib
import json
import logging
import os
import sys
from itertools import combinations
from pathlib import Path
from typing import Any, Optional, Sequence

import numpy as np

logger = logging.getLogger(__name__)

_PKG_DIR: Path = Path(__file__).resolve().parent

# The network definition is nnU-Net's `dynamic_network_architectures`. This repo
# already vendors it ONCE, for the microtubule v5H model (also an nnU-Net
# ResEnc-M). The copy shipped in the neurite-soma deployment package was diffed
# against it (`diff -r --exclude=__pycache__`) and is byte-identical, so this
# adds the existing tree to sys.path instead of a second copy -- the two
# microtubule copies that were allowed to exist drifted in opposite directions
# for months and neither side got the other's fix (see CLAUDE.md).
#
# This is a sys.path insert, not an import of `models.microtubule`: importing
# that package pulls in torch and the curvature instancer, which segmenting
# neurites does not need.
_SHARED_VENDOR: Path = _PKG_DIR.parent / "microtubule" / "vendor"
if str(_SHARED_VENDOR) not in sys.path:
    sys.path.insert(0, str(_SHARED_VENDOR))

DEFAULT_PARAMS_PATH: Path = _PKG_DIR / "params.json"

#: The label ids the network emits, and the polygon class each becomes. This is
#: the ONE place the mapping lives -- ``ModelLoader.predict_neurite_soma``
#: iterates it rather than repeating the literals -- and ``load_weights`` checks
#: it against the checkpoint's own ``dataset.json``, so a retrain that reorders
#: the labels fails at load instead of mislabelling every polygon it emits.
FOREGROUND_CLASSES: tuple[tuple[int, str], ...] = ((1, "neurite"), (2, "soma"))

#: The full label map the checkpoint must declare, background included.
EXPECTED_LABELS: dict[str, int] = {"background": 0, "neurite": 1, "soma": 2}


def compute_steps(
    image_size: Sequence[int], tile_size: Sequence[int], step_ratio: float = 0.5
) -> list[list[int]]:
    """Tile origins per axis, copied from nnU-Net's ``compute_steps_for_sliding_window``.

    The last tile is placed flush with the image edge, so the real stride is
    slightly SMALLER than ``step_ratio * tile``. A plain ``range(0, n, stride)``
    would shift every tile after the first and change the result.
    """
    target = [t * step_ratio for t in tile_size]
    num_steps = [
        int(np.ceil((i - k) / j)) + 1 for i, j, k in zip(image_size, target, tile_size)
    ]
    steps: list[list[int]] = []
    for dim in range(len(tile_size)):
        max_step = image_size[dim] - tile_size[dim]
        actual = max_step / (num_steps[dim] - 1) if num_steps[dim] > 1 else 1e11
        steps.append([int(np.round(actual * i)) for i in range(num_steps[dim])])
    return steps


def compute_gaussian(
    tile_size: Sequence[int],
    sigma_scale: float = 1.0 / 8,
    dtype: Any = None,
    device: str = "cuda",
):
    """Gaussian tile weight, normalised to max 1, with zeros floored.

    Zero weight at the tile corners would make the accumulator divide by zero
    wherever exactly one tile covers a pixel; nnU-Net floors the zeros to the
    smallest non-zero weight instead, and so does this.
    """
    import torch
    from scipy.ndimage import gaussian_filter

    if dtype is None:
        dtype = torch.float16
    tmp = np.zeros(tuple(tile_size))
    tmp[tuple(i // 2 for i in tile_size)] = 1
    g = gaussian_filter(tmp, [i * sigma_scale for i in tile_size], 0, mode="constant", cval=0)
    g = g / g.max()
    g[g == 0] = g[g != 0].min()
    return torch.from_numpy(g).to(dtype=dtype, device=device)


def mirror_combinations(mirror_axes: Sequence[int]) -> list[list[int]]:
    """Every non-empty subset of the allowed axes, as ``torch.flip`` dim tuples.

    Axes are recorded relative to the SPATIAL dims, so axis 0 is dim 2 of the
    (B, C, H, W) tensor.
    """
    dims = [a + 2 for a in mirror_axes]
    out: list[list[int]] = []
    for r in range(1, len(dims) + 1):
        out.extend(list(c) for c in combinations(dims, r))
    return out


def build_network(plans: dict, dataset_json: dict, configuration: str = "2d"):
    """Instantiate the exact network the checkpoint's plans describe.

    Four ``arch_kwargs`` entries are stored as dotted import strings rather than
    objects (JSON cannot hold a class); ``_kw_requires_import`` names them and
    they are resolved here the way nnU-Net resolves them.
    """
    cfg = plans["configurations"][configuration]
    arch = cfg["architecture"]
    kwargs = dict(arch["arch_kwargs"])

    for name in arch.get("_kw_requires_import", []):
        value = kwargs[name]
        if value is None:
            continue
        module_name, _, attr = value.rpartition(".")
        kwargs[name] = getattr(importlib.import_module(module_name), attr)

    module_name, _, cls_name = arch["network_class_name"].rpartition(".")
    cls = getattr(importlib.import_module(module_name), cls_name)

    return cls(
        input_channels=len(dataset_json["channel_names"]),
        num_classes=len(dataset_json["labels"]),
        deep_supervision=False,
        **kwargs,
    )


class NeuriteSomaModel:
    """3-class neurite/soma segmenter. Load once via :meth:`load_weights`, then
    call :meth:`predict` per frame.

    Not an ``nn.Module``: it holds a LIST of networks (one per fold) and drives
    its own sliding window, so it cannot flow through ``ModelLoader``'s generic
    ``torch.load`` + single-channel-sigmoid path.
    """

    def __init__(self) -> None:
        self._nets: list[Any] = []
        self._device: str = "cpu"
        self._patch: tuple[int, int] = (512, 512)
        self._num_classes: int = 3
        self._mirror_axes: tuple[int, ...] = ()
        self._params: Optional[dict] = None

    # ------------------------------------------------------------------ params
    @property
    def params(self) -> dict:
        """Inference configuration shipped beside this wrapper (see params.json)."""
        if self._params is None:
            self._params = json.loads(DEFAULT_PARAMS_PATH.read_text())
        return self._params

    # ------------------------------------------------------------------ loading
    def load_weights(
        self, weights_path: str | os.PathLike, device: Any = None
    ) -> "NeuriteSomaModel":
        """Build one network per fold and load the checkpoints into them.

        ``weights_path`` is a DIRECTORY (unlike every other model here, which
        ships one file): the ensemble is three ~560 MB checkpoints plus the
        ``plans.json`` that defines the architecture and the ``dataset.json``
        that defines the labels. They travel together because a retrain can
        change the architecture, and a checkpoint loaded against someone else's
        plans is a silent-garbage failure, not a loud one.
        """
        import torch

        directory = Path(weights_path)
        params = self.params
        configuration = params.get("configuration", "2d")
        folds = params.get("folds", [0, 1, 2])

        if not directory.is_dir():
            raise FileNotFoundError(
                f"neurite/soma weights directory not found at {directory} "
                f"(~1.6 GB: fold_0/1/2.pth + plans.json + dataset.json). "
                "Stage it with scripts/download-neurite-soma-weights.sh."
            )
        plans_path = directory / "plans.json"
        dataset_path = directory / "dataset.json"
        for required in (plans_path, dataset_path):
            if not required.is_file():
                raise FileNotFoundError(
                    f"neurite/soma weights directory {directory} is missing "
                    f"{required.name}; re-run scripts/download-neurite-soma-weights.sh."
                )

        plans = json.loads(plans_path.read_text())
        dataset_json = json.loads(dataset_path.read_text())

        # The class of every polygon this model emits is decided by an integer
        # id. If a retrain renumbers the labels, nothing downstream can tell --
        # neurites would simply come back tagged 'soma'. Check it here, where the
        # authority (the checkpoint's own dataset.json) is in hand.
        if dataset_json.get("labels") != EXPECTED_LABELS:
            raise ValueError(
                f"neurite/soma checkpoint declares labels {dataset_json.get('labels')}, "
                f"expected {EXPECTED_LABELS}. Polygon classes are assigned by label "
                "id, so loading this would mislabel every polygon; update "
                "FOREGROUND_CLASSES deliberately if the retrain really renumbered them."
            )

        dev_type = getattr(device, "type", str(device)) if device is not None else None
        if dev_type is None:
            dev_type = "cuda" if torch.cuda.is_available() else "cpu"
        self._device = "cuda" if dev_type == "cuda" else "cpu"

        self._patch = tuple(plans["configurations"][configuration]["patch_size"])
        self._num_classes = len(dataset_json["labels"])

        if not folds:
            raise ValueError(
                "neurite/soma params.json declares no folds; the validated model is "
                "the 3-fold ensemble [0, 1, 2] and a 0-fold load would 'succeed' and "
                "then fail on the first frame."
            )

        nets: list[Any] = []
        mirror_axes: tuple[int, ...] = ()
        first = True
        for fold in folds:
            ckpt_path = directory / f"fold_{fold}.pth"
            if not ckpt_path.is_file():
                raise FileNotFoundError(
                    f"neurite/soma fold {fold} checkpoint not found at {ckpt_path} "
                    "(~560 MB). Stage it with scripts/download-neurite-soma-weights.sh."
                )
            # weights_only=False: the checkpoint is a training blob that also
            # carries `inference_allowed_mirroring_axes`, which the TTA below
            # needs and which a tensors-only load would drop. Our own shipped
            # weights, not attacker-controlled input -- same argument the
            # generic loader makes for its fallback.
            blob = torch.load(ckpt_path, map_location="cpu", weights_only=False)
            net = build_network(plans, dataset_json, configuration)
            # strict (the default): these checkpoints match the plans exactly,
            # and a silently half-loaded ensemble member would degrade the mask
            # rather than fail.
            net.load_state_dict(blob["network_weights"])
            nets.append(net.eval().to(self._device))

            axes = tuple(blob.get("inference_allowed_mirroring_axes", ()) or ())
            if first:
                mirror_axes = axes
                first = False
            elif axes != mirror_axes:
                # Folds of one training run always agree. If they ever do not,
                # the folds are not from the same run and ensembling them is
                # meaningless -- fail rather than silently pick one.
                raise ValueError(
                    "neurite/soma folds disagree on inference_allowed_mirroring_axes "
                    f"({mirror_axes} vs {axes} at fold {fold}): the checkpoints are "
                    "not from the same training run."
                )

        self._nets = nets
        self._mirror_axes = mirror_axes if params.get("use_mirroring", True) else ()
        logger.info(
            "Loaded neurite/soma %d fold(s) %s on %s; patch %s, %d classes, "
            "mirroring axes %s",
            len(nets),
            folds,
            self._device,
            self._patch,
            self._num_classes,
            self._mirror_axes,
        )
        return self

    # ------------------------------------------------------------ preprocessing
    def _preprocess(self, raw: np.ndarray) -> np.ndarray:
        """Both normalisation stages. See the module docstring before changing.

        Stage 1 (1 - 99.5 percentile stretch to 8-bit) is applied
        UNCONDITIONALLY, unlike upstream's opt-in ``--raw-input``: this service
        receives uploads with no provenance and cannot know whether a frame has
        already been stretched. Re-applying it to an already-stretched frame is
        the exact identity -- measured, 0 of 44 M pixels changed; the module
        docstring has the numbers and the reason.
        """
        lo, hi = np.percentile(raw, [self.params["percentile_lo"], self.params["percentile_hi"]])
        stretched = np.clip((raw.astype(np.float32) - lo) / max(float(hi - lo), 1e-8), 0, 1)
        eight_bit = (stretched * 255).round().astype(np.uint8)

        x = eight_bit.astype(np.float32)
        return (x - x.mean()) / max(float(x.std()), 1e-8)

    # --------------------------------------------------------------- inference
    def _predict_logits(self, net, image) -> Any:
        """Gaussian-weighted sliding window over one normalised image (1, H, W).

        Returns class LOGITS, never probabilities -- see the module docstring.
        """
        import torch
        import torch.nn.functional as F

        patch = self._patch
        device = self._device
        _, height, width = image.shape
        pad_h, pad_w = max(0, patch[0] - height), max(0, patch[1] - width)
        if pad_h or pad_w:
            image = F.pad(image[None], (0, pad_w, 0, pad_h), mode="constant", value=0)[0]
        _, padded_h, padded_w = image.shape

        steps = compute_steps(
            (padded_h, padded_w), patch, self.params.get("tile_step_ratio", 0.5)
        )
        gaussian = compute_gaussian(
            patch,
            self.params.get("gaussian_sigma_scale", 0.125),
            dtype=torch.float16,
            device=device,
        )

        acc = torch.zeros(
            (self._num_classes, padded_h, padded_w), dtype=torch.float16, device=device
        )
        norm = torch.zeros((1, padded_h, padded_w), dtype=torch.float16, device=device)
        combos = mirror_combinations(self._mirror_axes)

        with torch.inference_mode():
            for y in steps[0]:
                for x in steps[1]:
                    tile = image[None, :, y : y + patch[0], x : x + patch[1]].to(device)
                    with torch.autocast(device_type=device, enabled=(device != "cpu")):
                        pred = net(tile)
                        for axes in combos:
                            pred = pred + torch.flip(net(torch.flip(tile, axes)), axes)
                    pred = pred / (1 + len(combos))
                    acc[:, y : y + patch[0], x : x + patch[1]] += pred[0].half() * gaussian
                    norm[:, y : y + patch[0], x : x + patch[1]] += gaussian

            acc /= norm
        return acc[:, :height, :width]

    def predict(self, image_np: np.ndarray) -> np.ndarray:
        """Segment one 2D grayscale frame at native resolution.

        Args:
            image_np: ``(H, W)`` intensity array of any dtype (uint8 PNG,
                uint16 TIFF, float). An ``(H, W, C)`` array is accepted only if
                every channel is identical -- an RGB render of a single
                grayscale channel -- because the model takes ONE channel and
                collapsing a genuinely multi-channel frame would feed it a
                mixture it never saw.

        Returns:
            ``(H, W)`` uint8 label map: 0 background, 1 neurite, 2 soma.
        """
        import torch

        if not self._nets:
            raise RuntimeError("Model not loaded. Call load_weights() first.")

        raw = np.asarray(image_np)
        if raw.ndim == 3:
            # Accept an RGB(A) render of ONE grayscale channel -- the common
            # shape of a web upload -- and nothing else. Averaging a genuinely
            # multi-channel frame would feed the model a mixture it never saw and
            # return confident polygons drawn on it, which is worse than a 500.
            # Every channel is compared, not just the first two: an R==G, B!=G
            # image is still not grayscale.
            if raw.shape[-1] == 1:
                raw = raw[..., 0]
            elif all(
                np.array_equal(raw[..., 0], raw[..., c]) for c in range(1, raw.shape[-1])
            ):
                raw = raw[..., 0]
            else:
                raise ValueError(
                    "neurite/soma expects a single tubulin channel; got a genuinely "
                    f"multi-channel image of shape {raw.shape}"
                )
        if raw.ndim != 2:
            raise ValueError(f"expected a 2D image, got shape {raw.shape}")

        tensor = torch.from_numpy(self._preprocess(raw))[None]

        logits = None
        for net in self._nets:
            fold_logits = self._predict_logits(net, tensor)
            logits = fold_logits if logits is None else logits + fold_logits
        logits /= len(self._nets)

        return logits.argmax(0).to("cpu").numpy().astype(np.uint8)

    # ---- PyTorch-compatible stubs (for ModelLoader uniformity) ---------------
    def eval(self) -> "NeuriteSomaModel":
        """Put every fold in eval mode (already set during load)."""
        for net in self._nets:
            net.eval()
        return self

    def to(self, device: Any) -> "NeuriteSomaModel":
        """Move every fold; the device is normally pinned in load_weights()."""
        dev_type = getattr(device, "type", str(device))
        self._device = "cuda" if dev_type == "cuda" else "cpu"
        for net in self._nets:
            net.to(self._device)
        return self

    def parameters(self):
        """Expose the first fold's parameters (used only for device introspection)."""
        return self._nets[0].parameters() if self._nets else iter([])
