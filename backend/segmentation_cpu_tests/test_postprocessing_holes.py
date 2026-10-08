"""Holes out of the shared polygoniser, for the learned neurite/soma model.

`services/postprocessing.py` needs numpy, OpenCV and scikit-image only, so it
is imported for real. The model call that uses it (`predict_neurite_soma`)
needs torch and a GPU; what it adds to this is two lines, covered by the
verification run recorded in the PR.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'segmentation'))
from services.postprocessing import PostprocessingService  # noqa: E402


def _loop_with_an_island() -> np.ndarray:
    """Crossing neurites close a loop; here one loop with a separate blob of
    the same class inside it, and a disc with a pinhole."""
    mask = np.zeros((200, 260), np.float32)
    cv2.circle(mask, (70, 100), 50, 1.0, 6)  # the loop
    cv2.circle(mask, (70, 100), 12, 1.0, -1)  # an island inside its hole
    cv2.circle(mask, (200, 60), 9, 1.0, -1)  # a disc ...
    mask[58:62, 198:202] = 0.0  # ... with a 4 x 4 px pinhole, under the minimum
    cv2.circle(mask, (200, 140), 30, 1.0, 5)  # a second loop, so two holes exist
    return mask


def _service() -> PostprocessingService:
    service = PostprocessingService()
    service.min_area = 20
    return service


def test_by_default_a_loop_is_its_outer_ring_only():
    # Every other caller: the result has no `holes` key at all.
    polygons = _service().mask_to_polygons(_loop_with_an_island())
    assert len(polygons) == 4
    assert all('holes' not in p for p in polygons)


def test_emit_holes_reports_the_hole_and_not_the_island_as_one():
    polygons = _service().mask_to_polygons(_loop_with_an_island(), emit_holes=True)
    assert len(polygons) == 4  # two loops, the island, the disc -- the island is a REGION
    with_holes = [p for p in polygons if 'holes' in p]
    assert len(with_holes) == 2
    loop = max(with_holes, key=lambda p: p['area'])
    assert len(loop['holes']) == 1
    # The hole is the inside of the loop: about pi * 47^2.
    ring = np.array([[p['x'], p['y']] for p in loop['holes'][0]], np.float32)
    assert 6000 < cv2.contourArea(ring) < 7500


def test_a_hole_under_the_minimum_is_closed_not_reported():
    polygons = _service().mask_to_polygons(_loop_with_an_island(), emit_holes=True)
    disc = next(p for p in polygons if 180 < p['points'][0]['x'] < 220)
    assert 'holes' not in disc


def test_without_hole_detection_nothing_is_emitted():
    polygons = _service().mask_to_polygons(
        _loop_with_an_island(), detect_holes=False, emit_holes=True
    )
    assert all('holes' not in p for p in polygons)


def test_holes_become_internal_polygons_with_no_class():
    polygons = _service().mask_to_polygons(_loop_with_an_island(), emit_holes=True)
    for i, polygon in enumerate(polygons, start=1):
        polygon['id'] = f'polygon_{i}'
        polygon['class'] = polygon['partClass'] = 'neurite'
    parents = [p['id'] for p in polygons if 'holes' in p]

    out = PostprocessingService.holes_to_internal(polygons, next_id=5)

    # Every polygon keeps a distinct id; the holes continue the numbering.
    assert [p['id'] for p in out] == [f'polygon_{i}' for i in range(1, 7)]
    assert all('holes' not in p for p in out)
    holes = out[4:]
    assert [h['type'] for h in holes] == ['internal', 'internal']
    assert [h['parent_id'] for h in holes] == parents
    for hole in holes:
        # A class on a hole would make every reader take it for a neurite and
        # fill the loop again.
        assert 'class' not in hole and 'partClass' not in hole
    assert 6000 < max(h['area'] for h in holes) < 7500
    # The regions themselves are untouched.
    assert [p['type'] for p in out[:4]] == ['external'] * 4
