"""Neurite-to-soma assignment, per-cell metrics and developmental staging.

Takes the 3-class semantic mask the `neurite_soma` model produces (0 background
/ 1 neurite / 2 soma) and turns it into per-cell biology: which soma each
neurite grows from, one row per neurite and one per soma, and a developmental
stage (1 / 1-2 / 2 / 3) for every neuronal soma.

WHERE THIS CODE COMES FROM
--------------------------
Vendored from the research package at `neurite-metrics/` (built 2026-09-05,
measured on nine expert-reviewed Leica confocal frames -- CVAT task 579,
Run_no.4: 3x ctrl, 3x imax, 3x wt). Only the RUNTIME set is here; the ablations,
training scripts, figure generators and the StarDist hybrid instancer stay in
the research package because nothing in the service calls them.

The vendored files are kept byte-identical to the research package apart from
four edits, each marked `VENDOR EDIT (n of 4)` in place:

  1. `soma_instances.py` -- `gt_io` moved into `main()`; it hardcodes a laptop
     checkout path and only the research CLI uses it.
  2. `soma_filter.py`    -- imports `soma_predict` from this flat directory
     rather than a sibling `soma_classifier/` package.
  3. `soma_predict.py`   -- default weight path points at the service weights
     tree instead of a Desktop path.
  4. `soma_predict.py`   -- CUDA added to the device ladder; the research code
     chose between `mps` and `cpu` and would have pinned the 3-seed ResNet-18
     ensemble to this server's CPU.

Keeping the rest identical is deliberate: re-syncing with the research package
is then a file-by-file diff rather than a merge. **Do not refactor these files.**

WHY IT SITS BESIDE THE MODEL PACKAGE, NOT INSIDE IT
---------------------------------------------------
Same reason as `mt_measure.py`: importing `models.neurite_soma` loads the
segmentation wrapper and therefore torch's nnU-Net stack. Assignment and
staging are graph and geometry work that need neither, so a caller that only
wants to re-stage a table does not pay for a model load. The soma CLASSIFIER
does need torch, which is why it is imported lazily by `soma_filter`.

WHAT IS NOT MEASURED -- read before trusting a number
-----------------------------------------------------
* There is **no ground truth for the assignment itself**. Correctness rests on
  synthetic tests with known answers, a cross-check against an independent
  pixel geodesic watershed (0.844 agreement), and visual review.
* The soma classifier is trained on **confocal only** and has balanced accuracy
  0.901 -- roughly one instance in ten is misjudged. Rejected instances are
  kept in the table with `soma_neuronal = 0`, never deleted, so the rejection
  rate stays auditable. It has **never been run on spinning disk**.
* **Fasciculated neurites cannot be separated**: two processes running together
  are one object in the mask and no graph reasoning recovers two.
* `C_adopt = 25 um` is **not calibrated** on real data -- only shown to be far
  better than the 1 um it replaced.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The vendored modules import each other flatly (`import assign as A`), exactly
# as they do in the research package. Putting this directory on the path is what
# lets that keep working without rewriting every import -- see the note above on
# why staying diffable matters more than import style here.
_DIR = Path(__file__).resolve().parent
if str(_DIR) not in sys.path:
    sys.path.insert(0, str(_DIR))

from .analyse import NeuriteMetricsResult, analyse_frame  # noqa: E402

__all__ = ['analyse_frame', 'NeuriteMetricsResult']
