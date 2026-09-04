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
        # The continuity constraint must not flatten real shape into a circle.
        #
        # The ellipse here is deliberately mild — semi-axes 205 and 190, i.e.
        # +-7.5 px off round. That is not timidity: the guide is a CIRCLE fit
        # and `TRACE_BAND` searches only +-0.035R around it, so a membrane much
        # further out of round is outside the searchable window and no tracer
        # can follow it. Measured on a 230x170 ellipse, the old per-ray argmax
        # spanned 24.0 px and the DP 22.3 — both simply pinned to the band
        # edges. That is a limit of the guide, not of this constraint, so do
        # not "strengthen" this test by making the ellipse rounder-breaking.
        size, cx, cy = 800, 400.0, 400.0
        yy, xx = np.mgrid[0:size, 0:size]
        rr_out = np.hypot(xx - cx, yy - cy)
        ell = np.hypot((xx - cx) / 205.0, (yy - cy) / 190.0)
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
        # A circle would span ~0; the ellipse spans 15 px between its axes.
        assert r.max() - r.min() > 10.0, (
            f"radius spans only {r.max() - r.min():.1f} px — the constraint "
            "flattened a 15 px-out-of-round ellipse into a circle"
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

    def test_estimates_the_level_locally_so_shading_cannot_shift_it(self):
        # A 25% linear illumination gradient across the field. One global
        # intensity level would sit at a different height on the edge at every
        # angle here — measured on real capsules the core and shell levels
        # swing by 11-40% of the contrast — and where the swing exceeds the
        # contrast it would not cross the profile at all.
        img = _dented_capsule(dent_px=10.0, dent_sig=0.09, shade=0.25)
        poly = _ring_polygon(400.0, 400.0, 360.0)

        _state, _score, _feats, membrane = membrane_polygon_for(
            prepare_gray(img), poly
        )
        assert membrane is not None
        at_dent, worst = _dent_error(membrane, dent_px=10.0, dent_sig=0.09)
        assert at_dent < 0.5, f"{at_dent:.2f} px off at the dent under shading"
        assert worst < 1.0, f"worst radial error {worst:.2f} px under shading"

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
