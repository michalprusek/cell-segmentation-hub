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


def _head_width():
    """Import inside the test, never at module scope.

    At module scope this breaks COLLECTION of the whole suite — pytest imports
    every test module up front, and importing `net` then drags in the model
    package, whose import chain reaches mamba_ssm/Triton and dies before any
    test runs. The file passes in isolation and takes the suite down with it,
    which is the worst of both. `test_microtubule_small_frames.py` defers its
    `from net import TILE` for the same reason.
    """
    from net import head_width

    return head_width


def test_a_valid_checkpoint_reports_its_head_width():
    state = {"decoder.seg_layers.0.weight": torch.zeros(1, 32, 1, 1)}
    head_width = _head_width()
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
        _head_width()({"encoder.stages.0.weight": torch.zeros(8, 3, 3, 3)})

    assert not isinstance(excinfo.value, SystemExit), (
        "SystemExit is a BaseException and bypasses every service error handler"
    )
    assert isinstance(excinfo.value, RuntimeError)
    assert "decoder.seg_layers" in str(excinfo.value)


def test_the_error_survives_a_plain_except_exception():
    """Exactly the shape model_loader.load_model uses."""
    try:
        _head_width()({})
    except Exception as exc:  # noqa: BLE001 — mirrors the production handler
        assert "ResEnc" in str(exc) or "seg_layers" in str(exc)
    else:
        pytest.fail("head_width accepted a checkpoint with no seg_layers at all")
