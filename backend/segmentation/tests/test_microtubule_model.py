"""Smoke tests for the microtubule v7 model wrapper + loader integration.

These tests deliberately bypass the actual DINOv3-L + DPT + PySOAX inference:

- The DINOv3 backbone is a gated 1.1 GB HuggingFace download and the v7
  checkpoint is 1.2 GB — together far too heavy for CI.
- PySOAX is iterative (5000 snake-evolution iterations per frame) and would
  dominate test runtime even on a real image.

Instead, we monkey-patch ``MicrotubuleModel.predict()`` with a synthetic
result and assert that the downstream conversion (``predict_microtubule``)
emits a well-formed response — the same contract the backend, the tracker,
and the kymograph endpoint all rely on.
"""

from __future__ import annotations

import base64
import contextlib
import pathlib
import sys
import types
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))


def test_microtubule_model_class_importable():
    """The optional ``MicrotubuleModel`` is exported from models/."""
    from models import MicrotubuleModel  # noqa: F401

    # In an environment without transformers / nd2 this is None — the loader
    # raises a clear error when the model is requested. Either outcome is
    # acceptable for this smoke check; we just want the symbol to exist.
    assert MicrotubuleModel is None or hasattr(MicrotubuleModel, "predict")


def test_predict_microtubule_response_shape(monkeypatch):
    """Conversion from wrapper output to API response is correct.

    The wrapper returns row/col centerlines and float16 embedding samples;
    ``predict_microtubule`` must convert them to (x, y) polyline points and
    base64-encoded embeddings while populating instanceId, geometry, etc.
    """
    pytest.importorskip("torch")  # model_loader imports torch unconditionally
    from ml.model_loader import ModelLoader

    H, W, D = 32, 32, 32
    fake_centerlines = [
        np.array([[5.0, 10.0], [5.0, 11.0], [5.0, 12.0]], dtype=np.float64),
        np.array([[10.0, 5.0], [11.0, 5.0], [12.0, 5.0], [13.0, 5.0]], dtype=np.float64),
    ]
    fake_embeddings = [
        np.random.randn(cl.shape[0], D).astype(np.float16) for cl in fake_centerlines
    ]

    loader = ModelLoader.__new__(ModelLoader)
    # Attributes the method actually uses (sidestep __init__ which boots torch)
    loader.is_processing = False
    loader.current_model = None
    loader.device = "cpu"
    loader.loaded_models = {}

    class _StubMTModel:
        def predict(self, image_np, seed_threshold=None, pysoax_params=None):
            return {
                "centerlines_rc": fake_centerlines,
                "seed_prob": np.zeros((H, W), dtype=np.float32),
                "embedding_samples": fake_embeddings,
            }

    loader.loaded_models["microtubule"] = _StubMTModel()
    monkeypatch.setattr(loader, "get_model", lambda name: loader.loaded_models[name])
    monkeypatch.setattr(loader, "release_model", lambda name: None)

    pil = Image.new("L", (W, H), color=128)
    result = loader.predict_microtubule(pil, threshold=0.5)

    assert result["model_used"] == "microtubule"
    assert result["polygons"] == []  # MT model produces polylines only
    assert len(result["polylines"]) == len(fake_centerlines)

    for poly, cl, emb in zip(result["polylines"], fake_centerlines, fake_embeddings):
        assert poly["geometry"] == "polyline"
        assert poly["class"] == "microtubule"
        assert poly["instanceId"].startswith("mt_")
        assert poly["vertices_count"] == cl.shape[0]
        # (row, col) → (x = col, y = row) conversion
        for i, pt in enumerate(poly["points"]):
            assert pt["x"] == pytest.approx(cl[i, 1])
            assert pt["y"] == pytest.approx(cl[i, 0])
        # Embedding round-trips through base64 → original float16 array.
        emb_bytes = base64.b64decode(poly["_embedding"])
        decoded = np.frombuffer(emb_bytes, dtype=np.float16).reshape(cl.shape[0], D)
        np.testing.assert_array_equal(decoded, emb)


def test_predict_microtubule_unloaded_raises(monkeypatch):
    """If the model wasn't loaded, the predict path returns a clear error."""
    pytest.importorskip("torch")
    from ml.model_loader import ModelLoader

    loader = ModelLoader.__new__(ModelLoader)
    loader.is_processing = False
    loader.current_model = None
    loader.device = "cpu"
    loader.loaded_models = {}
    monkeypatch.setattr(loader, "get_model", lambda name: None)

    with pytest.raises(ValueError, match="Microtubule model not loaded"):
        loader.predict_microtubule(Image.new("L", (16, 16)), threshold=0.5)


