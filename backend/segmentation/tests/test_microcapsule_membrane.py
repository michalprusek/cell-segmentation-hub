"""Integration tests for the vendored microcapsule membrane stage.

WHAT THESE DO AND DO NOT COVER. The upstream archive calibrated two thresholds
on 42 labelled bright-field images and reports 42/42 in-sample and
leave-one-out. Those images are NOT in the archive — only the per-image feature
table is — so that accuracy cannot be re-verified here and these tests do not
claim to. What they pin is the part this repo actually owns: that the vendored
module runs unchanged, that `capsule_from_polygon` correctly drives it from a
stored polygon (rather than the archive's own capsule detector, which is not
vendored), and that a capsule with a genuine second boundary is separated from
one without.

The fixtures are synthetic on purpose. A real bright-field capsule would test
the calibration, which belongs upstream; a synthetic one tests the wiring,
which is what changed.
"""
import numpy as np
import pytest

from models.microcapsule_membrane import (
    capsule_from_polygon,
    membrane_polygon_for,
    prepare_gray,
    PolygonCapsule,
)


def _ring_polygon(cx, cy, r, n=180):
    """A closed circular outline in the stored `[{x, y}, ...]` shape."""
    a = np.linspace(0.0, 2 * np.pi, n, endpoint=False)
    return [
        {"x": float(cx + r * np.cos(t)), "y": float(cy + r * np.sin(t))}
        for t in a
    ]


def _capsule_image(size=560, cx=280.0, cy=280.0, r_out=200.0,
                   r_mem=140.0, core_level=90, shell_level=150,
                   membrane_edge_px=2.0, background=190):
    """A bright-field-like capsule: darker core inside a membrane, lighter
    shell outside it, all inside an outer wall.

    `membrane_edge_px` is the σ of the core→shell transition, which is the
    physical quantity `width` measures: small = intact membrane, large = a
    dissolved one spread into a diffuse ramp.
    """
    yy, xx = np.mgrid[0:size, 0:size]
    rr = np.hypot(xx - cx, yy - cy)
    img = np.full((size, size), float(background))
    # Shell: between the membrane and the outer wall.
    img[rr <= r_out] = float(shell_level)
    # Core: inside the membrane, with a controlled transition width. A smooth
    # step rather than a hard one, so `width` has something real to measure.
    t = 0.5 * (1.0 + np.tanh((rr - r_mem) / max(membrane_edge_px, 1e-6)))
    core_zone = rr <= r_out
    img[core_zone] = (
        core_level + (shell_level - core_level) * t[core_zone]
    )
    # The outer wall itself: a dark rim, which is what the U-Net would outline.
    wall = np.abs(rr - r_out) < 3.0
    img[wall] = 40.0
    return img.astype(np.uint8)


def _two_edged_capsule(size=800, cx=400.0, cy=400.0, r_out=360.0,
                       r_inner=200.0, r_outer=214.0, swing=8.0,
                       bias=2.0, core=90, shell=150, edge_px=1.5):
    """A capsule whose membrane presents TWO near-concentric faces.

    This is the configuration that broke the tracer, reproduced from the real
    thing: on production capsule `af2e49a3` the two faces sat 16 px apart with
    band-passed edge responses of 2.54 vs 2.45 at one angle and 1.98 vs 2.59
    twenty rays later, so a per-ray `argmax` moved the contour 16 px on a 0.01
    difference in evidence.

    `swing` modulates which face is locally stronger (six alternations around
    the circle); `bias` makes the inner face the stronger one OVERALL, so
    "which edge should win" has one defensible answer to assert against.
    """
    yy, xx = np.mgrid[0:size, 0:size]
    rr = np.hypot(xx - cx, yy - cy)
    th = np.arctan2(yy - cy, xx - cx)
    total = float(shell - core)
    m = swing * np.cos(6.0 * th)
    a_in = total / 2.0 + bias + m          # amplitude of the inner face
    a_out = total / 2.0 - bias - m         # amplitude of the outer face
    step_in = 0.5 * (1.0 + np.tanh((rr - r_inner) / edge_px))
    step_out = 0.5 * (1.0 + np.tanh((rr - r_outer) / edge_px))
    img = np.full((size, size), float(shell + 40))
    inside = rr <= r_out
    img[inside] = (core + a_in * step_in + a_out * step_out)[inside]
    img[np.abs(rr - r_out) < 3.0] = 40.0
    return img.astype(np.uint8)


def _traced_radii(membrane, cx, cy):
    """Traced contour as a radius per angle, in angular order."""
    P = np.array([[p["x"], p["y"]] for p in membrane], float)
    r = np.hypot(P[:, 0] - cx, P[:, 1] - cy)
    a = np.arctan2(P[:, 1] - cy, P[:, 0] - cx)
    return r[np.argsort(a)]


