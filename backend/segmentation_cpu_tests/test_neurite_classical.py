"""The classical neurite/soma model and the per-class intensity table.

Both modules are loaded BY PATH, like `test_neurite_metrics.py` does: going
through the `models` package would import torch to run a ridge filter.

The fixtures here are synthetic and exist to pin BEHAVIOUR (what is a neurite,
what a hole is, which pixel belongs to which class). They say nothing about
whether the parameters are right for real images -- those were chosen on four
production frames, and the module docstring records how the model does there.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

_MODELS = Path(__file__).resolve().parents[1] / 'segmentation' / 'models'


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, _MODELS / f'{name}.py')
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


nc = _load('neurite_classical')
ni = _load('neurite_intensity')

SIZE = 512
SOMA = (256, 256)  # x, y
SOMA_R = 26


def _noise(seed: int, offset: float, sigma: float) -> np.ndarray:
    return np.random.default_rng(seed).normal(offset, sigma, (SIZE, SIZE))


def _neuron(amplitude: float) -> np.ndarray:
    """A cell: a disc with six BENT neurites, one of them ending in a loop.

    Bent on purpose -- a straight line cannot tell a correct ridge filter from
    one that only responds along the axes.
    """
    canvas = np.zeros((SIZE, SIZE), np.float32)
    cx, cy = SOMA
    for k in range(6):
        angle = k * np.pi / 3 + 0.2
        pts = []
        for r in range(SOMA_R - 4, 200, 6):
            bend = 0.35 * np.sin(r / 45.0 + k)
            pts.append(
                [cx + r * np.cos(angle + bend), cy + r * np.sin(angle + bend)]
            )
        cv2.polylines(
            canvas, [np.array(pts, np.int32)], False, float(amplitude), 4, cv2.LINE_AA
        )
    cv2.circle(canvas, SOMA, SOMA_R, float(amplitude), -1, cv2.LINE_AA)
    return canvas


LOOP_CENTRE = (120, 110)
LOOP_R = 34


def _loop(amplitude: float) -> np.ndarray:
    """A closed neurite ring, long enough to count as a neurite on its own."""
    canvas = np.zeros((SIZE, SIZE), np.float32)
    cv2.circle(canvas, LOOP_CENTRE, LOOP_R, float(amplitude), 4, cv2.LINE_AA)
    return canvas


STAINS = [(430, 60), (60, 440), (450, 430), (400, 300)]


def _stains(amplitude: float) -> np.ndarray:
    """Background debris: short squiggles as bright as a neurite, attached to
    nothing. A ridge filter answers to them exactly as it does to a neurite."""
    canvas = np.zeros((SIZE, SIZE), np.float32)
    for x, y in STAINS:
        pts = np.array([[x, y], [x + 9, y + 6], [x + 4, y + 15], [x + 14, y + 20]])
        cv2.polylines(canvas, [pts.astype(np.int32)], False, float(amplitude), 3, cv2.LINE_AA)
    return canvas


def _blur(image: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(image, (0, 0), 1.0)


@pytest.fixture(scope='module')
def scene():
    """One channel holding the whole scene, in 16-bit-camera-like counts."""
    structure = _blur(_neuron(60) + _loop(60) + _stains(60))
    return (_noise(1, 100, 3) + structure).astype(np.float32)


@pytest.fixture(scope='module')
def scene_label(scene):
    return nc.segment([scene])


def _fraction(label, mask, value):
    return float((label[mask] == value).mean())


def test_a_bent_neurite_is_found_and_the_soma_is_a_soma(scene_label):
    truth_soma = np.zeros((SIZE, SIZE), np.uint8)
    cv2.circle(truth_soma, SOMA, SOMA_R - 6, 1, -1)
    assert _fraction(scene_label, truth_soma > 0, 2) > 0.95

    # The neurites' own centre lines, away from the soma.
    truth_line = _neuron(1) > 0.9
    far = np.hypot(*np.mgrid[0:SIZE, 0:SIZE][::-1] - np.array(SOMA)[:, None, None]) > SOMA_R + 25
    assert _fraction(scene_label, truth_line & far, 1) > 0.9

    # ... and the soma is not also counted as neurite.
    assert _fraction(scene_label, truth_soma > 0, 1) == 0.0


def test_background_stains_are_not_neurites(scene_label):
    # A stain is as bright as a neurite here, so no threshold separates them;
    # what does is that it is short and attached to nothing.
    for x, y in STAINS:
        window = scene_label[y - 6 : y + 28, x - 6 : x + 22]
        assert not window.any(), f'stain at {(x, y)} was segmented'
    # Nothing but the cell and the loop is labelled at all.
    labelled = scene_label > 0
    allowed = cv2.dilate(
        ((_neuron(1) + _loop(1)) > 0.05).astype(np.uint8), np.ones((15, 15), np.uint8)
    )
    assert not (labelled & (allowed == 0)).any()


def test_a_soma_needs_neurites_leaving_it():
    # The same disc with nothing attached is a blob of debris, not a cell body.
    disc = np.zeros((SIZE, SIZE), np.float32)
    cv2.circle(disc, SOMA, SOMA_R, 60.0, -1, cv2.LINE_AA)
    label = nc.segment([(_noise(2, 100, 3) + _blur(disc)).astype(np.float32)])
    assert not (label == 2).any()


def test_each_channel_is_normalised_before_the_merge():
    # The cell is in the DIM channel only; the other is ten times brighter and
    # shows just the loop. Merged in raw counts the bright channel would decide
    # everything and the cell would vanish under its noise.
    dim = (_noise(3, 100, 3) + _blur(_neuron(40))).astype(np.float32)
    bright = (_noise(4, 3000, 60) + _blur(_loop(900))).astype(np.float32)

    merged = nc.segment([bright, dim])
    alone = nc.segment([bright])

    line = _neuron(1) > 0.9
    far = np.hypot(*np.mgrid[0:SIZE, 0:SIZE][::-1] - np.array(SOMA)[:, None, None]) > SOMA_R + 25
    assert _fraction(merged, line & far, 1) > 0.85
    assert _fraction(alone, line & far, 1) < 0.02
    # The loop, present only in the other channel, is in the merge as well.
    ring = _loop(1) > 0.9
    assert _fraction(merged, ring, 1) > 0.9


def test_merge_is_symmetric_in_channel_order():
    a = (_noise(5, 100, 3) + _blur(_neuron(50))).astype(np.float32)
    b = (_noise(6, 500, 9) + _blur(_loop(150))).astype(np.float32)
    assert np.array_equal(nc.segment([a, b]), nc.segment([b, a]))


def test_a_black_8_bit_background_does_not_divide_by_zero():
    # More than half the pixels are exactly 0, so the MAD is 0. That used to
    # be the divisor.
    image = np.clip(_blur(_neuron(200) + _loop(200)), 0, 255).astype(np.uint8)
    assert np.median(image) == 0
    units = nc.to_noise_units(image)
    assert units is not None and np.isfinite(units).all()
    label = nc.segment([image])
    assert (label == 1).any()


def test_a_flat_channel_contributes_nothing(scene):
    # The constant fill of a plane the microscope did not acquire. Zeros are
    # not neutral in a maximum: merged in as zeros they clip the negative half
    # of the other channel's noise and the result moves.
    flat = np.full((SIZE, SIZE), 777, np.uint16)
    assert nc.to_noise_units(flat) is None
    assert np.array_equal(nc.segment([scene, flat]), nc.segment([scene]))
    assert np.array_equal(nc.segment([flat, scene]), nc.segment([scene]))
    assert not nc.segment([flat]).any()


def test_channels_of_different_sizes_are_refused(scene):
    with pytest.raises(ValueError, match='same size'):
        nc.segment([scene, scene[:-1]])


def test_the_route_and_the_model_agree_on_the_pixel_limit():
    # `api/routes.py` writes the limit out instead of importing it (it is also
    # loaded where `models` is a stub), so nothing but this holds them equal.
    source = (_MODELS.parent / 'api' / 'routes.py').read_text()
    assert f'CLASSICAL_MAX_PIXELS = {nc.MAX_PIXELS:_}' in source


def test_an_oversized_image_is_refused(monkeypatch, scene):
    monkeypatch.setattr(nc, 'MAX_PIXELS', scene.size - 1)
    with pytest.raises(ValueError, match='at most'):
        nc.segment([scene])


# --- polygons ---------------------------------------------------------------


def _by_class(polygons, name):
    out = []
    for poly in polygons:
        if poly.get('partClass') != name:
            continue
        out.append(
            {
                'points': [[p['x'], p['y']] for p in poly['points']],
                'holes': [
                    [[p['x'], p['y']] for p in hole['points']]
                    for hole in polygons
                    if hole.get('parent_id') == poly['id']
                ],
            }
        )
    return out


def test_a_loop_keeps_its_hole_and_the_hole_has_no_class(scene_label):
    polygons = nc.label_to_polygons(scene_label)
    internal = [p for p in polygons if p['type'] == 'internal']
    assert internal, 'the neurite loop encloses background; a hole must be emitted'
    ids = {p['id'] for p in polygons}
    for hole in internal:
        assert hole['parent_id'] in ids
        # A class on a hole would make every reader treat it as a neurite.
        assert 'class' not in hole and 'partClass' not in hole
    for poly in polygons:
        if poly['type'] == 'external':
            assert poly['class'] == poly['partClass'] in ('neurite', 'soma')

    # The centre of the loop is background in the label and stays background
    # when the polygons are drawn back.
    cx, cy = LOOP_CENTRE
    assert scene_label[cy, cx] == 0
    masks = ni.class_masks(
        _by_class(polygons, 'soma'), _by_class(polygons, 'neurite'), scene_label.shape
    )
    assert masks['neurite'][cy, cx] == 0


def test_without_hole_detection_the_loop_is_filled(scene_label):
    polygons = nc.label_to_polygons(scene_label, detect_holes=False)
    assert all(p['type'] == 'external' for p in polygons)
    cx, cy = LOOP_CENTRE
    masks = ni.class_masks([], _by_class(polygons, 'neurite'), scene_label.shape)
    assert masks['neurite'][cy, cx] == 1


def test_polygons_drawn_back_reproduce_the_label(scene_label):
    # Holes at or above `min_hole_area` and regions at or above `min_area`
    # must come back pixel for pixel; a textbook hole fill erodes the ring by
    # one pixel all the way round, which on a 4 px neurite is a quarter of it.
    params = dict(nc.PARAMS, min_area=0.0, min_hole_area=0.0)
    polygons = nc.label_to_polygons(scene_label, params=params)
    masks = ni.class_masks(
        _by_class(polygons, 'soma'), _by_class(polygons, 'neurite'), scene_label.shape
    )
    assert np.array_equal(masks['soma'], (scene_label == 2).astype(np.uint8))
    assert np.array_equal(masks['neurite'], (scene_label == 1).astype(np.uint8))


# --- intensity --------------------------------------------------------------


def _square(x0, y0, size):
    return [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size]]


def test_intensity_per_class_and_soma_wins_the_overlap():
    shape = (100, 120)
    image = np.full(shape, 10, np.uint16)
    soma = {'points': _square(20, 20, 20), 'holes': []}  # 21 x 21 px, drawn inclusive
    neurite = {'points': _square(30, 30, 40), 'holes': []}  # overlaps the soma
    masks = ni.class_masks([soma], [neurite], shape)
    assert masks['soma'].sum() == 21 * 21
    assert not (masks['soma'] & masks['neurite']).any()
    assert masks['neurite'].sum() == 41 * 41 - 11 * 11

    image[masks['soma'] > 0] = 500
    image[masks['neurite'] > 0] = 200
    rows = {(r['channel'], r['class']): r for r in ni.measure([('c1', image)], masks)}
    assert rows[('c1', 'soma')]['mean_intensity'] == 500
    assert rows[('c1', 'neurite')]['mean_intensity'] == 200
    assert rows[('c1', 'soma')]['background_median'] == 10
    assert rows[('c1', 'neurite')]['mean_minus_background'] == 190
    assert rows[('c1', 'soma')]['area_px'] == 21 * 21


def test_the_background_keeps_clear_of_the_polygons():
    shape = (100, 100)
    image = np.full(shape, 7.0, np.float32)
    # A halo just outside the polygon: brighter than background, and exactly
    # what a blurred structure leaves around its outline.
    image[14:67, 14:67] = 90.0
    image[20:61, 20:61] = 300.0
    masks = ni.class_masks([], [{'points': _square(20, 20, 40), 'holes': []}], shape)
    row = ni.measure([('c', image)], masks)[0 + 1]  # neurite row
    assert row['class'] == 'neurite'
    assert row['background_median'] == 7.0
    assert not masks['background'][17, 17]  # within the margin
    assert masks['background'][5, 5]


def test_an_empty_class_is_blank_not_zero():
    shape = (60, 60)
    image = np.full(shape, 50, np.uint8)
    masks = ni.class_masks([], [{'points': _square(10, 10, 20), 'holes': []}], shape)
    rows = {r['class']: r for r in ni.measure([('c', image)], masks)}
    assert rows['soma']['area_px'] == 0
    assert rows['soma']['mean_intensity'] is None
    assert rows['soma']['mean_minus_background'] is None
    assert rows['neurite']['mean_intensity'] == 50


def test_a_soma_inside_a_neurite_loop_survives_the_hole():
    # The hole of one polygon must not erase a neighbour that lies inside it.
    shape = (120, 120)
    ring = {'points': _square(10, 10, 100), 'holes': [_square(30, 30, 60)]}
    inner = {'points': _square(50, 50, 20), 'holes': []}
    mask = ni.rasterise([inner, ring], shape)
    assert mask[60, 60] == 1  # the inner polygon
    assert mask[40, 40] == 0  # the hole
    assert mask[15, 15] == 1  # the ring
    # ... in either drawing order.
    assert np.array_equal(mask, ni.rasterise([ring, inner], shape))


def test_a_channel_of_the_wrong_size_is_refused():
    masks = ni.class_masks([], [{'points': _square(1, 1, 5), 'holes': []}], (20, 20))
    with pytest.raises(ValueError, match='polygons were drawn on'):
        ni.measure([('c', np.zeros((21, 20)))], masks)
