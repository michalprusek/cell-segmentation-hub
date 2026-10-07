"""Unit tests for the /api/disintegration-index endpoint (the POLYGON fallback).

The authoritative read-out is computed from the raster argmax mask at inference
time (see test_predict_disintegration_contract.py); this endpoint scores stored
polygons, for segmentations that predate that read-out or were edited since.
It composes the polygons into a 3-class mask and scores it with the same port
of the paper's compute_di.py, so every definition here is the paper's: p90
reach, raw corona components, Index B, both regime flags, the core guards.

The canvases are 512 x 512 and every core has a radius of at least 75 px,
because a core below MIN_CORE_PX (16 048 px, radius ~71.5 px) leaves DI
undefined by design.
"""

import os
import sys

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from api.metrics_endpoint import router as metrics_router  # noqa: E402
from api import disintegration_metrics as dm  # noqa: E402


@pytest.fixture(scope="module")
def client() -> TestClient:
    _app = FastAPI()
    _app.include_router(metrics_router)
    return TestClient(_app)


def _circle(cx: float, cy: float, r: float, n: int = 192) -> list:
    """Return n vertices approximating a circle, as [[x,y], ...]."""
    thetas = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return [[float(cx + r * np.cos(t)), float(cy + r * np.sin(t))] for t in thetas]


def _ring_with_arms(cx: float, cy: float, r_core: float,
                    arm_length: float, arm_count: int = 8) -> list:
    """A star-like polygon: tight body + radiating arms (a dispersed spheroid)."""
    pts = []
    for k in range(arm_count):
        theta = 2 * np.pi * k / arm_count
        pts.append([float(cx + arm_length * np.cos(theta)),
                    float(cy + arm_length * np.sin(theta))])
        notch = theta + np.pi / arm_count
        pts.append([float(cx + r_core * np.cos(notch)),
                    float(cy + r_core * np.sin(notch))])
    return pts


def _compose(h, w, masks, cores):
    """What the endpoint builds: foreground 1, core 2 on top, int-truncated vertices."""
    m = np.zeros((h, w), np.uint8)
    for p in masks:
        cv2.fillPoly(m, [np.asarray(p, np.float32).astype(np.int32)], 1)
    for p in cores:
        cv2.fillPoly(m, [np.asarray(p, np.float32).astype(np.int32)], 2)
    return m


H, W = 512, 512
CX, CY = 256.0, 256.0
R_CORE = 80.0  # pi * 80^2 = 20 106 px > MIN_CORE_PX


