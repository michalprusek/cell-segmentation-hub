"""Optional ensemble serving of the spheroid-disintegration model.

``SPHEROID_DISINTEGRATION_CHECKPOINTS`` may list several checkpoints; the
model then averages their softmax probabilities per pixel and takes the
argmax. Unset, it must stay the single network it always was. These tests pin:

* which files ``resolve_checkpoints`` returns (default when unset, order kept,
  missing / escaping / duplicated names refused rather than skipped);
* with one network, ``predict`` is the argmax of the LOGITS, not of a softmax
  (on a near-tie the two differ, so a refactor that routes one network
  through softmax fails here);
* with several, the mask is the argmax of the mean of the softmax
  probabilities, not of the mean logits and not of any one network.

CI has no torch: the module is loaded with the same short-lived torch
stand-in as test_disintegration_preprocessing.py, the resolver tests run
everywhere, and the prediction tests skip without torch.
"""

from __future__ import annotations

import contextlib
import importlib.util
import sys
import types
from pathlib import Path

import numpy as np
import pytest

_SEG = Path(__file__).resolve().parents[1] / "segmentation"


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


with _torch_or_stand_in():
    dis = _load("_hub_disintegration_model_ensemble", _SEG / "models" / "disintegration.py")


# ---- resolve_checkpoints ------------------------------------------------------

@pytest.fixture
def weights(tmp_path):
    for name in ("default.pth", "a.pth", "b.pth", "c.pth"):
        (tmp_path / name).write_bytes(b"x")
    return tmp_path


def test_the_variable_name_is_the_documented_one():
    assert dis.CHECKPOINTS_ENV == "SPHEROID_DISINTEGRATION_CHECKPOINTS"


@pytest.mark.parametrize("spec", [None, "", " ", ",", " , ,"])
def test_unset_or_blank_serves_the_default_file_unchanged(weights, spec):
    default = weights / "default.pth"
    assert dis.resolve_checkpoints(spec, weights, default) == [default]


def test_the_default_is_returned_even_when_it_is_absent(tmp_path):
    # the loader checks the default path itself, as it did before the ensemble
    default = tmp_path / "missing.pth"
    assert dis.resolve_checkpoints(None, tmp_path, default) == [default]


def test_listed_files_come_back_in_the_listed_order(weights):
    got = dis.resolve_checkpoints(" c.pth, a.pth ,b.pth", weights, weights / "default.pth")
    assert got == [(weights / n).resolve() for n in ("c.pth", "a.pth", "b.pth")]


def test_one_listed_file_is_a_one_network_model(weights):
    got = dis.resolve_checkpoints("a.pth", weights, weights / "default.pth")
    assert got == [(weights / "a.pth").resolve()]


def test_a_missing_file_fails_instead_of_being_skipped(weights):
    with pytest.raises(FileNotFoundError, match="nope.pth"):
        dis.resolve_checkpoints("a.pth,nope.pth", weights, weights / "default.pth")


@pytest.mark.parametrize("name", ["../a.pth", "sub/../../a.pth"])
def test_a_name_outside_the_weights_directory_is_refused(weights, name):
    with pytest.raises(ValueError, match="outside"):
        dis.resolve_checkpoints(name, weights, weights / "default.pth")


def test_an_absolute_path_is_refused(weights):
    with pytest.raises(ValueError, match="absolute"):
        dis.resolve_checkpoints(str(weights / "a.pth"), weights, weights / "default.pth")


def test_a_file_listed_twice_is_refused(weights):
    # the mean would silently weight that network twice
    with pytest.raises(ValueError, match="twice"):
        dis.resolve_checkpoints("a.pth,b.pth,a.pth", weights, weights / "default.pth")


def test_a_model_with_no_network_refuses_to_predict():
    with pytest.raises(RuntimeError, match="not loaded"):
        dis.DisintegrationModel().predict(np.zeros((8, 8, 3), np.uint8))


# ---- predict ----------------------------------------------------------------

