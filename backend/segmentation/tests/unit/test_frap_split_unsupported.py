"""A bleach must not land where the map saw no filament: frap_select.split_unsupported."""
from __future__ import annotations

import numpy as np

from models.frap_select import split_unsupported


def _map(width=600):
    return np.ones((50, width), np.float32)


def _line(x0, x1, y=25.0):
    return np.array([[x0, y], [x1, y]], float)


def test_a_supported_polyline_comes_back_as_the_same_array():
    pts = _line(10, 500)
    pieces, owners = split_unsupported([pts], _map())
    assert pieces[0] is pts and owners == [0]


def test_a_gap_cuts_the_polyline_and_both_pieces_keep_their_owner():
    prob = _map()
    prob[:, 200:270] = 0.1
    pieces, owners = split_unsupported([_line(10, 500)], prob)
    assert owners == [0, 0]
    assert pieces[0][:, 0].max() < 200 and pieces[1][:, 0].min() >= 270


def test_a_short_dip_does_not_cut():
    prob = _map()
    prob[:, 200:203] = 0.1
    pts = _line(10, 500)
    pieces, _ = split_unsupported([pts], prob)
    assert pieces[0] is pts


def test_no_piece_lies_on_the_gap():
    prob = _map()
    prob[:, 200:270] = 0.1
    pieces, _ = split_unsupported([_line(10, 500)], prob)
    for p in pieces:
        rows, cols = np.round(p[:, 1]).astype(int), np.round(p[:, 0]).astype(int)
        assert (prob[rows, cols] >= 0.5).all()


def test_owners_stay_aligned_with_several_polylines():
    prob = _map()
    prob[:, 200:270] = 0.1
    pieces, owners = split_unsupported([_line(10, 150), _line(10, 500), _line(300, 500)], prob)
    assert owners == [0, 1, 1, 2]
    assert len(pieces) == 4


def test_a_polyline_wholly_on_the_gap_vanishes():
    prob = _map()
    prob[:, 200:270] = 0.1
    pieces, owners = split_unsupported([_line(210, 260)], prob)
    assert pieces == [] and owners == []


def test_coordinates_outside_the_map_do_not_raise():
    pieces, _ = split_unsupported([_line(-5, 900)], _map())
    assert len(pieces) == 1