def test_rdp_preserves_embedding_alignment(monkeypatch):
    """The RDP simplification in wrapper.predict() must keep embedding
    samples index-aligned with the simplified centerline.

    Cross-frame tracking (`/api/v1/track`) uses Hungarian matching over
    the 32-d embeddings sampled per polyline vertex. If the embedding
    array is one shape and the polyline another, trackId assignments
    silently corrupt — no exception, just wrong correspondences.
    """
    cv2 = pytest.importorskip("cv2")
    pytest.importorskip("torch")
    from models.microtubule.wrapper import MicrotubuleModel

    # Synthetic wiggle on a 30-pt line: most points should be droppable
    # by RDP (eps=0.75 px) since they are near-collinear.
    rows = np.linspace(10.0, 40.0, 30)
    cols = np.full_like(rows, 20.0) + 0.1 * np.sin(np.linspace(0, 6, 30))
    wiggly = np.stack([rows, cols], axis=1)

    # Stub the model + the internal helpers so we never touch torch.
    mt = MicrotubuleModel.__new__(MicrotubuleModel)
    mt._model = object()
    mt._device = "cpu"

    fake_embed = np.random.randn(32, 64, 64).astype(np.float32)

    def fake_predict_seed_embed(_model, _norm, device):
        seed_prob = np.zeros((64, 64), dtype=np.float32)
        return seed_prob, fake_embed

    def fake_extract(_binary, _params, embeddings=None):  # noqa: ARG001
        return [{"centerline": wiggly}]

    # Inject the fakes via the same import paths the wrapper uses.
    import importlib

    seg_mt = importlib.import_module("models.microtubule.segment_mt")
    monkeypatch.setattr(seg_mt, "predict_seed_embed", fake_predict_seed_embed)
    monkeypatch.setattr(
        seg_mt, "PYSOAX_PARAMS_DEFAULT", {}, raising=False
    )
    monkeypatch.setattr(seg_mt, "_normalize", lambda x: x.astype(np.float32))

    import pysoax  # absolute import, same as wrapper

    monkeypatch.setattr(pysoax, "extract_soax_instances", fake_extract)

    result = mt.predict(np.zeros((64, 64), dtype=np.float32), seed_threshold=0.5)
    centerlines = result["centerlines_rc"]
    embeddings = result["embedding_samples"]

    assert len(centerlines) == 1
    assert len(embeddings) == 1
    # The load-bearing invariant: one embedding row per polyline vertex.
    assert centerlines[0].shape[0] == embeddings[0].shape[0]
    # And the simplification actually fired.
    assert centerlines[0].shape[0] < wiggly.shape[0], (
        "RDP should have dropped redundant near-collinear points"
    )
    # Endpoints preserved (RDP keeps first + last).
    np.testing.assert_allclose(centerlines[0][0], wiggly[0], atol=1e-3)
    np.testing.assert_allclose(centerlines[0][-1], wiggly[-1], atol=1e-3)


def test_rdp_short_polyline_passthrough(monkeypatch):
    """Centerlines with <=3 points must not be RDP-simplified.

    The guard `cl.shape[0] > 3` in wrapper.predict() avoids degenerate
    inputs to approxPolyDP. The polyline + matched embeddings should
    pass through unchanged.
    """
    pytest.importorskip("cv2")
    pytest.importorskip("torch")
    from models.microtubule.wrapper import MicrotubuleModel

    short_cl = np.array([[0.0, 0.0], [5.0, 5.0], [10.0, 10.0]], dtype=np.float64)

    mt = MicrotubuleModel.__new__(MicrotubuleModel)
    mt._model = object()
    mt._device = "cpu"

    fake_embed = np.random.randn(32, 16, 16).astype(np.float32)

    import importlib

    seg_mt = importlib.import_module("models.microtubule.segment_mt")
    monkeypatch.setattr(
        seg_mt, "predict_seed_embed",
        lambda _m, _n, device: (np.zeros((16, 16), dtype=np.float32), fake_embed),
    )
    monkeypatch.setattr(seg_mt, "PYSOAX_PARAMS_DEFAULT", {}, raising=False)
    monkeypatch.setattr(seg_mt, "_normalize", lambda x: x.astype(np.float32))

    import pysoax

    monkeypatch.setattr(
        pysoax, "extract_soax_instances",
        lambda _b, _p, embeddings=None: [{"centerline": short_cl}],
    )

    result = mt.predict(np.zeros((16, 16), dtype=np.float32), seed_threshold=0.5)
    assert result["centerlines_rc"][0].shape == short_cl.shape
    assert result["embedding_samples"][0].shape[0] == short_cl.shape[0]


