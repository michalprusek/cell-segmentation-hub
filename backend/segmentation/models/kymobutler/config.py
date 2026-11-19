"""Configuration constants for the vendored KymoButler pipeline.

Trimmed from upstream ``src/kymobutler/config.py``: the ``.pt`` weight names and
``MODEL_NAMES`` are gone with the ``.pt`` loading path (see ``README.md``), and
the segmentation thresholds carry recalibrated values with the measurement that
produced them.
"""

from __future__ import annotations

import os
from pathlib import Path

# ``backend/segmentation`` — this file is models/kymobutler/config.py, so two
# parents up from the package directory. Resolving from __file__ (rather than
# the process CWD, which is how ml/model_loader.py finds its checkpoints) keeps
# the weights findable when a test imports the package from the repo root.
_SEGMENTATION_ROOT = Path(__file__).resolve().parents[2]

# The four ONNX graphs are staged by ``scripts/download-kymobutler-weights.sh``
# into ``backend/segmentation/weights/kymobutler``, which docker-compose
# bind-mounts read-only at ``/app/weights``. Override with the env var when the
# weights live elsewhere (a test fixture, a shared cache).
DEFAULT_MODEL_DIR = Path(
    os.environ.get(
        "KYMOBUTLER_MODEL_DIR", str(_SEGMENTATION_ROOT / "weights" / "kymobutler")
    )
)

ONNX_FILES = {
    "binet": "bidirectional_seg.onnx",
    "uninet": "unidirectional_seg.onnx",
    "decnet": "decision_module.onnx",
}

# --- BiNet weight variants ---------------------------------------------------
#
# A variant is the SAME graph as ``bidirectional_seg.onnx`` (same nodes, opset,
# input/output names) with other initializers, so it loads through the exact
# ONNX path below and the no-``.pt`` rule of README.md still holds. Only BiNet
# has variants: the decision module and UniNet are always upstream's.
#
# ``alica_ft`` (2026-11-18): BiNet fine-tuned on 50 hand-annotated kymographs
# of kinesin motors on microtubules in vitro (TIRF, 5 movies, one annotator),
# built the way /kymograph builds them. Provenance, the leave-one-movie-out
# numbers against ``stock`` and the regression control are in README.md. It is
# derived from unpublished lab data and is NOT downloadable: it is staged by
# hand next to the upstream files, and the SHA256 below makes a wrong or
# truncated file fail at load instead of segmenting silently.
BINET_WEIGHTS = {
    "stock": "bidirectional_seg.onnx",
    "alica_ft": "bidirectional_seg_alica_ft.onnx",
}
BINET_WEIGHTS_SHA256 = {
    "alica_ft": "33bfa65fe6c8082e0b8d1b8103db2988766139b907fd5f8c5b35c1bbf3878793",
}

# The variant /kymograph uses when a request does not name one. ``stock`` in
# code, so tests and a fresh checkout behave as before; production chooses its
# default in ``.env.production`` (``KYMOBUTLER_DEFAULT_WEIGHTS``), which makes
# a rollback one line plus an ml recreate, no rebuild. An unknown value is NOT
# silently replaced by ``stock``: ``resolve_binet_weights`` raises, and the
# route reports it as ``velocity_error``.
DEFAULT_BINET_WEIGHTS = os.environ.get("KYMOBUTLER_DEFAULT_WEIGHTS", "stock").strip()

# --- Segmentation thresholds -------------------------------------------------
#
# Upstream ships ONE threshold (0.2) for both nets. That is right for the
# bidirectional net and WRONG for the unidirectional one: the ONNX exports are
# systematically colder than the Mathematica originals they were converted
# from, and the two nets are off by different amounts.
#
# Measured 2026-08-31 by running THIS vendored code on upstream's own
# ``tests/data/*.png`` and comparing with ``models/reference/
# reference_track_counts.json``, which upstream exported from the Mathematica
# pipeline (unitest ant=48 ret=7, unitest2 ant=9 ret=0, bitest=13):
#
#     threshold | unitest ant | unitest ret | unitest2 ant | bitest
#     ----------|-------------|-------------|--------------|-------
#       0.10    |     55      |      8      |       9      |   13
#       0.15    |     49      |      6      |       8      |   14
#       0.20    |     43      |      6      |       7      |   13   <- upstream default
#       0.30    |     28      |      5      |       3      |   14
#     REFERENCE |     48      |      7      |       9      |   13
#
# Summed absolute error over the three unidirectional columns: 0.10 -> 8,
# 0.15 -> 3, 0.20 -> 8, 0.30 -> 27. So 0.15 is the best unidirectional value on
# upstream's own ground truth, and 0.10 only looks competitive because it wins
# one column while overshooting another by 7.
#
# The bidirectional net reproduces its reference exactly at 0.20 (upstream's
# default) and misses by one at 0.15 and 0.30. These are two named constants
# rather than one shared magic number precisely because a single value cannot be
# right for both — the ONNX exports are systematically colder than the
# Mathematica originals, and by different amounts per net.
#
# Do NOT "improve" a low trajectory count by lowering these. Below 0.15 the
# unidirectional net starts inventing tracks against its own reference.
BIDIRECTIONAL_THRESHOLD = 0.20
UNIDIRECTIONAL_THRESHOLD = 0.15

# Binarisation threshold for the decision module's output probability map. The
# decision module is only consulted at ambiguities, and its map is a
# well-separated two-class softmax, so 0.5 is the natural cut and upstream's
# value is kept unchanged.
DEFAULT_VISION_THRESHOLD = 0.5

DEFAULT_MIN_SIZE = 10
DEFAULT_MIN_FRAMES = 10

# Bidirectional minimum component size / frame span, per BiNet variant. ``stock``
# keeps upstream's 10/10, against which the thresholds above were calibrated.
# ``alica_ft`` uses 3/3 (Michal, 2026-11-19: "klidně zkrať filtr"): its training
# traces are short (median ~8 rows, 77 % under 10), and on the annotator's
# movies, leave-one-movie-out, 3/3 raised trace recall from 0.52-0.59 to
# 0.70-0.85 with the share of track points on signal unchanged (0.53-0.62 at
# both); on another lab's annotations from 0.41-0.63 to 0.70-0.90, on-signal
# -0.02 to -0.06. The cost is more tracks: +55 to +120 % on those data. That
# most of them are real short runs 10/10 discarded is an inference from the
# unchanged on-signal share, not a measurement.
BIDIRECTIONAL_MIN_SIZE_FRAMES = {
    "stock": (DEFAULT_MIN_SIZE, DEFAULT_MIN_FRAMES),
    "alica_ft": (3, 3),
}

# --- Tracking ----------------------------------------------------------------
SEARCH_RADIUS = 1.5
VISION_MODULE_TILE_SIZE = 48
MAX_CANDIDATES = 24
STRADDLER_MAX_ITERATIONS = 500
STRADDLER_PIXEL_THRESHOLD = 5