def _dented_capsule(dent_px=14.0, dent_sig=0.10, shade=0.0, size=800,
                    cx=400.0, cy=400.0, r_out=360.0, r_mem=200.0,
                    core=90.0, shell=150.0, edge=1.4):
    """A membrane with a local inward dent, optionally under illumination shading.

    The dent is the shape a smoothness-penalised path cuts across: 14 px deep
    over about 6 degrees. `shade` multiplies a linear gradient across the field,
    which is what makes a single GLOBAL intensity level unusable and forces the
    level to be estimated per ray.
    """
    yy, xx = np.mgrid[0:size, 0:size]
    rr = np.hypot(xx - cx, yy - cy)
    th = np.arctan2(yy - cy, xx - cx)
    off = np.abs(np.arctan2(np.sin(th - np.pi), np.cos(th - np.pi)))
    r_mem_theta = r_mem - dent_px * np.exp(-(off ** 2) / (2 * dent_sig ** 2))
    img = np.full((size, size), 190.0)
    inside = rr <= r_out
    img[inside] = (core + (shell - core)
                   * 0.5 * (1 + np.tanh((rr - r_mem_theta) / edge)))[inside]
    if shade:
        img = img * (1.0 + shade * (xx - cx) / size)
    img[np.abs(rr - r_out) < 3.0] = 40.0
    return np.clip(img, 0, 255).astype(np.uint8)


def _dent_error(membrane, dent_px=14.0, dent_sig=0.10, cx=400.0, cy=400.0,
                r_mem=200.0):
    """Radial error against the known boundary, at the bottom of the dent."""
    P = np.array([[p["x"], p["y"]] for p in membrane], float)
    ang = np.arctan2(P[:, 1] - cy, P[:, 0] - cx)
    r = np.hypot(P[:, 0] - cx, P[:, 1] - cy)
    off = np.abs(np.arctan2(np.sin(ang - np.pi), np.cos(ang - np.pi)))
    truth = r_mem - dent_px * np.exp(-(off ** 2) / (2 * dent_sig ** 2))
    err = np.abs(r - truth)
    return float(err[int(np.argmin(off))]), float(err.max())


def _staircase_capsule(d=4.0, w=0.6, tilt=1.5, size=800, cx=400.0, cy=400.0,
                       r_out=360.0, r_mem=200.0, core=90.0, shell=150.0):
    """A membrane whose transition is a STAIRCASE with a plateau ON the level.

    Two half-steps `2*d` apart with a flat stretch between them that sits at
    the half level, plus a slight angle-dependent tilt of that plateau. Both
    ends of the plateau are then a level crossing, and which one is nearest
    flips around the circle.

    This is the shape that separates a continuity-constrained level search from
    a per-ray "nearest crossing": on real capsules the profile inside the
    refinement window is often non-monotonic (bright-field interference), and
    nearest-crossing then alternates between two near-tied minima. Measured on
    the eleven production membranes, nearest-crossing gave a worst ray-to-ray
    jump of 7.96 px against 1.63 px for the DP, with the contours differing by
    up to 6 px -- but no smooth synthetic edge reproduces it, which is why this
    fixture builds the tie explicitly.
    """
    yy, xx = np.mgrid[0:size, 0:size]
    rr = np.hypot(xx - cx, yy - cy)
    th = np.arctan2(yy - cy, xx - cx)
    x = rr - r_mem
    f = 0.25 * (1 + np.tanh((x + d) / w)) + 0.25 * (1 + np.tanh((x - d) / w))
    ramp = tilt * np.cos(4 * th) * np.clip(x / d, -1, 1)
    img = np.full((size, size), float(shell + 40))
    inside = rr <= r_out
    img[inside] = (core + (shell - core) * f + ramp)[inside]
    img[np.abs(rr - r_out) < 3.0] = 40.0
    return np.clip(img, 0, 255).astype(np.uint8)


def _varying_skew_capsule(shade=0.0, size=800, cx=400.0, cy=400.0,
                          r_out=360.0, r_mem=200.0, core=90.0, shell=150.0):
    """A membrane whose transition ASYMMETRY varies around the circle.

    Crisp on one side, a long outward tail on the other. The gradient maximum
    is only at a fixed intensity for a SYMMETRIC edge, so pass 1 alone places
    the contour at a different height on the step at every angle; a level set
    does not. `shade` adds a linear illumination gradient, which is what makes
    a single GLOBAL level fail.

    This replaced a dent fixture that stopped discriminating once `TRACE_BAND`
    widened to 0.10R: pass 1 could then reach the dent unaided, and the tests
    that were meant to pin the level pass passed with it deleted.
    """
    yy, xx = np.mgrid[0:size, 0:size]
    rr = np.hypot(xx - cx, yy - cy)
    th = np.arctan2(yy - cy, xx - cx)
    tail = 1.5 + 7.0 * (1 + np.cos(th)) / 2.0
    x = rr - r_mem
    f = np.where(x < 0, 0.5 * np.exp(x / 1.2), 1 - 0.5 * np.exp(-x / tail))
    img = np.full((size, size), float(shell + 40))
    inside = rr <= r_out
    img[inside] = (core + (shell - core) * f)[inside]
    if shade:
        img = img * (1.0 + shade * (xx - cx) / size)
    img[np.abs(rr - r_out) < 3.0] = 40.0
    return np.clip(img, 0, 255).astype(np.uint8)


