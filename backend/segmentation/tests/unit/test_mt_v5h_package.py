"""The v5H microtubule package is self-contained.

Guards the three properties that make the swap from v7 safe:

1. No v7 leftovers. A stale ``segment_mt.py`` would still import transformers
   and could be picked up by a caller that was not updated.
2. The network library is vendored. The ML container does not have
   ``dynamic_network_architectures`` installed and has no network at run time.
3. The instancer parameters are the ones fitted to THIS foreground. Shipping
   v4b's vector here would actively penalise a clean mask -- a large
   junction-contraction radius suits a shattered mask and damages a clean one.

These are cheap file-level assertions on purpose: they must pass on a driverless
box, so nothing here may import torch.
"""

import json
from pathlib import Path

import pytest

PKG = Path(__file__).resolve().parents[2] / "models" / "microtubule"


def test_v7_sources_are_gone():
    """v7's DINOv3 forward and PySOAX postprocessor must not survive the swap."""
    for stale in ("segment_mt.py", "pysoax.py", "synth_irm"):
        assert not (PKG / stale).exists(), f"v7 leftover: {stale}"


def test_vendored_network_library_is_present():
    """``net.py`` imports ResidualEncoderUNet from here; pip cannot supply it."""
    unet = PKG / "vendor" / "dynamic_network_architectures" / "architectures" / "unet.py"
    assert unet.is_file(), f"vendored library missing at {unet}"


def test_instancer_params_are_the_v5h_vector():
    """merge_radius 8.98 -> 5.0 and prob_thr 0.44 -> 0.97 are what distinguishes
    the fitted vector from v4b's."""
    params = json.loads((PKG / "params_v5h.json").read_text())
    assert params["merge_radius"] == pytest.approx(5.0)
    assert params["prob_thr"] == pytest.approx(0.97)


def test_kappa_max_is_not_configurable():
    """The curvature bound is DERIVED (just above the 0.239 rad/px maximum over
    957 human-annotated microtubules), not tuned. A params file that carried one
    would silently override the derived constant."""
    params = json.loads((PKG / "params_v5h.json").read_text())
    assert "kappa_max" not in params


def test_no_code_path_reaches_for_the_gated_backbone():
    """v5H's checkpoint is complete, so nothing may try a gated HF download --
    it would fail on a network-isolated box and is the failure mode that took
    the ML service down in 2026-07 (project_ml_hf_token_recovery).

    Parsed rather than grepped: the wrapper's docstring legitimately explains
    that HF_TOKEN is no longer needed, and a substring match would flag the
    explanation as the offence.
    """
    import ast

    for src in list(PKG.glob("*.py")) + list((PKG / "instance").glob("*.py")):
        tree = ast.parse(src.read_text(), filename=str(src))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert not alias.name.startswith("transformers"), (
                        f"{src.name} imports {alias.name}"
                    )
            elif isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith("transformers"), (
                    f"{src.name} imports from {node.module}"
                )
            elif isinstance(node, ast.Constant) and node.value == "HF_TOKEN":
                pytest.fail(f"{src.name} still looks up the HF_TOKEN env var")
