"""Contract of the v5H MicrotubuleModel wrapper.

What is under test is the WRAPPER's contract -- coordinate order, key set,
scale round-trip -- not the checkpoint's accuracy. The network is stubbed so
these run on a box with no GPU and no 535 MB checkpoint staged; model quality
is measured upstream and recorded in the package README, not here.

The orientation test is the important one. ``instance_a`` emits
``(x=col, y=row)`` and every downstream metric reads ``(row, col)``; a silent
transpose has broken this pipeline twice.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

_PKG = Path(__file__).resolve().parents[1] / "models" / "microtubule"
for _p in (str(_PKG), str(_PKG / "vendor")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from models.microtubule.wrapper import MicrotubuleModel, _simplify_polyline  # noqa: E402


class _StubNet:
    """Returns a horizontal filament through the middle of every tile.

    The band is 3 px so it survives skeletonisation, and the logits are
    saturated so the 0.97 threshold keeps exactly this band.
    """

    def __call__(self, t):
        import torch

        b, _, h, w = t.shape
        out = torch.full((b, 1, h, w), -12.0)
        out[:, :, h // 2 - 1 : h // 2 + 2, :] = 12.0
        return out


def _loaded_model(min_length: float = 20.0) -> MicrotubuleModel:
    """A model with the network stubbed out and the load guard satisfied."""
    m = MicrotubuleModel()
    m._model = _StubNet()
    m._device = "cpu"
    # The shipped min_length (44.7 px at the 1.5x scale) would reject the
    # filament in a small test frame; everything else stays as shipped.
    m._params = {**m.params, "min_length": min_length}
    return m


def test_predict_before_load_raises():
    """A missing checkpoint must fail here, not produce an empty result that
    reads downstream as 'this frame has no microtubules'."""
    with pytest.raises(RuntimeError, match="not loaded"):
        MicrotubuleModel().predict(np.zeros((64, 64), np.float32))


def test_predict_returns_row_col_and_no_embeddings():
    """embedding_samples must be ABSENT, not empty: a consumer that was not
    updated should fail loudly rather than silently track on zeros."""
    out = _loaded_model().predict(np.random.rand(256, 256).astype(np.float32))
    assert set(out) == {"centerlines_rc", "prob"}
    assert "embedding_samples" not in out
    for cl in out["centerlines_rc"]:
        assert cl.ndim == 2 and cl.shape[1] == 2


def test_probability_map_comes_back_at_input_resolution():
    """The internal 1.5x working scale must never reach the caller."""
    height, width = 256, 320
    out = _loaded_model().predict(np.random.rand(height, width).astype(np.float32))
    assert out["prob"].shape == (height, width)


def test_centerlines_are_mapped_back_to_input_resolution():
    height, width = 256, 320
    out = _loaded_model().predict(np.random.rand(height, width).astype(np.float32))
    assert out["centerlines_rc"], "stub foreground produced no instance"
    for cl in out["centerlines_rc"]:
        assert cl[:, 0].max() <= height + 1, "row coord escaped the input height"
        assert cl[:, 1].max() <= width + 1, "col coord escaped the input width"


def test_horizontal_filament_lands_in_the_middle_ROW():
    """Guards the (x,y) -> (row,col) transpose.

    The stub draws a HORIZONTAL band: rows are constant, columns sweep. If the
    transpose were dropped, this would come back as a vertical filament and
    every length/intensity measurement downstream would be taken across the
    wrong axis.
    """
    out = _loaded_model().predict(np.random.rand(256, 256).astype(np.float32))
    assert out["centerlines_rc"], "stub foreground produced no instance"
    cl = max(out["centerlines_rc"], key=len)
    assert cl[:, 0].std() < cl[:, 1].std(), "rows vary more than cols -- transposed"
    # The band sits at the vertical middle of the frame.
    assert 100 < float(np.median(cl[:, 0])) < 156


def test_threshold_override_is_honoured():
    """The ModelLoader passes the user's threshold through; a threshold above
    the stub's saturated probability must yield no foreground at all."""
    out = _loaded_model().predict(
        np.random.rand(256, 256).astype(np.float32), seed_threshold=0.999999
    )
    assert out["centerlines_rc"] == []


def test_rgb_input_is_reduced_to_grayscale():
    """ND2/TIFF frames occasionally arrive with a trailing channel axis."""
    out = _loaded_model().predict(np.random.rand(256, 256, 3).astype(np.float32))
    assert out["prob"].shape == (256, 256)


def test_non_2d_input_is_rejected():
    with pytest.raises(ValueError, match="expected 2D image"):
        _loaded_model().predict(np.random.rand(4, 8, 8, 2).astype(np.float32))


