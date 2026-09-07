"""The one entry point the service calls: mask in, two tables out.

Mirrors `run_pipeline.run()` from the research package, minus the parts that
only exist to produce the paper's diagnostics (the second reference `analyse`
pass that splits unassigned length by cause, the visualisation dumps, the CLI).
Those answer "is the method sound", which is settled; this answers "what are
this frame's numbers".
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sys
from pathlib import Path

import numpy as np

# The vendored modules import each other flatly, so this directory has to be on
# the path. The package `__init__` does the same thing; it is repeated here so
# this module can be imported DIRECTLY, without going through `models/__init__`
# -- that one pulls the torch model zoo (mamba_ssm -> Triton), which raises
# "0 active drivers" on any machine without a CUDA driver and would put every
# test of this file behind a GPU. The route's own tests import it this way.
_DIR = Path(__file__).resolve().parent
if str(_DIR) not in sys.path:
    sys.path.insert(0, str(_DIR))

import metrics_export  # noqa: E402
import pipeline  # noqa: E402
import soma_instances as si  # noqa: E402

#: h-maxima depth for the S1 instancer, in micrometres.
#:
#: Not a free parameter: screened against the 3345 expert soma polygons, S1 at
#: h = 2 um scores F1 0.884 at IoU 0.5 with 12.1 % fused, against 0.868 / 30.9 %
#: for plain connected components. The StarDist-seeded hybrid scores better
#: still (0.904 / 6.6 %) and is deliberately NOT used here: it needs TensorFlow
#: and labelled somas, it cannot be trained for spinning disk at all, and across
#: all nine frames it moved the biology by ~1 % (4390 -> 4441 neurites, median
#: length 19.30 -> 19.18 um). A better instancer that changes no conclusion is
#: not worth a second deep-learning stack in this image.
H_UM = 2.0

#: Probability threshold above which the classifier's `p(not a soma)` rejects an
#: instance. 0.5 is the operating point the reported balanced accuracy (0.901)
#: and ROC-AUC (0.956) were measured at.
CLASSIFIER_THRESHOLD = 0.5


@dataclass
class NeuriteMetricsResult:
    """Two tables plus the quality counters needed to read them."""

    neurites: list[dict[str, Any]]
    somas: list[dict[str, Any]]
    qc: dict[str, Any] = field(default_factory=dict)
    #: Instance id -> p(not a neuronal soma). Empty when the classifier was off.
    p_not_soma: dict[int, float] = field(default_factory=dict)
    #: The soma instance labelling, so callers can map a row back to pixels.
    soma_instances: np.ndarray | None = None
    #: neurite-polygon label -> {soma_id, shared, length_um}. Empty unless the
    #: caller passed `neurite_labels`. See `polygon_ownership` for what
    #: "shared" costs to compute and why a majority is the honest answer.
    polygon_owner: dict[int, dict[str, Any]] = field(default_factory=dict)


def analyse_frame(
    semantic: np.ndarray,
    um_per_px: float,
    *,
    image: np.ndarray | None = None,
    frame: str = 'frame',
    classify: bool = True,
    h_um: float = H_UM,
    threshold: float = CLASSIFIER_THRESHOLD,
    soma_instances: np.ndarray | None = None,
    neurite_labels: np.ndarray | None = None,
) -> NeuriteMetricsResult:
    """Run the whole chain on one frame.

    ``semantic`` is the 3-class mask (0 background / 1 neurite / 2 soma).
    ``image`` is the raw frame the mask came from; it is REQUIRED when
    ``classify`` is true, because the classifier reads pixels, not the mask.

    ``soma_instances`` is an OPTIONAL pre-computed labelling, one positive
    integer per cell body. Pass it when the caller already knows which pixels
    belong to which soma -- an editor where the user has drawn or corrected one
    polygon per cell does -- and S1 is skipped entirely.

    Getting this wrong is silent, which is why it is a parameter rather than an
    inference. Handing in a labelled array and letting S1 run anyway returns
    rows keyed by ids the caller never chose: measured on the packaged sample,
    149 soma polygons went in and 168 S1 instances came out, so every attempt
    to join a row back to a polygon was off by an unknowable amount while
    looking perfectly well-formed.

    Passing ``classify=False`` is supported but changes the biology, not just
    the runtime: 47 % of the expert's own `soma` polygons are not neuronal cell
    bodies (growth cones, fragments, one looped neurite), and a neurite whose
    far end is the cell's OWN growth cone is indistinguishable from one
    connecting two cells. Scoring the endpoints of every detected connection,
    76 % lose an endpoint once the classifier is applied. Unclassified output
    therefore over-reports connections and mis-splits their length.
    """
    if semantic.ndim != 2:
        raise ValueError(f'semantic mask must be 2-D, got shape {semantic.shape}')
    if not np.isfinite(um_per_px) or um_per_px <= 0:
        raise ValueError(f'um_per_px must be a positive number, got {um_per_px!r}')
    if classify and image is None:
        raise ValueError(
            'image is required when classify=True: the soma classifier reads '
            'pixel crops, not the mask'
        )

    if soma_instances is not None:
        if soma_instances.shape != semantic.shape:
            raise ValueError(
                f'soma_instances shape {soma_instances.shape} does not match '
                f'the semantic mask {semantic.shape}'
            )
        inst = soma_instances
    else:
        inst = si.s1_dt_hmaxima(semantic == 2, um_per_px, h_um)

    ids = [int(v) for v in np.unique(inst) if v]
    p_not_soma: dict[int, float] = {}
    accepted: set[int] = set(ids)
    if classify and ids:
        import soma_filter  # lazy: pulls torch, which staging does not need

        p_not_soma, accepted = soma_filter.classify(
            image, inst, ids, thr=threshold
        )

    res = pipeline.analyse(
        semantic == 1,
        inst,
        um_per_px,
        image=image,
        soma_ok=accepted if classify else None,
    )

    qc = dict(res.qc)
    qc['n_soma_instances'] = len(ids)
    qc['n_soma_accepted'] = len(accepted)
    qc['soma_reject_rate'] = round(1 - len(accepted) / max(len(ids), 1), 4)
    qc['classifier_applied'] = bool(classify and ids)
    qc['soma_instancing'] = 'caller' if soma_instances is not None else 's1'

    neurites, somas = metrics_export.build_tables(
        frame, res, inst, um_per_px, accepted, p_not_soma
    )
    owner = (
        polygon_ownership(res, neurite_labels)
        if neurite_labels is not None
        else {}
    )
    return NeuriteMetricsResult(
        neurites=neurites,
        somas=somas,
        qc=qc,
        p_not_soma=p_not_soma,
        soma_instances=inst,
        polygon_owner=owner,
    )


def polygon_ownership(res, neurite_labels: np.ndarray) -> dict[int, dict[str, Any]]:
    """Which soma owns each DRAWN neurite polygon.

    The pipeline assigns per skeleton BRANCH, not per polygon, and the two do
    not correspond: one drawn component routinely hosts several primary
    neurites, and a neurite bridging two cells has branches owned by both. So
    there is no exact per-polygon answer, and pretending otherwise would be the
    lie -- this returns the MAJORITY owner by cable length plus a `shared` flag,
    which is enough to colour a polygon and honest about when that colour is a
    simplification.

    Sampling the branch PATH rather than the polygon's pixels is what keeps this
    cheap: a path is a few hundred coordinates, where a polygon can be tens of
    thousands of pixels, and the skeleton is inside its own polygon by
    construction.
    """
    height, width = neurite_labels.shape
    per_polygon: dict[int, dict[int, float]] = {}

    for bid, branch in res.graph.branches.items():
        soma = res.owner.get(bid)
        if soma is None:
            continue
        path = np.asarray(branch.path)
        if path.size == 0:
            continue
        # `path` is (N, 2) as (row, col) float. Rounded and clipped rather than
        # floored: a coordinate sitting on a boundary belongs to the nearer
        # pixel, and a skeleton endpoint can land exactly on the frame edge.
        rows = np.clip(np.rint(path[:, 0]).astype(np.int64), 0, height - 1)
        cols = np.clip(np.rint(path[:, 1]).astype(np.int64), 0, width - 1)
        labels = neurite_labels[rows, cols]
        hit = labels[labels > 0]
        if hit.size == 0:
            # A bridge edge spans a GAP in the mask, so its path crosses
            # background and belongs to no drawn polygon. Skipping it is right:
            # it would otherwise credit whichever polygon its rounding happened
            # to clip into.
            continue
        # Split the branch's length across the polygons it actually covers,
        # proportionally, instead of giving all of it to the first one.
        share = float(branch.length_um) / hit.size
        for label in np.unique(hit):
            n = int((hit == label).sum())
            bucket = per_polygon.setdefault(int(label), {})
            bucket[int(soma)] = bucket.get(int(soma), 0.0) + share * n

    out: dict[int, dict[str, Any]] = {}
    for label, by_soma in per_polygon.items():
        best_soma, best_len = max(by_soma.items(), key=lambda kv: kv[1])
        total = sum(by_soma.values())
        out[label] = {
            'soma_id': best_soma,
            'shared': len(by_soma) > 1,
            'length_um': round(best_len, 3),
            'owned_fraction': round(best_len / total, 3) if total else 0.0,
        }
    return out