def _post(client, body):
    resp = client.post("/api/disintegration-index", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.unit
class TestDisintegrationIndex:
    """DI itself, and the conventions under which it is undefined."""

    def test_no_core_returns_na_not_a_computed_value(self, client):
        out = _post(client, {
            "mask_polygon": _circle(CX, CY, 120), "core_polygon": None,
            "image_width": W, "image_height": H,
        })
        assert out["reference"] == "no_core"
        assert out["di"] == 0.0 and out["w1"] == 0.0
        assert out["n_pixels"] > 1000
        assert out["index_b"] is None and out["reach_p90"] is None
        assert out["note"] == "no core: DI undefined"

    def test_core_below_minimum_size_is_undefined_not_near_one(self, client):
        """F14: a tiny core shrinks R_C and would push DI towards 1 by construction."""
        out = _post(client, {
            "mask_polygon": _circle(CX, CY, 150), "core_polygon": _circle(CX, CY, 30),
            "image_width": W, "image_height": H,
        })
        assert out["reference"] == "core_too_small"
        assert out["di"] == 0.0
        assert out["area_core_px"] < dm.MIN_CORE_PX
        assert "below the minimum core size" in out["note"]
        for k in ("index_b", "reach_p90", "n_fragments", "solidity", "core_fragmented",
                  "unvalidated_regime", "below_validated_regime"):
            assert out[k] is None, k

    def test_disk_with_matching_core_returns_low_di(self, client):
        pts = _circle(CX, CY, 100)
        out = _post(client, {"mask_polygon": pts, "core_polygon": pts,
                             "image_width": W, "image_height": H})
        assert out["reference"] == "core"
        assert out["di"] < 0.05
        assert out["index_b"] == 0.0
        # an intact spheroid is below the detection floor (outside-core fraction < 0.61), and says so
        assert out["below_validated_regime"] == 1

    def test_smaller_core_increases_di(self, client):
        mask_pts = _circle(CX, CY, 200)
        tight = _post(client, {"mask_polygon": mask_pts, "core_polygon": _circle(CX, CY, R_CORE),
                               "image_width": W, "image_height": H})
        full = _post(client, {"mask_polygon": mask_pts, "core_polygon": mask_pts,
                              "image_width": W, "image_height": H})
        assert tight["reference"] == full["reference"] == "core"
        assert full["di"] < 0.05
        assert tight["di"] > full["di"] + 0.10

    def test_invasion_pattern_returns_high_di(self, client):
        out = _post(client, {
            "mask_polygon": _ring_with_arms(CX, CY, r_core=90, arm_length=250, arm_count=10),
            "core_polygon": _circle(CX, CY, R_CORE),
            "image_width": W, "image_height": H,
        })
        assert out["reference"] == "core"
        assert out["di"] > 0.15
        assert 0.0 <= out["di"] < 1.0

    def test_degenerate_core_returns_no_core(self, client):
        out = _post(client, {
            "mask_polygon": _circle(CX, CY, 120),
            "core_polygon": [[10.0, 10.0], [11.0, 11.0]],
            "image_width": W, "image_height": H,
        })
        assert out["reference"] == "no_core"
        assert out["di"] == 0.0

    def test_returns_none_for_empty_polygon(self, client):
        out = _post(client, {"mask_polygon": [[0.0, 0.0], [1.0, 1.0]], "core_polygon": None,
                             "image_width": W, "image_height": H})
        assert out["reference"] == "none"
        assert out["n_pixels"] == 0

    def test_returns_none_for_polygon_outside_canvas(self, client):
        out = _post(client, {"mask_polygon": _circle(-300, -300, 30), "core_polygon": None,
                             "image_width": W, "image_height": H})
        assert out["reference"] == "none"
        assert out["n_pixels"] == 0

    def test_invalid_image_dims_returns_400(self, client):
        resp = client.post("/api/disintegration-index", json={
            "mask_polygon": _circle(CX, CY, 60), "core_polygon": None,
            "image_width": 0, "image_height": H,
        })
        assert resp.status_code == 400

    def test_neither_singular_nor_plural_mask_returns_400(self, client):
        resp = client.post("/api/disintegration-index",
                           json={"image_width": W, "image_height": H})
        assert resp.status_code == 400

    def test_plural_mask_polygons_union(self, client):
        single = _post(client, {"mask_polygon": _circle(130, 130, 60),
                                "image_width": W, "image_height": H})
        union = _post(client, {"mask_polygons": [_circle(130, 130, 60), _circle(380, 380, 60)],
                               "image_width": W, "image_height": H})
        assert 1.9 * single["n_pixels"] <= union["n_pixels"] <= 2.1 * single["n_pixels"]

    def test_overlapping_polygons_do_not_double_count(self, client):
        c = _circle(CX, CY, 100)
        once = _post(client, {"mask_polygons": [c], "image_width": W, "image_height": H})
        twice = _post(client, {"mask_polygons": [c, c], "image_width": W, "image_height": H})
        assert once["n_pixels"] == twice["n_pixels"]

    def test_off_core_mass_raises_di_via_core_anchor(self, client):
        core = [_circle(CX - 60, CY, R_CORE)]
        compact = [_circle(CX - 60, CY, 95)]
        with_bulge = compact + [_circle(CX + 150, CY, 50)]
        a = _post(client, {"mask_polygons": compact, "core_polygons": core,
                           "image_width": W, "image_height": H})
        b = _post(client, {"mask_polygons": with_bulge, "core_polygons": core,
                           "image_width": W, "image_height": H})
        assert a["reference"] == b["reference"] == "core"
        assert b["di"] > a["di"] + 0.05

    def test_off_centre_core_changes_di(self, client):
        mask_pts = [_circle(CX, CY, 200)]
        centred = _post(client, {"mask_polygons": mask_pts, "core_polygons": [_circle(CX, CY, R_CORE)],
                                 "image_width": W, "image_height": H})
        offset = _post(client, {"mask_polygons": mask_pts,
                                "core_polygons": [_circle(CX - 60, CY - 60, R_CORE)],
                                "image_width": W, "image_height": H})
        assert abs(offset["di"] - centred["di"]) > 0.02


@pytest.mark.unit
class TestDisintegrationPanel:
    """The panel is the paper's (compute_di.py), not the old speckle-guarded one."""

    def test_endpoint_equals_the_port_on_the_composed_mask(self, client):
        masks = [_ring_with_arms(CX, CY, r_core=95, arm_length=240, arm_count=7),
                 _circle(60, 60, 12), _circle(470, 90, 6)]
        cores = [_circle(CX, CY, R_CORE)]
        out = _post(client, {"mask_polygons": masks, "core_polygons": cores,
                             "image_width": W, "image_height": H})
        ref = dm.disintegration_index(_compose(H, W, masks, cores))
        assert ref is not None
        pairs = {"di": "DI", "w1": "W1", "index_b": "index_B", "reach_p90": "reach_p90",
                 "n_fragments": "n_fragments", "largest_fragment_frac": "largest_fragment_frac",
                 "solidity": "solidity", "area_core_px": "area_core_px",
                 "area_corona_px": "area_corona_px", "area_total_px": "area_total_px",
                 "n_core_components": "n_core_components",
                 "largest_core_component_frac": "largest_core_component_frac",
                 "core_centroid_shift": "core_centroid_shift", "core_fragmented": "core_fragmented",
                 "unvalidated_regime": "unvalidated_regime",
                 "below_validated_regime": "below_validated_regime"}
        for api_key, ref_key in pairs.items():
            assert out[api_key] == pytest.approx(ref[ref_key], abs=1e-12), api_key
        assert out["algorithm_sha256"] == dm.ALGORITHM_SOURCE_SHA256
        assert out["source"] == "polygons"

    def test_reach_is_the_90th_percentile(self, client):
        masks = [_ring_with_arms(CX, CY, r_core=95, arm_length=240, arm_count=9)]
        cores = [_circle(CX, CY, R_CORE)]
        out = _post(client, {"mask_polygons": masks, "core_polygons": cores,
                             "image_width": W, "image_height": H})
        m = _compose(H, W, masks, cores)
        cy, cx = np.nonzero(m == 2)
        fy, fx = np.nonzero(m > 0)
        d = np.hypot(fx - cx.mean(), fy - cy.mean()) / np.sqrt((m == 2).sum() / np.pi)
        assert out["reach_p90"] == pytest.approx(np.percentile(d, 90), abs=1e-12)
        assert abs(out["reach_p90"] - np.percentile(d, 95)) > 1e-3

    def test_fragments_are_raw_components_without_closing_or_size_floor(self, client):
        """Two 3x3 specks 3 px apart: the old closing + 30 px floor dropped both."""
        body = {"mask_polygons": [_circle(CX, CY, 100),
                                  [[400, 400], [402, 400], [402, 402], [400, 402]],
                                  [[405, 400], [407, 400], [407, 402], [405, 402]]],
                "core_polygons": [_circle(CX, CY, 90)],
                "image_width": W, "image_height": H}
        out = _post(client, body)
        # the corona ring round the core + two separate 3x3 specks
        assert out["n_fragments"] == 3
        assert "radial_reach_q95" not in out and "hole_count" not in out

    def test_intact_disk_panel(self, client):
        pts = _circle(CX, CY, 100)
        out = _post(client, {"mask_polygon": pts, "core_polygon": pts,
                             "image_width": W, "image_height": H})
        assert out["n_fragments"] == 0            # no corona at all
        assert out["largest_fragment_frac"] == 0.0
        assert 0.9 < out["solidity"] <= 1.0
        assert out["area_total_px"] == out["area_core_px"] + out["area_corona_px"]
        assert out["reach_p90"] == pytest.approx(np.sqrt(0.9), abs=0.02)
        assert out["n_core_components"] == 1 and out["core_fragmented"] == 0

    def test_split_core_is_flagged(self, client):
        cores = [_circle(CX - 90, CY, R_CORE), _circle(CX + 120, CY, 40)]
        out = _post(client, {"mask_polygons": [_circle(CX, CY, 230)], "core_polygons": cores,
                             "image_width": W, "image_height": H})
        assert out["reference"] == "core"
        assert out["n_core_components"] == 2
        assert out["largest_core_component_frac"] < dm.CORE_LARGEST_MIN
        assert out["core_fragmented"] == 1

    def test_index_b_increases_with_corona(self, client):
        core = _circle(CX, CY, R_CORE)
        tight = _post(client, {"mask_polygon": _circle(CX, CY, 90), "core_polygon": core,
                               "image_width": W, "image_height": H})
        wide = _post(client, {"mask_polygon": _circle(CX, CY, 200), "core_polygon": core,
                              "image_width": W, "image_height": H})
        assert wide["index_b"] > tight["index_b"]

    def test_unvalidated_regime_flag(self, client):
        # core radius 100, foreground radius 115 -> outside-core fraction
        # 1 - (100/115)^2 ~ 0.24, inside the gap [0.08, 0.47) that holds no expert mask
        out = _post(client, {"mask_polygon": _circle(CX, CY, 115),
                             "core_polygon": _circle(CX, CY, 100),
                             "image_width": W, "image_height": H})
        assert dm.UNVALIDATED_LO <= out["index_b"] < dm.UNVALIDATED_HI
        assert out["unvalidated_regime"] == 1


@pytest.mark.unit
class TestInputScaleWarning:
    def test_non_validated_frame_warns(self, client):
        pts = _circle(CX, CY, 100)
        out = _post(client, {"mask_polygon": pts, "core_polygon": pts,
                             "image_width": W, "image_height": H})
        assert len(out["warnings"]) == 1 and "512x512" in out["warnings"][0]

    def test_pixel_size_warns(self, client):
        pts = _circle(CX, CY, 100)
        out = _post(client, {"mask_polygon": pts, "core_polygon": pts,
                             "image_width": W, "image_height": H, "pixel_size_um": 0.65})
        assert len(out["warnings"]) == 2
        assert any("0.65 um/px" in w for w in out["warnings"])

    def test_validated_frame_and_scale_do_not_warn(self, client):
        big = _circle(1024, 1024, 300)
        out = _post(client, {"mask_polygon": big, "core_polygon": big,
                             "image_width": 2048, "image_height": 2048,
                             "pixel_size_um": 1.28})
        assert out["warnings"] == []
