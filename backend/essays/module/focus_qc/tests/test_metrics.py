"""Tests for the per-frame focus descriptors."""
import numpy as np
import pytest
from scipy import ndimage as ndi

from focus_qc.metrics import noise_sigma, structure_area, focus_score


def _rng():
    return np.random.default_rng(1234)


def _lines_image(sigma_blur, polarity=-1, level=16000.0, amp=600.0, noise=25.0, size=512):
    """Synthetic field of thin lines, optionally blurred, plus Gaussian noise."""
    img = np.zeros((size, size), np.float32)
    r = np.random.default_rng(7)
    for _ in range(25):
        y0, x0 = r.integers(20, size - 20, 2)
        ang = r.uniform(0, np.pi)
        t = np.arange(-60, 60)
        ys = np.clip((y0 + t * np.sin(ang)).astype(int), 0, size - 1)
        xs = np.clip((x0 + t * np.cos(ang)).astype(int), 0, size - 1)
        img[ys, xs] = 1.0
    if sigma_blur > 0:
        # Defocus conserves photons and lowers the peak; gaussian_filter does exactly that.
        img = ndi.gaussian_filter(img, sigma_blur)
    out = level + polarity * amp * img
    return out + _rng().normal(0, noise, out.shape).astype(np.float32)


class TestNoiseSigma:
    def test_recovers_known_gaussian_noise_on_flat_field(self):
        img = 1000.0 + _rng().normal(0, 8.0, (400, 400))
        assert noise_sigma(img) == pytest.approx(8.0, rel=0.05)

    def test_is_not_inflated_by_image_structure(self):
        """Structure must not leak into the noise estimate, or every threshold shifts."""
        flat = 1000.0 + _rng().normal(0, 8.0, (400, 400))
        structured = _lines_image(sigma_blur=0, noise=8.0, level=1000.0, size=400)
        assert noise_sigma(structured) == pytest.approx(noise_sigma(flat), rel=0.15)


class TestStructureArea:
    def test_is_larger_for_sharp_than_for_blurred_structures(self):
        sharp = structure_area(_lines_image(0.0), polarity=-1)
        blurred = structure_area(_lines_image(3.0), polarity=-1)
        assert sharp > 2 * blurred

    def test_reports_zero_for_the_absent_polarity(self):
        """Bright puncta must not register as dark structures."""
        bright = _lines_image(0.0, polarity=+1)
        assert structure_area(bright, polarity=+1) > 10
        assert structure_area(bright, polarity=-1) < 1

    def test_ignores_a_smooth_illumination_gradient(self):
        """A large-scale shading pattern is not structure; local background removes it."""
        flat = 1000.0 + _rng().normal(0, 8.0, (400, 400))
        yy, xx = np.mgrid[0:400, 0:400]
        shaded = flat + 300.0 * np.exp(-((yy - 200) ** 2 + (xx - 200) ** 2) / (2 * 90.0 ** 2))
        assert structure_area(shaded, polarity=+1) < 1


class TestFocusScore:
    def test_is_invariant_to_camera_gain(self):
        """Doubling gain scales signal and noise alike; the score must not move."""
        base = _lines_image(0.0)
        gained = base * 2.0
        a = focus_score(base, modality="irm").score
        b = focus_score(gained, modality="irm").score
        assert b == pytest.approx(a, rel=0.10)

    def test_is_invariant_to_a_constant_offset(self):
        base = _lines_image(0.0)
        a = focus_score(base, modality="irm").score
        b = focus_score(base + 5000.0, modality="irm").score
        assert b == pytest.approx(a, rel=0.02)

    def test_selects_polarity_from_the_modality(self):
        dark = _lines_image(0.0, polarity=-1)
        assert focus_score(dark, modality="irm").score > 10
        assert focus_score(dark, modality="fluor").score < 1

    def test_reports_the_stats_needed_for_a_domain_check(self):
        s = focus_score(_lines_image(0.0), modality="irm")
        assert s.noise_sigma > 0
        assert s.background == pytest.approx(16000.0, rel=0.05)


