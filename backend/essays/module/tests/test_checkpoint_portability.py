"""The checkpoint must load on Windows, not just on Linux/macOS.

History, because the shim this file used to test is gone rather than broken.

`microtubule_v7.pt` stored the training run's argparse values, two of which
were the training machine's own `pathlib.PosixPath` directories::

    args['data_dir'] = PosixPath('/home/prusek/BIOCEV/datasets/...')
    args['out_dir']  = PosixPath('/home/prusek/BIOCEV/results/...')

Inference read neither — only ``args['backbone']`` and ``model_state`` — but
unpickling constructed them, and PosixPath refuses to instantiate on Windows.
Because ``args`` was serialised *after* ``model_state``, every weight tensor was
read first and the load then died on the trailing dict, returning nothing:

    cannot instantiate 'PosixPath' on your system

Reported from the field 2026-07-29 and fixed in PR #306 with a cross-platform
``pickle_module`` in ``segment_mt.py``.

`microtubule_v5h.pth` is a bare ``OrderedDict`` of tensors — no argparse
namespace, no paths, nothing to unpickle but storage. The hazard is therefore
structural rather than patched, and the shim was removed with the rest of the
v7 loader. What is left here is the ONE assertion that keeps it structural: if
a future checkpoint reintroduced a non-tensor payload, the Windows failure mode
would come back silently, on someone else's machine.

Run with: pytest tests/ (needs torch; no GPU).
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

from _mt_package import default_weights  # noqa: E402


def test_checkpoint_carries_tensors_only():
    """No non-tensor entry may ride along in the checkpoint.

    A PosixPath, an argparse.Namespace or any other host-specific object would
    be reconstructed at unpickle time and can fail on a different OS — after
    every weight has already been read, so the error arrives at the very end of
    a 535 MB load and returns nothing.
    """
    torch = pytest.importorskip("torch")

    weights = default_weights()
    if not weights.is_file():
        pytest.skip(f"checkpoint not staged at {weights}")

    state = torch.load(str(weights), map_location="cpu")
    assert isinstance(state, dict), f"expected a state_dict, got {type(state).__name__}"

    offenders = {k: type(v).__name__ for k, v in state.items() if not torch.is_tensor(v)}
    assert not offenders, (
        "checkpoint carries non-tensor entries that must be unpickled on the "
        f"loading host: {offenders}. Strip them, or restore a cross-platform "
        "pickle_module in the loader (see this module's docstring)."
    )