def _level_spread(gray, membrane, cx=400.0, cy=400.0):
    """5-95 spread of the contour's height on the LOCAL intensity step.

    Shading divides out, so 0 means "always at the same place on the edge"
    however the capsule is lit. This is the honest yardstick: the spread of
    ABSOLUTE intensity along a contour measures the illumination gradient, not
    whether the contour left the boundary.
    """
    from models.microcapsule_membrane import _sample

    P = np.array([[p["x"], p["y"]] for p in membrane], float)
    ang = np.arctan2(P[:, 1] - cy, P[:, 0] - cx)
    r = np.hypot(P[:, 0] - cx, P[:, 1] - cy)
    inner = _sample(gray, cx, cy, ang, r[:, None] + np.arange(-16, -6, 1.0)[None, :])
    outer = _sample(gray, cx, cy, ang, r[:, None] + np.arange(6, 16, 1.0)[None, :])
    with np.errstate(invalid="ignore"):
        lo = np.nanmedian(inner, axis=1)
        hi = np.nanmedian(outer, axis=1)
    at = _sample(gray, cx, cy, ang, r[:, None])[:, 0]
    t = (at - lo) / np.where(np.abs(hi - lo) < 1e-6, np.nan, hi - lo)
    t = t[np.isfinite(t)]
    return float(np.percentile(t, 95) - np.percentile(t, 5))


class TestCapsuleAdapter:
    def test_builds_a_capsule_from_a_stored_polygon(self):
        poly = _ring_polygon(100.0, 120.0, 50.0)
        cap = capsule_from_polygon(poly)
        assert isinstance(cap, PolygonCapsule)
        assert cap.cx == pytest.approx(100.0, abs=0.5)
        assert cap.cy == pytest.approx(120.0, abs=0.5)
        assert cap.mean_radius == pytest.approx(50.0, abs=0.5)
        # The contour is handed through as (N, 2) float — the shape the
        # membrane code indexes as `contour[:, 0]` / `contour[:, 1]`.
        assert cap.contour.shape == (180, 2)

    @pytest.mark.parametrize(
        "points",
        [None, [], [{"x": 0, "y": 0}], [{"x": 0, "y": 0}, {"x": 1, "y": 1}]],
    )
    def test_refuses_an_outline_that_cannot_define_a_ring(self, points):
        # Fewer than three vertices is not a capsule. Returning None makes the
        # caller skip it; measuring it would be measuring noise.
        assert capsule_from_polygon(points) is None

    def test_refuses_a_zero_radius_outline(self):
        degenerate = [{"x": 5.0, "y": 5.0}] * 4
        assert capsule_from_polygon(degenerate) is None


class TestMembraneDetection:
    def test_a_sharp_membrane_is_found_and_traced(self):
        img = _capsule_image(membrane_edge_px=1.5)
        poly = _ring_polygon(280.0, 280.0, 200.0)

        state, score, feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )

        assert state == "sharp", f"score={score} feats={feats}"
        assert score > 0
        assert membrane is not None and len(membrane) >= 3
        # The traced contour must sit on the membrane we drew, not on the outer
        # wall — the whole point is that it is a SECOND boundary.
        radii = [
            np.hypot(p["x"] - 280.0, p["y"] - 280.0) for p in membrane
        ]
        assert np.median(radii) == pytest.approx(140.0, abs=12.0)

    def test_a_dissolved_membrane_yields_no_contour(self):
        # Same capsule, but the core→shell transition spread over a broad
        # diffuse ramp: this is what dissolving looks like, and it must be
        # refused rather than given a fabricated inner circle.
        img = _capsule_image(membrane_edge_px=18.0)
        poly = _ring_polygon(280.0, 280.0, 200.0)

        state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )

        assert state == "dissolved"
        assert membrane is None

    def test_no_optical_compartment_yields_no_contour(self):
        # A capsule with a uniform interior has no membrane at all. Whatever
        # faint edge the search lands on, `contrast` must refuse it: an intact
        # membrane means the core really is a different compartment.
        img = _capsule_image(core_level=150, shell_level=150)
        poly = _ring_polygon(280.0, 280.0, 200.0)

        state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )

        assert state == "dissolved"
        assert membrane is None

    def test_a_capsule_too_small_to_read_is_refused_not_crashed(self):
        # Below MIN_RADIUS the method cannot measure anything. It must come
        # back as a refusal with the degenerate feature set, not raise.
        img = _capsule_image(size=80, cx=40.0, cy=40.0, r_out=20.0, r_mem=12.0)
        poly = _ring_polygon(40.0, 40.0, 20.0, n=60)

        state, _score, feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )

        assert state == "dissolved"
        assert membrane is None
        assert feats["coverage"] == 0.0

    def test_the_verdict_does_not_depend_on_the_polygon_vertex_count(self):
        # The U-Net's contours vary in vertex count between capsules; the
        # membrane stage resamples to its own 720 rays, so the answer must not
        # move when the same circle is described by fewer points.
        img = _capsule_image(membrane_edge_px=1.5)
        coarse = membrane_polygon_for(
            prepare_gray(img), _ring_polygon(280.0, 280.0, 200.0, n=24)
        )
        fine = membrane_polygon_for(
            prepare_gray(img), _ring_polygon(280.0, 280.0, 200.0, n=360)
        )
        assert coarse[0] == fine[0] == "sharp"


