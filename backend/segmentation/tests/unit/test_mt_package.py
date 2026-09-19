"""The microtubule package (SPARSE35 ep040) is self-contained.

Guards the three properties that make the swap from v7 safe:

1. No v7 leftovers. A stale ``segment_mt.py`` would still import transformers
   and could be picked up by a caller that was not updated.
2. The network library is vendored. The ML container does not have
   ``dynamic_network_architectures`` installed and has no network at run time.
3. The instancer parameters are the DERIVED vector the model was measured with
   (``params_sparse35.json``): ``min_length`` 15.0 by the declared rule, the
   production cut 0.98. Shipping v5H's real-VAL-fitted 44.74 here would drop
   every short microtubule the network finds (0.30 F1 on an oracle mask).

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


def test_instancer_params_are_the_derived_sparse35_vector():
    """The three numbers that distinguish the deployed vector: the DERIVED
    min_length (15.0 at the 1.5x scale, rule 3 x tolerance), the model's own
    cut (0.98, roi303 VAL optimum) and the junction radius the v5H-era fit
    established (5.0; v4b's 8.98 damages a clean mask)."""
    params = json.loads((PKG / "params_sparse35.json").read_text())
    assert params["merge_radius"] == pytest.approx(5.0)
    assert params["prob_thr"] == pytest.approx(0.98)
    assert params["min_length"] == pytest.approx(15.0)


def test_the_wrapper_reads_the_sparse35_params():
    """A stale DEFAULT_PARAMS_PATH would silently ship the previous vector."""
    src = (PKG / "wrapper.py").read_text()
    assert 'DEFAULT_PARAMS_PATH = _PKG_DIR / "params_sparse35.json"' in src
    assert "DEFAULT_SEED_THRESHOLD: float = 0.98" in src


def test_kappa_max_is_not_configurable():
    """The curvature bound is DERIVED (just above the 0.239 rad/px maximum over
    957 human-annotated microtubules), not tuned. A params file that carried one
    would silently override the derived constant."""
    params = json.loads((PKG / "params_sparse35.json").read_text())
    assert "kappa_max" not in params


def test_no_code_path_reaches_for_the_gated_backbone():
    """The checkpoint is complete, so nothing may try a gated HF download --
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