# --- Cross-platform checkpoint loading ------------------------------------
#
# The v7 checkpoint embeds the training run's argparse values, two of which are
# the trainer's own ``pathlib.PosixPath`` directories. Unpickling those on
# Windows raises only at the very end of the unpickle — every weight tensor is
# materialised first, then the trailing ``args`` dict kills the load and nothing
# is returned. That is why the pipeline ran on Linux/macOS but not Windows
# (reported from the field, 2026-07-29). The loader
# hands ``torch.load`` a pickle module that remaps POSIX-only path classes to
# their ``Pure`` equivalents; these tests pin that behaviour down.


@contextlib.contextmanager
def _posixpath_unavailable():
    """Make ``pathlib.PosixPath`` refuse to construct, as it does on Windows.

    Scoped to a ``with`` block rather than applied as a fixture: pytest builds
    ``Path`` objects of its own while collecting and while formatting failures,
    so a patch left in place for a whole test crashes the runner instead of the
    code under test.

    Blocking ``__new__`` is sufficient on every version — a direct
    ``PosixPath(...)`` call, which is what unpickling does, always enters there
    (``_from_parts`` on Python <=3.11 sits *downstream* of it, not beside it).
    Subclassing the real class keeps every other attribute intact, so a stray
    instance can't produce a confusing unrelated error.
    """
    import pathlib as pathlib_mod

    message = "cannot instantiate 'PosixPath' on your system"

    class _WindowsHostPosixPath(pathlib_mod.PosixPath):
        def __new__(cls, *_args, **_kwargs):
            raise NotImplementedError(message)

    real = pathlib_mod.PosixPath
    pathlib_mod.PosixPath = _WindowsHostPosixPath
    try:
        yield
    finally:
        pathlib_mod.PosixPath = real


def _v7_shaped_checkpoint(torch):
    """A miniature stand-in for microtubule_v7.pt's pickle structure."""
    # Key order mirrors the real checkpoint: model_state FIRST, args LAST. Pickle
    # preserves insertion order, so putting args first would reproduce an early
    # abort — the exact failure mode the module docstring says this is NOT.
    return {
        "epoch": 9,
        "model_state": {"head.weight": torch.arange(4.0).reshape(2, 2)},
        "args": {
            "backbone": "facebook/dinov3-vitl16-pretrain-lvd1689m",
            # Explicitly PosixPath, not Path: on a Windows host Path() yields a
            # WindowsPath and the reproduction would silently invert.
            "data_dir": pathlib.PosixPath(
                "/home/prusek/BIOCEV/datasets/microtubules/synth_train_v2"),
            "out_dir": pathlib.PosixPath(
                "/home/prusek/BIOCEV/results/training_v7_dinov3l_v5arch"),
        },
    }


def test_stock_torch_load_fails_on_windows_like_host(tmp_path):
    """Control: without the remap the checkpoint is unloadable on Windows.

    If this ever stops raising, the fix below is no longer testing anything —
    the reproduction has drifted away from the reported failure.
    """
    torch = pytest.importorskip("torch")

    ckpt_path = tmp_path / "ckpt_ep09.pt"
    torch.save(_v7_shaped_checkpoint(torch), ckpt_path)  # written by a POSIX host

    with _posixpath_unavailable():
        with pytest.raises(Exception) as excinfo:
            torch.load(str(ckpt_path), map_location="cpu", weights_only=False)
        captured = str(excinfo.value)

    assert "cannot instantiate 'PosixPath' on your system" in captured


def test_checkpoint_loads_on_windows_like_host(tmp_path):
    """The loader's pickle module makes that same checkpoint load anyway.

    Both the inference-relevant payload (``backbone``, ``model_state``) and the
    inert training directories must survive; the latter come back as
    ``PurePosixPath``, which stringifies identically.
    """
    torch = pytest.importorskip("torch")

    from models.microtubule.segment_mt import _CROSS_PLATFORM_PICKLE

    ckpt_path = tmp_path / "ckpt_ep09.pt"
    torch.save(_v7_shaped_checkpoint(torch), ckpt_path)

    with _posixpath_unavailable():
        ckpt = torch.load(
            str(ckpt_path),
            map_location="cpu",
            pickle_module=_CROSS_PLATFORM_PICKLE,
            weights_only=False,
        )

    assert ckpt["args"]["backbone"] == "facebook/dinov3-vitl16-pretrain-lvd1689m"
    assert torch.equal(
        ckpt["model_state"]["head.weight"], torch.arange(4.0).reshape(2, 2)
    )
    assert (
        str(ckpt["args"]["data_dir"])
        == "/home/prusek/BIOCEV/datasets/microtubules/synth_train_v2"
    )