class TestOneContinuousContour:
    """The contour must be ONE boundary, not a hop between two of them.

    Reported by the user 2026-09-03 as a membrane segmented "zubatě" (with
    teeth) that should come out "jako jedna vrstevnice" — as a single contour
    line. The cause was not noise: each of the 720 rays chose its own edge
    independently, so wherever two concentric faces were near-equal in
    strength the contour stepped between them in square notches. Measured over
    the eleven membranes in production at the time, five stepped, with
    ray-to-ray jumps up to 19.7 px between points 2.2 px apart.
    """

    def test_does_not_step_between_two_concentric_edges(self):
        img = _two_edged_capsule()
        poly = _ring_polygon(400.0, 400.0, 360.0)

        state, score, feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )
        assert state == "sharp", f"score={score} feats={feats}"
        assert membrane is not None

        r = _traced_radii(membrane, 400.0, 400.0)
        jump = np.abs(np.diff(np.r_[r, r[0]])).max()
        # The two faces are 14 px apart, so an independent per-ray argmax
        # steps by ~14; a contour that follows one of them cannot.
        assert jump < 3.0, f"contour steps by {jump:.1f} px between rays"

    def test_commits_to_an_edge_rather_than_averaging_the_two(self):
        # The obvious wrong fix is to low-pass the stepped contour. That would
        # park it BETWEEN the two faces — smooth, and wrong everywhere instead
        # of wrong in patches. The contour must sit ON the face with the most
        # evidence, which `bias` makes the inner one.
        img = _two_edged_capsule()
        poly = _ring_polygon(400.0, 400.0, 360.0)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )
        assert membrane is not None
        median_r = float(np.median(_traced_radii(membrane, 400.0, 400.0)))
        assert median_r == pytest.approx(200.0, abs=3.0), (
            f"traced at r={median_r:.1f}; the faces are at 200 and 214, and "
            "207 would mean it averaged them"
        )

    def test_still_follows_a_non_circular_membrane(self):
        # The continuity constraint must not flatten real shape into a circle,
        # and the search band must be wide enough to let it.
        #
        # Semi-axes 220 and 180, i.e. 40 px out of round. The band is what
        # limits this: the guide is a circle fit, and at the old +-0.035R the
        # trace was pinned to the band edges at a 21.6 px span; at 0.10R it is
        # the true 40.0 px. So this pins the band as well as the constraint.
        #
        # Do NOT make the ellipse rounder-breaking to "strengthen" it. A
        # 230x170 ellipse demands 0.307 px per arc px at its steepest, above
        # TRACE_SLOPE, so the movement cap clips it by design — measured, not
        # assumed. An earlier version of this test used 230x170 and appeared to
        # pass only because a fixed radial step had quietly loosened the cap to
        # 0.294.
        size, cx, cy = 800, 400.0, 400.0
        yy, xx = np.mgrid[0:size, 0:size]
        rr_out = np.hypot(xx - cx, yy - cy)
        ell = np.hypot((xx - cx) / 220.0, (yy - cy) / 180.0)
        img = np.full((size, size), 190.0)
        inside = rr_out <= 360.0
        img[inside] = (90 + 60 * 0.5 * (1 + np.tanh((ell - 1.0) / 0.01)))[inside]
        img[np.abs(rr_out - 360.0) < 3.0] = 40.0
        poly = _ring_polygon(cx, cy, 360.0)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img.astype(np.uint8)), poly
        )
        assert membrane is not None
        r = _traced_radii(membrane, cx, cy)
        span = r.max() - r.min()
        assert span > 35.0, (
            f"radius spans only {span:.1f} px of the true 40 px — the search "
            "band is clipping a genuinely non-circular membrane"
        )
    def test_follows_a_local_fold_rather_than_cutting_the_corner(self):
        """The movement cap must be loose enough to track a real feature.

        A span-of-radii test does not pin this: at half the shipped cap the
        contour can still travel 180 px around the full circle, so it renders
        a slowly-varying ellipse perfectly well and only fails where the
        boundary turns quickly. This fold — 8 px over about 5 degrees, so
        ~0.35 px per ray — is that case. Halving the cap undershoots its apex
        by 2.2 px where the shipped one is within 0.5, and on the eleven real
        membranes the same halving pinned the path against its own cap on
        9-39% of rays (against 0.1-11%) and gave up to 7.5 px of contour.
        """
        size, cx, cy = 800, 400.0, 400.0
        yy, xx = np.mgrid[0:size, 0:size]
        rr = np.hypot(xx - cx, yy - cy)
        th = np.arctan2(yy - cy, xx - cx)
        off = np.abs(np.arctan2(np.sin(th - 0.7), np.cos(th - 0.7)))
        r_mem = 200.0 + 8.0 * np.exp(-(off ** 2) / (2 * 0.09 ** 2))
        img = np.full((size, size), 190.0)
        inside = rr <= 360.0
        img[inside] = (90 + 60 * 0.5 * (1 + np.tanh((rr - r_mem) / 1.2)))[inside]
        img[np.abs(rr - 360.0) < 3.0] = 40.0
        poly = _ring_polygon(cx, cy, 360.0)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img.astype(np.uint8)), poly
        )
        assert membrane is not None
        P = np.array([[p["x"], p["y"]] for p in membrane], float)
        r = np.hypot(P[:, 0] - cx, P[:, 1] - cy)
        a = np.arctan2(P[:, 1] - cy, P[:, 0] - cx)
        apex = float(r[np.argmin(np.abs(np.arctan2(np.sin(a - 0.7),
                                                   np.cos(a - 0.7))))])
        assert apex == pytest.approx(208.0, abs=1.2), (
            f"fold apex traced at r={apex:.2f}, true 208.0 — the contour is "
            "cutting the corner instead of following the boundary"
        )


