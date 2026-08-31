"""Tests for the per-frame verdict: per-channel thresholds combined by OR."""
import numpy as np
import pytest

from focus_qc.calibration import Calibration, DomainRange
from focus_qc.detect import ChannelSpec, judge_frame, score_frame
from focus_qc.metrics import FrameStats

SPECS = (ChannelSpec(name="IRM", modality="irm"), ChannelSpec(name="TIRF 488", modality="fluor"))


def _cal():
    return Calibration(
        thresholds={"irm": 10.0, "fluor": 1.0},
        domain={
            "irm": DomainRange(noise_sigma=(20.0, 30.0), background=(16000.0, 17000.0)),
            "fluor": DomainRange(noise_sigma=(5.0, 7.0), background=(105.0, 115.0)),
        },
        tolerance_um=0.3,
    )


def _stats(irm_score, fluor_score, irm_noise=25.0, fluor_noise=6.0):
    return {
        "IRM": FrameStats(irm_score, 2.0, irm_noise, 16500.0),
        "TIRF 488": FrameStats(fluor_score, 2.0, fluor_noise, 110.0),
    }


class TestOrRule:
    def test_keeps_a_frame_with_both_channels_in_focus(self):
        v = judge_frame(_stats(50.0, 5.0), SPECS, _cal())
        assert not v.flagged
        assert v.channel_flags == {"IRM": False, "TIRF 488": False}

    def test_flags_a_frame_when_only_the_irm_channel_is_out_of_focus(self):
        v = judge_frame(_stats(2.0, 5.0), SPECS, _cal())
        assert v.flagged
        assert v.channel_flags == {"IRM": True, "TIRF 488": False}

    def test_flags_a_frame_when_only_the_fluorescence_channel_is_out_of_focus(self):
        v = judge_frame(_stats(50.0, 0.1), SPECS, _cal())
        assert v.flagged
        assert v.channel_flags == {"IRM": False, "TIRF 488": True}

    def test_flags_a_frame_with_both_channels_out_of_focus(self):
        assert judge_frame(_stats(2.0, 0.1), SPECS, _cal()).flagged

    def test_treats_a_score_exactly_at_the_threshold_as_in_focus(self):
        assert not judge_frame(_stats(10.0, 1.0), SPECS, _cal()).flagged


class TestDomainGuard:
    def test_reports_no_warning_for_a_frame_inside_the_calibrated_domain(self):
        assert judge_frame(_stats(50.0, 5.0), SPECS, _cal()).out_of_calibration == []

    def test_names_the_channel_whose_acquisition_drifted_too_far(self):
        v = judge_frame(_stats(50.0, 5.0, irm_noise=300.0), SPECS, _cal())
        assert v.out_of_calibration == ["IRM"]

    def test_does_not_change_the_verdict_when_out_of_calibration(self):
        """The guard is advisory; the OR rule the user asked for still decides."""
        v = judge_frame(_stats(50.0, 5.0, irm_noise=300.0), SPECS, _cal())
        assert not v.flagged


class TestScoreFrame:
    def test_scores_every_declared_channel_of_a_multichannel_frame(self):
        rng = np.random.default_rng(0)
        frame = {"IRM": rng.normal(16000, 25, (128, 128)), "TIRF 488": rng.normal(110, 6, (128, 128))}
        stats = score_frame(frame, SPECS)
        assert set(stats) == {"IRM", "TIRF 488"}
        assert all(s.noise_sigma > 0 for s in stats.values())

    def test_rejects_a_frame_that_is_missing_a_declared_channel(self):
        with pytest.raises(KeyError):
            score_frame({"IRM": np.zeros((64, 64))}, SPECS)


class TestChannelSpecValidation:
    def test_rejects_an_unknown_modality_at_construction(self):
        """A typo in the JSON spec must not survive to detect time."""
        with pytest.raises(ValueError, match="flour"):
            ChannelSpec(name="TIRF 488", modality="flour")

    def test_names_the_valid_modalities(self):
        with pytest.raises(ValueError, match="irm"):
            ChannelSpec(name="x", modality="fluorescence")


class TestUnscoreableFrames:
    """A frame that cannot be scored must be flagged, never quietly kept."""

    def test_scores_a_degenerate_frame_as_unscoreable_rather_than_raising(self):
        constant = np.full((128, 128), 111.0)
        stats = score_frame({"IRM": constant, "TIRF 488": constant}, SPECS)
        assert all(np.isnan(s.score) for s in stats.values())

    def test_flags_a_frame_whose_score_could_not_be_measured(self):
        stats = _stats(float("nan"), 5.0)
        verdict = judge_frame(stats, SPECS, _cal())
        assert verdict.flagged
        assert verdict.channel_flags["IRM"]

    def test_names_the_channel_that_could_not_be_scored(self):
        constant = np.full((128, 128), 111.0)
        good = np.random.default_rng(0).normal(16500, 25, (128, 128))
        stats = score_frame({"IRM": good, "TIRF 488": constant}, SPECS)
        verdict = judge_frame(stats, SPECS, _cal())
        assert verdict.unscoreable == ["TIRF 488"]

    def test_a_scoreable_frame_lists_nothing_as_unscoreable(self):
        assert judge_frame(_stats(50.0, 5.0), SPECS, _cal()).unscoreable == []


class TestMissingModality:
    def test_explains_which_modality_the_calibration_lacks(self):
        irm_only = Calibration(
            thresholds={"irm": 10.0},
            domain={"irm": DomainRange(noise_sigma=(20.0, 30.0), background=(16000.0, 17000.0))},
            tolerance_um=0.3,
        )
        with pytest.raises(KeyError, match="fluor"):
            judge_frame(_stats(50.0, 5.0), SPECS, irm_only)

    def test_names_the_channel_and_what_the_calibration_does_cover(self):
        irm_only = Calibration(
            thresholds={"irm": 10.0},
            domain={"irm": DomainRange(noise_sigma=(20.0, 30.0), background=(16000.0, 17000.0))},
            tolerance_um=0.3,
        )
        with pytest.raises(KeyError, match="TIRF 488"):
            judge_frame(_stats(50.0, 5.0), SPECS, irm_only)


class TestVerdictCannotContradictItself:
    def test_the_or_rule_is_derived_rather_than_stored(self):
        """flagged must not be settable independently of the per-channel flags."""
        from focus_qc.detect import FrameVerdict

        verdict = FrameVerdict(
            channel_flags={"IRM": True, "TIRF 488": False},
            out_of_calibration=[],
            unscoreable=[],
            stats={},
        )
        assert verdict.flagged
