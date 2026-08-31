"""Regression tests against the five annotated reference z-stacks.

Two halves, and the distinction matters:

* ``TestGoldenFrame`` pins ``focus_score`` itself against a deterministic
  synthetic frame. This is what guards the *descriptor* -- change ``BG_SIZE``,
  ``K_SIGMA``, ``GRAD_SIGMA`` or the noise estimator and these fail.
* ``TestReferenceStacks`` runs on the cached per-plane scores in ``reference/``,
  so it is fast and needs no ND2 files. It guards the *threshold-fitting and
  labelling* code over frozen inputs -- it cannot detect a descriptor change,
  which is precisely why the golden-frame tests above exist.
"""
import json
from pathlib import Path

import numpy as np
import pytest
from scipy import ndimage as ndi

from focus_qc.calibration import evaluate, pick_threshold
from focus_qc.metrics import focus_score
from focus_qc.zstack import IN_FOCUS, OUT_OF_FOCUS, label_planes

REFERENCE = Path(__file__).resolve().parents[1] / "reference"
CACHE = REFERENCE / "scores_cache.json"
SPEC = REFERENCE / "zstacks_oof_spec.json"

TOLERANCE_UM = 0.3
GUARD_UM = 0.1

#: Measured separation margin (p5 in-focus / p95 out-of-focus) on the reference
#: stacks: IRM 1.97x, TIRF 488 5.01x. IRM is the binding constraint, so the floor
#: sits just below it -- see reference/compare_alternatives.py, which also shows
#: variance-of-Laplacian scoring below 1.0x on both channels.
MARGIN_FLOOR = 1.8


def _golden_frame(sigma_blur):
    """A deterministic field of dark lines on a bright field, optionally defocused."""
    r = np.random.default_rng(20260830)
    img = np.zeros((512, 512), np.float32)
    for _ in range(30):
        y0, x0 = r.integers(30, 482, 2)
        angle = r.uniform(0, np.pi)
        t = np.arange(-70, 70)
        img[np.clip((y0 + t * np.sin(angle)).astype(int), 0, 511),
            np.clip((x0 + t * np.cos(angle)).astype(int), 0, 511)] = 1.0
    if sigma_blur:
        img = ndi.gaussian_filter(img, sigma_blur)
    f = 16000.0 - 700.0 * img
    return np.round(f + np.random.default_rng(1).normal(0, 30.0, f.shape))


class TestGoldenFrame:
    """Pin the descriptor itself, so a constant change cannot pass unnoticed."""

    def test_reproduces_the_recorded_score_for_a_sharp_frame(self):
        assert focus_score(_golden_frame(0.0), "irm").score == pytest.approx(147.743, rel=1e-4)

    def test_reproduces_the_recorded_score_for_a_defocused_frame(self):
        assert focus_score(_golden_frame(3.0), "irm").score == pytest.approx(5.684, rel=1e-3)

    def test_reproduces_the_recorded_sharpness(self):
        assert focus_score(_golden_frame(0.0), "irm").sharpness == pytest.approx(8.8715, rel=1e-4)

    def test_reproduces_the_recorded_noise_estimate(self):
        assert focus_score(_golden_frame(0.0), "irm").noise_sigma == pytest.approx(29.971, rel=1e-4)

    def test_the_sharp_frame_outscores_the_defocused_one_by_more_than_twentyfold(self):
        sharp = focus_score(_golden_frame(0.0), "irm").score
        blurred = focus_score(_golden_frame(3.0), "irm").score
        assert sharp / blurred > 20


pytestmark_stacks = pytest.mark.skipif(
    not (CACHE.exists() and SPEC.exists()), reason=f"reference artefacts missing from {REFERENCE}"
)


@pytest.fixture(scope="module")
def reference():
    spec = json.loads(SPEC.read_text())
    scores = json.loads(CACHE.read_text())["scores"]
    return spec, scores


def _channel_scores(scores, path, channel):
    return np.array([s["score"] for s in scores[path][channel]])


def _labels(spec, stack, n):
    return label_planes(n, stack["sharp_plane"], spec["z_step_um"], TOLERANCE_UM, GUARD_UM)