class TestFollowsTheIntensityLevel:
    """The contour must run along an intensity level set, not cut across one.

    Reported 2026-09-04: the membrane "sometimes does not follow the intensity
    contour and scoops a piece out". Maximising edge evidence answers WHICH
    boundary but not WHERE ON IT: the gradient maximum only sits at a fixed
    intensity for a symmetric edge, and the movement penalty that keeps the
    path continuous will trade a weak stretch of evidence for a shortcut. On
    the real capsule that prompted the report the path ran 7.9 px inside the
    strongest edge over a 23-ray stretch. A level set has no shortcut to take.
    """

    def test_follows_a_dent_instead_of_cutting_across_it(self):
        img = _dented_capsule()
        poly = _ring_polygon(400.0, 400.0, 360.0)

        state, score, feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )
        assert state == "sharp", f"score={score} feats={feats}"
        assert membrane is not None

        at_dent, worst = _dent_error(membrane)
        # Without the level pass this measures 1.83 px at the dent; the dent is
        # 14 px deep, so cutting it entirely would read 14.
        assert at_dent < 0.5, (
            f"contour is {at_dent:.2f} px off the boundary at the dent — it is "
            "cutting across instead of following it"
        )
        assert worst < 1.0, f"worst radial error {worst:.2f} px"

    def test_sits_at_one_height_on_the_step_all_the_way_round(self):
        # Pass 1 maximises the gradient, which only coincides with a fixed
        # intensity on a symmetric edge. Where the asymmetry varies with angle,
        # pass 1 alone lands at a different height at every angle (spread
        # 0.126); the level pass equalises it (0.059).
        img = _varying_skew_capsule()
        gray = prepare_gray(img)
        poly = _ring_polygon(400.0, 400.0, 360.0)

        state, score, feats, membrane = membrane_polygon_for(gray, poly)
        assert state == "sharp", f"score={score} feats={feats}"
        assert membrane is not None
        spread = _level_spread(gray, membrane)
        assert spread < 0.09, (
            f"contour height on the step varies by {spread:.3f} — it is "
            "tracking the gradient maximum, not a level"
        )

    def test_estimates_the_level_locally_so_shading_cannot_shift_it(self):
        # A 25% linear illumination gradient. One global intensity level would
        # sit at a different height on the edge at every angle here — measured
        # on real capsules the core and shell levels swing by 11-40% of the
        # contrast — and where the swing exceeds the contrast it would not
        # cross the profile at all. A global level measures 0.190 here.
        img = _varying_skew_capsule(shade=0.25)
        gray = prepare_gray(img)
        poly = _ring_polygon(400.0, 400.0, 360.0)

        _state, _score, _feats, membrane = membrane_polygon_for(gray, poly)
        assert membrane is not None
        spread = _level_spread(gray, membrane)
        assert spread < 0.09, (
            f"contour height on the step varies by {spread:.3f} under shading"
        )
    def test_the_refinement_never_relocates_the_contour(self):
        # It places the contour on the boundary pass 1 chose; it must not be
        # able to walk it onto a different one. The window is a fraction of the
        # capsule radius, so on this capsule it is a few px: a contour that
        # moved further than that would mean the two passes disagree about
        # which boundary is the membrane.
        img = _two_edged_capsule()
        poly = _ring_polygon(400.0, 400.0, 360.0)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )
        assert membrane is not None
        median_r = float(np.median(_traced_radii(membrane, 400.0, 400.0)))
        # The faces are at 200 and 214 and the evidence favours the inner one.
        assert median_r == pytest.approx(200.0, abs=3.0), (
            f"traced at r={median_r:.1f}; the level refinement has walked the "
            "contour off the boundary the evidence chose"
        )

    def test_the_level_search_is_continuous_not_per_ray(self):
        # Where two level crossings are near-tied, choosing the nearest one on
        # each ray independently brings the stepping straight back -- the same
        # failure the evidence pass was rewritten to remove, one stage later.
        # On this fixture nearest-crossing jumps 3.00 px between adjacent
        # points; the constrained search keeps it to 0.26.
        img = _staircase_capsule()
        poly = _ring_polygon(400.0, 400.0, 360.0)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )
        assert membrane is not None
        r = _traced_radii(membrane, 400.0, 400.0)
        jump = np.abs(np.diff(np.r_[r, r[0]])).max()
        assert jump < 1.0, (
            f"contour steps by {jump:.2f} px between rays — the level search "
            "is picking each ray's crossing independently"
        )


