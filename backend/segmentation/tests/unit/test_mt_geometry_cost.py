"""Geometry that replaces the 32-d embedding as cross-frame evidence.

Each test names the failure it prevents. The two that matter most are the
overlap gate (a fragment stealing a filament's track) and the drift estimator
(reporting gliding as drift, which would cancel the signal a motility assay
exists to measure).
"""

import numpy as np
import pytest

from api.mt_geometry_cost import (
    GATE_MIN_OVERLAP,
    arclength,
    contour_shift,
    curve_distance,
    estimate_drift,
    overlap_fraction,
    resample,
)


def _line(x0, y0, x1, y1, n=50):
    """A straight polyline. Column order is irrelevant except in drift tests."""
    return np.stack([np.linspace(x0, x1, n), np.linspace(y0, y1, n)], axis=1)


# --------------------------------------------------------------------------
# curve_distance
# --------------------------------------------------------------------------


def test_identical_curves_have_zero_distance():
    a = _line(0, 0, 100, 0)
    assert curve_distance(a, a.copy()) == pytest.approx(0.0, abs=1e-9)


def test_translated_curve_distance_is_the_translation():
    a = _line(0, 0, 100, 0)
    b = a + np.array([0.0, 3.0])
    assert curve_distance(a, b) == pytest.approx(3.0, abs=0.2)


def test_distance_is_symmetric():
    a, b = _line(0, 0, 100, 0), _line(0, 2, 80, 6)
    assert curve_distance(a, b) == pytest.approx(curve_distance(b, a))


def test_degenerate_input_is_infinite_not_zero():
    """A one-point 'curve' must never look like a perfect match. A centroid
    distance would return ~0 here and hand it somebody else's track."""
    assert curve_distance(np.array([[1.0, 1.0]]), _line(0, 0, 10, 0)) == float("inf")
    assert curve_distance(np.zeros((0, 2)), _line(0, 0, 10, 0)) == float("inf")


# --------------------------------------------------------------------------
# overlap_fraction
# --------------------------------------------------------------------------


def test_overlap_of_a_curve_with_itself_is_one():
    a = _line(0, 0, 100, 0)
    assert overlap_fraction(a, a.copy()) == pytest.approx(1.0)


def test_short_fragment_on_a_long_filament_is_gated_out():
    """The failure mean distance alone cannot see: a 10 px fragment lying on a
    200 px filament is NOT the same object, but its one-directional distance is
    tiny, so without this gate it wins the assignment."""
    long_mt = _line(0, 0, 200, 0, n=200)
    fragment = _line(90, 0, 100, 0, n=10)
    assert overlap_fraction(long_mt, fragment) < GATE_MIN_OVERLAP


def test_a_genuinely_shifted_filament_still_overlaps_enough():
    """The gate must not be so tight that ordinary frame-to-frame motion of a
    real microtubule severs its track."""
    a = _line(0, 0, 200, 0, n=200)
    b = _line(3, 1, 203, 1, n=200)
    assert overlap_fraction(a, b) >= GATE_MIN_OVERLAP


def test_a_growing_microtubule_is_not_gated_out():
    """Microtubules polymerise. A filament that lengthened by half between
    frames is the same filament; the min() reducer must still admit it."""
    a = _line(0, 0, 200, 0, n=200)
    b = _line(0, 0, 300, 0, n=300)
    assert overlap_fraction(a, b) >= GATE_MIN_OVERLAP


def test_half_of_a_split_detection_still_matches_its_filament():
    """When the instancer breaks one microtubule into two arcs, the larger arc
    must keep the track rather than being gated out as a fragment."""
    a = _line(0, 0, 200, 0, n=200)
    half = _line(0, 0, 100, 0, n=100)
    assert overlap_fraction(a, half) >= GATE_MIN_OVERLAP


# --------------------------------------------------------------------------
# estimate_drift
# --------------------------------------------------------------------------


