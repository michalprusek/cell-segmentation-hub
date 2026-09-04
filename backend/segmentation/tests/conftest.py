import sys
from pathlib import Path

import pytest

sys.path.insert(0, "/app")

#: The microtubule checkpoint. Untracked by git (560 MB) and staged by
#: ``scripts/download-microtubule-weights.sh``, so a fresh clone — or a git
#: worktree, which is how this was noticed — does not have it.
#:
#: RELATIVE, resolved against the cwd, because that is what the thing it guards
#: does: ``ModelLoader.AVAILABLE_MODELS['microtubule']['pretrained_path']`` is
#: the string ``'weights/microtubule_v5h.pth'`` and torch.load opens it from
#: wherever the process happens to be. Hardcoding ``/app/weights/...`` would
#: agree with the loader only under ``make test-ml``'s ``-w /app``, and would
#: skip everything — silently, which is the failure this guard exists to
#: prevent — for anyone running pytest from ``backend/segmentation``.
def _mt_checkpoint() -> Path:
    return Path.cwd() / "weights" / "microtubule_v5h.pth"


@pytest.fixture(scope="session")
def mt_model():
    """The real v5H model, or a skip when its checkpoint is not staged.

    Without the skip, every test taking this fixture ERRORS during setup with a
    "Model weights not found" traceback. Ten of them did, in
    ``test_microtubule_small_frames.py``, and a run that is really "this
    checkout has no weights" reads as "the model is broken" — the noise is
    worse than the missing coverage, because it teaches the reader to ignore a
    red ML suite. ``pytest.importorskip`` is the same idea one level up and is
    already how ``test_mt_metrics_band.py`` and ``test_kymograph_velocity.py``
    handle their own unavailable inputs.

    Deliberately NOT a fallback to a stub: these tests exist to pin the real
    network's tensor-shape behaviour at tile boundaries, which a stub cannot
    reproduce. Skipped is the honest answer; passing against a stub is not.
    """
    checkpoint = _mt_checkpoint()
    if not checkpoint.exists():
        pytest.skip(
            f"microtubule checkpoint not staged at {checkpoint} "
            "(scripts/download-microtubule-weights.sh)"
        )
    from ml.model_loader import ModelLoader

    return ModelLoader().get_model("microtubule")
