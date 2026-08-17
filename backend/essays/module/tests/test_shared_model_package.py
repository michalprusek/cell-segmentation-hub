"""The batch assay and the ML service share ONE microtubule package.

This module used to carry its own copy of the model code. The two drifted in
opposite directions and neither side received the other's fix. The copy is gone;
these tests pin the properties that made removing it safe, so a future edit to
the shared package cannot quietly break the batch assay:

1. The module resolves the ML service's package rather than a local copy.
2. Both callers name the same checkpoint file.
3. That package is SELF-CONTAINED. The batch worker runs with no HuggingFace
   token and, on a locked-down host, no network at all. Under the v7 model this
   was guaranteed by an offline-backbone escape hatch (``MT_BACKBONE_CONFIG``)
   that had to be kept working; v5H's checkpoint carries every weight, so the
   guarantee is now structural — nothing in the package may reach for
   ``transformers`` or a token at all.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

import _mt_package  # noqa: E402
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


def test_weights_name_is_the_v5h_checkpoint():
    """The essays container bind-mounts the ML service's weights directory
    read-only. If the two callers named different files, the batch assay would
    silently run a different model from interactive segmentation — exactly the
    drift that vendoring the module was meant to end."""
    assert _mt_package.WEIGHTS_NAME == "microtubule_v5h.pth"


def test_the_shared_package_never_reaches_for_a_gated_backbone():
    """Parsed rather than grepped: a docstring may legitimately mention
    HF_TOKEN to explain that it is not needed."""
    pkg = ensure_on_path() / "microtubule"
    sources = list(pkg.glob("*.py")) + list((pkg / "instance").glob("*.py"))
    assert sources, f"no python sources found under {pkg}"

    for src in sources:
        tree = ast.parse(src.read_text(), filename=str(src))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert not alias.name.startswith("transformers"), (
                        f"{src.name} imports {alias.name}; the batch worker has "
                        "no HuggingFace token and may have no network"
                    )
            elif isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith("transformers"), (
                    f"{src.name} imports from {node.module}"
                )
            elif isinstance(node, ast.Constant) and node.value in (
                "HF_TOKEN",
                "MT_BACKBONE_CONFIG",
            ):
                pytest.fail(
                    f"{src.name} still looks up {node.value}; v5H carries every "
                    "weight in its checkpoint and needs neither"
                )


def test_v7_model_sources_are_gone():
    """A leftover v7 module would still import transformers, and a caller that
    was not updated could pick it up."""
    pkg = ensure_on_path() / "microtubule"
    for stale in ("segment_mt.py", "pysoax.py", "synth_irm"):
        assert not (pkg / stale).exists(), f"v7 leftover in shared package: {stale}"


def test_the_vendored_network_library_travels_with_the_package():
    """``net.py`` imports ResidualEncoderUNet from a vendored copy. The essays
    image is built FROM the ml image but COPIES the package explicitly, so a
    missing subdirectory here means the batch worker cannot build the model."""
    pkg = ensure_on_path() / "microtubule"
    unet = pkg / "vendor" / "dynamic_network_architectures" / "architectures" / "unet.py"
    assert unet.is_file(), f"vendored network library missing at {unet}"


def test_instancer_params_travel_with_the_package():
    """The hyperparameters are fitted to THIS model's foreground; without the
    file the wrapper cannot pick a threshold."""
    pkg = ensure_on_path() / "microtubule"
    assert (pkg / "params_v5h.json").is_file()
