"""Tests for threshold selection and the calibration record."""
import json

import numpy as np
import pytest

from focus_qc.calibration import Calibration, DomainRange, OverlappingDistributions, pick_threshold


class TestPickThreshold:
    def test_lies_strictly_between_the_two_distributions(self):
        in_focus = np.array([40.0, 55.0, 62.0, 70.0, 88.0])
        out_of_focus = np.array([0.0, 0.2, 1.1, 3.0, 6.0])
        t = pick_threshold(in_focus, out_of_focus)
        assert out_of_focus.max() < t < in_focus.min()

    def test_is_the_geometric_midpoint_of_the_two_tails(self):
        """Log-midpoint keeps equal relative headroom on both sides."""
        in_focus = np.full(100, 100.0)
        out_of_focus = np.full(100, 4.0)
        assert pick_threshold(in_focus, out_of_focus) == pytest.approx(20.0, rel=1e-6)

    def test_ignores_outliers_beyond_the_tail_percentiles(self):
        """A single wild out-of-focus frame must not drag the threshold up."""
        in_focus = np.full(100, 100.0)
        out_of_focus = np.full(100, 4.0)
        contaminated = np.append(out_of_focus, [90.0, 95.0])
        assert pick_threshold(in_focus, contaminated) == pytest.approx(
            pick_threshold(in_focus, out_of_focus), rel=0.05
        )

    def test_refuses_to_invent_a_threshold_when_the_classes_overlap(self):
        """Silently returning a number here would hide an unusable descriptor."""
        overlapping = np.array([5.0, 6.0, 7.0, 8.0, 9.0])
        with pytest.raises(OverlappingDistributions):
            pick_threshold(overlapping, overlapping)

    def test_handles_an_out_of_focus_class_that_is_exactly_zero(self):
        """The fluorescence channel really does hit zero when defocused."""
        t = pick_threshold(np.full(50, 5.0), np.zeros(50))
        assert 0.0 < t < 5.0


class TestCalibration:
    def _cal(self):
        return Calibration(
            thresholds={"irm": 13.5, "fluor": 0.9},
            domain={
                "irm": DomainRange(noise_sigma=(20.0, 30.0), background=(16000.0, 17000.0)),
                "fluor": DomainRange(noise_sigma=(5.0, 7.0), background=(105.0, 115.0)),
            },
            tolerance_um=0.3,
            notes="test",
        )

    def test_survives_a_json_round_trip(self):
        original = self._cal()
        restored = Calibration.from_dict(json.loads(json.dumps(original.to_dict())))
        assert restored == original

    def test_accepts_a_frame_inside_the_calibrated_domain(self):
        assert self._cal().in_domain("irm", noise_sigma=25.0, background=16500.0)

    def test_rejects_a_frame_whose_noise_is_far_outside_the_calibrated_range(self):
        """Doubled noise means a different acquisition; the threshold no longer applies."""
        assert not self._cal().in_domain("irm", noise_sigma=200.0, background=16500.0)

    def test_allows_moderate_drift_within_the_tolerance_factor(self):
        """A 1.5x change is normal session-to-session drift, not a new regime."""
        assert self._cal().in_domain("irm", noise_sigma=40.0, background=16500.0)


class TestEvaluate:
    """Scoring a threshold against labelled planes."""

    def test_reports_perfect_scores_for_a_threshold_that_separates_cleanly(self):
        from focus_qc.calibration import evaluate

        scores = np.array([50.0, 60.0, 1.0, 0.5])
        labels = np.array([1, 1, 0, 0])
        r = evaluate(scores, labels, threshold=10.0)
        assert r["sensitivity"] == pytest.approx(1.0)
        assert r["specificity"] == pytest.approx(1.0)
        assert r["balanced_accuracy"] == pytest.approx(1.0)

    def test_counts_an_in_focus_frame_below_the_threshold_as_a_miss(self):
        from focus_qc.calibration import evaluate

        r = evaluate(np.array([50.0, 2.0, 1.0]), np.array([1, 1, 0]), threshold=10.0)
        assert r["sensitivity"] == pytest.approx(0.5)

    def test_counts_an_out_of_focus_frame_above_the_threshold_as_a_false_pass(self):
        from focus_qc.calibration import evaluate

        r = evaluate(np.array([50.0, 2.0, 60.0]), np.array([0, 0, 1]), threshold=10.0)
        assert r["specificity"] == pytest.approx(0.5)

    def test_ignores_planes_in_the_excluded_guard_band(self):
        from focus_qc.calibration import evaluate

        scores = np.array([50.0, 0.5, 0.4])
        clean = evaluate(scores[:2], np.array([1, 0]), threshold=10.0)
        with_guard = evaluate(scores, np.array([1, 0, -1]), threshold=10.0)
        assert with_guard == clean


