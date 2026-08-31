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
import time
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

SEG_ROOT = Path(__file__).resolve().parents[1]
if str(SEG_ROOT) not in sys.path:
    sys.path.insert(0, str(SEG_ROOT))

from api import tracker_kymograph  # noqa: E402
from api.tracker_kymograph import router as tracker_kymograph_router  # noqa: E402
from api.tracker_kymograph import (  # noqa: E402
    PolylineInput,
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
    """A polyline near its previous-frame position must inherit the trackId.

    The `embedding` field is still sent here because stored v7 segmentations
    carry one; it must make no difference to the result.
    """
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


def test_track_accepts_and_ignores_legacy_embedding_payloads(client):
    """Segmentations written by the v7 model still carry an `_embedding`, and a
    Node container that has not been recreated yet still forwards it.

    Because the request model is extra='forbid', dropping the field would 400
    both. It must be accepted, ignored, and never reported as degradation —
    even when the payload is outright corrupt, since nothing decodes it now.
    """
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
    # geometry links the (identical) centerlines regardless of the payload
    assert body["assignments"]["A"] == body["assignments"]["A2"]
    assert body["corrupt_count"] == 0
    assert body["degraded"] is False


def test_track_accepts_the_deprecated_weight_fields(client):
    """`emb_template_alpha` is inert but still accepted, for the same
    un-recreated-container reason."""
    poly = _horiz(10, 20)
    r = client.post("/api/v1/track", json={
        "frames": [
            {"frame": 0, "polylines": [{"id": "A", "points_rc": poly}]},
            {"frame": 1, "polylines": [{"id": "A2", "points_rc": poly}]},
        ],
        "emb_template_alpha": 0.25,
    })
    assert r.status_code == 200, r.text
    assert r.json()["assignments"]["A"] == r.json()["assignments"]["A2"]


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


def test_a_far_pair_is_expensive_but_NOT_forbidden():
    """No hard gates — the defect that fragmented tracks 3.14x.

    This function used to return `inf` beyond a displacement threshold and the
    docstring called being un-outbiddable a virtue. On 30 frames of a real
    production video, 25.3% of pairs the embedding tracker called the same
    microtubule exceed that threshold, because the instancer re-traces a
    different EXTENT of the same filament between frames. Rejecting them turned
    133 tracks into 417.

    Cost must still RISE with distance — that is what lets the assignment
    prefer the near pair — but it must stay finite so a good link can win when
    the other terms agree.
    """
    fa = _feat([(0, 0), (0, 20)])
    far = _feat([(0, 400), (0, 420)])
    cost = _filament_cost(fa, far, 1000.0)
    assert np.isfinite(cost), "a far pair must be expensive, not forbidden"
    near = _feat([(2, 0), (2, 20)])
    assert _filament_cost(fa, near, 1000.0) < cost


def test_a_pair_at_the_p90_of_real_links_stays_linkable():
    """Regression for the real-data distribution.

    True links measured on production have a bimodal curve distance: median
    2.35 px but p90 184 px. A cost that forbids the tail severs a quarter of
    them, silently, and every per-track measurement downstream is then computed
    over fragments.
    """
    fa = _feat([(0, c) for c in range(0, 201, 5)])
    shifted = _feat([(184, c) for c in range(0, 201, 5)])
    assert np.isfinite(_filament_cost(fa, shifted, 1000.0))


def test_a_fragment_costs_more_than_the_matching_filament():
    """The fragment case still has to be discriminated — just by PRICE, not by
    veto. A 10 px fragment on a 200 px filament must lose the assignment to the
    filament's own re-detection, which is what
    test_a_short_fragment_does_not_steal_a_long_filaments_track proves
    end-to-end through the LAP."""
    long_mt = _feat([(0, c) for c in range(0, 201, 5)])
    fragment = _feat([(0, 95), (0, 105)])
    redetected = _feat([(1, c) for c in range(0, 201, 5)])
    assert _filament_cost(long_mt, fragment, 1000.0) > _filament_cost(
        long_mt, redetected, 1000.0
    )


def test_degenerate_geometry_is_still_infinite():
    """The one surviving `inf`: a centerline with fewer than two points cannot
    be compared, and a distance of 0 would otherwise read as a perfect match."""
    stub = _feat([(5, 5)])
    real = _feat([(0, c) for c in range(0, 41, 2)])
    assert _filament_cost(real, stub, 1000.0) == float("inf")


def test_filament_cost_rises_with_curve_distance():
    """The primary evidence term: two identical centerlines are cheapest, and
    cost grows as one is displaced."""
    fa = _feat([(0, c) for c in range(0, 41, 2)])
    same = _feat([(0, c) for c in range(0, 41, 2)])
    near = _feat([(3, c) for c in range(0, 41, 2)])
    mid = _feat([(10, c) for c in range(0, 41, 2)])
    c_same = _filament_cost(fa, same, 1000.0)
    c_near = _filament_cost(fa, near, 1000.0)
    c_mid = _filament_cost(fa, mid, 1000.0)
    assert c_same == pytest.approx(0.0, abs=1e-6)
    assert c_same < c_near < c_mid
    assert np.isfinite(c_mid)


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


def test_kymograph_samples_intensity_in_row_col_order(client, monkeypatch):
    """A horizontal polyline through a column-index gradient should
    produce monotonically-increasing intensity in the output CSV. Catches
    accidental row/col swap (would produce uniform output for a
    horizontal line through that gradient)."""
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td).resolve()
        # /kymograph rejects any image_path outside the configured upload
        # storage root (api.tracker_kymograph._UPLOAD_ROOT, a CodeQL
        # path-injection guard — see memory project_codeql_pathinjection_guard).
        # The default root is /app/uploads, which this test's OS temp dir is
        # never a descendant of, and which may not even exist in a test
        # container. Point the guard at this test's own temp dir instead of
        # writing fixtures into the real production uploads directory.
        monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
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


