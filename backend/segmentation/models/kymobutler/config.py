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

# --- Tracking ----------------------------------------------------------------
SEARCH_RADIUS = 1.5
VISION_MODULE_TILE_SIZE = 48
MAX_CANDIDATES = 24
STRADDLER_MAX_ITERATIONS = 500
STRADDLER_PIXEL_THRESHOLD = 5
