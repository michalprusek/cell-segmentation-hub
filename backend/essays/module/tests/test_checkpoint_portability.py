"""The v7 checkpoint must load on Windows, not just on Linux/macOS.

`microtubule_v7.pt` stores the training run's argparse values, two of which are
the training machine's own `pathlib.PosixPath` directories::

    args['data_dir'] = PosixPath('/home/prusek/BIOCEV/datasets/...')
    args['out_dir']  = PosixPath('/home/prusek/BIOCEV/results/...')

Inference reads neither — only ``args['backbone']`` and ``model_state`` — but
unpickling constructs them, and PosixPath refuses to instantiate on Windows.
Because ``args`` is serialised *after* ``model_state``, every weight tensor is
read first and the load then dies on the trailing dict, returning nothing:

    cannot instantiate 'PosixPath' on your system

Reported from the field 2026-07-29 against a Windows install.

Run with: pytest tests/ (needs torch; no GPU, no checkpoint download).
"""

from __future__ import annotations

import contextlib
import pathlib
import sys
import types
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))
# segment_mt does `from synth_irm.training...`, which needs the package dir too.
MT_DIR = PKG_ROOT / "microtubule"
if str(MT_DIR) not in sys.path:
    sys.path.insert(0, str(MT_DIR))


@contextlib.contextmanager
def _posixpath_unavailable():
    """Make ``pathlib.PosixPath`` refuse to construct, as it does on Windows.

    Scoped to a ``with`` block rather than a fixture: pytest builds ``Path``
    objects of its own while collecting and while formatting failures, so a
    patch left in place for a whole test crashes the runner instead of the code
    under test. Subclassing the real class keeps every other attribute intact.
    """
    message = "cannot instantiate 'PosixPath' on your system"

    class _WindowsHostPosixPath(pathlib.PosixPath):
        def __new__(cls, *_args, **_kwargs):
            raise NotImplementedError(message)

    real = pathlib.PosixPath
    pathlib.PosixPath = _WindowsHostPosixPath
    try:
        yield
    finally:
        pathlib.PosixPath = real


def _v7_shaped_checkpoint(torch):
    """A miniature stand-in for microtubule_v7.pt's pickle structure."""
    return {
        "epoch": 9,
        "args": {
            "backbone": "facebook/dinov3-vitl16-pretrain-lvd1689m",
            # Explicitly PosixPath, not Path: on a Windows host Path() yields a
            # WindowsPath and the reproduction would silently invert.
            "data_dir": pathlib.PosixPath(
                "/home/prusek/BIOCEV/datasets/microtubules/synth_train_v2"),
            "out_dir": pathlib.PosixPath(
                "/home/prusek/BIOCEV/results/training_v7_dinov3l_v5arch"),
        },
        "model_state": {"head.weight": torch.arange(4.0).reshape(2, 2)},
    }


def test_stock_torch_load_fails_on_windows_like_host(tmp_path):
    """Control: without the remap the checkpoint is unloadable on Windows.

    If this ever stops raising, the reproduction has drifted away from the
    reported failure and the tests below stop meaning anything.
    """
    torch = pytest.importorskip("torch")

    ckpt_path = tmp_path / "ckpt_ep09.pt"
    torch.save(_v7_shaped_checkpoint(torch), ckpt_path)  # written by a POSIX host

    with _posixpath_unavailable():
        with pytest.raises(Exception) as excinfo:
            torch.load(str(ckpt_path), map_location="cpu", weights_only=False)
        captured = str(excinfo.value)

    assert "cannot instantiate 'PosixPath' on your system" in captured


def test_load_v7_model_survives_windows_like_host(tmp_path, monkeypatch):
    """``load_v7_model`` works on a Windows-like host.

    Deliberately goes through the loader rather than ``torch.load`` directly:
    a test that only exercises the pickle shim stays green if someone tidies
    the ``pickle_module=`` argument out of ``load_v7_model``, which is exactly
    the regression worth guarding. The real network is a gated 1.1 GB DINOv3
    download, so it is stubbed.
    """
    torch = pytest.importorskip("torch")

    from microtubule import segment_mt

    seen: dict = {}

    class _StubNet:
        def __init__(self, **kwargs):
            seen["init"] = kwargs

        def load_state_dict(self, state):
            seen["state_keys"] = sorted(state)

        def to(self, device):
            seen["device"] = device
            return self

        def eval(self):
            return self

    for name in ("synth_irm", "synth_irm.training"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    stub = types.ModuleType("synth_irm.training.model_v4")
    stub.FilamentInstanceModelV4 = _StubNet
    monkeypatch.setitem(sys.modules, "synth_irm.training.model_v4", stub)

    ckpt_path = tmp_path / "ckpt_ep09.pt"
    torch.save(_v7_shaped_checkpoint(torch), ckpt_path)

    with _posixpath_unavailable():
        model = segment_mt.load_v7_model(ckpt_path, device="cpu")

    assert model is not None
    assert seen["init"]["backbone_name"] == "facebook/dinov3-vitl16-pretrain-lvd1689m"
    assert seen["state_keys"] == ["head.weight"]
    assert seen["device"] == "cpu"


def test_native_posix_paths_are_left_alone(tmp_path):
    """On a POSIX host nothing is remapped — existing behaviour is unchanged."""
    torch = pytest.importorskip("torch")

    from microtubule.segment_mt import _CROSS_PLATFORM_PICKLE

    ckpt_path = tmp_path / "ckpt_ep09.pt"
    torch.save(_v7_shaped_checkpoint(torch), ckpt_path)

    ckpt = torch.load(
        str(ckpt_path),
        map_location="cpu",
        pickle_module=_CROSS_PLATFORM_PICKLE,
        weights_only=False,
    )
    assert type(ckpt["args"]["data_dir"]) is pathlib.PosixPath


def test_path_class_probe_handles_a_module_this_host_lacks():
    """A 3.13-saved checkpoint records ``pathlib._local``, absent on <=3.12.

    That is precisely the case the extra table keys exist for, so it must
    remap rather than raise. An earlier version indexed ``sys.modules[module]``
    directly and died with a bare KeyError here.
    """
    pytest.importorskip("torch")

    from microtubule.segment_mt import _path_class_is_native

    assert _path_class_is_native("pathlib._local_does_not_exist", "PosixPath") is False