def test_native_posix_paths_are_left_alone(tmp_path):
    """On a POSIX host nothing is remapped — production behaviour is unchanged.

    The remap is conditional on the concrete class being unusable here, so the
    Linux ML service keeps getting real ``PosixPath`` objects exactly as before.
    """
    import pathlib as pathlib_mod

    torch = pytest.importorskip("torch")

    from models.microtubule.segment_mt import _CROSS_PLATFORM_PICKLE

    ckpt_path = tmp_path / "ckpt_ep09.pt"
    torch.save(_v7_shaped_checkpoint(torch), ckpt_path)

    ckpt = torch.load(
        str(ckpt_path),
        map_location="cpu",
        pickle_module=_CROSS_PLATFORM_PICKLE,
        weights_only=False,
    )
    assert type(ckpt["args"]["data_dir"]) is pathlib_mod.PosixPath


def test_load_v7_model_survives_windows_like_host(tmp_path, monkeypatch):
    """``load_v7_model`` itself works on a Windows-like host — not just the shim.

    This is the test that actually guards the fix. The three above drive
    ``torch.load`` directly, so all of them stay green if someone tidies the
    ``pickle_module=`` argument out of ``load_v7_model`` — the helper stays
    proven while the wiring silently regresses. This one goes red.

    The real network is a DINOv3-L (a gated 1.1 GB download), so
    ``FilamentInstanceModelV4`` is stubbed; the assertions are about what the
    loader pulled out of the checkpoint, which is the part under test.
    """
    torch = pytest.importorskip("torch")

    from models.microtubule import segment_mt

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


def test_checkpoint_loads_on_windows_like_host_legacy_format(tmp_path):
    """The remap also covers torch's non-zip serialisation.

    Both formats reach the remap through ``shim.Unpickler`` — ``_legacy_load``
    uses ``pickle_module.load`` only for the header scalars (magic number,
    protocol, sys-info), which carry no path objects. So this pins that the
    legacy path picks up our Unpickler; it does NOT exercise ``shim.load``.
    That rebinding is covered separately by
    ``test_shim_load_and_loads_are_rebound``.
    """
    torch = pytest.importorskip("torch")

    from models.microtubule.segment_mt import _CROSS_PLATFORM_PICKLE

    ckpt_path = tmp_path / "ckpt_legacy.pt"
    torch.save(_v7_shaped_checkpoint(torch), ckpt_path,
               _use_new_zipfile_serialization=False)

    with _posixpath_unavailable():
        ckpt = torch.load(
            str(ckpt_path),
            map_location="cpu",
            pickle_module=_CROSS_PLATFORM_PICKLE,
            weights_only=False,
        )

    assert ckpt["args"]["backbone"] == "facebook/dinov3-vitl16-pretrain-lvd1689m"
    assert (
        str(ckpt["args"]["data_dir"])
        == "/home/prusek/BIOCEV/datasets/microtubules/synth_train_v2"
    )


class _SavedOnWindows:
    """Pickles as a real ``pathlib.WindowsPath`` without constructing one.

    ``WindowsPath`` cannot be instantiated on POSIX, so a Windows-trained
    checkpoint cannot be produced here directly. ``__reduce__`` names the class
    by reference and only the *unpickler* calls it — which is exactly the code
    path under test. Using ``PureWindowsPath`` instead would be a tautology: it
    pickles as ``pathlib.PureWindowsPath``, a name absent from the remap table,
    so the test would pass without ever entering the remap.
    """

    def __reduce__(self):
        return (pathlib.WindowsPath, ("C:\\", "runs", "v7"))


