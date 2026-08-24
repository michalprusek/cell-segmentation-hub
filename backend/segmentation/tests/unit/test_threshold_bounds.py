"""The threshold bound is declared twice, one hop apart, and both must agree.

WHY THIS EXISTS. The Node API validates `threshold` before queueing, and this
service validates it again on /api/v1/segment. When only the first was raised
from 0.9 to 0.99, the microtubule model's fitted cut of 0.97 sailed through the
queue with a 200 and "20 images queued", then every single job died here with

    422 Unprocessable Entity — Input should be less than or equal to 0.9

Nothing surfaced: the user saw jobs queue and no segmentations appear. The
visible half was fixed and the invisible half was not, which is the worst
possible split, so the bound gets a test on this side rather than a comment.
"""

import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from api.models import SegmentationRequest

REPO = Path(__file__).resolve().parents[4]

# The value the microtubule v5H model actually uses (params_v5h.json prob_thr),
# and the one src/lib/models/modelRegistry.ts sends as its defaultThreshold.
V5H_FITTED_CUT = 0.97


def test_the_v5h_fitted_cut_is_accepted():
    assert SegmentationRequest(threshold=V5H_FITTED_CUT).threshold == V5H_FITTED_CUT


@pytest.mark.parametrize("value", [0.1, 0.5, 0.9, 0.97, 0.99])
def test_the_usable_range_is_accepted(value):
    assert SegmentationRequest(threshold=value).threshold == value


@pytest.mark.parametrize("value", [0.09, 1.0, 1.5, -1])
def test_values_outside_the_range_are_refused(value):
    with pytest.raises(ValidationError):
        SegmentationRequest(threshold=value)


def test_the_form_routes_declare_the_same_ceiling_as_the_model():
    """/segment and /batch-segment take threshold as a Form field, declared
    separately from SegmentationRequest. A ceiling raised in one place and not
    the other is exactly the failure this module is named for."""
    src = (REPO / "backend/segmentation/api/routes.py").read_text()
    ceilings = set(re.findall(r"le=(0\.\d+),?\s*#?[^\n]*\n?\s*description=\"Segmentation threshold\"", src))
    if not ceilings:  # formatting changed — fall back to every le= near a threshold Form
        ceilings = set(re.findall(r"threshold: float = Form\([^)]*?le=(0\.\d+)", src, re.S))
    assert ceilings, "could not find the threshold Form declarations in routes.py"
    assert ceilings == {"0.99"}, f"routes.py declares {ceilings}, expected 0.99"
