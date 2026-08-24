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

from models.microtubule.wrapper import MicrotubuleModel  # noqa: E402


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
