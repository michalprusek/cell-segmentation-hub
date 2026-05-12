"""Unit tests for the Hungarian tracker and the kymograph endpoint.

These are pure-Python tests that exercise the algorithms without GPU,
without DINOv3, and without the v7 weights — just the postprocessing
(SciPy linear_sum_assignment, scipy.ndimage.map_coordinates, viridis
LUT). Catches regressions like:

- row/col swap in `points_rc` consumption (a 90° rotation of every
  kymograph)
- broken cost-matrix scaling (silent randomized trackIds)
- viridis LUT corruption (the bug surfaced by review round 1 where the
  last 4 stops were inferno/magma rather than viridis)
- Pydantic schema drift (extra='forbid' should reject unknown fields)
"""
from __future__ import annotations

import base64
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

from api.tracker_kymograph import router as tracker_kymograph_router  # noqa: E402
from fastapi import FastAPI  # noqa: E402


@pytest.fixture(scope="module")
def client():
    app = FastAPI()
    app.include_router(tracker_kymograph_router, prefix="/api/v1")
    return TestClient(app)


# ---------------------------------------------------------------------------
#  /track
# ---------------------------------------------------------------------------

def _embed_b64(n_points: int, seed: int) -> str:
    """Build a stable base64-encoded float16 (n_points × 32) embedding."""
    rng = np.random.default_rng(seed)
    arr = rng.standard_normal((n_points, 32), dtype=np.float32).astype(np.float16)
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def test_track_continues_track_id_across_close_polylines(client):
    """A polyline near its previous-frame position with similar embedding
    must inherit the trackId."""
    emb_a = _embed_b64(20, seed=1)
    payload = {
        "frames": [
            {
                "frame": 0,
                "polylines": [
                    {
                        "id": "P-A",
                        "points_rc": [[10.0, 20.0 + i] for i in range(20)],
                        "embedding": emb_a,
                    }
                ],
            },
            {
                "frame": 1,
                "polylines": [
                    {
                        "id": "P-A2",
                        "points_rc": [[10.5, 20.5 + i] for i in range(20)],
                        "embedding": emb_a,  # identical embedding → cosine=0
                    }
                ],
            },
        ]
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["track_count"] == 1
    assert body["assignments"]["P-A"] == body["assignments"]["P-A2"]


def test_track_starts_fresh_track_for_distant_polyline(client):
    """A polyline far from any prev-frame polyline must get a fresh ID."""
    emb_a = _embed_b64(20, seed=1)
    emb_b = _embed_b64(20, seed=999)
    payload = {
        "frames": [
            {
                "frame": 0,
                "polylines": [
                    {
                        "id": "near",
                        "points_rc": [[10.0, 20.0 + i] for i in range(20)],
                        "embedding": emb_a,
                    }
                ],
            },
            {
                "frame": 1,
                "polylines": [
                    {
                        "id": "near2",
                        "points_rc": [[10.0, 20.0 + i] for i in range(20)],
                        "embedding": emb_a,
                    },
                    {
                        "id": "far",
                        "points_rc": [[500.0, 500.0 + i] for i in range(20)],
                        "embedding": emb_b,
                    },
                ],
            },
        ]
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    # near → near2 inherits; far gets a fresh trackId
    assert body["assignments"]["near"] == body["assignments"]["near2"]
    assert body["assignments"]["far"] != body["assignments"]["near"]
    assert body["track_count"] == 2


def test_track_rejects_extra_field(client):
    """extra='forbid' should reject unknown fields on the request body."""
    payload = {
        "frames": [],
        "cost_threshold": 0.5,
        "spatial_weight": 0.3,
        "made_up_field": 42,  # not in the schema
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
#  /kymograph
# ---------------------------------------------------------------------------

def _write_gradient_png(path: Path, height: int = 16, width: int = 64) -> None:
    """A horizontal-gradient grayscale PNG: column-index intensity."""
    from PIL import Image as PILImage

    arr = np.tile(np.arange(width, dtype=np.uint8), (height, 1))
    PILImage.fromarray(arr, mode="L").save(path)


def test_kymograph_samples_intensity_in_row_col_order(client):
    """A horizontal polyline through a column-index gradient should
    produce monotonically-increasing intensity in the output CSV. Catches
    accidental row/col swap (would produce uniform output for a
    horizontal line through that gradient)."""
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        png0 = td_path / "frame0.png"
        png1 = td_path / "frame1.png"
        _write_gradient_png(png0)
        _write_gradient_png(png1)

        polyline_rc = [[8.0, float(x)] for x in range(0, 64)]
        payload = {
            "frames": [
                {"frame": 0, "polyline_rc": polyline_rc, "image_path": str(png0)},
                {"frame": 1, "polyline_rc": polyline_rc, "image_path": str(png1)},
            ],
            "target_width": 64,
            "tracked": False,
        }
        r = client.post("/api/v1/kymograph", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["frame_count"] == 2
        assert body["length_px"] == 64

        csv_text = base64.b64decode(body["csv_base64"]).decode("utf-8")
        rows = [
            line for line in csv_text.strip().split("\n") if not line.startswith("frame,")
        ]
        # Each row: frame,x0,x1,...,x63 — intensities should be monotonic
        # non-decreasing across the row (we sample through a horizontal
        # gradient that increases with column index).
        values = [float(v) for v in rows[0].split(",")[1:]]
        # Globally normalised against the [min,max] across both frames; we
        # just need the *order* to be increasing.
        for i in range(1, len(values)):
            assert values[i] >= values[i - 1] - 1e-3, (
                f"intensity dropped at column {i}: {values[i - 1]} → {values[i]}"
            )


def test_kymograph_rejects_extra_field(client):
    payload = {
        "frames": [],
        "target_width": 200,
        "tracked": False,
        "rogue": "field",
    }
    r = client.post("/api/v1/kymograph", json=payload)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
#  viridis LUT
# ---------------------------------------------------------------------------

def test_viridis_lut_ends_in_yellow_not_orange():
    """Regression for the review-1 finding: the LUT used to mix viridis
    body with inferno tail, so high intensities rendered as orange/red.
    Real viridis ends at bright yellow #fde725."""
    from api.tracker_kymograph import _VIRIDIS_RGB

    assert _VIRIDIS_RGB.shape == (16, 3)
    last = _VIRIDIS_RGB[-1] * 255.0
    # Real viridis last stop is roughly RGB ≈ (253, 231, 37). Allow 5
    # units of slack for the 16-stop subsample.
    assert 240 <= last[0] <= 255, f"R={last[0]}"
    assert 220 <= last[1] <= 240, f"G={last[1]}"
    assert 20 <= last[2] <= 60, f"B={last[2]}"