class TestDegenerateFrames:
    """A frame whose noise cannot be measured must never read as 'in focus'.

    Dividing the residual by a near-zero sigma multiplies it by ~1e9, so every
    pixel clears the 5-sigma cut and the score explodes. That is the one failure
    mode this module exists to prevent: a blank or saturated frame silently
    admitted to a quantitative analysis.
    """

    def test_refuses_a_frame_whose_noise_estimate_is_zero(self):
        from focus_qc.metrics import UnscoreableFrame

        quantised = np.round(_rng().normal(100, 0.2, (256, 256)))   # sub-ADU read noise
        assert noise_sigma(quantised) == 0.0
        with pytest.raises(UnscoreableFrame):
            focus_score(quantised, modality="fluor")

    def test_refuses_a_saturated_frame(self):
        from focus_qc.metrics import UnscoreableFrame

        saturated = np.full((256, 256), 65535.0)
        saturated[100:150, 100:150] = 60000.0
        with pytest.raises(UnscoreableFrame):
            focus_score(saturated, modality="irm")

    def test_refuses_a_constant_frame(self):
        from focus_qc.metrics import UnscoreableFrame

        with pytest.raises(UnscoreableFrame):
            focus_score(np.full((128, 128), 111.0), modality="fluor")

    def test_refuses_a_frame_containing_nan(self):
        from focus_qc.metrics import UnscoreableFrame

        img = _lines_image(0.0)
        img[10, 10] = np.nan
        with pytest.raises(UnscoreableFrame):
            focus_score(img, modality="irm")

    def test_the_refusal_explains_what_went_wrong(self):
        from focus_qc.metrics import UnscoreableFrame

        with pytest.raises(UnscoreableFrame, match="noise"):
            focus_score(np.full((128, 128), 111.0), modality="fluor")

    def test_structure_area_refuses_the_same_frames(self):
        from focus_qc.metrics import UnscoreableFrame

        with pytest.raises(UnscoreableFrame):
            structure_area(np.full((128, 128), 111.0), polarity=+1)


class TestSharpnessSentinel:
    def test_reports_not_a_number_when_there_is_no_structure_to_measure(self):
        """'Declined to measure' must be distinguishable from 'measured zero'."""
        noise_only = 1000.0 + _rng().normal(0, 8.0, (256, 256))
        assert np.isnan(focus_score(noise_only, modality="irm").sharpness)

    def test_reports_a_real_number_when_structure_is_present(self):
        assert focus_score(_lines_image(0.0), modality="irm").sharpness > 0


class TestFocusScoreMatchesTheStandaloneDescriptors:
    """focus_score must not carry its own copy of the formulas -- copies drift."""

    def test_score_equals_structure_area(self):
        from focus_qc.metrics import structure_area

        img = _lines_image(0.0)
        assert focus_score(img, "irm").score == structure_area(img, polarity=-1)

    def test_sharpness_equals_structure_sharpness(self):
        from focus_qc.metrics import structure_sharpness

        img = _lines_image(0.0)
        assert focus_score(img, "irm").sharpness == structure_sharpness(img)


class TestNoiseEstimatorIsContinuous:
    """An integer-valued MAD quantises the noise estimate to ~1 ADU steps.

    That matters because the score counts a 5-sigma tail: on the reference
    fluorescence channel a single ADU step in sigma swings the score about
    sixfold, which is larger than the in-focus margin at the tolerance edge.
    The estimator must therefore respond smoothly to a sub-ADU change.
    """

    def _integer_frame(self, sigma, seed=3):
        r = np.random.default_rng(seed)
        return np.round(r.normal(111.0, sigma, (512, 512)))

    def test_distinguishes_noise_levels_less_than_one_adu_apart(self):
        low = noise_sigma(self._integer_frame(6.0))
        high = noise_sigma(self._integer_frame(6.5))
        assert high > low, f"quantised: both estimates collapsed to {low}"

    def test_tracks_the_true_noise_level_on_integer_data(self):
        for true_sigma in (4.0, 6.0, 6.5, 9.0):
            assert noise_sigma(self._integer_frame(true_sigma)) == pytest.approx(
                true_sigma, rel=0.06
            )

    def test_stays_robust_to_structure_on_integer_data(self):
        r = np.random.default_rng(5)
        frame = np.round(r.normal(111.0, 6.0, (512, 512)))
        frame[:, 100:104] += 400          # bright bands: strong edges, few pixels
        frame[200:204, :] += 400
        assert noise_sigma(frame) == pytest.approx(6.0, rel=0.10)


