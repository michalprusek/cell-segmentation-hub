"""Every optional model import must actually succeed.

`ml/model_loader.py` wraps each optional model in `try/except ImportError` and
logs a warning, so a broken import does not crash the service -- it quietly
serves one model fewer while `/health` keeps saying "healthy". That is the right
runtime behaviour and a terrible failure mode for a dependency bump: nothing
goes red, and the only evidence is a WARNING line in a container log.

It has already happened once. Bumping transformers 4.57.1 -> 5.5.4 (2026-08-27)
broke `from mamba_ssm import Mamba`, because mamba_ssm 2.2.4's text-generation
helper imports two output dataclasses transformers 5 removed. Mamba-UNet
disappeared from the registry and `models_loaded` went 5 -> 4, with a green
build and a healthy service throughout. See the shim in models/mamba_unet.py.

So these tests assert the guards are NOT firing. They are the check that a
library upgrade did not silently amputate a model.
"""
import importlib
import os

import pytest

# models/__init__ pulls in mamba_ssm and Triton, which fail to initialise
# without a CUDA driver ("0 active drivers"), so the whole module is GPU-only.
torch = pytest.importorskip("torch")

pytestmark = pytest.mark.skipif(
    not torch.cuda.is_available(),
    reason="optional model imports need CUDA (mamba_ssm/Triton init)",
)


@pytest.fixture(scope="module")
def loader():
    return importlib.import_module("ml.model_loader")


# (attribute that is None when the guard fired, error attribute, why it matters)
OPTIONAL_MODELS = [
    ("SpermModel", "_sperm_import_error", "sperm — live, 233 runs in 60 days"),
    ("SegFormerModel", "_segformer_import_error", "segformer — transformers-backed"),
]


@pytest.mark.parametrize("attr,err_attr,why", OPTIONAL_MODELS)
def test_optional_model_imported(loader, attr, err_attr, why):
    err = getattr(loader, err_attr, None)
    assert err is None, f"{attr} guard fired ({why}): {err!r}"
    assert getattr(loader, attr, None) is not None, f"{attr} is None ({why})"


def test_mamba_ssm_imports_under_current_transformers():
    """The exact breakage the transformers 5 bump caused.

    Asserted against `mamba_ssm` directly rather than through the loader so the
    failure names the real culprit instead of "Mamba-UNet unavailable".
    """
    from models import mamba_unet  # noqa: F401  -- applies the alias shim

    mamba_ssm = importlib.import_module("mamba_ssm")
    assert hasattr(mamba_ssm, "Mamba")


def test_generation_output_aliases_present():
    """The shim must survive transformers dropping the old names.

    If a future transformers removes `GenerateDecoderOnlyOutput` too, the shim
    silently does nothing and we are back to a disabled model -- so check the
    aliases actually exist after the shim has run, not merely that it ran.
    """
    from models import mamba_unet  # noqa: F401  -- applies the alias shim

    gen = importlib.import_module("transformers.generation")
    for name in ("GreedySearchDecoderOnlyOutput", "SampleDecoderOnlyOutput"):
        assert hasattr(gen, name), (
            f"transformers.generation.{name} missing after the mamba_unet shim; "
            "mamba_ssm 2.2.4 imports it and Mamba-UNet will be disabled"
        )


def test_registry_advertises_only_importable_models(loader):
    """Every entry in the registry must carry a real class, not None.

    `AVAILABLE_MODELS` is what `/api/v1/models` is built from, so it is what
    the frontend populates its picker with. An entry whose `class` is None is a
    model a user can select and the service cannot run -- and because each
    import is individually guarded, exactly one entry can go None without
    anything else changing. This is the assertion that turns that from a log
    line into a failing test.
    """
    registry = loader.ModelLoader.AVAILABLE_MODELS
    assert registry, "AVAILABLE_MODELS is empty"

    missing = [name for name, cfg in registry.items() if cfg.get("class") is None]
    assert not missing, (
        "registry advertises models whose class failed to import: "
        + ", ".join(sorted(missing))
    )
