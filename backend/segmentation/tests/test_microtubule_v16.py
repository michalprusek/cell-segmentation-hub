"""The V16 pipeline: which checkpoint runs which decoder, Gaussian tile fusion, instancer L+H.

No checkpoint and no GPU needed: the wrapper's network is a stub and the decoder runs on synthetic
probability maps. The check against what the research harness emitted lives in
``test_microtubule_reference_v16.py``.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

_SEG = Path(__file__).resolve().parents[1]
_PKG = _SEG / "models" / "microtubule"
for _p in (str(_PKG), str(_PKG / "vendor")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from models.microtubule.wrapper import _PIPELINES, MicrotubuleModel  # noqa: E402

from instance.instancer_lh import TooManyArcs, hysteresis_mask, instance_lh  # noqa: E402

KAPPA = 0.25
V16 = json.loads((_PKG / "params_v16.json").read_text())
SPARSE35 = json.loads((_PKG / "params_sparse35.json").read_text())


def _line(prob, p0, p1, value, half_width=1):
    n = int(max(abs(p1[0] - p0[0]), abs(p1[1] - p0[1]))) + 1
    for t in np.linspace(0, 1, n):
        y, x = int(round(p0[0] + t * (p1[0] - p0[0]))), int(round(p0[1] + t * (p1[1] - p0[1])))
        prob[y - half_width:y + half_width + 1, x - half_width:x + half_width + 1] = value


# --- the checkpoint selects the pipeline -------------------------------------------------------


@pytest.mark.parametrize("name, decoder, cut", [
    ("microtubule_v16_deb_s4_ep040.pth", "lh", 0.995),
    ("microtubule_sparse35_ep040.pth", None, 0.98),      # what the essays batch keeps loading
])
def test_checkpoint_name_selects_the_measured_pipeline(tmp_path, name, decoder, cut):
    model = MicrotubuleModel()
    with pytest.raises(FileNotFoundError):
        model.load_weights(tmp_path / name)
    assert model.params.get("decoder") == decoder
    assert model.params["prob_thr"] == pytest.approx(cut)


def test_unknown_checkpoint_name_is_refused(tmp_path):
    """A renamed V16 loads without error into SPARSE35's pipeline, so the name has to be checked."""
    model = MicrotubuleModel()
    with pytest.raises(ValueError, match="unknown microtubule checkpoint name"):
        model.load_weights(tmp_path / "ep040.pth")


def test_every_listed_pipeline_has_its_params_file():
    assert all(p.is_file() for p in _PIPELINES.values())


def test_v16_keeps_the_graph_constants_of_the_derived_vector():
    for k in ("merge_radius", "bridge_max_len", "window", "w_theta", "w_kappa", "w_gap", "gap_floor",
              "min_arc_len", "min_length", "polyline_eps_px"):
        assert V16[k] == SPARSE35[k], k


def test_v16_carries_the_measured_decoder_constants():
    assert (V16["fusion"], V16["match_reach"], V16["hyst_t_lo"], V16["hyst_radius"]) == ("gauss", 80.0, 0.98, 22.5)
    assert len(V16["link_model"]["coef"]) == len(V16["link_model"]["mu"]) == len(V16["link_model"]["sd"]) == 5
    assert "kappa_max" not in V16      # a constant of the method, never read from a file


# --- tile fusion --------------------------------------------------------------------------------


class _ConstantLogit:
    """Stands in for the network: constant logit, counts its calls."""

    def __init__(self, logit):
        self.logit, self.calls = logit, 0

    def __call__(self, t):
        import torch

        self.calls += 1
        return torch.full((1, 1, *t.shape[-2:]), self.logit)


def _channels(fusion, logit=2.0, size=1024):
    pytest.importorskip("torch")
    model = MicrotubuleModel()
    model._params = {"fusion": fusion} if fusion else {}
    model._model, model._device = _ConstantLogit(logit), "cpu"
    return model._channels(np.zeros((size, size), np.float32)), model._model.calls


def test_gauss_fusion_uses_half_tile_stride_and_keeps_a_constant_map():
    out, calls = _channels("gauss")
    assert calls == 9                   # starts 0, 256, 512 on each axis
    assert np.allclose(out, 1 / (1 + np.exp(-2.0)))