class TestTunableInvariants:
    """Constraints the tunables are DERIVED from, asserted directly.

    `TRACE_STEP` cannot be pinned by a synthetic fixture. Coarsening it to
    1.0 px moves real contours by up to 21 px (p95 2.48 px), but three
    principled attempts to reproduce that synthetically — two near-tied faces,
    a thin dark line, and added noise — all came out step-independent, because
    the failure needs the irregular radial structure of real bright field. So
    the invariant the value is derived FROM is asserted instead of the
    behaviour it produces, which at least fails loudly if someone changes one
    number without the other.
    """

    def test_the_derivative_scale_survives_the_radial_sampling(self):
        from models import microcapsule_membrane as mm

        # `SIGMA_G / step` is the fine-derivative sigma in SAMPLES. Below about
        # 3 the Gaussian is too narrow for its own grid and edge localisation
        # degrades; at a 1.0 px step it is 1.5, and real traces then move by up
        # to 21 px.
        assert mm.SIGMA_G / mm.TRACE_STEP_MAX >= 3.0, (
            f"SIGMA_G/TRACE_STEP_MAX = {mm.SIGMA_G / mm.TRACE_STEP_MAX:.1f}"
        )

    def test_the_placement_window_is_reachable_from_the_search_grid(self):
        from models import microcapsule_membrane as mm

        # Pass 2 refines within +-LEVEL_WINDOW of pass 1's answer, and pass 1
        # quantises to its own step. If the window were smaller than that
        # quantisation, the refinement could not undo pass 1's rounding.
        for radius in (40.0, 250.0, 2000.0):
            assert mm._px(mm.LEVEL_WINDOW, radius) > mm.TRACE_STEP_MAX, radius

    def test_the_movement_cap_is_never_tighter_than_intended(self):
        from models import microcapsule_membrane as mm

        # The cap is a shape constraint in px per arc px, so it must not
        # tighten with magnification -- a tighter cap clips real shape, which
        # is the harm. It is allowed to come out LOOSER on a small capsule:
        # `N_ANG` is fixed, so below about R=175 the rays are closer together
        # than the radial grid can resolve and the integer state count rounds
        # up. That direction only lets the path move faster on a capsule whose
        # rays already oversample it, so nothing is clipped.
        for radius in (40.0, 60.0, 125.0, 250.0, 600.0, 1500.0):
            arc = 2 * np.pi * radius / mm.N_ANG
            step = float(np.clip(mm.TRACE_SLOPE * arc, 0.25,
                                 min(mm.TRACE_STEP_MAX, mm.SIGMA_G / 3)))
            smax = max(1, int(np.ceil(0.9 * mm.TRACE_SLOPE * arc / step)))
            effective = smax * step / arc
            # 10% of slack: the state count is an integer, so the cap can
            # rarely be exactly TRACE_SLOPE, and `_trace_inner` rounds up
            # rather than to nearest for exactly this reason. Plain rounding
            # measured up to 29% tighter at some radii.
            assert effective >= 0.9 * mm.TRACE_SLOPE, (
                f"at R={radius:.0f} the cap is {effective:.3f} px per arc px, "
                f"tighter than the intended {mm.TRACE_SLOPE}"
            )

    def test_a_large_capsule_gets_the_same_slope_as_a_small_one(self):
        """The cap must scale with the capsule, not with the ray index.

        The formula test above checks the arithmetic; this one runs the code.
        On a capsule whose membrane sits at r~595 the rays are 5.2 px apart, so
        the same 0.23 px-per-arc-px cap has to buy several radial states rather
        than one. Pinning the state count at 1 -- which is what it happens to
        be at the ~250 px radii in production, so no other fixture here would
        notice -- clips this 120 px-out-of-round ellipse to a 25 px span.

        The ellipse demands 0.202 px per arc px at its steepest, just under the
        cap, so it is reachable by design rather than by luck.
        """
        size, cx, cy = 1800, 900.0, 900.0
        yy, xx = np.mgrid[0:size, 0:size]
        rr = np.hypot(xx - cx, yy - cy)
        ell = np.hypot((xx - cx) / 660.0, (yy - cy) / 540.0)
        img = np.full((size, size), 190.0)
        inside = rr <= 850.0
        img[inside] = (90 + 60 * 0.5 * (1 + np.tanh((ell - 1.0) / 0.006)))[inside]
        img[np.abs(rr - 850.0) < 4.0] = 40.0
        poly = _ring_polygon(cx, cy, 850.0, n=240)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img.astype(np.uint8)), poly
        )
        assert membrane is not None
        r = _traced_radii(membrane, cx, cy)
        span = r.max() - r.min()
        assert span > 100.0, (
            f"radius spans only {span:.1f} px of the true 120 px — the "
            "movement cap has not scaled with the capsule"
        )

    def test_a_small_capsule_gets_the_same_slope_as_a_large_one(self):
        """The other end of the same scaling, and the one that bites.

        On a capsule whose membrane sits at r~105 the rays are 0.92 px apart,
        so the intended 0.23 px-per-arc-px cap is 0.21 px per ray -- finer than
        the 0.5 px grid the big capsules use. Sampling the search at a FIXED
        0.5 px would make the cap 0.5 px per ray whatever the capsule size,
        i.e. 1.36 px per arc px here: six times looser than intended, enough
        for the contour to hop between two faces 7 px apart (span 5.6 px
        against 2.3).

        The large-capsule test above cannot catch this: there the derived step
        and a fixed 0.5 px coincide.
        """
        size, cx, cy, r_out, r_mem = 340, 170.0, 170.0, 155.0, 105.0
        sep, swing = 7.0, 9.0
        yy, xx = np.mgrid[0:size, 0:size]
        rr = np.hypot(xx - cx, yy - cy)
        th = np.arctan2(yy - cy, xx - cx)
        total = 60.0
        m = swing * np.cos(6.0 * th)
        img = np.full((size, size), 190.0)
        inside = rr <= r_out
        img[inside] = (90 + (total / 2 + m) * 0.5 * (1 + np.tanh((rr - r_mem) / 1.0))
                          + (total / 2 - m) * 0.5
                          * (1 + np.tanh((rr - r_mem - sep) / 1.0)))[inside]
        img[np.abs(rr - r_out) < 2.0] = 40.0
        poly = _ring_polygon(cx, cy, r_out, n=120)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(np.clip(img, 0, 255).astype(np.uint8)), poly
        )
        assert membrane is not None
        r = _traced_radii(membrane, cx, cy)
        jump = float(np.abs(np.diff(np.r_[r, r[0]])).max())
        arc = 2 * np.pi * float(np.mean(r)) / len(r)
        assert jump / arc < 0.6, (
            f"contour moves {jump / arc:.2f} px per arc px on a small capsule, "
            "far past the intended cap — the radial grid is not scaling with it"
        )


