"""api.frap_render: the ROI mask and the diagnostic overlay, exercised directly.

The endpoint-level PNG-shape tests live in tests/test_frap_targets_api.py (Task 5
brief). This file covers the one behavioural claim that needs synthetic Spot and
RejectedFilament objects rather than a full HTTP round-trip: that drawing the
rejected-filament markers actually changes the overlay's pixels.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "models"))
import frap_select as FS  # noqa: E402

from api import frap_render  # noqa: E402

UM_PER_PX = 0.1
SHAPE_HW = (600, 600)


def _spot(x, y, tangent_deg=0.0, mt_index=0):
    return FS.Spot(x=x, y=y, tangent_deg=tangent_deg, mt_index=mt_index,
                   mt_length_um=30.0, bleach_clearance_um=5.0,
                   readout_clearance_um=5.0, snr=3.0, score=1.0)


def test_overlay_with_rejected_filaments_differs_in_bytes_from_without():
    frame = np.zeros(SHAPE_HW, dtype=np.uint16)
    polylines = [np.array([[100.0, 300.0], [400.0, 300.0]])]
    spots = [_spot(250.0, 300.0)]
    params = FS.SelectionParams()
    rejected = [FS.RejectedFilament(x=115.0, y=450.0, reason="length", mt_index=1)]

    without = frap_render.render_overlay_png(frame, polylines, spots, params, UM_PER_PX)
    with_rejected = frap_render.render_overlay_png(
        frame, polylines, spots, params, UM_PER_PX, rejected=rejected)

    assert without != with_rejected


def test_overlay_with_no_rejected_filaments_matches_the_default_argument():
    frame = np.zeros(SHAPE_HW, dtype=np.uint16)
    polylines = [np.array([[100.0, 300.0], [400.0, 300.0]])]
    spots = [_spot(250.0, 300.0)]
    params = FS.SelectionParams()

    default = frap_render.render_overlay_png(frame, polylines, spots, params, UM_PER_PX)
    explicit_empty = frap_render.render_overlay_png(
        frame, polylines, spots, params, UM_PER_PX, rejected=[])

    assert default == explicit_empty
