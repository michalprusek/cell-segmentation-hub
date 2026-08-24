"""Locate the shared ``microtubule`` package and put it on ``sys.path``.

Single source of truth: the microtubule v5H model code (wrapper, net, the
instancer, the vendored network library) lives ONCE, in the ML service at
``backend/segmentation/models/microtubule``. Both the interactive segmentation
service and this batch evaluator import that one package.

Until this module was vendored into the app it shipped its own copy, and the two
drifted in opposite directions without either side noticing. Both fixes now live
in the single package, so a change to the instancer or the checkpoint loader can
no longer be applied to one caller and silently miss the other.

The package's parent directory differs by context, so it is resolved in order:

1. ``MT_PACKAGE_DIR`` — explicit override; when set, it is the ONLY candidate,
   so a typo surfaces as an error instead of silently falling through to a stale
   copy somewhere else on the box.
2. The repo checkout — ``backend/segmentation/models`` relative to this file.
3. ``/app/models`` — the essays container, whose image is built FROM the ML
   image and therefore already carries the package.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _sibling_of_essays(*parts: str) -> list[Path]:
    """``backend/<parts>`` for a checkout, where this file is backend/essays/module.

    Returns an empty list when this file is not that deep — the module gets
    mounted straight onto ``/essays_module`` in one-off containers, where
    ``parents[1]`` would raise IndexError and take down every import of
    ``evaluate`` with it.
    """
    parents = _HERE.parents
    if len(parents) < 2:
        return []
    return [parents[1].joinpath(*parts)]


def _candidates() -> list[Path]:
    override = os.environ.get("MT_PACKAGE_DIR")
    if override:
        return [Path(override)]
    return [
        # backend/essays/module/ -> backend/segmentation/models/
        *_sibling_of_essays("segmentation", "models"),
        Path("/app/models"),
    ]


def ensure_on_path() -> Path:
    """Put the directory *containing* the ``microtubule`` package on sys.path.

    Returns the directory that was found, so callers can log it — which copy of
    the model code ran is the first thing to check when results look wrong.

    Raises:
        ModuleNotFoundError: if no candidate holds the package. The message
            lists every path tried; a bare ``ImportError`` on ``microtubule``
            three frames later would not say where it looked.
    """
    tried: list[Path] = []
    for candidate in _candidates():
        tried.append(candidate)
        # Probe for a file, not just the directory: an empty leftover
        # ``microtubule/`` dir would otherwise shadow the real package.
        if (candidate / "microtubule" / "wrapper.py").is_file():
            if str(candidate) not in sys.path:
                sys.path.insert(0, str(candidate))
            return candidate
    raise ModuleNotFoundError(
        "Could not locate the shared 'microtubule' package. Tried: "
        + ", ".join(str(p) for p in tried)
        + ". Set MT_PACKAGE_DIR to the directory that CONTAINS it."
    )


WEIGHTS_NAME = "microtubule_v5h.pth"


def weights_candidates() -> list[Path]:
    """Where the v5H checkpoint may be staged, most-specific first.

    The checkpoint (~535 MB) is too large for git and is staged out-of-band by
    ``scripts/download-microtubule-weights.sh`` into the ML service's weights
    directory. The essays container bind-mounts that same directory read-only at
    ``/app/mt_weights``, so both callers run the byte-identical file.
    """
    env = os.environ.get("ESSAYS_WEIGHTS")
    out = [Path(env)] if env else []
    out += [
        # backend/essays/module/ -> backend/segmentation/weights/
        *_sibling_of_essays("segmentation", "weights", WEIGHTS_NAME),
        Path("/app/mt_weights") / WEIGHTS_NAME,
    ]
    return out


def default_weights() -> Path:
    """First staged checkpoint that exists, else the most likely path.

    Returning a non-existent path rather than raising lets the caller print one
    good error naming every location it looked in.
    """
    candidates = weights_candidates()
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return candidates[0]


def missing_weights_message(weights: Path) -> str:
    """Explain how to stage the checkpoint.

    Until this module was vendored into the app it downloaded the checkpoint
    from its own repo's GitHub Release. That repo is gone; the app stages the
    same file itself, so point people at the supported path instead of leaving a
    download that 404s.
    """
    return (
        f"microtubule v5H checkpoint not found at {weights}.\n"
        "Looked in: " + ", ".join(str(p) for p in weights_candidates()) + "\n"
        "Stage it with scripts/download-microtubule-weights.sh (writes "
        "backend/segmentation/weights/" + WEIGHTS_NAME + "), or pass an explicit "
        "--weights path."
    )