async def test_kymograph_detection_does_not_block_the_event_loop(monkeypatch):
    """Trajectory detection must run OFF the loop, or the whole service stalls.

    ``/kymograph`` is ``async def`` on purpose (see the handler's docstring:
    holding a full-frame float32 array per frame and calling into matplotlib's
    global backend state on 40 threadpool slots is worse than serialising). That
    was free while detection was 0.03-0.2 s of numpy. KymoButler is seconds to
    minutes of torch, and inline it starves the loop for the whole request:
    uvicorn cannot accept ``/segment`` or ``/track``, and the compose
    healthcheck marks ``ml`` unhealthy after ~150 s.

    Measured before the fix, on a real 300-frame kymograph: a 20 Hz poller got
    ZERO responses for the entire 8.5 s request. After it, 15 responses at a
    1 ms median.
    """
    import asyncio

    import httpx
    from PIL import Image as PILImage

    app = FastAPI()
    app.include_router(tracker_kymograph_router, prefix="/api/v1")

    @app.get("/ping")
    async def ping():  # pragma: no cover - trivial
        return {"ok": True}

    # Stand in for KymoButler with something that merely sleeps. This tests the
    # WIRING (is the call awaited off-loop?), not the detector — a real forward
    # pass would need 272 MB of ONNX staged and would make the test minutes long.
    blocking_seconds = 1.0

    def _slow_detect(kymo, **kwargs):
        time.sleep(blocking_seconds)
        return []

    monkeypatch.setattr(tracker_kymograph, "detect_tracks", _slow_detect)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td).resolve()
        monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
        png = td_path / "frame0.png"
        PILImage.fromarray(
            np.zeros((32, 32), dtype=np.uint8), mode="L"
        ).save(png)
        polyline_rc = [[8.0, float(x)] for x in range(0, 32)]
        payload = {
            "frames": [
                {"frame": i, "polyline_rc": polyline_rc, "image_path": str(png)}
                for i in range(4)
            ],
            "target_width": 32,
            "tracked": False,
            "detect_velocity": True,
        }

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://t", timeout=60
        ) as c:
            served = 0
            done = asyncio.Event()

            async def poll():
                nonlocal served
                while not done.is_set():
                    r = await c.get("/ping")
                    assert r.status_code == 200
                    served += 1
                    await asyncio.sleep(0.02)

            poller = asyncio.create_task(poll())
            res = await c.post("/api/v1/kymograph", json=payload)
            done.set()
            await poller

    assert res.status_code == 200, res.text
    # Inline, `served` is 0 — the poller never gets scheduled at all.
    assert served >= 5, (
        f"event loop was starved during detection: only {served} sibling "
        "request(s) served while it ran"
    )


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