def test_drift_recovers_a_pure_translation():
    """Two distinct orientations are enough to solve the aperture problem."""
    prev = [_line(0, 0, 100, 0), _line(0, 0, 0, 100)]
    shift = np.array([4.0, -3.0])
    curr = [p + shift for p in prev]
    assert estimate_drift(prev, curr) == pytest.approx(shift, abs=0.5)


def test_gliding_along_the_filament_is_not_reported_as_drift():
    """THE critical property.

    A filament sliding along its own axis is motility, not stage drift. A
    median-centroid estimator reports ~the full gliding speed here; subtracting
    it would cancel exactly what a gliding assay measures.
    """
    prev = [_line(0, 0, 100, 0), _line(0, 20, 100, 20)]
    curr = [_line(8, 0, 108, 0), _line(8, 20, 108, 20)]   # slid +8 px along x
    drift = estimate_drift(prev, curr)
    assert abs(drift[1]) < 1.0, f"invented perpendicular drift: {drift}"
    assert abs(drift[0]) < 3.0, f"gliding leaked into drift: {drift}"


def test_parallel_field_degrades_towards_zero_not_garbage():
    """Rank-deficient: every filament shares one orientation, so motion along
    it is unobservable. The honest answer is 'no evidence', not extrapolation."""
    prev = [_line(0, y, 100, y) for y in (0, 10, 20)]
    curr = [p + np.array([5.0, 0.0]) for p in prev]
    assert np.linalg.norm(estimate_drift(prev, curr)) < 2.0


def test_drift_of_an_empty_frame_is_zero_not_an_error():
    """A frame where every microtubule vanished is a legitimate input."""
    assert estimate_drift([], [_line(0, 0, 10, 0)]) == pytest.approx(np.zeros(2))
    assert estimate_drift([_line(0, 0, 10, 0)], []) == pytest.approx(np.zeros(2))


def test_drift_ignores_filaments_beyond_the_gate():
    """A filament that jumped 200 px is a different object; letting it vote
    would drag the common-mode estimate off."""
    prev = [_line(0, 0, 100, 0), _line(0, 0, 0, 100)]
    curr = [p + np.array([2.0, 2.0]) for p in prev] + [_line(500, 500, 600, 500)]
    assert estimate_drift(prev, curr) == pytest.approx(np.array([2.0, 2.0]), abs=0.8)


# --------------------------------------------------------------------------
# contour_shift
# --------------------------------------------------------------------------


def test_contour_shift_measures_sliding_a_distance_metric_cannot_see():
    """The filament slid 8 px along itself; its perpendicular displacement is
    zero, so curve_distance reports ~0 while the material clearly moved."""
    a = _line(0, 0, 100, 0, n=100)
    b = _line(8, 0, 108, 0, n=100)
    assert curve_distance(a, b) < 1.0            # invisible to distance
    assert abs(contour_shift(a, b)) == pytest.approx(8.0, abs=1.5)


def test_contour_shift_of_a_stationary_filament_is_zero():
    a = _line(0, 0, 100, 0, n=100)
    assert contour_shift(a, a.copy()) == pytest.approx(0.0, abs=0.5)


# --------------------------------------------------------------------------
# resample / arclength
# --------------------------------------------------------------------------


def test_resample_gives_uniform_spacing_and_preserves_extent():
    a = _line(0, 0, 100, 0, n=7)
    r = resample(a, ds=2.0)
    steps = np.linalg.norm(np.diff(r, axis=0), axis=1)
    assert steps.std() < 0.1
    assert r[:, 0].max() == pytest.approx(100.0, abs=2.0)


def test_resample_makes_sampling_density_irrelevant():
    """Two identical curves sampled at different densities must compare equal;
    without resampling the mean nearest-point distance is biased."""
    sparse = resample(_line(0, 0, 100, 0, n=5))
    dense = resample(_line(0, 0, 100, 0, n=500))
    assert curve_distance(sparse, dense) < 0.05


def test_arclength_of_a_straight_line_is_its_length():
    assert arclength(_line(0, 0, 30, 40, n=2))[-1] == pytest.approx(50.0)
