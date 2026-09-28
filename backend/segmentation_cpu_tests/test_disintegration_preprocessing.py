"""The spheroid-disintegration model's input is deterministic and equals the paper's.

The paper's released ``spheroid_seg/predict.py`` pins CLAHE at
``clip_limit=(2.0, 2.0)`` on 8 x 8 tiles (spheroid_rozpad
paper/PREREG_F_CLAHE_PIN.md, 2026-09-28). Before that it passed a scalar 3.0,
which albumentations reads as the range (1, 3) and re-draws per image -- the
source of the run-to-run jitter the paper used to report. The app reimplements
the step with cv2 in ``models/disintegration.py``; these tests pin it:

* the clip limit is 2.0, and the output is what ``cv2.createCLAHE(2.0)`` gives
  and NOT what 1.0 or 3.0 give (a silent return to 3.0 fails here);
* the same image preprocessed twice is byte-identical, and -- where torch is
  installed -- the same image predicted twice gives the identical mask;
* where albumentations is installed, the app's array is bit-identical to the
  paper's ``A.CLAHE(clip_limit=(2.0, 2.0))`` + ``A.Normalize`` output.

CI installs cv2 but no torch (requirements-pytest-ci.txt), so the module is
loaded by path with a torch stand-in that lives only as long as the import;
see test_inference_serialisation.py for why the stand-in must not outlive it.
The torch and albumentations tests skip where those are absent.
"""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import sys
import types
from pathlib import Path

import cv2
import numpy as np
import pytest

_SEG = Path(__file__).resolve().parents[1] / "segmentation"
_MEAN = (0.485, 0.456, 0.406)
_STD = (0.229, 0.224, 0.225)


@contextlib.contextmanager
def _torch_or_stand_in():
    try:  # pragma: no cover - depends on the environment, not the code
        import torch  # noqa: F401
    except ImportError:  # pragma: no cover
        pass
    else:
        yield
        return
    stand_in = types.ModuleType("torch")
    stand_in.Tensor = object
    sys.modules["torch"] = stand_in
    try:
        yield
    finally:
        if sys.modules.get("torch") is stand_in:
            del sys.modules["torch"]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# By path, not `models.disintegration`: models/__init__ imports mamba_ssm ->
# Triton, which raises at import time on a machine without a CUDA driver.
with _torch_or_stand_in():
    dis = _load("_hub_disintegration_model", _SEG / "models" / "disintegration.py")


def _image(h: int = 301, w: int = 347, seed: int = 0) -> np.ndarray:
    """A grey spheroid-like frame, replicated to 3 channels as the app sends it.

    Textured enough that the clip limit changes the CLAHE output: a dark disk
    with a noisy halo on a bright, slowly varying background.
    """
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[:h, :w]
    r = np.hypot(yy - h / 2, xx - w / 2)
    g = 170 + 30 * np.sin(xx / 23.0) - 90 * (r < min(h, w) / 5)
    g = g + np.where(r < min(h, w) / 3, rng.normal(0, 25, (h, w)), rng.normal(0, 6, (h, w)))
    g = np.clip(g, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(np.stack([g] * 3, 2))


def _cv2_reference(rgb: np.ndarray, clip: float) -> np.ndarray:
    """CLAHE at ``clip``, then Normalize written out as albumentations 2.x does it
    for uint8 input: (v - 255*mean) * reciprocal(255*std), all float32."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=clip, tileGridSize=(8, 8)).apply(lab[:, :, 0])
    x = cv2.cvtColor(lab, cv2.COLOR_LAB2RGB).astype(np.float32)
    mean255 = np.array(_MEAN, np.float32) * 255.0
    inv = np.reciprocal(np.array(_STD, np.float32) * 255.0)
    return ((x - mean255) * inv).astype(np.float32)


def test_the_torch_stand_in_does_not_outlive_the_import():
    torch = sys.modules.get("torch")
    assert torch is None or hasattr(torch, "load")


def test_clip_limit_is_pinned_at_two_on_eight_by_eight_tiles():
    assert dis.CLAHE_CLIP_LIMIT == 2.0
    assert tuple(dis.CLAHE_TILE_GRID) == (8, 8)


def test_preprocessing_is_clahe_at_two_and_not_at_one_or_three():
    rgb = _image()
    got = dis.preprocess_array(rgb.copy())
    assert got.dtype == np.float32 and got.shape == rgb.shape
    assert np.array_equal(got, _cv2_reference(rgb, 2.0))
    # the synthetic frame is textured enough that the clip limit matters,
    # so a return to 3.0 (or 1.0) cannot pass the equality above by accident
    assert not np.allclose(got, _cv2_reference(rgb, 3.0), atol=1e-3)
    assert not np.allclose(got, _cv2_reference(rgb, 1.0), atol=1e-3)


def test_preprocessing_the_same_image_twice_is_byte_identical():
    rgb = _image(seed=3)
    a = dis.preprocess_array(rgb.copy())
    b = dis.preprocess_array(rgb.copy())
    assert hashlib.sha256(a.tobytes()).digest() == hashlib.sha256(b.tobytes()).digest()


def test_preprocessing_does_not_modify_the_caller_array():
    rgb = _image(seed=4)
    before = rgb.copy()
    dis.preprocess_array(rgb)
    assert np.array_equal(rgb, before)


def test_preprocessing_matches_the_papers_albumentations_transform():
    A = pytest.importorskip("albumentations")
    rgb = _image(seed=5)
    paper = A.Compose([A.CLAHE(clip_limit=(2.0, 2.0), tile_grid_size=(8, 8), p=1.0),
                       A.Normalize(mean=_MEAN, std=_STD)])
    ref = paper(image=rgb.copy())["image"]
    # bit-identical, not merely close: ~5e-7 of float noise was enough to flip
    # argmax ties on a real 48 h frame with the deposited weights
    np.testing.assert_array_equal(dis.preprocess_array(rgb.copy()), ref)


def test_two_predictions_of_the_same_image_are_identical():
    torch = pytest.importorskip("torch")
    torch.manual_seed(0)
    net = torch.nn.Sequential(
        torch.nn.Conv2d(3, 8, 3, padding=1), torch.nn.ReLU(),
        torch.nn.Conv2d(8, 3, 3, padding=1),
    ).eval()
    model = dis.DisintegrationModel()
    model._model, model._device = net, "cpu"
    rgb = _image(seed=7)           # 301 x 347: exercises the pad-to-32 path
    m1 = model.predict(rgb.copy())
    m2 = model.predict(rgb.copy())
    assert m1.shape == rgb.shape[:2] and m1.dtype == np.uint8
    assert len(np.unique(m1)) > 1  # a constant mask would make the test vacuous
    assert np.array_equal(m1, m2)
    # and the tensor the network saw is the pinned-2.0 preprocessing
    x = model._preprocess(rgb.copy())
    assert np.array_equal(x[0].permute(1, 2, 0).numpy(), _cv2_reference(rgb, 2.0))
