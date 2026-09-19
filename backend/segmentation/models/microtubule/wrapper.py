"""Microtubule instance segmentation model wrapper (SPARSE35 ep040).

Wraps the microtubule package -- an nnU-Net ResEnc-M semantic stage plus a
curvature-bounded instancer -- so the ModelLoader can drive it through the same
``load_weights`` / ``predict`` surface used by the other models.

TWO callers share this package, so it is not free to change:

- the ML service's interactive per-frame segmentation (this repo's queue), and
- the Automated Essays batch assay (``backend/essays/module``), which imports
  it via ``_mt_package.ensure_on_path()`` rather than keeping its own copy.

They used to be separate copies that silently drifted apart. Re-verify BOTH
paths when changing this file or anything under ``instance/``.

What changed on 2026-09-19 (v5H -> SPARSE35 ep040)
---------------------------------------------------
Read ``MODEL_CARD.md`` next to this file for the model itself. The wrapper
changed in three places, each of them so that the deployed pipeline is the
pipeline the model was MEASURED with (the declared read of 2026-09-15, run with
``eval_v5.py --infer-scale 1.0 --no-fov`` and ``params_a_derived.json``):

- **The network runs at NATIVE resolution.** v5H upscaled the image by 1.5x
  before the network. The synthetic training frames are rendered on
  native-resolution backgrounds and never upscaled, and inference at the
  training scale was worth +0.02 to +0.05 F1 on every real block it was tried
  on. Only the PROBABILITIES are resampled to the 1.5x frame afterwards, because
  the instancer's constants (tolerances, ``min_length``, the curvature bound)
  are defined there. Output coordinates are mapped back, so callers never see
  the 1.5x.
- **The instancer vector is DERIVED, not fitted.** ``params_sparse35.json``
  carries ``min_length`` 15.0 at the 1.5x scale (the rule ``3 x tolerance``,
  declared before any number was read) instead of v5H's 44.74 fitted on real
  validation frames. The user-visible effect is that short microtubules that
  the network finds are no longer dropped: on an oracle mask the 44.74 filter
  alone cost 0.30 of centerline-F1.
- **Foreground cut 0.98**, the model's own optimum on the roi303 validation
  block (13-node sweep at per-model thresholds). It is not a user setting; see
  ``DEFAULT_SEED_THRESHOLD``.

Inference precision matches the measurement too: bf16 autocast on CUDA, the
tile stride the evaluation harness uses, the same whole-frame percentile
normalisation.
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

#: Name of the deployed model, for logs and error messages.
MODEL_NAME = "SPARSE35 ep040"

#: Scale of the INSTANCER's frame relative to the input. The network runs at
#: native scale; its probabilities are resampled by this factor before
#: instancing, because every instancer constant (tolerance, min_length, the
#: curvature bound) is defined on the 1.5x frame the benchmark is scored on.
UP = 1.5

#: Hard curvature bound, rad/px. Derived from data, never read from the params
#: file -- just above the 0.239 rad/px maximum over 957 human-annotated
#: microtubules at an 8 px baseline. Microtubules bend; they do not kink.
KAPPA_MAX = 0.25

DEFAULT_PARAMS_PATH = _PKG_DIR / "params_sparse35.json"


def _normalize(a: np.ndarray, p: tuple[float, float] = (1.0, 99.0)) -> np.ndarray:
    """Percentile stretch over the whole frame -- exactly what training and the
    evaluation harness use (``train_v5.norm01``).

    An FOV-restricted variant was tested upstream and lost on validation
    (0.412 vs 0.438). Do not "improve" this without re-measuring: the model was
    fitted to this input distribution.
    """
    lo, hi = np.percentile(a, p)
    return np.clip((a - lo) / (hi - lo + 1e-6), 0.0, 1.0)


def eval_shape(shape: tuple[int, int], up: float = UP) -> tuple[int, int]:
    """Shape of the 1.5x instancer frame for a native ``(H, W)`` -- scipy's own
    rounding, the same the evaluation harness uses (``eval_v5.eval_frame_shape``),
    so a resampled probability map lines up with ``zoom(mask, UP)``."""
    return tuple(int(round(s * up)) for s in shape)


def resample_to_eval(ch: np.ndarray, target_hw: tuple[int, int]) -> np.ndarray:
    """Resample a ``(C, h, w)`` probability stack to the instancer frame,
    bilinear per channel. Transcribed from ``eval_v5.resample_to_eval`` so the
    deployed map is the measured map; identity when the shape already matches."""
    from scipy.ndimage import zoom

    if tuple(ch.shape[1:]) == tuple(target_hw):
        return np.asarray(ch, np.float32)
    f = (target_hw[0] / ch.shape[1], target_hw[1] / ch.shape[2])
    out = np.stack(
        [zoom(np.asarray(c, np.float32), f, order=1, mode="nearest") for c in ch]
    ).astype(np.float32)
    if tuple(out.shape[1:]) != tuple(target_hw):
        raise ValueError(f"resampled to {out.shape[1:]}, expected {target_hw}")
    return out


def _simplify_polyline(cl: np.ndarray, eps_px: float) -> np.ndarray:
    """Ramer-Douglas-Peucker simplification of one centerline, INPUT-px space.

    This is output formatting, not instancing: it runs after the instancer's
    ``ds``-spaced grid has already been traced and junction-matched, so it
    changes only how densely the accepted geometry is stored, never which
    filaments are found. ``cv2.approxPolyDP(..., closed=False)`` always keeps
    the first and last point of an open curve, so endpoints survive.

    Mirrors the fallback commit 39b6493c used for the v7-era wrapper: a
    centerline too short to simplify, or one that collapses to under 2 points
    (eps too large for its extent), or a `cv2` failure on a malformed
    centerline, all degrade to the ORIGINAL (unsimplified) curve rather than
    dropping the microtubule from the frame.
    """
    if eps_px <= 0 or cl.shape[0] <= 2:
        return cl
    try:
        import cv2

        cv_pts = cl.astype(np.float32).reshape(-1, 1, 2)
        simplified = cv2.approxPolyDP(cv_pts, float(eps_px), closed=False)
        cl_simp = simplified.reshape(-1, 2).astype(np.float64)
        if cl_simp.shape[0] >= 2:
            return cl_simp
        logger.warning(
            "RDP collapsed centerline to %d pts (eps=%.2f px); keeping "
            "original (%d pts)",
            cl_simp.shape[0],
            eps_px,
            cl.shape[0],
        )
    except Exception as exc:  # noqa: BLE001 -- one bad centerline must not
        # abort the whole inference and lose every other MT in the frame.
        logger.warning(
            "polyline simplification failed on shape=%s: %s; using unsimplified",
            cl.shape,
            exc,
        )
    return cl


class MicrotubuleModel:
    """Semantic stage + instancer. Load once, then predict many frames.

    Unlike HRNet / UNet / CBAM (pure ``nn.Module`` networks), this class is a
    thin orchestrator: the network is a ``ResidualEncoderUNet`` and the
    postprocessing is :func:`instance.instancer_a.instance_a`, which has no
    learned weights at all.
    """

    #: Foreground cut. The shipped params vector carries 0.98 -- SPARSE35's own
    #: optimum on the roi303 validation block under the declared metric (the
    #: 13-node sweep 0.50..0.999 at per-model thresholds; the htw block
    #: preferred 0.995, and one value had to be chosen for production). The
    #: ModelLoader's generic 0.5 default would flood the instancer with noise.
    DEFAULT_SEED_THRESHOLD: float = 0.98

    def __init__(self) -> None:
        self._model: Optional[Any] = None
        self._device: Optional[str] = None
        self._ckpt_path: Optional[Path] = None
        self._params: Optional[dict] = None

    @property
    def params(self) -> dict:
        """Instancer hyperparameters: the DERIVED vector (``params_sparse35.json``).

        Underscore-prefixed keys are provenance notes, not parameters, and
        ``kappa_max`` is a constant of the method, never read from a file.
        """
        if self._params is None:
            params = json.loads(DEFAULT_PARAMS_PATH.read_text())
            params = {k: v for k, v in params.items() if not k.startswith("_")}
            params.pop("kappa_max", None)
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
                f"microtubule {MODEL_NAME} checkpoint not found at {path} (~535 MB). "
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
            "Loaded microtubule %s from %s on %s (head width %d)",
            MODEL_NAME,
            path,
            self._device,
            width,
        )
        return self

    def _channels(self, img01: np.ndarray) -> np.ndarray:
        """Tiled prediction over a NATIVE-resolution, already-normalised frame.

        Returns ``(C, H, W)`` in [0, 1]; C is 1 for this checkpoint. Tiles
        overlap and are averaged, so a filament crossing a tile seam is not cut
        in two. The tile is 512 because the eight-stage plan downsamples seven
        times and the residual adds need the input divisible by 128 -- the v4b
        package's 518 (DINOv2's /14 patch grid) is not, and would fail at run
        time rather than at load time. The stride is the evaluation harness's
        (``train_v5.predict``: ``round(512 * 392 / 518)`` = 387), and on CUDA
        the forward pass runs under bf16 autocast, as the measurement did.
        """
        import torch

        from net import IMA_M, IMA_S, STRIDE, TILE

        mean = torch.tensor(IMA_M).view(3, 1, 1)
        std = torch.tensor(IMA_S).view(3, 1, 1)
        height, width = img01.shape
        use_bf16 = str(self._device).startswith("cuda")

        def _starts(extent: int) -> list[int]:
            starts = list(range(0, max(1, extent - TILE + 1), STRIDE)) or [0]
            if starts[-1] != max(0, extent - TILE):
                starts.append(max(0, extent - TILE))
            return starts

        acc = cnt = None
        with torch.no_grad():
            for y in _starts(height):
                for x in _starts(width):
                    tile = img01[y : y + TILE, x : x + TILE]
                    th, tw = tile.shape
                    # The eight-stage ResEnc plan downsamples seven times, so its
                    # residual adds need every side divisible by 128. A full tile
                    # is 512 and satisfies that; a frame SMALLER than the tile
                    # does not, and the last tile of a frame that is not a
                    # multiple of the stride does not either. Unpadded, those
                    # reached the network and died on a shape mismatch deep in
                    # the decoder -- "size of tensor a (13) must match tensor b
                    # (12)" for a 200 px frame -- which says nothing about the
                    # image being too small. Measured before this: 200, 300 and
                    # 341 px all failed, 384 and 512 passed, and non-square
                    # failed per axis.
                    #
                    # Reflect, not zeros: after the percentile stretch the frame
                    # is in [0, 1] and IRM microtubules are DARK, so a constant-0
                    # border is precisely the thing the instancer is hunting for.
                    # Reflection keeps the local statistics the network was
                    # trained on. The output is cropped back to (th, tw) below,
                    # so nothing found inside the padding can survive. The
                    # evaluation harness has no padding at all: every benchmark
                    # frame is at least 512 px, so this branch never fires there
                    # and the two paths are identical on such frames.
                    pad_h = (-th) % 128
                    pad_w = (-tw) % 128
                    if pad_h or pad_w:
                        # np.pad's reflect needs the pad to be smaller than the
                        # extent; fall back to edge replication for a frame too
                        # small to reflect (under 128 px on a side).
                        mode = "reflect" if pad_h < th and pad_w < tw else "edge"
                        tile = np.pad(tile, ((0, pad_h), (0, pad_w)), mode=mode)
                    t = torch.from_numpy(tile.astype(np.float32))[None].repeat(3, 1, 1)
                    t = ((t - mean) / std)[None].to(self._device)
                    with torch.autocast("cuda", dtype=torch.bfloat16, enabled=use_bf16):
                        out = self._model(t)
                    while isinstance(out, (tuple, list)):
                        out = out[0]   # deep supervision off, but be defensive
                    out = torch.sigmoid(out.float())[0].cpu().numpy()
                    if acc is None:
                        acc = np.zeros((out.shape[0], height, width), dtype=np.float64)
                        cnt = np.zeros((height, width), dtype=np.float64)
                    acc[:, y : y + th, x : x + tw] += out[:, :th, :tw]
                    cnt[y : y + th, x : x + tw] += 1
        return acc / np.maximum(cnt, 1)[None]

    def infer_maps(self, image_np: np.ndarray) -> dict:
        """The probability maps ``predict`` is built on, exposed for verification.

        Returns ``{'prob': (H, W) float32 native, 'chans_eval': (C, 1.5H, 1.5W)
        float32, 'prob_eval': (1.5H, 1.5W) float32}``. ``prob_eval`` is what the
        instancer thresholds; the reference fixture pins it.
        """
        if self._model is None:
            raise RuntimeError("Model not loaded. Call load_weights() first.")
        img = np.asarray(image_np)
        if img.ndim == 3:
            img = img.mean(axis=-1)
        if img.ndim != 2:
            raise ValueError(f"expected 2D image, got shape {img.shape}")
        img01 = _normalize(img.astype(np.float64))
        chans = self._channels(img01)                                   # native
        chans_eval = resample_to_eval(chans, eval_shape(img01.shape))   # instancer frame
        return {
            "prob": chans.max(axis=0).astype(np.float32),
            "chans_eval": chans_eval,
            "prob_eval": chans_eval.max(axis=0),
        }

    def predict(
        self,
        image_np: np.ndarray,
        seed_threshold: Optional[float] = None,
        params: Optional[dict] = None,
    ) -> dict:
        """Run the model on a single 2D grayscale frame.

        Args:
            image_np: numpy ndarray of shape ``(H, W)`` -- an IRM/TIRF intensity
                frame. Higher-dimension arrays are reduced to grayscale (mean
                over the channel axis) for convenience.
            seed_threshold: Foreground cut applied to the probability map before
                instancing. ``None`` uses the shipped params vector's
                ``prob_thr`` (0.98), which is what the model was measured with.
            params: Overrides of the instancer hyperparameters. Also accepts
                ``polyline_eps_px`` (default from params_sparse35.json), the RDP
                tolerance applied to the OUTPUT geometry -- see
                :func:`_simplify_polyline`. It is not read by ``instance_a``;
                the instancer's working resolution stays ``ds``, unaffected.

        Returns:
            ``{
                'centerlines_rc': list[(M_i, 2) float64],  # row, col, INPUT px
                'prob':           (H, W) float32,          # foreground prob, INPUT px
            }``

            Note the absence of ``embedding_samples``: it is gone rather than
            empty, so a consumer that was not updated fails loudly instead of
            silently tracking on zeros.
        """
        from instance.instancer_a import instance_a

        maps = self.infer_maps(image_np)   # raises the same errors predict used to
        merged = {**self.params, **(params or {})}
        thr = (
            seed_threshold
            if seed_threshold is not None
            else merged.get("prob_thr", self.DEFAULT_SEED_THRESHOLD)
        )
        chans_eval, prob_eval = maps["chans_eval"], maps["prob_eval"]

        # return_masks=False: this method reads only `polylines`, and so does
        # every caller of it (interactive segmentation via
        # ModelLoader.predict_microtubule, the essays batch via evaluate.py /
        # infer.py) — all of them consume `centerlines_rc` and `prob`. Building
        # one full-frame boolean mask per polyline only to drop it cost 0.38 GB
        # and 0.133 s on a real 1476x1924 production frame, 2.84 GB on a dense
        # 2048^2 essays position. See instance_a's docstring.
        polylines, _ = instance_a(
            prob_eval > thr, KAPPA_MAX, merged, channels=chans_eval, prob=prob_eval,
            return_masks=False,
        )

        # instance_a returns (x=col, y=row) at the 1.5x instancer scale. Every
        # downstream consumer -- mt_measure, mt_metrics, the essays adapter --
        # reads (row, col) at INPUT scale, so transpose and rescale here. A
        # silent flip is the single most expensive bug this pipeline has
        # shipped, twice; test_microtubule_model.py pins the orientation.
        centerlines_rc = [
            np.asarray(pl, dtype=np.float64)[:, ::-1] / UP for pl in polylines
        ]

        # RDP simplification, in INPUT-px space (after the /UP rescale above,
        # so `polyline_eps_px` means what it says: pixels of the frame that
        # was passed in, not the 1.5x instancer scale). This is the ONE
        # chokepoint both callers share -- interactive segmentation via
        # ModelLoader.predict_microtubule() and the essays batch worker via
        # `evaluate.py` / `infer.py` -- both consume `centerlines_rc` from
        # this method and neither has its own copy of the geometry. See
        # _simplify_polyline for the endpoint-preserving, fail-open contract.
        eps_px = float(merged.get("polyline_eps_px", 0.0) or 0.0)
        if eps_px > 0:
            centerlines_rc = [_simplify_polyline(cl, eps_px) for cl in centerlines_rc]

        # The network ran at input resolution, so its map IS the caller's frame:
        # no resampling back, no shape fitting.
        return {"centerlines_rc": centerlines_rc, "prob": maps["prob"]}