# ---------------------------------------------------------------------------
# Post-instancer RDP simplification (polyline_eps_px).
#
# The instancer itself is NEVER touched by this: `ds` stays the working
# resolution the instancer traces at (junction matching, curvature
# enforcement, tangent windows all still see the dense grid). What changes is
# only how densely the ALREADY-ACCEPTED geometry is stored on the way out.
# ---------------------------------------------------------------------------


def test_rdp_simplification_wired_into_predict_output():
    """End-to-end through predict(), not a unit test of the helper alone.

    The stub draws a near-straight horizontal band, so RDP should collapse
    almost every interior sample, while an eps=0 override (RDP disabled)
    must keep the instancer's full ds-spaced point count. This is the same
    `predict()` return value both ModelLoader.predict_microtubule()
    (interactive) and the essays batch worker (`infer.py` / `evaluate.py`)
    consume -- there is no second copy of this geometry for either caller
    to diverge from.
    """
    image = np.random.rand(256, 256).astype(np.float32)
    model = _loaded_model()

    unsimplified = model.predict(image, params={"polyline_eps_px": 0.0})["centerlines_rc"]
    simplified = model.predict(image)["centerlines_rc"]  # shipped params_v5h.json eps (0.30)

    assert unsimplified, "stub foreground produced no instance"
    assert simplified
    assert len(unsimplified) == len(simplified), "RDP must not change instance count"

    for raw, simp in zip(unsimplified, simplified):
        assert raw.shape[0] > 10, "fixture should have interior points to simplify"
        assert simp.shape[0] <= 3, "a near-straight centerline must collapse to (near) its two endpoints"
        np.testing.assert_allclose(raw[0], simp[0], atol=1e-9, err_msg="start point moved")
        np.testing.assert_allclose(raw[-1], simp[-1], atol=1e-9, err_msg="end point moved")


def test_vertices_count_reflects_simplified_geometry():
    """model_loader.py stamps vertices_count = len(points) built straight from
    centerlines_rc, so it automatically tracks whatever predict() emits --
    guard that predict() is in fact emitting the SIMPLIFIED count."""
    image = np.random.rand(256, 256).astype(np.float32)
    model = _loaded_model()
    simplified = model.predict(image)["centerlines_rc"]
    unsimplified = model.predict(image, params={"polyline_eps_px": 0.0})["centerlines_rc"]
    assert sum(len(c) for c in simplified) < sum(len(c) for c in unsimplified)


def test_simplify_polyline_short_input_passthrough():
    """<=2-point input is returned unchanged (nothing to simplify)."""
    cl = np.array([[0.0, 0.0], [1.0, 1.0]])
    np.testing.assert_array_equal(_simplify_polyline(cl, 0.3), cl)


def test_simplify_polyline_zero_eps_is_noop():
    cl = np.array([[0.0, 0.0], [0.0, 1.0], [0.0, 2.0], [5.0, 2.0]])
    np.testing.assert_array_equal(_simplify_polyline(cl, 0.0), cl)


def test_simplify_polyline_preserves_endpoints_on_curved_input():
    """cv2.approxPolyDP(..., closed=False) always keeps the first and last
    point of an open curve; pin that guarantee directly."""
    theta = np.linspace(0, np.pi, 40)
    cl = np.stack([10 * np.sin(theta), theta * 5.0], axis=1)
    simp = _simplify_polyline(cl, 0.3)
    assert simp.shape[0] < cl.shape[0], "a curved fixture should still simplify"
    np.testing.assert_allclose(simp[0], cl[0])
    np.testing.assert_allclose(simp[-1], cl[-1])


def test_simplify_polyline_falls_back_when_cv2_raises(monkeypatch):
    """One malformed centerline must degrade to the unsimplified curve, not
    abort the whole frame's inference (mirrors commit 39b6493c's guard)."""
    cl = np.array([[0.0, 0.0], [1.0, 0.5], [2.0, 0.0], [3.0, 0.5], [4.0, 0.0]])

    class _BoomCv2:
        @staticmethod
        def approxPolyDP(*_args, **_kwargs):
            raise RuntimeError("boom")

    monkeypatch.setitem(sys.modules, "cv2", _BoomCv2())
    np.testing.assert_array_equal(_simplify_polyline(cl, 0.3), cl)


def test_simplify_polyline_falls_back_when_result_collapses(monkeypatch):
    """eps too large for a short curve collapsing to <2 points must also
    fall back to the original, not drop the microtubule."""
    cl = np.array([[0.0, 0.0], [1.0, 0.0], [2.0, 0.0], [3.0, 0.0]])

    class _CollapseCv2:
        @staticmethod
        def approxPolyDP(_cv_pts, _eps, _closed):
            return np.zeros((1, 1, 2), dtype=np.float32)

    monkeypatch.setitem(sys.modules, "cv2", _CollapseCv2())
    np.testing.assert_array_equal(_simplify_polyline(cl, 0.3), cl)
