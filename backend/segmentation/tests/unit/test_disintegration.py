"""Unit tests for the /api/disintegration-index endpoint."""

import os
import sys

import numpy as np
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from api.metrics_endpoint import router as metrics_router  # noqa: E402


@pytest.fixture(scope="module")
def client() -> TestClient:
    _app = FastAPI()
    _app.include_router(metrics_router)
    return TestClient(_app)


def _circle(cx: float, cy: float, r: float, n: int = 96) -> list:
    """Return n vertices approximating a circle, as [[x,y], ...]."""
    thetas = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return [[float(cx + r * np.cos(t)), float(cy + r * np.sin(t))] for t in thetas]


def _ring_with_arms(cx: float, cy: float, r_core: float,
                    arm_length: float, arm_count: int = 8) -> list:
    """Return a star-like polygon: small core + radiating arms.

    Used to simulate a disintegrated spheroid with a tight core and outward
    invasion projections.
    """
    pts = []
    for k in range(arm_count):
        theta = 2 * np.pi * k / arm_count
        # Outer tip of arm
        pts.append([float(cx + arm_length * np.cos(theta)),
                    float(cy + arm_length * np.sin(theta))])
        # Inner notch
        notch = theta + np.pi / arm_count
        pts.append([float(cx + r_core * np.cos(notch)),
                    float(cy + r_core * np.sin(notch))])
    return pts