def test_uniform_fusion_is_the_default_and_keeps_the_old_stride():
    out, calls = _channels(None)
    assert calls == 9                   # starts 0, 387, 512 on each axis
    assert np.allclose(out, 1 / (1 + np.exp(-2.0)))
    _, calls_big = _channels(None, size=2048)
    _, calls_big_gauss = _channels("gauss", size=2048)
    assert calls_big == 25 and calls_big_gauss == 49


def test_gauss_fusion_averages_logits_not_probabilities():
    """Two tiles of different confidence must meet in logit space, or a tile border's weak
    prediction pulls a confident filament under the cut near a seam."""
    pytest.importorskip("torch")
    import torch

    class TwoLevel:
        calls = 0

        def __call__(self, t):
            level = 6.0 if TwoLevel.calls == 0 else -6.0
            TwoLevel.calls += 1
            return torch.full((1, 1, *t.shape[-2:]), level)

    model = MicrotubuleModel()
    model._params = {"fusion": "gauss"}
    model._model, model._device = TwoLevel(), "cpu"
    out = model._channels(np.zeros((512, 768), np.float32))    # tiles at x = 0 and x = 256
    w_a, w_b = (np.exp(-((300 - c) ** 2) / (2 * 64.0 ** 2)) for c in (255.5, 511.5))
    logit_mean = (6.0 * w_a - 6.0 * w_b) / (w_a + w_b)
    assert out[0, 256, 300] == pytest.approx(1 / (1 + np.exp(-logit_mean)), abs=1e-6)
    prob_mean = (w_a / (1 + np.exp(-6.0)) + w_b / (1 + np.exp(6.0))) / (w_a + w_b)
    assert abs(out[0, 256, 300] - prob_mean) > 1e-3     # the test can tell the two apart


# --- the decoder ---------------------------------------------------------------------------------


def test_hysteresis_adds_a_piece_only_if_it_joins_two_components():
    prob = np.zeros((101, 101), np.float32)
    _line(prob, (50, 10), (50, 90), 0.999, 0)      # horizontal, above the cut
    _line(prob, (10, 50), (40, 50), 0.999, 0)      # vertical, above the cut, with a gap at the crossing
    _line(prob, (60, 50), (90, 50), 0.999, 0)
    _line(prob, (41, 50), (49, 50), 0.985, 0)      # gap pieces, between t_lo and the cut
    _line(prob, (51, 50), (59, 50), 0.985, 0)
    _line(prob, (51, 62), (57, 62), 0.985, 0)      # a stub off the horizontal: one component only
    mask = hysteresis_mask(prob, 0.995, 0.98, 22.5)
    assert mask[45, 50] and mask[55, 50]
    assert not mask[55, 62]
    assert mask[prob > 0.995].all()


def test_hysteresis_adds_nothing_far_from_a_junction():
    prob = np.zeros((101, 101), np.float32)
    _line(prob, (50, 5), (50, 40), 0.999, 0)
    _line(prob, (50, 41), (50, 59), 0.985, 0)
    _line(prob, (50, 60), (50, 95), 0.999, 0)      # one straight line, no junction anywhere
    assert not hysteresis_mask(prob, 0.995, 0.98, 22.5)[50, 50]


def test_two_crossing_filaments_keep_their_identity():
    """The whole point of matching arc ENDS: the crossing resolves into two straight filaments, not
    four stubs and not two kinked chains."""
    prob = np.full((300, 300), 1e-3, np.float32)
    _line(prob, (150, 20), (150, 280), 0.9995)
    _line(prob, (20, 150), (280, 150), 0.9995)
    polys = instance_lh(prob, 0.995, KAPPA, V16)
    assert len(polys) == 2
    for p in polys:
        assert float(np.linalg.norm(np.diff(p, axis=0), axis=1).sum()) > 220
        extent = np.ptp(p, axis=0)
        assert extent.max() > 220 and extent.min() < 15     # straight along one axis


