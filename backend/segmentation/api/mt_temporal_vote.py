"""Request handling of the microtubule temporal vote (``POST /microtubule/temporal-vote``).

Kept free of torch and FastAPI, like :mod:`api.mt_geometry_cost`, so that the CPU test suite and
the replay of the measured real frames import exactly what the route runs. The vote itself is
``models/microtubule/instance/instancer_lh_vote.py``.
"""

from __future__ import annotations

import json

import numpy as np


def parse_curves(raw: str, field: str) -> list:
    """``[[[x, y], ...], ...]`` in input px, as the editor stores points, -> (row, col) arrays.

    Raises ``ValueError`` naming ``field`` for anything else, non-finite values included.
    """
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            raise TypeError(f"a list of curves, not {type(data).__name__}")
        curves = [np.asarray(c, dtype=float).reshape(-1, 2)[:, ::-1] for c in data]
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{field}: expected [[[x, y], ...], ...] ({exc})") from exc
    if any(not np.isfinite(c).all() for c in curves):
        raise ValueError(f"{field}: coordinates must be finite")
    return curves


def same_curves(a, b, atol: float = 1e-6) -> bool:
    """Same number of curves, each with the same vertices within ``atol`` px, in order."""
    return len(a) == len(b) and all(
        x.shape == y.shape and np.allclose(x, y, rtol=0.0, atol=atol) for x, y in zip(a, b)
    )


def verdict(per_frame, voted, stored) -> tuple[bool, str | None, bool]:
    """``(applied, reason, changed)`` for one frame.

    Not applied beyond the L+H arc limit (``per_frame`` is None, reason ``"arc_limit"``), and not
    applied when this model's per-frame curves for the image differ from the ones the caller
    stored (``"not_per_frame"``: an edited frame, another channel's file, another model). The
    vote changes geometry, so it acts only on the condition it was measured on.
    """
    if per_frame is None:
        return False, "arc_limit", False
    if not same_curves(per_frame, stored):
        return False, "not_per_frame", False
    return True, None, not same_curves(voted, per_frame)
