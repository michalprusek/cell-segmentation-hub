"""Tests for the two-protein competition metric.

The cases below are chosen so that a wrong implementation FAILS them, not so
that a right one passes. In particular several fixtures are deliberately
asymmetric or differently-scaled, because the obvious bugs here — forgetting to
normalise per channel, normalising by peak instead of area, dropping the
background, returning 0.0 instead of None — all survive a symmetric fixture.

WHY THIS FILE LIVES HERE. ``mt_competition`` sits beside ``mt_measure`` in
``backend/segmentation/models``, whose natural test home is
``backend/segmentation/tests`` — which CI cannot collect, because that
directory's ``conftest.py`` imports torch, and on a driverless runner
``mamba_ssm`` reaches Triton and raises. This directory IS in ``make ci``
step 7, for the same reason ``test_mt_measure_region_stats.py`` gives: an
assertion about a shared metric is worth little if nothing automated runs it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

from _mt_package import ensure_on_path  # noqa: E402

ensure_on_path()
from mt_competition import (  # noqa: E402  (needs the path set above)
    MIN_PROFILE_SAMPLES,
    competition_index,
    competition_pair,
    normalize_profile,
    profile_anticorrelation,
)


# --------------------------------------------------------------- normalisation


def test_normalize_gives_unit_area_not_unit_peak():
    """The distinguishing property. A peak-normalised profile would sum to more
    than 1 for anything but a delta, so this fails loudly if the wrong
    normalisation is used."""
    f = normalize_profile(np.array([1.0, 2.0, 3.0, 4.0]))
    assert f is not None
    assert f.sum() == pytest.approx(1.0)
    assert f.max() == pytest.approx(4.0 / 10.0)  # NOT 1.0


def test_normalize_is_invariant_to_channel_gain():
    """Why per-channel normalisation exists: the same shape at 10x the counts
    must give the identical density. CLAUDE.md records 488 nm running 9-51
    counts against 640 nm at 93-228 on the same container."""
    shape = np.array([1.0, 5.0, 2.0, 8.0, 3.0])
    a = normalize_profile(shape)
    b = normalize_profile(shape * 37.0)
    assert a is not None and b is not None
    np.testing.assert_allclose(a, b, rtol=1e-12)


def test_normalize_subtracts_background_before_normalising():
    """Order matters: subtracting after normalising would leave the background
    ratio in the answer. A flat pedestal under a peak must vanish."""
    with_pedestal = normalize_profile(np.array([10.0, 10.0, 20.0, 10.0]), background=10.0)
    without = normalize_profile(np.array([0.0, 0.0, 10.0, 0.0]))
    assert with_pedestal is not None and without is not None
    np.testing.assert_allclose(with_pedestal, without, atol=1e-12)


def test_normalize_clamps_negatives_rather_than_letting_them_cancel():
    """Unit-area normalisation divides by the sum; unclamped negatives could
    drive it toward zero and blow the profile up. Samples below background are
    noise, not negative protein."""
    f = normalize_profile(np.array([5.0, -3.0, 5.0, -4.0]), background=0.0)
    assert f is not None
    assert np.all(f >= 0.0)
    np.testing.assert_allclose(f, [0.5, 0.0, 0.5, 0.0], atol=1e-12)


def test_normalize_returns_none_when_nothing_survives_background():
    """None, never a zero profile: a channel entirely at background has no
    distribution, and 0.0 competition would read as 'perfectly co-distributed',
    the opposite of the truth."""
    assert normalize_profile(np.array([4.0, 4.0, 4.0, 4.0]), background=4.0) is None
    assert normalize_profile(np.array([1.0, 2.0, 1.0]), background=99.0) is None


def test_normalize_rejects_too_short_and_non_finite():
    assert normalize_profile(np.array([1.0, 2.0])) is None  # < MIN_PROFILE_SAMPLES
    assert normalize_profile(np.array([1.0, np.nan, 3.0])) is None
    assert normalize_profile(np.array([1.0, np.inf, 3.0])) is None


# ------------------------------------------------------------------ the metric


def test_identical_distributions_score_zero():
    p = normalize_profile(np.array([1.0, 4.0, 9.0, 2.0, 7.0]))
    assert p is not None
    assert competition_index(p, p) == pytest.approx(0.0, abs=1e-12)


def test_identical_shape_at_different_brightness_scores_zero():
    """The headline property: competition must measure WHERE the proteins are,
    not how bright their dyes are."""
    shape = np.array([2.0, 9.0, 4.0, 1.0])
    f = normalize_profile(shape)
    g = normalize_profile(shape * 120.0)
    assert f is not None and g is not None
    assert competition_index(f, g) == pytest.approx(0.0, abs=1e-12)


def test_disjoint_supports_score_one():
    """A on the left half, B on the right: perfect mutual exclusion."""
    f = normalize_profile(np.array([5.0, 5.0, 0.0, 0.0]))
    g = normalize_profile(np.array([0.0, 0.0, 5.0, 5.0]))
    assert f is not None and g is not None
    assert competition_index(f, g) == pytest.approx(1.0, abs=1e-12)


def test_half_overlap_scores_one_half():
    """A known intermediate value, so the test pins the SCALE and not just the
    two endpoints. Uniform over [0,1] vs uniform over [0.5,1] overlap on half
    their mass."""
    f = normalize_profile(np.ones(4))
    g = normalize_profile(np.array([0.0, 0.0, 1.0, 1.0]))
    assert f is not None and g is not None
    assert competition_index(f, g) == pytest.approx(0.5, abs=1e-12)


def test_metric_is_symmetric():
    f = normalize_profile(np.array([1.0, 6.0, 2.0, 0.5]))
    g = normalize_profile(np.array([3.0, 1.0, 1.0, 9.0]))
    assert f is not None and g is not None
    assert competition_index(f, g) == pytest.approx(competition_index(g, f))


def test_matches_the_half_absolute_difference_form():
    """1 - sum(min(f,g)) and 0.5*sum|f-g| are the same number for unit-area
    inputs. Asserting both keeps the docstring honest."""
    rng = np.random.default_rng(20260905)
    for _ in range(200):
        f = normalize_profile(rng.random(40) * rng.integers(1, 500))
        g = normalize_profile(rng.random(40) * rng.integers(1, 500))
        assert f is not None and g is not None
        assert competition_index(f, g) == pytest.approx(
            0.5 * float(np.abs(f - g).sum()), abs=1e-12
        )


def test_stays_within_bounds_on_random_input():
    rng = np.random.default_rng(7)
    for _ in range(500):
        f = normalize_profile(rng.random(rng.integers(3, 60)) * 1000)
        g = normalize_profile(rng.random(f.size) * 1000)
        assert f is not None and g is not None
        assert 0.0 <= competition_index(f, g) <= 1.0


def test_shape_mismatch_is_an_error_not_a_silent_truncation():
    with pytest.raises(ValueError):
        competition_index(np.ones(4) / 4, np.ones(5) / 5)


# ----------------------------------------------------------- anticorrelation


def test_anticorrelation_is_minus_one_for_exact_displacement():
    """The case the distance metric cannot see: A falls exactly where B rises."""
    a = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    assert profile_anticorrelation(a, -a + 10.0) == pytest.approx(-1.0)


def test_anticorrelation_is_plus_one_for_colocalisation():
    a = np.array([1.0, 4.0, 2.0, 8.0])
    assert profile_anticorrelation(a, a * 3.0 + 5.0) == pytest.approx(1.0)


def test_anticorrelation_is_none_for_a_flat_profile():
    """Undefined, not zero — correlation with a constant has no value."""
    assert profile_anticorrelation(np.ones(5), np.array([1.0, 2.0, 3.0, 4.0, 5.0])) is None


def test_anticorrelation_separates_the_case_competition_cannot():
    """The worked example from the module docstring, as an executable claim.

    A uniform, B a single spot. Whether or not A dips under B, the competition
    index is high — so on its own it would call both 'competition'. The
    correlation tells them apart, which is the entire reason it is exported.
    """
    n = 40
    spot = np.zeros(n)
    spot[20] = 10.0

    a_flat = np.ones(n)                      # no competition: A ignores B
    a_dip = np.ones(n)
    a_dip[20] = 0.0                          # competition: A is displaced

    f_flat = normalize_profile(a_flat)
    f_dip = normalize_profile(a_dip)
    g = normalize_profile(spot)
    assert f_flat is not None and f_dip is not None and g is not None

    c_flat = competition_index(f_flat, g)
    c_dip = competition_index(f_dip, g)
    # Competition cannot tell them apart: both high, and within a few percent.
    assert c_flat > 0.9 and c_dip > 0.9
    assert abs(c_flat - c_dip) < 0.05

    # The correlation can: displacement is clearly the more negative of the two.
    r_flat = profile_anticorrelation(a_flat, spot)
    r_dip = profile_anticorrelation(a_dip, spot)
    assert r_flat is None or r_dip < r_flat   # flat A is constant -> undefined
    assert r_dip is not None and r_dip < 0.0


# ------------------------------------------------------------------- the pair


def test_pair_returns_both_and_applies_backgrounds_independently():
    n = 12
    a = np.full(n, 50.0)
    a[:6] = 150.0
    b = np.full(n, 500.0)
    b[6:] = 900.0

    comp, corr = competition_pair(a, b, background_a=50.0, background_b=500.0)
    assert comp is not None and corr is not None
    assert comp == pytest.approx(1.0, abs=1e-12)   # disjoint after subtraction
    assert corr == pytest.approx(-1.0, abs=1e-12)  # and exactly anti-correlated


def test_pair_fails_the_two_values_independently():
    """A channel entirely at background has no density, but the pair still has
    a defined correlation — so one may be None while the other is not."""
    n = 10
    a = np.linspace(1.0, 10.0, n)
    flat = np.full(n, 7.0)
    comp, corr = competition_pair(a, flat, background_a=0.0, background_b=7.0)
    assert comp is None      # nothing survives b's background
    assert corr is None      # ...and a flat profile has no correlation either

    comp2, corr2 = competition_pair(a, np.linspace(10.0, 1.0, n), 0.0, 0.0)
    assert comp2 is not None and corr2 == pytest.approx(-1.0)


def test_min_profile_samples_is_enforced_at_the_pair_level():
    short = np.array([1.0, 2.0])
    assert len(short) < MIN_PROFILE_SAMPLES
    comp, corr = competition_pair(short, short)
    assert comp is None and corr is None