def test_windows_paths_are_remapped_on_posix(tmp_path):
    """The reverse direction works too — a checkpoint trained on Windows.

    No such checkpoint exists today, so this pins the ``WindowsPath`` half of
    the table as a decision rather than leaving it as untested dead weight.
    """
    torch = pytest.importorskip("torch")

    from models.microtubule.segment_mt import _CROSS_PLATFORM_PICKLE

    ckpt_path = tmp_path / "ckpt_win.pt"
    torch.save({"args": {"out_dir": _SavedOnWindows()}}, ckpt_path)

    # Control: without the remap this is unloadable on POSIX at all.
    with pytest.raises(Exception) as excinfo:
        torch.load(str(ckpt_path), map_location="cpu", weights_only=False)
    assert "WindowsPath" in str(excinfo.value)

    ckpt = torch.load(
        str(ckpt_path),
        map_location="cpu",
        pickle_module=_CROSS_PLATFORM_PICKLE,
        weights_only=False,
    )
    assert isinstance(ckpt["args"]["out_dir"], pathlib.PureWindowsPath)
    assert ckpt["args"]["out_dir"].as_posix().endswith("runs/v7")


def test_path_class_probe_rejects_unknown_name():
    """A typo must raise, not masquerade as "you're on Windows".

    A blanket ``except`` here would make ``_path_class_is_native`` answer
    ``False`` for a misspelled class — the same answer as a genuinely foreign
    host — and silently remap on a platform where the class works fine.
    """
    pytest.importorskip("torch")

    from models.microtubule.segment_mt import _path_class_is_native

    assert _path_class_is_native("pathlib", "PosixPath") is True
    assert _path_class_is_native("pathlib", "WindowsPath") is False
    with pytest.raises(AttributeError):
        _path_class_is_native("pathlib", "PosixPathh")


def test_path_class_probe_handles_a_module_this_host_lacks():
    """A 3.13-saved checkpoint records ``pathlib._local``, absent on <=3.12.

    That is precisely the case the extra table keys exist for, so it must
    remap rather than raise. An earlier version indexed ``sys.modules[module]``
    directly and died with a bare KeyError here.
    """
    pytest.importorskip("torch")

    from models.microtubule.segment_mt import _path_class_is_native

    assert _path_class_is_native("pathlib._local_does_not_exist", "PosixPath") is False


def test_shim_load_and_loads_are_rebound(tmp_path):
    """``shim.load`` and ``shim.loads`` route through the remapping unpickler.

    Both come across from the ``pickle.__dict__`` copy still bound to the STOCK
    ``Unpickler``, so leaving them alone would reintroduce the bug on any entry
    point torch does not currently use. torch reaches the object graph through
    ``Unpickler`` on both formats, so nothing else covers these two — without
    this test, reverting the rebinding is invisible.
    """
    import pickle as stock_pickle

    pytest.importorskip("torch")

    from models.microtubule.segment_mt import _CROSS_PLATFORM_PICKLE

    blob = stock_pickle.dumps(
        {"out_dir": pathlib.PosixPath("/home/prusek/BIOCEV/results/x")})

    with _posixpath_unavailable():
        # Control: the stock entry point fails on a Windows-like host.
        with pytest.raises(Exception):
            stock_pickle.loads(blob)

        via_loads = _CROSS_PLATFORM_PICKLE.loads(blob)
        with open(tmp_path / "blob.pkl", "wb") as fh:
            fh.write(blob)
        with open(tmp_path / "blob.pkl", "rb") as fh:
            via_load = _CROSS_PLATFORM_PICKLE.load(fh)

    for got in (via_loads, via_load):
        assert isinstance(got["out_dir"], pathlib.PurePosixPath)
        assert str(got["out_dir"]) == "/home/prusek/BIOCEV/results/x"


def test_find_class_remaps_the_3_13_module_name():
    """A 3.13-saved checkpoint records ``pathlib._local``, not ``pathlib``.

    The probe returning False for an absent module is only half the mechanism —
    without the table key, ``find_class`` never consults the probe at all. This
    covers the other half, which is the whole point of commit a558b66.
    """
    import io
    import pickle as stock_pickle

    pytest.importorskip("torch")

    from models.microtubule.segment_mt import _CrossPlatformUnpickler

    # Hand-craft a 3.13-style reference without needing a 3.13 interpreter.
    blob = (b"\x80\x04\x95\x00\x00\x00\x00\x00\x00\x00\x00"
            b"\x8c\x0epathlib._local\x8c\tPosixPath\x93\x94"
            b"\x8c\x05/home\x85\x94R\x94.")
    got = _CrossPlatformUnpickler(io.BytesIO(blob)).load()
    assert isinstance(got, pathlib.PurePosixPath)
    assert str(got) == "/home"

    # And the stock unpickler cannot read it on this interpreter at all.
    with pytest.raises(Exception):
        stock_pickle.loads(blob)
