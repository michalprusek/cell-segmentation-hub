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


#: params_a_derived.json of the research repo (sha256 98f2cc49…), verbatim -- the vector every
#: declared number was read with. prob_thr is the production cut (0.98; the harness sweeps it) and
#: polyline_eps_px is output formatting, so those two are the only keys allowed to differ.
DERIVED_VECTOR = {
        "prob_thr": 0.97,
        "merge_radius": 5.0,
        "bridge_max_len": 11.535402577528444,
        "window": 28.4061495451,
        "w_theta": 2.4108987954215335,
        "w_kappa": 16.10643963709496,
        "w_gap": 0.023943431708221545,
        "c_open": 3.5105243273445317,
        "min_length": 15.0,
        "smooth_size": 11,
        "gap_floor": 9.580777678689557,
        "w_ori": 2.6027267692410323,
        "link_max_gap": 35.74047484783207,
        "c_open_link": 2.31855842251525,
        "bridge_thr": 0.07121686958579185,
        "min_arc_len": 3,
        "ds": 2.0,
        "half_width": 1.0,
}


def test_every_instancer_key_is_the_derived_value():
    """A drift in any of the keys the instancer reads (window, weights, gap rules...) would
    make the deployed pipeline differ from the measured one with every other test green."""
    params = json.loads((PKG / "params_sparse35.json").read_text())
    shipped = {k: v for k, v in params.items() if not k.startswith("_")}
    expected = {**DERIVED_VECTOR, "prob_thr": 0.98, "polyline_eps_px": 0.30}
    assert shipped == expected


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