def _fold_thresholds(spec, scores, held, channel):
    good, bad = [], []
    for stack in spec["stacks"]:
        if stack["path"] == held["path"]:
            continue
        s = _channel_scores(scores, stack["path"], channel)
        labels = _labels(spec, stack, len(s))
        good.append(s[labels == IN_FOCUS])
        bad.append(s[labels == OUT_OF_FOCUS])
    return pick_threshold(np.concatenate(good), np.concatenate(bad))


@pytestmark_stacks
class TestReferenceStacks:
    def test_the_annotated_plane_is_within_two_planes_of_the_score_peak(self, reference):
        """Both channels must agree with the microscopist's eye to about one z-step."""
        spec, scores = reference
        for stack in spec["stacks"]:
            for channel in ("IRM", "TIRF 488"):
                s = _channel_scores(scores, stack["path"], channel)
                offset = abs(int(np.argmax(s)) + 1 - stack["sharp_plane"])
                assert offset <= 2, f"{stack['path']} {channel}: peak is {offset} planes off"

    def test_both_channels_place_focus_within_one_plane_of_each_other(self, reference):
        """IRM and fluorescence share a focal plane here; the OR rule relies on it."""
        spec, scores = reference
        for stack in spec["stacks"]:
            peaks = [int(np.argmax(_channel_scores(scores, stack["path"], c)))
                     for c in ("IRM", "TIRF 488")]
            assert abs(peaks[0] - peaks[1]) <= 1

    @pytest.mark.parametrize("channel,expected_mean,expected_worst",
                             [("IRM", 0.953, 0.913), ("TIRF 488", 0.967, 0.929)])
    def test_reproduces_the_published_per_channel_accuracy(
        self, reference, channel, expected_mean, expected_worst
    ):
        """Pinned to the published values, not a loose floor, so README cannot drift."""
        spec, scores = reference
        accuracies = []
        for held in spec["stacks"]:
            threshold = _fold_thresholds(spec, scores, held, channel)
            s = _channel_scores(scores, held["path"], channel)
            accuracies.append(
                evaluate(s, _labels(spec, held, len(s)), threshold)["balanced_accuracy"]
            )
        assert np.mean(accuracies) == pytest.approx(expected_mean, abs=0.001)
        assert np.min(accuracies) == pytest.approx(expected_worst, abs=0.001)

    def test_reproduces_the_published_or_rule_accuracy(self, reference):
        spec, scores = reference
        per_fold = []
        for held in spec["stacks"]:
            n = len(_channel_scores(scores, held["path"], "IRM"))
            keep = np.ones(n, bool)
            for channel in ("IRM", "TIRF 488"):
                keep &= (_channel_scores(scores, held["path"], channel)
                         >= _fold_thresholds(spec, scores, held, channel))
            per_fold.append(
                evaluate(keep.astype(float), _labels(spec, held, n), 0.5)["balanced_accuracy"]
            )
        assert np.mean(per_fold) == pytest.approx(0.959, abs=0.001)
        assert np.min(per_fold) == pytest.approx(0.929, abs=0.001)

    def test_the_fold_thresholds_genuinely_differ(self, reference):
        """Guards against a refactor that silently fits on all five stacks."""
        spec, scores = reference
        thresholds = [_fold_thresholds(spec, scores, held, "IRM") for held in spec["stacks"]]
        assert len(set(np.round(thresholds, 6))) == len(thresholds)

    def test_in_focus_and_out_of_focus_scores_stay_separated(self, reference):
        """Below this the threshold has no room left for exposure drift."""
        spec, scores = reference
        for channel in ("IRM", "TIRF 488"):
            good, bad = [], []
            for stack in spec["stacks"]:
                s = _channel_scores(scores, stack["path"], channel)
                labels = _labels(spec, stack, len(s))
                good.append(s[labels == IN_FOCUS])
                bad.append(s[labels == OUT_OF_FOCUS])
            margin = np.percentile(np.concatenate(good), 5) / max(
                np.percentile(np.concatenate(bad), 95), 1e-6)
            assert margin > MARGIN_FLOOR, f"{channel}: separation margin only {margin:.2f}x"
