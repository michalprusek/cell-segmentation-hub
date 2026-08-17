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


def test_the_selection_the_mask_and_the_json_share_one_half_axis_calculation():
    # frap_select.half_axes_px, frap_render._roi_polygon and
    # frap_targets._spot_json each computed 0.5 * spot_len_um / um_per_px
    # independently. The third is what the microscope BLEACHES and the first is what
    # the isolation criteria VALIDATED, so those two disagreeing is a wrong bleach
    # that looks right, and nothing enforced their agreement. A NON-circular spot is
    # used deliberately: at spot_len_um == spot_wid_um the two axes coincide and any
    # divergence between them is invisible.
    import pytest

    from api import frap_targets

    params = FS.SelectionParams(spot_len_um=2.0, spot_wid_um=0.8)
    a_px, b_px = FS.half_axes_px(params, UM_PER_PX)

    spot = _spot(300.0, 300.0)
    body = frap_targets._spot_json(spot, params, UM_PER_PX, ["mt_a"])
    assert body["roi"]["rx"] == round(a_px, 2)
    assert body["roi"]["ry"] == round(b_px, 2)

    # A tangent of 0 with 48 samples starting at t=0 puts a vertex exactly on each
    # semi-axis, so the polygon's extent IS the half-axis pair.
    poly = frap_render._roi_polygon(spot, params, UM_PER_PX)
    assert max(p[0] for p in poly) - spot.x == pytest.approx(a_px, abs=1e-9)
    assert max(p[1] for p in poly) - spot.y == pytest.approx(b_px, abs=1e-9)


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
