"""
Two-part (head + tail) sperm assembly, and the three-part path it must not change.

Source: backend/segmentation/sperm_final/inference/graph_assembly.py
        backend/segmentation/sperm_final/inference/postprocess.py

The `sperm_2part` model predicts Head (1) and Tail (3) only. Its sperm are
assembled on the TWO_PART chain (S -> Head -> Tail -> T); the original model
keeps THREE_PART (S -> Head -> Midpiece -> Tail -> T).
"""
import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from sperm_final.inference.graph_assembly import (  # noqa: E402
    THREE_PART,
    TWO_PART,
    assemble_sperm_graph,
)
from sperm_final.inference.postprocess import connect_sperm_polylines  # noqa: E402

H, W = 200, 400


def _part(points, cls, score=0.99, thickness=7):
    m = np.zeros((H, W), np.float32)
    cv2.polylines(m, [np.array(points, np.int32)], False, 1.0, thickness)
    return {"mask": m, "cls": cls, "score": score}


def _two_part_sperm(y=60, x0=40):
    head = _part([(x0, y), (x0 + 60, y)], 1)
    tail = _part([(x0 + 64, y), (x0 + 220, y + 20)], 3)
    return head, tail


@pytest.mark.unit
class TestTwoPartAssembly:

    def test_head_and_tail_form_one_sperm(self):
        head, tail = _two_part_sperm()
        sperm = assemble_sperm_graph([head, tail], 0.3, scheme=TWO_PART)
        assert len(sperm) == 1
        assert set(sperm[0]) == {"head", "tail"}

    def test_three_part_scheme_still_requires_a_midpiece(self):
        """Regression guard: the original model must not start accepting H+T."""
        head, tail = _two_part_sperm()
        assert assemble_sperm_graph([head, tail], 0.3, scheme=THREE_PART) == []
        assert assemble_sperm_graph([head, tail], 0.3) == []  # default = THREE_PART

    def test_three_part_complete_sperm_unchanged(self):
        head = _part([(40, 60), (70, 60)], 1)
        mid = _part([(74, 60), (170, 60)], 2)
        tail = _part([(174, 60), (330, 80)], 3)
        sperm = assemble_sperm_graph([head, mid, tail], 0.3)
        assert len(sperm) == 1
        assert set(sperm[0]) == {"head", "midpiece", "tail"}

    def test_two_part_ignores_midpiece_predictions(self):
        head, tail = _two_part_sperm()
        stray_mid = _part([(40, 150), (200, 150)], 2)
        sperm = assemble_sperm_graph([head, tail, stray_mid], 0.3, scheme=TWO_PART)
        assert len(sperm) == 1
        assert "midpiece" not in sperm[0]

    def test_lone_head_or_tail_is_discarded(self):
        head, tail = _two_part_sperm()
        assert assemble_sperm_graph([head], 0.3, scheme=TWO_PART) == []
        assert assemble_sperm_graph([tail], 0.3, scheme=TWO_PART) == []

    def test_two_sperm_pair_each_head_with_its_own_tail(self):
        h1, t1 = _two_part_sperm(y=40)
        h2, t2 = _two_part_sperm(y=150)
        sperm = assemble_sperm_graph([h1, t2, h2, t1], 0.3, scheme=TWO_PART)
        assert len(sperm) == 2
        for s in sperm:
            hy = np.nonzero(s["head"]["mask"])[0].mean()
            ty = np.nonzero(s["tail"]["mask"])[0].mean()
            assert abs(hy - ty) < 30, "head paired with the other sperm's tail"


@pytest.mark.unit
class TestTwoPartPolylines:

    def test_head_and_tail_are_welded_at_the_junction(self):
        head, tail = _two_part_sperm()
        polys = connect_sperm_polylines({"head": head, "tail": tail})
        assert polys["midpiece"] == []
        assert len(polys["head"]) >= 2 and len(polys["tail"]) >= 2
        assert tuple(polys["head"][-1]) == tuple(polys["tail"][0])

    def test_orientation_runs_head_tip_to_tail_tip(self):
        head, tail = _two_part_sperm()
        polys = connect_sperm_polylines({"head": head, "tail": tail})
        # The free head tip is the left end, the free tail tip the far right.
        assert polys["head"][0][0] < 50
        assert polys["tail"][-1][0] > 250
        # The junction sits where the two parts meet (x ~ 100-104).
        assert 90 < polys["head"][-1][0] < 115

    def test_three_part_polylines_unchanged(self):
        head = _part([(40, 60), (70, 60)], 1)
        mid = _part([(74, 60), (170, 60)], 2)
        tail = _part([(174, 60), (330, 80)], 3)
        polys = connect_sperm_polylines({"head": head, "midpiece": mid, "tail": tail})
        assert tuple(polys["head"][-1]) == tuple(polys["midpiece"][0])
        assert tuple(polys["midpiece"][-1]) == tuple(polys["tail"][0])