@pytest.mark.unit
class TestDisintegrationIndex:
    """Tests for POST /api/disintegration-index."""

    H, W = 256, 256
    CX, CY = 128.0, 128.0

    def _post(self, client, body):
        resp = client.post("/api/disintegration-index", json=body)
        assert resp.status_code == 200, resp.text
        return resp.json()

    def test_no_core_returns_na_not_a_computed_value(self, client):
        """Mask present but no core → DI is undefined → reference='no_core'.

        A core is required; there is no r_eff fallback. The DI field is a 0.0
        N/A sentinel (callers render it as N/A), and n_pixels is still reported.
        """
        pts = _circle(self.CX, self.CY, 60)
        body = {
            "mask_polygon": pts,
            "core_polygon": None,
            "image_width": self.W,
            "image_height": self.H,
        }
        out = self._post(client, body)
        assert out["reference"] == "no_core"
        assert out["di"] == 0.0
        assert out["w1"] == 0.0
        assert out["n_pixels"] > 1000

    def test_disk_with_matching_core_returns_low_di(self, client):
        """Mask polygon == core polygon → intact spheroid → DI is small."""
        pts = _circle(self.CX, self.CY, 60)
        body = {
            "mask_polygon": pts,
            "core_polygon": pts,
            "image_width": self.W,
            "image_height": self.H,
        }
        out = self._post(client, body)
        assert out["reference"] == "core"
        assert out["di"] < 0.05

    def test_smaller_core_increases_di(self, client):
        """Core ⊊ Mask → R_core small → d̃ = d/R_C stretched → DI larger.

        Both cases carry a core (a core is required). A tight core makes the
        same mask look far more dispersed than a core equal to the mask.
        """
        mask_pts = _circle(self.CX, self.CY, 80)
        tight_core = _circle(self.CX, self.CY, 30)
        full_core = _circle(self.CX, self.CY, 80)  # core == mask → intact
        with_tight = self._post(client, {
            "mask_polygon": mask_pts,
            "core_polygon": tight_core,
            "image_width": self.W, "image_height": self.H,
        })
        with_full = self._post(client, {
            "mask_polygon": mask_pts,
            "core_polygon": full_core,
            "image_width": self.W, "image_height": self.H,
        })
        assert with_tight["reference"] == "core"
        assert with_full["reference"] == "core"
        # Intact (core == mask) → DI ≈ 0; tight core → clearly higher.
        assert with_full["di"] < 0.05
        assert with_tight["di"] > with_full["di"] + 0.10

    def test_invasion_pattern_returns_high_di(self, client):
        """Star-shape mask with a tight core → significant DI > 0."""
        mask_pts = _ring_with_arms(self.CX, self.CY, r_core=20,
                                   arm_length=80, arm_count=10)
        core_pts = _circle(self.CX, self.CY, 18)
        out = self._post(client, {
            "mask_polygon": mask_pts,
            "core_polygon": core_pts,
            "image_width": self.W, "image_height": self.H,
        })
        assert out["reference"] == "core"
        # Heavy invasion → DI well above 0.1.
        assert out["di"] > 0.15

    def test_degenerate_core_returns_no_core(self, client):
        """Core polygon with <3 points → undefined DI → reference='no_core'.

        A degenerate core cannot anchor the metric, so DI is N/A rather than
        silently degrading to an equivalent-disk value.
        """
        mask_pts = _circle(self.CX, self.CY, 60)
        out = self._post(client, {
            "mask_polygon": mask_pts,
            "core_polygon": [[10.0, 10.0], [11.0, 11.0]],  # only 2 vertices
            "image_width": self.W, "image_height": self.H,
        })
        assert out["reference"] == "no_core"
        assert out["di"] == 0.0

    def test_returns_zero_for_empty_polygon(self, client):
        """Mask polygon with <3 vertices → DI = 0, reference='none'."""
        out = self._post(client, {
            "mask_polygon": [[0.0, 0.0], [1.0, 1.0]],
            "core_polygon": None,
            "image_width": self.W, "image_height": self.H,
        })
        assert out["reference"] == "none"
        assert out["di"] == 0.0
        assert out["n_pixels"] == 0

    def test_returns_zero_for_polygon_outside_canvas(self, client):
        """Polygon entirely outside the image bounds → no pixels → DI = 0."""
        out = self._post(client, {
            "mask_polygon": _circle(-100, -100, 30),
            "core_polygon": None,
            "image_width": self.W, "image_height": self.H,
        })
        assert out["reference"] == "none"
        assert out["n_pixels"] == 0

    def test_di_in_zero_one_range(self, client):
        """DI must always lie in [0, 1) due to tanh saturation."""
        mask_pts = _ring_with_arms(self.CX, self.CY, r_core=10,
                                   arm_length=120, arm_count=6)
        core_pts = _circle(self.CX, self.CY, 6)
        out = self._post(client, {
            "mask_polygon": mask_pts,
            "core_polygon": core_pts,
            "image_width": self.W, "image_height": self.H,
        })
        assert 0.0 <= out["di"] < 1.0

    def test_invalid_image_dims_returns_400(self, client):
        body = {
            "mask_polygon": _circle(self.CX, self.CY, 60),
            "core_polygon": None,
            "image_width": 0,
            "image_height": self.H,
        }
        resp = client.post("/api/disintegration-index", json=body)
        assert resp.status_code == 400

    # ---- plural mask_polygons / core_polygons (production-shape) ----

    def test_plural_mask_polygons_unions_multiple_polygons(self, client):
        """`mask_polygons` (plural) must union every polygon into one mask.

        This is the shape the TypeScript caller actually sends in production —
        every external non-core polygon as a separate entry.
        """
        # Two disjoint disks → combined pixel count ≈ 2× a single disk.
        single = self._post(client, {
            "mask_polygon": _circle(80, 80, 30),
            "core_polygon": None,
            "image_width": self.W, "image_height": self.H,
        })
        union = self._post(client, {
            "mask_polygons": [_circle(80, 80, 30), _circle(180, 180, 30)],
            "core_polygons": None,
            "image_width": self.W, "image_height": self.H,
        })
        assert union["n_pixels"] >= int(1.9 * single["n_pixels"])
        assert union["n_pixels"] <= int(2.1 * single["n_pixels"])

    def test_plural_with_overlapping_polygons_does_not_double_count(self, client):
        """Two identical polygons in `mask_polygons` produce the same
        `n_pixels` as one — fillPoly union is idempotent.
        """
        circle = _circle(self.CX, self.CY, 50)
        once = self._post(client, {
            "mask_polygons": [circle],
            "image_width": self.W, "image_height": self.H,
        })
        twice = self._post(client, {
            "mask_polygons": [circle, circle],
            "image_width": self.W, "image_height": self.H,
        })
        assert once["n_pixels"] == twice["n_pixels"]

    def test_plural_core_polygons_combined_for_r_ref(self, client):
        """Multiple core polygons should be unioned into the R_core area."""
        mask = _circle(self.CX, self.CY, 90)
        core_a = _circle(self.CX - 20, self.CY, 15)
        core_b = _circle(self.CX + 20, self.CY, 15)
        out = self._post(client, {
            "mask_polygons": [mask],
            "core_polygons": [core_a, core_b],
            "image_width": self.W, "image_height": self.H,
        })
        assert out["reference"] == "core"

    def test_neither_singular_nor_plural_mask_returns_400(self, client):
        """Empty request body for masks → 400, not silent zeros."""
        resp = client.post("/api/disintegration-index", json={
            "image_width": self.W, "image_height": self.H,
        })
        assert resp.status_code == 400

    # ---- core-centroid anchor (improvement A) ----
    # The previous tests use symmetric concentric shapes, so the mass centroid
    # and the core centroid coincide and the anchor change is invisible. The
    # tests below deliberately break symmetry to exercise the new anchor.

    def test_off_core_mass_raises_di_via_core_anchor(self, client):
        """Same centred core; mass that sits off the core inflates DI.

        Both cases are core-anchored on (CX, CY). A compact mask over the core
        looks nearly intact; adding a distant rightward bulge places mass far
        from the anchor and drives DI up. This exercises the core-centroid
        anchor without relying on any no-core fallback.
        """
        core = [_circle(self.CX, self.CY, 18)]
        compact = [_circle(self.CX, self.CY, 24)]
        with_bulge = [_circle(self.CX, self.CY, 24), _circle(self.CX + 80, self.CY, 25)]
        symmetric = self._post(client, {
            "mask_polygons": compact, "core_polygons": core,
            "image_width": self.W, "image_height": self.H,
        })
        asymmetric = self._post(client, {
            "mask_polygons": with_bulge, "core_polygons": core,
            "image_width": self.W, "image_height": self.H,
        })
        assert symmetric["reference"] == "core"
        assert asymmetric["reference"] == "core"
        # Distant off-core mass (anchored on the core) must raise DI.
        assert asymmetric["di"] > symmetric["di"] + 0.05

    def test_off_centre_core_changes_di_vs_centred_core(self, client):
        """Same mask, two different core positions. Old code (mass anchor)
        would have given identical DIs because the anchor depends only on
        the mask. New code (core anchor) gives different DIs because the
        anchor moves with the core.
        """
        mask_pts = [_circle(140, 100, 80)]
        centred_core = [_circle(140, 100, 30)]
        offset_core = [_circle(120, 80, 30)]
        centred = self._post(client, {
            "mask_polygons": mask_pts, "core_polygons": centred_core,
            "image_width": self.W, "image_height": self.H,
        })
        offset = self._post(client, {
            "mask_polygons": mask_pts, "core_polygons": offset_core,
            "image_width": self.W, "image_height": self.H,
        })
        assert abs(offset["di"] - centred["di"]) > 0.02

    def test_satellite_blob_with_main_blob_core(self, client):
        """A main blob with a core, plus a distant satellite blob in the
        mask. Anchor sits on the main blob's core; satellite pixels are
        far from the anchor → DI elevated. Mass anchor would have sat
        between the blobs.
        """
        main_blob = _circle(80, 128, 35)
        satellite = _circle(200, 128, 20)
        core = [_circle(80, 128, 18)]
        out = self._post(client, {
            "mask_polygons": [main_blob, satellite], "core_polygons": core,
            "image_width": self.W, "image_height": self.H,
        })
        assert out["reference"] == "core"
        assert out["di"] > 0.20