# ---------------------------------------------------------------------------
#  Geometric association (post-v5H): no embeddings anywhere in the request
# ---------------------------------------------------------------------------

def _seg(r0, c0, r1, c1, n=40):
    """A straight centerline in (row, col)."""
    return [
        [float(r0 + (r1 - r0) * k / (n - 1)), float(c0 + (c1 - c0) * k / (n - 1))]
        for k in range(n)
    ]


def test_geometric_tracking_keeps_two_filaments_distinct(client):
    """The base case with the embedding gone entirely. Note frame 1 lists the
    filaments in the OPPOSITE order, so a positional fallback would swap them.
    """
    payload = {
        "frames": [
            {"frame": 0, "polylines": [
                {"id": "a0", "points_rc": _seg(0, 0, 0, 100)},
                {"id": "b0", "points_rc": _seg(50, 0, 50, 100)},
            ]},
            {"frame": 1, "polylines": [
                {"id": "b1", "points_rc": _seg(52, 0, 52, 100)},
                {"id": "a1", "points_rc": _seg(2, 0, 2, 100)},
            ]},
        ],
        "image_hw": [512, 512],
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    a = r.json()["assignments"]
    assert a["a0"] == a["a1"], "filament a lost its track"
    assert a["b0"] == a["b1"], "filament b lost its track"
    assert a["a0"] != a["b0"], "two filaments collapsed into one track"
    assert r.json()["track_count"] == 2


def test_geometric_tracking_survives_a_reversed_centerline(client):
    """The instancer's centerline direction is arbitrary and can flip between
    frames. Every geometric term must be direction-invariant or a flip would
    sever the track."""
    fwd = _seg(10, 0, 10, 100)
    payload = {
        "frames": [
            {"frame": 0, "polylines": [{"id": "f0", "points_rc": fwd}]},
            {"frame": 1, "polylines": [{"id": "f1", "points_rc": list(reversed(fwd))}]},
        ],
        "image_hw": [512, 512],
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    a = r.json()["assignments"]
    assert a["f0"] == a["f1"]


def test_stage_drift_does_not_sever_every_track(client):
    """A 30 px common-mode stage shift moves every filament at once, which is
    BEYOND the 25 px association gate. Without drift removal every curve
    distance is inf, the whole field is re-born as new tracks, and every
    microtubule changes colour on a single frame scrub."""
    payload = {
        "frames": [
            {"frame": 0, "polylines": [
                {"id": "h0", "points_rc": _seg(0, 0, 0, 100)},
                {"id": "v0", "points_rc": _seg(0, 0, 100, 0)},
            ]},
            {"frame": 1, "polylines": [
                {"id": "h1", "points_rc": _seg(30, 30, 30, 130)},
                {"id": "v1", "points_rc": _seg(30, 30, 130, 30)},
            ]},
        ],
        "image_hw": [512, 512],
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    a = r.json()["assignments"]
    assert a["h0"] == a["h1"], "horizontal filament lost to drift"
    assert a["v0"] == a["v1"], "vertical filament lost to drift"
    assert r.json()["track_count"] == 2


def test_a_gliding_filament_keeps_its_track(client):
    """A filament sliding ALONG its own axis has ~zero perpendicular
    displacement, so the curve distance barely moves. It must keep its id —
    this is the motility signal the assay exists to measure."""
    payload = {
        "frames": [
            {"frame": 0, "polylines": [{"id": "g0", "points_rc": _seg(10, 0, 10, 100)}]},
            {"frame": 1, "polylines": [{"id": "g1", "points_rc": _seg(10, 8, 10, 108)}]},
        ],
        "image_hw": [512, 512],
    }
    r = client.post("/api/v1/track", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["assignments"]["g0"] == r.json()["assignments"]["g1"]
