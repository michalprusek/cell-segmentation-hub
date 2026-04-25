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
    app = FastAPI()
    app.include_router(metrics_router)
    return TestClient(app)


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

    def test_perfect_disk_returns_low_di(self, client):
        """Mask = perfect disk, no core → R_eff path → DI is small."""
        pts = _circle(self.CX, self.CY, 60)
        body = {
            "mask_polygon": pts,
            "core_polygon": None,
            "image_width": self.W,
            "image_height": self.H,
        }
        out = self._post(client, body)
        assert out["reference"] == "r_eff"
        # A discretised disk has tiny rasterisation noise; DI should be near zero.
        assert out["di"] < 0.05
        assert out["w1"] >= 0.0
        assert out["n_pixels"] > 1000

    def test_disk_with_matching_core_returns_low_di(self, client):
        """Mask polygon == core polygon → R_core ≈ R_eff → DI is small."""
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
        """Core ⊊ Mask → R_core < R_eff → d̃ stretched → DI larger."""
        mask_pts = _circle(self.CX, self.CY, 80)
        core_pts = _circle(self.CX, self.CY, 30)
        with_core = self._post(client, {
            "mask_polygon": mask_pts,
            "core_polygon": core_pts,
            "image_width": self.W, "image_height": self.H,
        })
        without_core = self._post(client, {
            "mask_polygon": mask_pts,
            "core_polygon": None,
            "image_width": self.W, "image_height": self.H,
        })
        assert with_core["di"] > without_core["di"] + 0.10

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

    def test_falls_back_when_core_degenerate(self, client):
        """Core polygon with <3 points → r_eff_fallback label."""
        mask_pts = _circle(self.CX, self.CY, 60)
        out = self._post(client, {
            "mask_polygon": mask_pts,
            "core_polygon": [[10.0, 10.0], [11.0, 11.0]],  # only 2 vertices
            "image_width": self.W, "image_height": self.H,
        })
        assert out["reference"] == "r_eff_fallback"

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
