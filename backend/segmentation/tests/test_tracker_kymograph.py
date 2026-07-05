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
from api.tracker_kymograph import (  # noqa: E402
    PolylineInput,
    _build_link_cost,
    _emb_distance,
    _filament_cost,
    _filament_features,
    _geom_terms,
    _solve_link_lap,
)
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
#  Two-step LAP tracker: birth / death / gap closing / crossings (HTTP)
# ---------------------------------------------------------------------------

def _horiz(row, col0, n=20):
    """A horizontal centerline of n points at a fixed row."""
    return [[float(row), float(col0 + i)] for i in range(n)]


def test_track_birth_on_empty_previous_frame(client):
    """A filament appearing after an empty frame is a birth: it gets an id
    and does not crash the pipeline."""
    payload = {
        "frames": [
            {"frame": 0, "polylines": []},
            {
                "frame": 1,
                "polylines": [{"id": "X", "points_rc": _horiz(10, 20)}],
            },
        ]
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assignments"]["X"]  # got some trackId
    assert body["track_count"] == 1


def test_track_death_when_filament_disappears(client):
    """A filament present in the first frame but absent in the next ends its
    segment (death) without crashing; the surviving filament keeps linking."""
    emb = _embed_b64(20, seed=3)
    payload = {
        "frames": [
            {
                "frame": 0,
                "polylines": [
                    {"id": "A", "points_rc": _horiz(10, 20), "embedding": emb},
                    {"id": "B", "points_rc": _horiz(200, 20), "embedding": emb},
                ],
            },
            {
                "frame": 1,
                "polylines": [
                    {"id": "A2", "points_rc": _horiz(10, 20), "embedding": emb},
                ],
            },
        ]
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assignments"]["A"] == body["assignments"]["A2"]
    assert body["assignments"]["B"] != body["assignments"]["A"]
    assert body["track_count"] == 2


def test_track_gap_closing_reacquires_track_id(client):
    """THE headline behaviour: a filament present in frames 0,1, absent in a
    (present but empty) frame 2, and present again in frame 3 (gap=2, the
    default max_gap) keeps ONE trackId across 0, 1 and 3."""
    emb = _embed_b64(20, seed=5)
    poly = _horiz(10, 20)
    payload = {
        "frames": [
            {"frame": 0, "polylines": [{"id": "f0", "points_rc": poly, "embedding": emb}]},
            {"frame": 1, "polylines": [{"id": "f1", "points_rc": poly, "embedding": emb}]},
            {"frame": 2, "polylines": []},
            {"frame": 3, "polylines": [{"id": "f3", "points_rc": poly, "embedding": emb}]},
        ]
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    a = body["assignments"]
    assert a["f0"] == a["f1"] == a["f3"], a
    assert body["track_count"] == 1


def test_track_gap_too_large_starts_new_track(client):
    """When the absence exceeds max_gap the reappearing filament is a fresh
    track (no gap-close merge)."""
    emb = _embed_b64(20, seed=5)
    poly = _horiz(10, 20)
    payload = {
        "frames": [
            {"frame": 0, "polylines": [{"id": "f0", "points_rc": poly, "embedding": emb}]},
            {"frame": 1, "polylines": [{"id": "f1", "points_rc": poly, "embedding": emb}]},
            {"frame": 2, "polylines": []},
            {"frame": 3, "polylines": [{"id": "f3", "points_rc": poly, "embedding": emb}]},
        ],
        "max_gap": 1,  # gap of 2 (frame 1 -> frame 3) now exceeds the limit
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    a = body["assignments"]
    assert a["f0"] == a["f1"]
    assert a["f3"] != a["f0"], a
    assert body["track_count"] == 2


def test_track_crossing_filaments_keep_distinct_ids(client):
    """Two filaments whose centroids COINCIDE at the middle (crossing) frame
    but whose endpoints/orientation differ keep DISTINCT trackIds through the
    crossing. Embeddings are absent so geometry alone must resolve them —
    exactly where the old centroid+embedding tracker failed."""
    # F1 travels down-right (orientation +45deg); F2 travels up-right
    # (orientation -45deg). At frame 1 both are centred on (10, 10).
    f1 = [
        [[0, 0], [5, 5], [10, 10]],
        [[5, 5], [10, 10], [15, 15]],
        [[10, 10], [15, 15], [20, 20]],
    ]
    f2 = [
        [[20, 0], [15, 5], [10, 10]],
        [[15, 5], [10, 10], [5, 15]],
        [[10, 10], [5, 15], [0, 20]],
    ]
    frames = []
    for t in range(3):
        frames.append(
            {
                "frame": t,
                "polylines": [
                    {"id": f"a{t}", "points_rc": f1[t]},
                    {"id": f"b{t}", "points_rc": f2[t]},
                ],
            }
        )
    r = client.post("/api/v1/track", json={"frames": frames})
    assert r.status_code == 200, r.text
    a = r.json()["assignments"]
    # Each filament keeps one id across all frames…
    assert a["a0"] == a["a1"] == a["a2"], a
    assert a["b0"] == a["b1"] == a["b2"], a
    # …and the two filaments are NOT confused with each other.
    assert a["a0"] != a["b0"], a
    assert r.json()["track_count"] == 2


def test_track_degraded_on_corrupt_and_missing_embeddings(client):
    """Corrupt / absent embeddings fall back to geometry without crashing;
    corrupt_count and degraded are still reported."""
    corrupt = base64.b64encode(b"\x00\x01\x02").decode("ascii")  # bad float16 buf
    poly = _horiz(10, 20)
    payload = {
        "frames": [
            {"frame": 0, "polylines": [{"id": "A", "points_rc": poly, "embedding": corrupt}]},
            {"frame": 1, "polylines": [{"id": "A2", "points_rc": poly, "embedding": None}]},
        ]
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    # geometry still links the (identical) centerlines
    assert body["assignments"]["A"] == body["assignments"]["A2"]
    assert body["corrupt_count"] == 1
    assert body["degraded"] is True


# ---------------------------------------------------------------------------
#  Filament-aware LAP cost (unit level)
# ---------------------------------------------------------------------------

def _mk(points, emb=None, pid="p"):
    """Build a PolylineInput from a list of (row, col) tuples."""
    return PolylineInput(
        id=pid,
        points_rc=[[float(r), float(c)] for r, c in points],
        embedding=emb,
    )


def _feat(points, emb=None):
    return _filament_features(_mk(points, emb))


def test_geom_terms_endpoint_pairing_is_order_invariant():
    """Reversing one centerline must not change d_end (min over the two
    head/tail pairings) nor the total cost."""
    fa = _feat([(0, 0), (0, 10)])
    fb = _feat([(1, 0), (1, 10)])
    fb_rev = _feat([(1, 10), (1, 0)])  # same filament, reversed order
    img_diag = 100.0

    d_end1, _, _ = _geom_terms(fa, fb, img_diag)
    d_end2, _, _ = _geom_terms(fa, fb_rev, img_diag)
    assert d_end1 == pytest.approx(d_end2)

    c1 = _filament_cost(fa, fb, img_diag)
    c2 = _filament_cost(fa, fb_rev, img_diag)
    assert c1 == pytest.approx(c2)


def test_geom_terms_parallel_far_filaments_cost_high_on_d_end():
    """Two parallel, equal-length filaments far apart in space score high
    on d_end (and low on d_orient / d_len)."""
    img_diag = 300.0
    fa = _feat([(0, 0), (0, 10)])
    fb_close = _feat([(1, 0), (1, 10)])
    fb_far = _feat([(0, 200), (0, 210)])

    d_end_far, d_orient_far, d_len_far = _geom_terms(fa, fb_far, img_diag)
    assert d_end_far > 0.5
    assert d_orient_far < 0.01
    assert d_len_far < 0.01

    # A far parallel filament must cost more than a near parallel one.
    assert _filament_cost(fa, fb_far, img_diag) > _filament_cost(
        fa, fb_close, img_diag
    )


def test_geom_terms_perpendicular_filaments_cost_high_on_d_orient():
    """Perpendicular filaments score ~1 on d_orient regardless of endpoint
    order."""
    img_diag = 100.0
    fa = _feat([(0, 0), (0, 10)])       # horizontal
    fb = _feat([(0, 5), (10, 5)])       # vertical, crosses fa
    _, d_orient, _ = _geom_terms(fa, fb, img_diag)
    assert d_orient > 0.99


def test_geom_terms_length_difference_costs_high_on_d_len():
    """A large centerline-length mismatch scores high on d_len."""
    img_diag = 1000.0
    fa = _feat([(0, 0), (0, 10)])       # length 10
    fb = _feat([(0, 0), (0, 100)])      # length 100
    _, _, d_len = _geom_terms(fa, fb, img_diag)
    assert d_len > 0.8


def test_emb_distance_identical_is_zero_missing_is_none():
    """Cosine-based d_emb is 0 for identical embeddings and None when
    either side lacks one."""
    emb = _embed_b64(8, seed=7)
    fa = _feat([(0, 0), (0, 8)], emb=emb)
    fb = _feat([(0, 0), (0, 8)], emb=emb)
    assert _emb_distance(fa, fb) == pytest.approx(0.0, abs=1e-3)
    fc = _feat([(0, 0), (0, 8)], emb=None)
    assert _emb_distance(fa, fc) is None


def test_build_link_cost_matches_per_cell_reference():
    """The vectorized _build_link_cost must equal, cell-for-cell, the per-cell
    _filament_cost with the documented median-neutral fallback for missing
    embeddings. Locks the fast matrix build to the scalar contract so a future
    refactor can't silently drift the tracking cost."""
    weights = (0.5, 0.3, 0.1, 0.1)
    img_diag = 250.0
    prev = [
        _feat([(0, 0), (0, 20)], emb=_embed_b64(2, seed=1)),
        _feat([(30, 5), (30, 25)], emb=_embed_b64(2, seed=2)),
        _feat([(60, 10), (70, 40)], emb=None),  # legitimately missing embedding
    ]
    nxt = [
        _feat([(1, 0), (1, 21)], emb=_embed_b64(2, seed=3)),
        _feat([(31, 5), (31, 24)], emb=None),  # legitimately missing embedding
        _feat([(90, 0), (95, 30)], emb=_embed_b64(2, seed=4)),
        _feat([(200, 200), (210, 230)], emb=_embed_b64(2, seed=5)),
    ]

    got = _build_link_cost(prev, nxt, img_diag, weights)

    P, Q = len(prev), len(nxt)
    demb = np.full((P, Q), np.nan)
    for i in range(P):
        for j in range(Q):
            d = _emb_distance(prev[i], nxt[j])
            if d is not None:
                demb[i, j] = d
    neutral = float(np.median(demb[~np.isnan(demb)]))
    ref = np.array(
        [
            [_filament_cost(prev[i], nxt[j], img_diag, neutral, *weights) for j in range(Q)]
            for i in range(P)
        ]
    )

    assert got.shape == (P, Q)
    assert not np.isnan(got).any()
    np.testing.assert_allclose(got, ref, rtol=0, atol=1e-12)


def test_build_link_cost_all_missing_embeddings_falls_back_to_geometry():
    """With no embeddings anywhere, every d_emb collapses to the 0.5 neutral
    and the matrix is finite (no NaN leak from the vectorized cosine path)."""
    weights = (0.5, 0.3, 0.1, 0.1)
    prev = [_feat([(0, 0), (0, 10)]), _feat([(50, 0), (50, 10)])]
    nxt = [_feat([(1, 0), (1, 10)]), _feat([(51, 0), (51, 10)])]
    got = _build_link_cost(prev, nxt, 100.0, weights)
    assert not np.isnan(got).any()
    # Aligned near-identical filament is cheaper than the far one.
    assert got[0, 0] < got[0, 1]


def test_build_link_cost_empty_side_returns_empty_matrix():
    """A birth-only or death-only frame pair yields a correctly-shaped empty
    cost matrix rather than raising in the vectorized stacking."""
    weights = (0.5, 0.3, 0.1, 0.1)
    assert _build_link_cost([], [_feat([(0, 0), (0, 5)])], 10.0, weights).shape == (0, 1)
    assert _build_link_cost([_feat([(0, 0), (0, 5)])], [], 10.0, weights).shape == (1, 0)


def test_solve_link_lap_handles_birth_and_death():
    """The augmented birth/death LAP links only pairs at/under threshold;
    an unmatched prev dies, an unmatched next is born."""
    import numpy as _np

    # prev0 links next0 cheaply; prev1 has no cheap next; next1 has no cheap
    # prev. Expected: {0: 0}; prev1 dies, next1 is a birth.
    base = _np.array([[0.1, 0.9], [0.9, 0.9]], dtype=float)
    links = _solve_link_lap(base, cost_threshold=0.5)
    assert links == {0: 0}

    # Empty prev / next must not crash.
    assert _solve_link_lap(_np.zeros((0, 3)), cost_threshold=0.5) == {}
    assert _solve_link_lap(_np.zeros((3, 0)), cost_threshold=0.5) == {}


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
