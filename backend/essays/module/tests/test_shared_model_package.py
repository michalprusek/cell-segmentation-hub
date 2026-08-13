"""The batch assay and the ML service share ONE microtubule package.

This module used to carry its own copy of the v7 model code. The two drifted in
opposite directions — the ML copy grew warm-start seed priors, this copy grew
the offline backbone path — and neither side received the other's fix. The copy
is gone; these tests pin the two properties that made removing it safe, so a
future edit to the shared package cannot quietly break the batch assay:

1. The module resolves the ML service's package rather than a local copy.
2. That package still builds the DINOv3 backbone OFFLINE. The batch worker runs
   with no HuggingFace token; if ``MT_BACKBONE_CONFIG`` support were dropped,
   every batch job would fail at model load against a gated repo.
"""
from __future__ import annotations

import importlib
import sys
import types
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

from _mt_package import ensure_on_path  # noqa: E402


def test_microtubule_package_is_not_a_local_copy():
    """The resolved package must live outside this module's directory."""
    pkg_parent = ensure_on_path()
    package = pkg_parent / "microtubule"

    assert package.is_dir(), f"no microtubule package at {package}"
    assert not (PKG_ROOT / "microtubule").exists(), (
        "a second copy of the model code reappeared at "
        f"{PKG_ROOT / 'microtubule'} — the batch assay and the ML service must "
        "import the same package, or fixes to one silently miss the other"
    )


@pytest.fixture
def model_v4(monkeypatch):
    """``synth_irm.training.model_v4`` from the shared package, transformers stubbed.

    Stubbed because the real call either downloads a 1.1 GB gated backbone or
    builds a ViT-L; the assertion here is only about WHICH branch runs.
    """
    mt_dir = ensure_on_path() / "microtubule"
    monkeypatch.syspath_prepend(str(mt_dir))

    module = importlib.import_module("synth_irm.training.model_v4")

    calls: list[str] = []

    class _Config:
        hidden_size = 1024

    class _Backbone:
        config = _Config()
        embeddings = types.SimpleNamespace(parameters=lambda: iter([]))

        def __getattr__(self, name):  # no rope_embeddings / layer / encoder
            raise AttributeError(name)

    def _from_pretrained(name, **_kwargs):
        calls.append("online")
        return _Backbone()

    def _from_config(_cfg):
        calls.append("offline")
        return _Backbone()

    monkeypatch.setattr(
        module, "AutoModel",
        types.SimpleNamespace(from_pretrained=_from_pretrained,
                              from_config=_from_config),
    )
    monkeypatch.setattr(
        module.transformers if hasattr(module, "transformers") else importlib.import_module("transformers"),
        "AutoConfig",
        types.SimpleNamespace(from_pretrained=lambda _p, **_k: _Config()),
    )
    return module, calls


def _build(module) -> None:
    """Construct the model, ignoring failures after the backbone is chosen.

    The stub backbone has no real layers, so head construction raises. That is
    past the branch under test — the recorded call is what matters.
    """
    try:
        module.FilamentInstanceModelV4()
    except Exception:  # noqa: BLE001 — see docstring
        pass


def test_offline_backbone_path_needs_no_token(monkeypatch, model_v4, tmp_path):
    """MT_BACKBONE_CONFIG set -> build from config, never touch the network."""
    module, calls = model_v4
    monkeypatch.setenv("MT_BACKBONE_CONFIG", str(tmp_path))

    _build(module)

    assert calls == ["offline"], (
        "the batch assay runs without HF_TOKEN and relies on the offline "
        f"backbone path; got {calls}"
    )


def test_online_backbone_path_is_still_the_default(monkeypatch, model_v4):
    """MT_BACKBONE_CONFIG unset -> the ML service's gated download, unchanged."""
    module, calls = model_v4
    monkeypatch.delenv("MT_BACKBONE_CONFIG", raising=False)

    _build(module)

    assert calls == ["online"], (
        f"interactive segmentation must keep downloading the backbone; got {calls}"
    )
