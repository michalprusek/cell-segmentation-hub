"""Threshold selection and the calibration record it produces.

The threshold is deliberately *not* the one that maximises balanced accuracy on
the calibration set.  Any value inside the gap between the two classes scores
identically there, so the optimiser settles on an arbitrary edge of the gap --
in a leave-one-stack-out trial on the reference data it jumped between 13 and 36
across folds.  Placing the threshold at the geometric midpoint of the two tails
instead gives the same accuracy with equal *relative* headroom on both sides,
which is what survives the exposure drift that moves the whole scale at once.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

import numpy as np

#: Tail percentiles used to define each class, so single odd frames do not set the threshold.
P_IN_FOCUS = 5.0
P_OUT_OF_FOCUS = 95.0

#: Floor for an out-of-focus class that is exactly zero, relative to the in-focus tail.
ZERO_FLOOR_FRACTION = 1e-3

#: How far a frame's acquisition statistics may drift before the threshold is untrustworthy.
DOMAIN_FACTOR = 2.0


IN_FOCUS = 1
OUT_OF_FOCUS = 0


class EmptyClass(ValueError):
    """Raised when a labelled set has no members of one class, so metrics are undefined.

    Returning NaN instead would flow into the report table, poison the mean and
    worst-fold aggregates, and land in calibration.json as the bare token NaN --
    which is not valid JSON and silently breaks any non-Python reader.
    """


def evaluate(scores: np.ndarray, labels: np.ndarray, threshold: float) -> dict[str, float]:
    """Score a threshold against labelled planes; planes labelled EXCLUDED are dropped.

    ``sensitivity`` is the fraction of genuinely in-focus frames the threshold
    keeps, ``specificity`` the fraction of out-of-focus frames it flags.
    """
    scores = np.asarray(scores, float)
    labels = np.asarray(labels, int)
    kept = scores >= threshold
    in_focus = labels == IN_FOCUS
    out_of_focus = labels == OUT_OF_FOCUS
    if not in_focus.any():
        raise EmptyClass("no plane is labelled in focus; widen --tolerance-um or check the "
                         "annotated sharp plane")
    if not out_of_focus.any():
        raise EmptyClass("no plane is labelled out of focus; narrow --tolerance-um/--guard-um "
                         "or use a deeper stack")
    sensitivity = float(kept[in_focus].mean())
    specificity = float((~kept[out_of_focus]).mean())
    return {
        "sensitivity": sensitivity,
        "specificity": specificity,
        "balanced_accuracy": (sensitivity + specificity) / 2,
        "n_in_focus": int(in_focus.sum()),
        "n_out_of_focus": int(out_of_focus.sum()),
    }


class OverlappingDistributions(ValueError):
    """Raised when in-focus and out-of-focus scores overlap, so no threshold separates them."""


def pick_threshold(in_focus: np.ndarray, out_of_focus: np.ndarray) -> float:
    """Geometric midpoint between the low tail of in-focus and the high tail of out-of-focus."""
    in_focus = np.asarray(in_focus, float)
    out_of_focus = np.asarray(out_of_focus, float)
    if in_focus.size == 0:
        raise EmptyClass("no in-focus scores to fit a threshold from")
    if out_of_focus.size == 0:
        raise EmptyClass("no out-of-focus scores to fit a threshold from")
    hi = float(np.percentile(in_focus, P_IN_FOCUS))
    lo = float(np.percentile(out_of_focus, P_OUT_OF_FOCUS))
    if not hi > lo:
        raise OverlappingDistributions(
            f"in-focus p{P_IN_FOCUS:g}={hi:.4g} does not exceed "
            f"out-of-focus p{P_OUT_OF_FOCUS:g}={lo:.4g}; the descriptor cannot separate these classes"
        )
    lo = max(lo, hi * ZERO_FLOOR_FRACTION)   # a class that is exactly zero still needs a scale
    return float(np.sqrt(lo * hi))


@dataclass(frozen=True)
class DomainRange:
    """Range of acquisition statistics the calibration was built from."""

    noise_sigma: tuple[float, float]
    background: tuple[float, float]

    def __post_init__(self):
        for name in ("noise_sigma", "background"):
            bounds = getattr(self, name)
            if len(bounds) != 2 or not 0 < bounds[0] <= bounds[1]:
                raise ValueError(
                    f"{name}={tuple(bounds)} must be a pair (lo, hi) with 0 < lo <= hi; "
                    "an inverted or non-positive range silently shifts the multiplicative band"
                )

    def contains(self, noise_sigma: float, background: float, factor: float = DOMAIN_FACTOR) -> bool:
        for value, (lo, hi) in (
            (noise_sigma, self.noise_sigma),
            (background, self.background),
        ):
            if not (lo / factor) <= value <= (hi * factor):
                return False
        return True

    def to_dict(self) -> dict:
        return {"noise_sigma": list(self.noise_sigma), "background": list(self.background)}

    @classmethod
    def from_dict(cls, d: Mapping) -> "DomainRange":
        return cls(noise_sigma=tuple(d["noise_sigma"]), background=tuple(d["background"]))


@dataclass(frozen=True)
class Calibration:
    """Per-modality thresholds plus the acquisition domain they are valid in."""

    thresholds: dict[str, float]
    domain: dict[str, DomainRange]
    tolerance_um: float
    notes: str = ""
    metrics: dict = field(default_factory=dict)

    def __post_init__(self):
        if set(self.thresholds) != set(self.domain):
            raise ValueError(
                f"thresholds cover {sorted(self.thresholds)} but domain covers "
                f"{sorted(self.domain)}; every modality needs both, or detect fails "
                "with a bare KeyError after reading the whole file"
            )

    def in_domain(self, modality: str, noise_sigma: float, background: float) -> bool:
        return self.domain[modality].contains(noise_sigma, background)

    def to_dict(self) -> dict:
        return {
            "thresholds": dict(self.thresholds),
            "domain": {k: v.to_dict() for k, v in self.domain.items()},
            "tolerance_um": self.tolerance_um,
            "notes": self.notes,
            "metrics": dict(self.metrics),
        }

    @classmethod
    def from_dict(cls, d: Mapping) -> "Calibration":
        return cls(
            thresholds=dict(d["thresholds"]),
            domain={k: DomainRange.from_dict(v) for k, v in d["domain"].items()},
            tolerance_um=d["tolerance_um"],
            notes=d.get("notes", ""),
            metrics=dict(d.get("metrics", {})),
        )