class TestOptimisedFormsAreBitIdentical:
    """The 2026-08-31 rewrite of this module changed speed, never a number.

    The deployment README claimed "a few milliseconds per frame"; measured
    inside the essays image on real wells it was 91 ms per channel at 1400x1400
    and 213 ms at 2048x2048, so the descriptor was rewritten to do less work.
    Every substitution is meant to be exactly equal, not approximately equal --
    the IRM in-focus/out-of-focus separation margin is only 1.97x and
    ``test_in_focus_and_out_of_focus_scores_stay_separated`` fails below 1.8x,
    so there is no headroom to spend on "close enough".

    The reference expressions below are the code as it stood BEFORE the rewrite,
    written out in full rather than described, and compared bit for bit
    (``float.hex()``) rather than with ``approx``. The golden-frame tests in
    ``test_regression_zstacks.py`` pin four specific numbers; this pins the whole
    descriptor over frames those four do not reach -- odd extents, integer input,
    an absent tail, and no structure at all.
    """

    @staticmethod
    def _ref_noise_sigma(img):
        from focus_qc.metrics import NOISE_CLIP_SIGMAS

        d = np.diff(np.asarray(img, np.float64), axis=1).ravel()
        if d.size == 0 or not np.all(np.isfinite(d)):
            return float("nan")
        centre = np.median(d)
        coarse = 1.4826 * np.median(np.abs(d - centre))
        if coarse <= 0:
            return 0.0
        noise_only = d[np.abs(d - centre) < NOISE_CLIP_SIGMAS * coarse]
        if noise_only.size < 2:
            return 0.0
        return float(noise_only.std() / np.sqrt(2))

    @classmethod
    def _ref_residual(cls, img):
        from focus_qc.metrics import BG_SIZE

        f = np.asarray(img, np.float32)
        sigma = cls._ref_noise_sigma(f)
        return (f - ndi.uniform_filter(f, BG_SIZE)) / sigma, sigma, float(np.median(f))

    @classmethod
    def _ref_focus_score(cls, img, modality):
        from focus_qc.metrics import (GRAD_SIGMA, K_SIGMA, MIN_STRUCTURE_PX,
                                      POLARITY)

        rn, sigma, level = cls._ref_residual(img)
        score = float((POLARITY[modality] * rn > K_SIGMA).mean() * 1e4)
        mask = np.abs(rn) > GRAD_SIGMA
        if mask.sum() < MIN_STRUCTURE_PX:
            sharpness = float("nan")
        else:
            gy, gx = np.gradient(rn)
            sharpness = float(np.hypot(gx, gy)[mask].mean())
        return score, sharpness, sigma, level

    @staticmethod
    def _identical(a, b):
        return (np.isnan(a) and np.isnan(b)) or a.hex() == b.hex()

    FRAMES = {
        "sharp lines": lambda: _lines_image(0.0),
        "blurred lines": lambda: _lines_image(3.0),
        "bright puncta": lambda: _lines_image(0.0, polarity=+1),
        # An odd pixel count takes the single-order-statistic branch of the
        # median; an even one averages the two central ones. Both must match.
        "odd extent": lambda: _lines_image(0.0, size=401),
        # Real cameras deliver integers, and the noise estimator's entire design
        # note is about what integer data does to a MAD.
        "integer frame": lambda: np.round(_lines_image(0.0)).astype(np.uint16),
        # No structure at all: sharpness must stay NaN rather than become 0.
        "noise only": lambda: 1000.0 + _rng().normal(0, 8.0, (256, 256)),
    }

    @pytest.mark.parametrize("name", sorted(FRAMES))
    @pytest.mark.parametrize("modality", ["irm", "fluor"])
    def test_focus_score_matches_the_pre_optimisation_expression(self, name, modality):
        img = self.FRAMES[name]()
        want = self._ref_focus_score(img, modality)
        got = focus_score(img, modality)

        for field, expected in zip(("score", "sharpness", "noise_sigma",
                                    "background"), want):
            assert self._identical(getattr(got, field), expected), (
                f"{name}/{modality}: {field} moved "
                f"{expected!r} -> {getattr(got, field)!r}")

    def test_structure_area_matches_the_pre_optimisation_expression(self):
        """The standalone descriptor took the same shortcut and must still agree."""
        for name in sorted(self.FRAMES):
            img = self.FRAMES[name]()
            rn, _, _ = self._ref_residual(img)
            for polarity in (-1, +1):
                want = float((polarity * rn > 5.0).mean() * 1e4)
                assert self._identical(structure_area(img, polarity), want), name

    def test_a_polarity_the_one_sided_form_cannot_express_is_refused(self):
        """``count_nonzero(rn < -k)`` equals ``polarity * rn > k`` only for a
        unit polarity, and POLARITY holds nothing else. Refuse rather than
        silently disagree with the expression that was replaced."""
        with pytest.raises(ValueError, match="polarity"):
            structure_area(_lines_image(0.0), polarity=2)