def _image(h: int = 97, w: int = 131, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    g = rng.integers(0, 256, (h, w), dtype=np.uint8)
    return np.ascontiguousarray(np.stack([g] * 3, 2))


def _constant_logits(torch, values):
    """A network that outputs the same three logits at every pixel."""

    class _Const(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.v = torch.tensor(values, dtype=torch.float32).view(1, 3, 1, 1)

        def forward(self, x):
            return self.v.expand(x.shape[0], 3, x.shape[2], x.shape[3]).clone()

    return _Const().eval()


def _random_net(torch, seed):
    torch.manual_seed(seed)
    return torch.nn.Sequential(
        torch.nn.Conv2d(3, 8, 3, padding=1), torch.nn.ReLU(),
        torch.nn.Conv2d(8, 3, 3, padding=1),
    ).eval()


def _model(nets):
    m = dis.DisintegrationModel()
    m._nets, m._device = list(nets), "cpu"
    return m


def _padded_input(torch, model, rgb):
    """The tensor predict() feeds the networks (pad to the stride of 32)."""
    h, w = rgb.shape[:2]
    x = model._preprocess(rgb.copy())
    ph, pw = (32 - h % 32) % 32, (32 - w % 32) % 32
    return torch.nn.functional.pad(x, (0, pw, 0, ph), mode="replicate")


def test_one_network_is_the_argmax_of_its_logits_not_of_a_softmax():
    torch = pytest.importorskip("torch")
    # 2e-8 is a distinct float32 logit, but exp(-2e-8) rounds to 1.0, so the
    # softmax of these logits is an exact three-way tie (argmax 0) while the
    # logits themselves pick class 1.
    logits = [0.0, 2e-8, 0.0]
    probs = torch.softmax(torch.tensor(logits).view(1, 3, 1, 1), dim=1)
    assert probs.argmax(1).item() == 0 and torch.tensor(logits).argmax().item() == 1
    mask = _model([_constant_logits(torch, logits)]).predict(_image())
    assert mask.shape == (97, 131) and mask.dtype == np.uint8
    assert (mask == 1).all()


def test_one_network_assigned_as_model_is_the_one_network_path():
    # the attribute the older tests set (test_disintegration_preprocessing.py)
    torch = pytest.importorskip("torch")
    m = dis.DisintegrationModel()
    m._model, m._device = _constant_logits(torch, [0.0, 2e-8, 0.0]), "cpu"
    assert len(m._nets) == 1 and (m.predict(_image()) == 1).all()
    m._model = None
    assert m._nets == [] and m._model is None


def test_one_network_equals_the_argmax_of_its_logits_on_a_textured_image():
    torch = pytest.importorskip("torch")
    net = _random_net(torch, 0)
    model = _model([net])
    rgb = _image(seed=1)
    with torch.no_grad():
        ref = net(_padded_input(torch, model, rgb)).float().argmax(1)[0].numpy()[:97, :131]
    got = model.predict(rgb)
    assert len(np.unique(got)) > 1
    assert np.array_equal(got, ref.astype(np.uint8))


def test_the_ensemble_averages_probabilities_not_logits():
    torch = pytest.importorskip("torch")
    # A very confident vote for class 0 and two moderate votes for class 2.
    # Mean logits [10, 0, 2] pick 0; mean probabilities, about
    # [0.364, 0.030, 0.606], pick 2: each network's vote is capped at 1.
    nets = [_constant_logits(torch, [30.0, 0.0, 0.0]),
            _constant_logits(torch, [0.0, 0.0, 3.0]),
            _constant_logits(torch, [0.0, 0.0, 3.0])]
    mask = _model(nets).predict(_image())
    assert (mask == 2).all()
    # and each network alone would have voted as described
    assert (_model(nets[:1]).predict(_image()) == 0).all()
    assert (_model(nets[1:2]).predict(_image()) == 2).all()


def test_the_ensemble_is_the_argmax_of_the_mean_softmax_of_every_network():
    torch = pytest.importorskip("torch")
    nets = [_random_net(torch, s) for s in (0, 1, 2)]
    model = _model(nets)
    rgb = _image(seed=2)
    x = _padded_input(torch, model, rgb)
    with torch.no_grad():
        probs = [torch.softmax(n(x).float(), dim=1) for n in nets]
    ref = (sum(probs) / 3).argmax(1)[0].numpy()[:97, :131].astype(np.uint8)
    got = model.predict(rgb)
    assert np.array_equal(got, ref)
    # not vacuous: the ensemble differs from every one of its networks
    for n in nets:
        assert not np.array_equal(got, _model([n]).predict(rgb))


def test_the_ensemble_is_deterministic():
    torch = pytest.importorskip("torch")
    model = _model([_random_net(torch, s) for s in (3, 4)])
    rgb = _image(seed=5)
    assert np.array_equal(model.predict(rgb), model.predict(rgb))


def test_parameters_cover_every_network():
    torch = pytest.importorskip("torch")
    nets = [_random_net(torch, s) for s in (6, 7)]
    n_one = sum(1 for _ in nets[0].parameters())
    assert sum(1 for _ in _model(nets).parameters()) == 2 * n_one
    assert list(dis.DisintegrationModel().parameters()) == []
