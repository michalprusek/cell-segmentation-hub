"""A bad microtubule checkpoint must fail like every other model's does.

`head_width` runs inside `load_weights()`, which the FastAPI service reaches on
the first request that needs the model — `model_loader.get_model('microtubule')`,
called BEFORE `predict_microtubule`'s own try block. It used to raise
`SystemExit`, a BaseException, so a mis-staged or truncated checkpoint was caught
by none of the service's handlers and never showed up as a 500 or as
`models_failed` on /health.
"""

import sys

import pytest
import torch

sys.path.insert(0, "/app/models/microtubule")

from net import head_width  # noqa: E402


def test_a_valid_checkpoint_reports_its_head_width():
    state = {"decoder.seg_layers.0.weight": torch.zeros(1, 32, 1, 1)}
    assert head_width(state) == 1
    state = {"decoder.seg_layers.0.weight": torch.zeros(7, 32, 1, 1)}
    assert head_width(state) == 7


def test_a_checkpoint_without_seg_layers_raises_a_catchable_error():
    """The point of the test: `except Exception` must see it.

    A BaseException here escapes model_loader's handler, the route's handler and
    the app-wide handler alike, so the operator gets a dropped connection instead
    of a 500 naming the checkpoint.
    """
    with pytest.raises(Exception) as excinfo:
        head_width({"encoder.stages.0.weight": torch.zeros(8, 3, 3, 3)})

    assert not isinstance(excinfo.value, SystemExit), (
        "SystemExit is a BaseException and bypasses every service error handler"
    )
    assert isinstance(excinfo.value, RuntimeError)
    assert "decoder.seg_layers" in str(excinfo.value)


def test_the_error_survives_a_plain_except_exception():
    """Exactly the shape model_loader.load_model uses."""
    try:
        head_width({})
    except Exception as exc:  # noqa: BLE001 — mirrors the production handler
        assert "ResEnc" in str(exc) or "seg_layers" in str(exc)
    else:
        pytest.fail("head_width accepted a checkpoint with no seg_layers at all")