class TestShapePrior:
    """A membrane is a closed shell, so where the image says nothing the
    contour should stay round.

    Reported 2026-09-04: "the boundary dips inward in some places; I want the
    membrane to be ideally a circle". On the arc in question the radial profile
    has no edge at all -- intensity climbs monotonically from 65 to 150 over
    ~100 px and the band-passed response is 1.2-1.8 against 4-6.7 in the sharp
    sectors -- so the path locks onto whatever ripple the ramp carries.

    WHAT IS AND IS NOT COVERED HERE. The prior's effect is established on real
    data (the reported capsule goes from 5.03 px of non-circularity to 3.24,
    the eight already-round ones move by at most 0.14 px). Three attempts at a
    synthetic fixture that would fail without it -- a half-blurred capsule, one
    with a corrugated ramp, one with a decoy arc on the soft half -- all came
    out prior-independent or made the capsule read as dissolved, because the
    failure needs the irregular structure of real bright field. So what is
    pinned here is the SAFETY property, which is the one that could silently
    ruin good output, plus the robustness of the circle it pulls toward.
    """

    def test_does_not_round_off_a_genuinely_non_circular_membrane(self):
        # The 120 px out-of-round ellipse from the scaling test, restated as a
        # prior question: its edge is sharp the whole way round, so no ray is
        # weak enough to be pulled and the shape must survive intact. This is
        # the failure mode that matters -- an earlier ungated version of the
        # pull, which ramped from 1.0 instead of gating, flattened it to a
        # 66 px span.
        size, cx, cy = 1800, 900.0, 900.0
        yy, xx = np.mgrid[0:size, 0:size]
        rr = np.hypot(xx - cx, yy - cy)
        ell = np.hypot((xx - cx) / 660.0, (yy - cy) / 540.0)
        img = np.full((size, size), 190.0)
        inside = rr <= 850.0
        img[inside] = (90 + 60 * 0.5 * (1 + np.tanh((ell - 1.0) / 0.006)))[inside]
        img[np.abs(rr - 850.0) < 4.0] = 40.0
        poly = _ring_polygon(cx, cy, 850.0, n=240)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img.astype(np.uint8)), poly
        )
        assert membrane is not None
        r = _traced_radii(membrane, cx, cy)
        assert r.max() - r.min() > 100.0, (
            f"span {r.max() - r.min():.1f} px of the true 120 — the shape "
            "prior is rounding off a membrane the image clearly resolves"
        )

    def test_the_gate_leaves_a_confident_edge_alone(self):
        from models import microcapsule_membrane as mm

        # The gate is what makes the test above hold, so state it directly: a
        # ray carrying an edge as strong as the capsule's best gets no pull at
        # all, and the pull only reaches full strength at zero evidence.
        strong = 1.0
        for frac in (1.0, 0.9, mm.SHAPE_PRIOR_GATE):
            weak = np.clip((mm.SHAPE_PRIOR_GATE - frac / strong)
                           / mm.SHAPE_PRIOR_GATE, 0.0, 1.0)
            assert weak == 0.0, f"a ray at {frac} of the strong edges is pulled"
        assert np.clip((mm.SHAPE_PRIOR_GATE - 0.0) / mm.SHAPE_PRIOR_GATE,
                       0.0, 1.0) == 1.0

    def test_the_circle_it_pulls_toward_ignores_the_bad_stretches(self):
        from models import microcapsule_membrane as mm

        # The prior is only as good as its circle, and that circle is fitted to
        # the very path whose bad stretches it exists to correct.
        #
        # Trimming alone cannot do it. The bad stretches are CONTIGUOUS arcs,
        # and an arc pulled inward is indistinguishable from a circle whose
        # centre has moved, so least squares absorbs it into the centre instead
        # of flagging it as an outlier. Both halves are asserted here, because
        # the failing one is the reason the `trust` argument exists.
        angs = np.linspace(0, 2 * np.pi, 720, endpoint=False)
        radial = np.full(720, 200.0)
        radial[100:244] -= 25.0            # a fifth of the ring, dragged in
        cap = mm.capsule_from_polygon(_ring_polygon(0.0, 0.0, 360.0))

        blind = mm._fit_circle_radius(cap, angs, radial)
        assert blind is not None
        assert float(np.median(blind)) < 198.0, (
            "the unweighted fit is expected to be dragged by a contiguous "
            "arc; if it is not, this test no longer proves anything"
        )

        # The same evidence that gates the pull also selects the fit: the bad
        # arc is where the edge was weak, so it is excluded.
        trust = np.ones(720)
        trust[100:244] = 0.05
        fitted = mm._fit_circle_radius(cap, angs, radial, trust=trust)
        assert fitted is not None
        assert float(np.median(fitted)) == pytest.approx(200.0, abs=1.5), (
            f"weighted fit came out at {np.median(fitted):.1f}"
        )

    def test_the_circle_fit_refuses_rather_than_inventing_one(self):
        from models import microcapsule_membrane as mm

        # Degenerate input must return None so the caller keeps pass 1's path,
        # rather than a circle solved from a singular system.
        angs = np.linspace(0, 2 * np.pi, 720, endpoint=False)
        cap = mm.capsule_from_polygon(_ring_polygon(0.0, 0.0, 360.0))
        assert mm._fit_circle_radius(cap, angs, np.zeros(720)) is None