def test_a_collinear_gap_is_linked_only_within_the_reach():
    """The gap carries the map's evidence below t_lo, so it stays out of the mask and only the link
    can cross it; 70 and 90 px straddle match_reach 80, so nothing but the reach tells them apart."""
    def n_chains(gap):
        prob = np.full((200, 600), 1e-3, np.float32)
        _line(prob, (100, 20), (100, 200), 0.9995)
        _line(prob, (100, 201), (100, 199 + gap), 0.9)
        _line(prob, (100, 200 + gap), (100, 380 + gap), 0.9995)
        return len(instance_lh(prob, 0.995, KAPPA, V16))

    assert n_chains(70) == 1
    assert n_chains(90) == 2


def test_output_is_xy_on_the_frame_of_the_map():
    prob = np.full((100, 400), 1e-3, np.float32)
    _line(prob, (50, 20), (50, 380), 0.9995)
    p = instance_lh(prob, 0.995, KAPPA, V16)[0]
    assert p[:, 0].max() > 300          # x = column runs to 380
    assert p[:, 1].max() < 60           # y = row stays near 50


def test_empty_map_gives_no_polylines():
    assert instance_lh(np.zeros((64, 64), np.float32), 0.995, KAPPA, V16) == []


def test_short_fragments_are_dropped_at_min_length():
    prob = np.full((100, 100), 1e-3, np.float32)
    _line(prob, (50, 40), (50, 45), 0.9995)
    assert instance_lh(prob, 0.995, KAPPA, V16) == []


def _dashes(n):
    """A map of n separate short dashes: nothing to link, so the arc count is simply n."""
    prob = np.full((40 * (n // 20 + 2), 40 * 22), 1e-3, np.float32)
    for k in range(n):
        y, x = 20 + 40 * (k // 20), 20 + 40 * (k % 20)
        _line(prob, (y, x), (y, x + 20), 0.9995, 0)
    return prob


def test_too_many_arcs_is_refused_before_the_matching():
    with pytest.raises(TooManyArcs):
        instance_lh(_dashes(40), 0.995, KAPPA, {**V16, "max_arcs": 10})
    assert len(instance_lh(_dashes(40), 0.995, KAPPA, {**V16, "max_arcs": 40})) >= 1


# --- predict() through the V16 branch, network stubbed -------------------------------------------


class _Band:
    """A horizontal filament at row 120 of every tile; saturated, so it clears any cut."""

    def __call__(self, t):
        import torch

        b, _, h, w = t.shape
        out = torch.full((b, 1, h, w), -12.0)
        out[:, :, 119:122, :] = 12.0
        return out


def _v16_model():
    pytest.importorskip("torch")
    model = MicrotubuleModel()
    model._params_path = _PKG / "params_v16.json"
    model._model, model._device = _Band(), "cpu"
    return model


def test_predict_decodes_the_v16_branch_on_a_float16_rounded_map(monkeypatch):
    import instance.instancer_lh as lh

    seen = {}

    def spy(prob, cut, kappa, params):
        seen.update(prob=prob, cut=cut)
        return []

    monkeypatch.setattr(lh, "instance_lh", spy)
    model = _v16_model()
    image = np.random.default_rng(0).random((512, 512)).astype(np.float32)
    model.predict(image)
    assert seen["cut"] == pytest.approx(0.995)
    assert seen["prob"].dtype == np.float32
    assert np.array_equal(seen["prob"], seen["prob"].astype(np.float16).astype(np.float32))


def test_predict_returns_row_col_at_input_scale_through_the_v16_branch():
    out = _v16_model().predict(np.random.default_rng(0).random((512, 512)).astype(np.float32))
    assert len(out["centerlines_rc"]) == 1
    cl = out["centerlines_rc"][0]
    assert abs(cl[:, 0].mean() - 120) < 2           # row
    assert np.ptp(cl[:, 1]) > 400                   # runs along the columns of the 512 px input
    assert out["decoder"] == "lh"


def test_predict_falls_back_to_instance_a_beyond_the_arc_limit(monkeypatch, caplog):
    import instance.instancer_lh as lh

    def too_many(*args):
        raise lh.TooManyArcs("9999 arcs, limit 3000")

    monkeypatch.setattr(lh, "instance_lh", too_many)
    out = _v16_model().predict(np.random.default_rng(0).random((512, 512)).astype(np.float32))
    assert "falls back to instance_a" in caplog.text
    assert len(out["centerlines_rc"]) == 1
    assert out["decoder"] == "instance_a_fallback"
