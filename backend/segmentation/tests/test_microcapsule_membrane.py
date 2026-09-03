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