class TestEvaluateRefusesUndefinedMetrics:
    """A metric with an empty class is a fit failure, not a value.

    Returning NaN let it flow into the report table, into np.mean of the folds,
    and into calibration.json as the bare token NaN -- which is not valid JSON.
    """

    def test_refuses_when_no_plane_is_labelled_in_focus(self):
        from focus_qc.calibration import EmptyClass, evaluate

        with pytest.raises(EmptyClass, match="in focus"):
            evaluate(np.array([1.0, 2.0]), np.array([0, 0]), threshold=1.5)

    def test_refuses_when_no_plane_is_labelled_out_of_focus(self):
        from focus_qc.calibration import EmptyClass, evaluate

        with pytest.raises(EmptyClass, match="out of focus"):
            evaluate(np.array([1.0, 2.0]), np.array([1, 1]), threshold=1.5)

    def test_never_returns_a_non_finite_metric(self):
        from focus_qc.calibration import evaluate

        r = evaluate(np.array([50.0, 1.0]), np.array([1, 0]), threshold=10.0)
        assert all(np.isfinite(v) for v in r.values())


class TestPickThresholdRefusesEmptyInput:
    def test_refuses_an_empty_in_focus_class(self):
        from focus_qc.calibration import EmptyClass, pick_threshold

        with pytest.raises(EmptyClass):
            pick_threshold(np.array([]), np.array([1.0, 2.0]))

    def test_refuses_an_empty_out_of_focus_class(self):
        from focus_qc.calibration import EmptyClass, pick_threshold

        with pytest.raises(EmptyClass):
            pick_threshold(np.array([1.0, 2.0]), np.array([]))


class TestDomainRangeValidation:
    def test_rejects_an_inverted_range(self):
        """(hi, lo) silently becomes a shifted, narrower band instead of failing."""
        with pytest.raises(ValueError, match="lo <= hi"):
            DomainRange(noise_sigma=(30.0, 20.0), background=(1.0, 2.0))

    def test_rejects_a_non_positive_lower_bound(self):
        """A multiplicative band is only meaningful for positive quantities."""
        with pytest.raises(ValueError):
            DomainRange(noise_sigma=(0.0, 10.0), background=(1.0, 2.0))

    def test_rejects_a_range_that_is_not_a_pair(self):
        with pytest.raises(ValueError):
            DomainRange(noise_sigma=(1.0, 2.0, 3.0), background=(1.0, 2.0))

    def test_accepts_a_degenerate_but_valid_range(self):
        """The reference fluorescence channel really does report one sigma value."""
        assert DomainRange(noise_sigma=(6.29, 6.29), background=(110.0, 111.0))


class TestCalibrationValidation:
    def test_rejects_a_modality_with_a_threshold_but_no_domain(self):
        with pytest.raises(ValueError, match="fluor"):
            Calibration(
                thresholds={"irm": 1.0, "fluor": 2.0},
                domain={"irm": DomainRange((1.0, 2.0), (1.0, 2.0))},
                tolerance_um=0.3,
            )

    def test_does_not_alias_its_metrics_dict_out_through_to_dict(self):
        cal = Calibration(
            thresholds={"irm": 1.0},
            domain={"irm": DomainRange((1.0, 2.0), (1.0, 2.0))},
            tolerance_um=0.3,
            metrics={"a": 1},
        )
        cal.to_dict()["metrics"]["a"] = 999
        assert cal.metrics["a"] == 1
