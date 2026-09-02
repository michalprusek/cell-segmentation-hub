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

import asyncio
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


def test_kymograph_measures_every_trajectory_against_a_neighbour_free_ring(
    client, monkeypatch
):
    """The route must hand ALL trajectories to the intensity measurement at once.

    A trajectory's background ring is its band dilated by
    ``intensity_width * intensity_bg_margin`` MINUS the union of every
    trajectory's band, exactly as a microtubule's is. That union is only
    available if the route measures the whole kymograph in one call — measuring
    one track at a time silently reintroduces the bug this replaced, because
    each ring would then exclude nothing but its own band.

    The fixture is three parallel streaks 6 columns apart on a flat field, i.e.
    ordinary traffic, each exactly as wide as the default ``intensity_width``
    (5) so the band is pure signal. The default ``intensity_bg_margin`` of 2.0
    puts the ring 10 columns out, which reaches both neighbours. Measured
    together the middle one's background is the field (40): the ring is 14-38
    minus the union {18-22, 24-28, 30-34}, i.e. ten columns of empty field.
    Measured alone the ring is 14-38 minus only its own band — ten field
    columns and ten neighbour columns, so the ImageJ tie-rule median (the UPPER
    of the two central values) lands on the neighbour (200) and a streak 5x
    brighter than the field reports ZERO contrast. So the assertion below fails
    loudly on a per-track regression rather than drifting a few percent.
    """
    from PIL import Image as PILImage

    cols, field, bright, width, T = (20, 26, 32), 40, 200, 60, 20
    half = 2  # streaks 2*half+1 = 5 columns wide, matching intensity_width

    def _stub_detect(kymo, **kwargs):
        return [
            {
                "points": [[t, float(c)] for t in range(T)],
                "net_pxframe": 0.0,
                "snr": 5.0,
                "total_run_time_frames": 0.0,
                "total_run_displacement_px": 0.0,
            }
            for c in cols
        ]

    monkeypatch.setattr(tracker_kymograph, "detect_tracks", _stub_detect)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td).resolve()
        monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
        row = np.full(width, field, dtype=np.uint8)
        for c in cols:
            row[c - half:c + half + 1] = bright
        png = td_path / "frame.png"
        PILImage.fromarray(np.tile(row, (16, 1)), mode="L").save(png)

        polyline_rc = [[8.0, float(x)] for x in range(width)]
        r = client.post(
            "/api/v1/kymograph",
            json={
                "frames": [
                    {"frame": t, "polyline_rc": polyline_rc,
                     "image_path": str(png)}
                    for t in range(T)
                ],
                "target_width": width,
                "detect_velocity": True,
            },
        )
    assert r.status_code == 200, r.text
    tracks = r.json()["tracks"]
    assert len(tracks) == 3
    for tr in tracks:
        assert tr["intensity_signal"] == float(bright)
        assert tr["intensity_background"] == float(field)
        assert tr["intensity_minus_bg"] == float(bright - field)


def test_the_intensity_floor_reaches_the_filter_through_the_endpoint(
    client, monkeypatch
):
    """The floor drops the dim streak, keeps the bright one, counts what it did
    — and does not disturb what the survivor measured.

    Two mutation checks, both of which the pure-helper tests miss because they
    call `filter_dim_tracks` directly:

    * Re-add `polarity=polarity` to the call at the filter site. On this
      DARK-ON-BRIGHT fixture the endpoint then signs an already-signed value
      and every trajectory disappears — the bug this endpoint shipped with.
    * Move the filter above `tracks_intensity`. The background ring is the
      union of every trajectory's band, so the survivor is then measured as if
      its dropped neighbour were empty field and `intensity_background` moves.
    """
    from PIL import Image as PILImage

    field, dim, brightest, width, T = 200, 170, 60, 60, 20
    cols = (20, 40)
    half = 2

    def _stub_detect(kymo, **kwargs):
        return [
            {
                "points": [[t, float(c)] for t in range(T)],
                "net_pxframe": 0.0,
                "snr": 5.0,
                "total_run_time_frames": 0.0,
                "total_run_displacement_px": 0.0,
            }
            for c in cols
        ]

    monkeypatch.setattr(tracker_kymograph, "detect_tracks", _stub_detect)

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td).resolve()
        monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
        # A bright field with two DARK streaks of different depth, so the
        # kymograph's polarity is -1 and the floor has to survive that.
        row = np.full(width, field, dtype=np.uint8)
        row[cols[0] - half : cols[0] + half + 1] = dim
        row[cols[1] - half : cols[1] + half + 1] = brightest
        png = td_path / "frame.png"
        PILImage.fromarray(np.tile(row, (16, 1)), mode="L").save(png)

        polyline_rc = [[8.0, float(x)] for x in range(width)]
        frames = [
            {"frame": t, "polyline_rc": polyline_rc, "image_path": str(png)}
            for t in range(T)
        ]

        def post(**extra):
            r = client.post(
                "/api/v1/kymograph",
                json={"frames": frames, "detect_velocity": True, **extra},
            )
            assert r.status_code == 200, r.text
            return r.json()

        unfiltered = post()
        # Contrast above background, positive on this inverted kymograph.
        contrasts = sorted(t["intensity_minus_bg"] for t in unfiltered["tracks"])
        assert len(contrasts) == 2
        assert all(c > 0 for c in contrasts), contrasts
        assert unfiltered["filtered_dim_track_count"] == 0

        floor = (contrasts[0] + contrasts[1]) / 2
        filtered = post(min_intensity_minus_bg=floor)

    assert len(filtered["tracks"]) == 1
    assert filtered["filtered_dim_track_count"] == 1
    survivor = filtered["tracks"][0]
    assert survivor["intensity_minus_bg"] == contrasts[1]
    # Measured before the filter ran, so dropping its neighbour changed nothing.
    before = max(unfiltered["tracks"], key=lambda t: t["intensity_minus_bg"])
    assert survivor["intensity_signal"] == before["intensity_signal"]
    assert survivor["intensity_background"] == before["intensity_background"]


def test_the_intensity_floor_is_off_by_default(client, monkeypatch):
    """An omitted floor must leave the response exactly as it was."""
    from PIL import Image as PILImage

    monkeypatch.setattr(
        tracker_kymograph,
        "detect_tracks",
        lambda kymo, **kwargs: [
            {
                "points": [[t, 20.0] for t in range(8)],
                "net_pxframe": 0.0,
                "snr": 5.0,
                "total_run_time_frames": 0.0,
                "total_run_displacement_px": 0.0,
            }
        ],
    )
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td).resolve()
        monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
        row = np.full(40, 200, dtype=np.uint8)
        row[18:23] = 60
        png = td_path / "frame.png"
        PILImage.fromarray(np.tile(row, (16, 1)), mode="L").save(png)
        polyline_rc = [[8.0, float(x)] for x in range(40)]
        r = client.post(
            "/api/v1/kymograph",
            json={
                "frames": [
                    {"frame": t, "polyline_rc": polyline_rc, "image_path": str(png)}
                    for t in range(8)
                ],
                "detect_velocity": True,
            },
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["tracks"]) == 1
    assert body["filtered_dim_track_count"] == 0


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


# ---------------------------------------------------------------------------
#  /kymograph sampled-row cache + threadpool hop
# ---------------------------------------------------------------------------
#
# Why these exist. Measured on a real 300-frame production container
# (CH5_DO4 / 4972cad8, 1924x1476 16-bit PNGs), one kymograph read 1267 MB off
# disk to use 200 pixels per frame — a 14 199x read amplification — and spent
# 99% of its 9.6 s sampling loop inside the PNG decoder, on the event loop,
# where it blocked GET /health for 10.24 s against a healthcheck that times out
# at 10 s. The fix caches the sampled ROW (233 KB per request, against 3.4 GB
# for the decoded frames), decodes misses on a small thread pool, and runs the
# whole body on a one-slot executor.
#
# A cache that returns a stale or misaligned kymograph is far worse than a slow
# one, so most of what follows is about the key, not about speed.


@pytest.fixture(autouse=True)
def _empty_sample_cache():
    """The row cache is a module singleton: without this, one test's entries
    make the next test's "cold" run warm, and every decode-count assertion
    below becomes order-dependent."""
    tracker_kymograph._SAMPLE_CACHE.clear()
    yield
    tracker_kymograph._SAMPLE_CACHE.clear()


def _write_constant_png(path: Path, value: int, height: int = 16,
                        width: int = 64) -> None:
    """A flat grayscale PNG, so a row sampled from it is identifiable."""
    from PIL import Image as PILImage

    arr = np.full((height, width), value, dtype=np.uint8)
    PILImage.fromarray(arr, mode="L").save(path)


def _write_2d_ramp_png(path: Path, height: int = 16, width: int = 64) -> None:
    """``value = 4*row + col``: unlike the horizontal gradient, two horizontal
    polylines at DIFFERENT rows read different intensities from it. Needed to
    separate the cache key's geometry digest from its ``n_samples``, which two
    polylines of equal length share."""
    from PIL import Image as PILImage

    rows = np.arange(height, dtype=np.uint8)[:, None] * 4
    cols = np.arange(width, dtype=np.uint8)[None, :]
    PILImage.fromarray((rows + cols).astype(np.uint8), mode="L").save(path)


def _kymo_payload(pngs, polyline_rc, **overrides):
    # ``target_width`` is deliberately still sent: it has been accepted-and-
    # ignored since 2026-09-01 (Node no longer sends it, older Node containers
    # still do), and every test that posts this body is a regression guard that
    # the field has not been deleted from the ``extra="forbid"`` model.
    payload = {
        "frames": [
            {"frame": i, "polyline_rc": polyline_rc, "image_path": str(p)}
            for i, p in enumerate(pngs)
        ],
        "target_width": 64,
        "tracked": False,
    }
    payload.update(overrides)
    return payload


def _row_job(path, pts, n_samples: int):
    """One ``_RowJob`` for a direct ``_sample_frame_rows`` call. The keys are
    dummies: only the endpoint uses them, and only to group and to cache."""
    return tracker_kymograph._RowJob(
        item=0,
        row=0,
        path=path,
        file_key=(0, 0, 0, 0),
        pts=np.asarray(pts, dtype=np.float32),
        n_samples=n_samples,
        cache_key=(0, 0, 0, 0, n_samples, b""),
    )


def _count_decodes(monkeypatch) -> dict:
    """Count frame decodes. ``PIL.Image.open`` is reached ONLY by
    ``_sample_frame_row``; the response PNG is written with ``fromarray``."""
    from PIL import Image as PILImage

    counter = {"n": 0}
    real_open = PILImage.open

    def counting_open(*args, **kwargs):
        counter["n"] += 1
        return real_open(*args, **kwargs)

    monkeypatch.setattr(PILImage, "open", counting_open)
    return counter


def _csv_rows(body) -> list:
    text = base64.b64decode(body["csv_base64"]).decode("utf-8")
    return [
        line.split(",")
        for line in text.strip().split("\n")
        if not line.startswith("frame,")
    ]


def test_kymograph_warm_request_is_byte_identical_and_decodes_nothing(
    client, monkeypatch, tmp_path
):
    """The whole point: a repeat of the same geometry must skip the decode and
    return the SAME bytes. Measured on the 299-frame container: 10.44 s ->
    0.033 s, with the same SHA-256 for the response PNG and CSV."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    pngs = [td_path / f"f{i}.png" for i in range(3)]
    for p in pngs:
        _write_gradient_png(p)
    payload = _kymo_payload(pngs, [[8.0, float(x)] for x in range(64)])

    decodes = _count_decodes(monkeypatch)
    first = client.post("/api/v1/kymograph", json=payload)
    assert first.status_code == 200, first.text
    assert decodes["n"] == 3, "cold request should decode every frame once"

    second = client.post("/api/v1/kymograph", json=payload)
    assert second.status_code == 200, second.text
    assert decodes["n"] == 3, "warm request re-decoded frames"
    assert second.json() == first.json(), "warm response differs from cold"


def test_kymograph_cache_misses_when_a_frame_is_rewritten_in_place(
    client, monkeypatch, tmp_path
):
    """Frame PNGs are NOT immutable. ``drift_correction.correct_drift_in_place``
    rewrites every frame on disk after extraction (and ``add_channel_align``
    writes new ones), so a cache keyed on the path alone would serve
    pre-correction intensities forever. The key carries st_mtime_ns and st_size
    for exactly this."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_constant_png(png, 40)
    payload = _kymo_payload([png], [[8.0, float(x)] for x in range(64)])

    before = client.post("/api/v1/kymograph", json=payload)
    assert before.status_code == 200, before.text
    identity_before = (png.stat().st_mtime_ns, png.stat().st_size)
    assert float(_csv_rows(before.json())[0][1]) == 40.0

    # Same path, new pixels — the de-drift rewrite, minus the shift.
    _write_constant_png(png, 200)
    identity_after = (png.stat().st_mtime_ns, png.stat().st_size)
    assert identity_after != identity_before, (
        "precondition: the filesystem must report the rewrite in "
        "(st_mtime_ns, st_size); it did not, so this test cannot prove anything"
    )

    after = client.post("/api/v1/kymograph", json=payload)
    assert after.status_code == 200, after.text
    assert float(_csv_rows(after.json())[0][1]) == 200.0, (
        "served the pre-rewrite intensities from cache"
    )


def test_kymograph_cache_misses_on_a_different_polyline(
    client, monkeypatch, tmp_path
):
    """Same frame, different microtubule. The geometry digest is what keeps
    the second MT from inheriting the first one's row.

    The two polylines are deliberately the SAME LENGTH, so they share
    ``n_samples`` and the digest is the only thing separating them. An earlier
    version of this test used polylines of different lengths and survived
    deleting the digest outright — the mutation run is what caught that."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_2d_ramp_png(png)

    row_8 = [[8.0, float(x)] for x in range(64)]
    row_12 = [[12.0, float(x)] for x in range(64)]
    first = client.post("/api/v1/kymograph", json=_kymo_payload([png], row_8))
    second = client.post("/api/v1/kymograph", json=_kymo_payload([png], row_12))
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["length_px"] == second.json()["length_px"] == 64

    # value = 4*row + col, so row 8 reads 32..95 and row 12 reads 48..111.
    assert [float(v) for v in _csv_rows(first.json())[0][1:]] == [
        32.0 + x for x in range(64)
    ]
    assert [float(v) for v in _csv_rows(second.json())[0][1:]] == [
        48.0 + x for x in range(64)
    ]


def test_kymograph_cache_misses_when_n_samples_changes(
    client, monkeypatch, tmp_path
):
    """``n_samples`` earns its place in the row-cache key even though it is a
    pure function of geometry — because it is a function of the SEED frame's
    geometry, not of the row's own.

    Frame 1 carries a byte-identical polyline in both requests, so its file
    identity and its geometry digest are identical. Only frame 0 differs, and
    only in length. The row for frame 1 must still be re-sampled: the two
    requests want it at 64 and at 32 columns.

    Mutation check: drop ``n_samples`` from ``cache_key`` in ``_plan_rows`` and
    the second request either serves a 64-wide row into a 32-wide kymograph or
    re-decodes nothing — either way ``decodes["n"]`` stays 1 and this fails."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    f0 = td_path / "f0.png"
    f1 = td_path / "f1.png"
    _write_gradient_png(f0)
    _write_gradient_png(f1)
    shared = [[8.0, float(x)] for x in range(64)]

    def payload(seed_len):
        return {
            "frames": [
                {
                    "frame": 0,
                    "polyline_rc": [[4.0, float(x)] for x in range(seed_len)],
                    "image_path": str(f0),
                },
                {"frame": 1, "polyline_rc": shared, "image_path": str(f1)},
            ],
            "tracked": False,
        }

    decodes = _count_decodes(monkeypatch)
    wide = client.post("/api/v1/kymograph", json=payload(64))
    assert wide.status_code == 200, wide.text
    assert wide.json()["length_px"] == 64
    assert decodes["n"] == 2

    # Same request again: both rows are cache hits, nothing re-decodes.
    again = client.post("/api/v1/kymograph", json=payload(64))
    assert again.status_code == 200, again.text
    assert again.json()["length_px"] == 64
    assert decodes["n"] == 2, "re-decoded for an identical request"

    # Shorter SEED polyline -> 32 columns. Frame 1's own geometry has not
    # changed, so only ``n_samples`` can keep its row out of the cache.
    narrow = client.post("/api/v1/kymograph", json=payload(32))
    assert narrow.status_code == 200, narrow.text
    assert narrow.json()["length_px"] == 32
    assert decodes["n"] == 4, "served 64-sample rows into a 32-sample kymograph"


def test_kymograph_column_count_is_one_per_pixel_of_arc_and_uncapped(
    client, monkeypatch, tmp_path
):
    """THE rule, and the change of 2026-09-01: one column per pixel of the seed
    polyline's arc length, with no ceiling.

    600 px is past the old default cap of 200 and past the 33 % of real
    microtubules that used to be squeezed by it. ``target_width`` is sent (an
    un-recreated Node still sends it) and must be ignored: 20 would once have
    clamped this to 20 columns.

    Mutation check: restore ``min(..., req.target_width)`` in ``_seed_columns``
    / ``_plan_kymograph`` and ``length_px`` drops to 20."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png, height=16, width=700)

    long_line = [[8.0, 0.0], [8.0, 600.0]]
    r = client.post(
        "/api/v1/kymograph",
        json={
            "frames": [
                {"frame": 0, "polyline_rc": long_line, "image_path": str(png)}
            ],
            "tracked": False,
            "target_width": 20,
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["length_px"] == 601, "the column cap is back"
    # One column per image pixel, so the axis is an identity to within the
    # rounding of round(arc)+1.
    assert body["px_per_column"] == pytest.approx(1.0, abs=1e-6)


def test_kymograph_rows_stay_aligned_with_frames(client, monkeypatch, tmp_path):
    """Misses are decoded on a thread pool while degenerate frames are filled
    in place, so row order is no longer the loop's order of arrival. Row i MUST
    still be frame i — a shifted row axis would relabel every velocity and
    every CSV line while looking perfectly plausible."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    values = [10, 60, 110, 160, 210]
    pngs = []
    for i, v in enumerate(values):
        p = td_path / f"f{i}.png"
        _write_constant_png(p, v)
        pngs.append(p)

    polyline_rc = [[8.0, float(x)] for x in range(64)]
    payload = _kymo_payload(pngs, polyline_rc)
    # Frame 2's polyline collapses to a single point: it takes the zero-fill
    # branch and never reaches the pool.
    payload["frames"][2]["polyline_rc"] = [[8.0, 8.0]]

    r = client.post("/api/v1/kymograph", json=payload)
    assert r.status_code == 200, r.text
    rows = _csv_rows(r.json())
    assert [row[0] for row in rows] == ["0", "1", "2", "3", "4"]
    expected = [10.0, 60.0, 0.0, 160.0, 210.0]
    assert [float(row[1]) for row in rows] == expected
    assert [float(row[-1]) for row in rows] == expected


def test_kymograph_missing_frame_still_404s(client, monkeypatch, tmp_path):
    """Validation stays serial and in request order, so a missing frame names
    itself the way it always did instead of surfacing as a pool exception."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    gone = td_path / "f1.png"
    payload = _kymo_payload([png, gone], [[8.0, float(x)] for x in range(64)])

    r = client.post("/api/v1/kymograph", json=payload)
    assert r.status_code == 404, r.text
    assert "f1.png" in r.json()["detail"]


def test_kymograph_include_csv_defaults_to_building_it(client, monkeypatch, tmp_path):
    """Backward compatibility: a caller that never heard of ``include_csv``
    must get exactly today's response. Both models are ``extra='forbid'``, so
    the field had to be additive and defaulted in the safe direction."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    payload = _kymo_payload([png], [[8.0, float(x)] for x in range(64)])

    r = client.post("/api/v1/kymograph", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["csv_base64"], "omitting include_csv dropped the CSV"


def test_kymograph_include_csv_false_omits_only_the_csv(
    client, monkeypatch, tmp_path
):
    """The CSV was 626 KB of the 780 KB response on the 299-frame container,
    and the modal only reads it when the user clicks download."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    polyline_rc = [[8.0, float(x)] for x in range(64)]

    full = client.post("/api/v1/kymograph", json=_kymo_payload([png], polyline_rc))
    lean = client.post(
        "/api/v1/kymograph",
        json=_kymo_payload([png], polyline_rc, include_csv=False),
    )
    assert full.status_code == 200 and lean.status_code == 200, lean.text
    # None, not "" — an empty string would download as a zero-byte file.
    assert lean.json()["csv_base64"] is None
    assert lean.json()["png_base64"] == full.json()["png_base64"]
    assert lean.json()["frame_count"] == full.json()["frame_count"]
    assert lean.json()["length_px"] == full.json()["length_px"]


def test_kymograph_intensity_width_defaults_to_five(client, monkeypatch, tmp_path):
    """The band width the caller does not send is the one every export uses, so
    the default is what actually decides ``intensity_signal`` /
    ``intensity_background`` / ``intensity_minus_background`` in
    ``velocity_metrics.xlsx``. Raised 3 -> 5 on 2026-09-01.

    Tests the WIRING — the value that reaches ``tracks_intensity`` — not the
    field's declared default, because the field is only correct if it is the
    argument that is passed. The ring margin rides along on the same call for
    the same reason: ``intensity_bg_margin`` is a MULTIPLE of this width, so a
    default that never arrives would resize the background too.

    Mutation check: set either field back and the recorded pair changes."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)

    monkeypatch.setattr(
        tracker_kymograph,
        "detect_tracks",
        lambda kymo, **kw: [
            {"points": [[0.0, 30.0], [1.0, 31.0]], "net_pxframe": 1.0, "snr": 3.0}
        ],
    )
    seen: list = []
    real_tracks_intensity = tracker_kymograph.tracks_intensity

    def recording(kymo, point_lists, width, **kw):
        seen.append((width, kw.get("margin_multiplier")))
        return real_tracks_intensity(kymo, point_lists, width, **kw)

    monkeypatch.setattr(tracker_kymograph, "tracks_intensity", recording)

    polyline_rc = [[8.0, float(x)] for x in range(64)]
    r = client.post(
        "/api/v1/kymograph",
        json={
            "frames": [
                {"frame": i, "polyline_rc": polyline_rc, "image_path": str(png)}
                for i in range(2)
            ],
            "tracked": False,
            "detect_velocity": True,
        },
    )
    assert r.status_code == 200, r.text
    # ONE call for all trajectories, carrying both defaults.
    assert seen == [(5, 2.0)], f"(width, margin) reaching tracks_intensity: {seen}"


async def test_kymograph_leaves_the_event_loop_free(monkeypatch, tmp_path):
    """The handler used to run its whole blocking body on the event loop. On a
    real 299-frame container that held GET /health for 10.24 s, against the
    compose healthcheck's 10 s timeout; with the one-slot executor the worst
    /health latency measured during the same request was 27.6 ms."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    pngs = []
    for i in range(8):
        p = td_path / f"f{i}.png"
        _write_gradient_png(p)
        pngs.append(p)

    real_sample = tracker_kymograph._sample_frame_rows

    def slow_sample(path, jobs):
        time.sleep(0.05)
        return real_sample(path, jobs)

    monkeypatch.setattr(tracker_kymograph, "_sample_frame_rows", slow_sample)

    ticks = 0

    async def ticker():
        nonlocal ticks
        while True:
            ticks += 1
            await asyncio.sleep(0.005)

    tick_task = asyncio.ensure_future(ticker())
    try:
        req = tracker_kymograph.KymographRequest(
            **_kymo_payload(pngs, [[8.0, float(x)] for x in range(64)])
        )
        resp = await tracker_kymograph.kymograph(req)
    finally:
        tick_task.cancel()

    assert resp.frame_count == 8
    assert ticks > 5, f"the event loop was blocked; only {ticks} tick(s) ran"


def test_sampled_row_cache_evicts_least_recently_used_within_its_budget():
    """An unbounded cache on the container that also runs seven segmentation
    models is a production incident. The budget is in BYTES, and the
    bookkeeping counts too: a 200-column row is 800 B and its
    OrderedDict/key/ndarray overhead is a measured 392 B, so an entry-count
    budget would under-report the cache by a third."""
    entry = 200 * 4 + tracker_kymograph._ENTRY_OVERHEAD_BYTES
    cache = tracker_kymograph._SampledRowCache(budget_bytes=4 * entry)

    def row():
        return np.zeros(200, dtype=np.float32)

    for i in range(4):
        cache.put((i,), row())
    assert cache.stats()["entries"] == 4
    assert cache.stats()["evictions"] == 0

    # Touch the oldest so it is no longer the eviction candidate.
    assert cache.get((0,)) is not None
    cache.put((99,), row())

    stats = cache.stats()
    assert stats["entries"] == 4
    assert stats["bytes"] <= stats["budget_bytes"]
    assert stats["evictions"] == 1
    assert cache.get((0,)) is not None, "evicted the most recently used entry"
    assert cache.get((1,)) is None, "kept an entry past the budget"


def test_sampled_row_cache_refuses_an_entry_larger_than_its_whole_budget():
    """A row wider than the budget must be dropped rather than evicting the
    entire cache to make room for something that still will not fit."""
    cache = tracker_kymograph._SampledRowCache(budget_bytes=2000)
    cache.put(("small",), np.zeros(100, dtype=np.float32))
    cache.put(("huge",), np.zeros(100_000, dtype=np.float32))
    stats = cache.stats()
    assert cache.get(("huge",)) is None
    assert cache.get(("small",)) is not None, "a too-large entry flushed the cache"
    assert stats["bytes"] <= stats["budget_bytes"]


def test_sampled_rows_are_frozen_against_accidental_writes(tmp_path):
    """A cached row is shared by every later request that hits the same key,
    so a write through one would silently corrupt all of them. The row comes
    back read-only, which turns that into an exception at the write."""
    png = tmp_path / "f0.png"
    _write_gradient_png(png)
    (row,) = tracker_kymograph._sample_frame_rows(
        png, [_row_job(png, [[8.0, 0.0], [8.0, 63.0]], 64)]
    )
    assert row.flags.writeable is False
    with pytest.raises(ValueError):
        row[0] = 1.0


def test_decode_keeps_the_previous_frame_alive_per_thread(tmp_path):
    """``_DECODE_SCRATCH.previous_frame`` looks like a useless assignment and
    is not: it holds one decoded frame per decode thread so the next frame is
    allocated while the previous block is still live, which is what stops glibc
    returning 11 MB to the kernel between frames and re-faulting all 2775 pages
    of the next one.

    Measured over 299 real frames, deleting it costs 822 839 minor faults and
    1.74 s of system time per request, against 5 312 faults and 0.24 s for the
    loop this code replaced. A fault count is too flaky to assert directly, so
    this pins the reference that produces it."""
    png = tmp_path / "f0.png"
    _write_gradient_png(png, height=16, width=64)
    if hasattr(tracker_kymograph._DECODE_SCRATCH, "previous_frame"):
        del tracker_kymograph._DECODE_SCRATCH.previous_frame

    tracker_kymograph._sample_frame_rows(
        png, [_row_job(png, [[8.0, 0.0], [8.0, 63.0]], 64)]
    )

    held = getattr(tracker_kymograph._DECODE_SCRATCH, "previous_frame", None)
    assert held is not None, "the decoded frame was released at return"
    assert held.shape == (16, 64)
    del tracker_kymograph._DECODE_SCRATCH.previous_frame


def test_decode_worker_count_is_capped(monkeypatch):
    """Four is the measured knee on the ml container's 4-CPU quota (1.999 s
    serial -> 0.559 s at x4 -> 0.631 s at x8 over 60 real frames). The cap
    exists because this box is shared with GPU inference and the essays
    worker, so a bigger host must not buy more decode threads."""
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(64)))
    monkeypatch.delenv("KYMOGRAPH_DECODE_WORKERS", raising=False)
    assert tracker_kymograph._decode_workers() == tracker_kymograph._DECODE_WORKERS_CAP

    monkeypatch.setenv("KYMOGRAPH_DECODE_WORKERS", "1")
    assert tracker_kymograph._decode_workers() == 1
    monkeypatch.setenv("KYMOGRAPH_DECODE_WORKERS", "99")
    assert tracker_kymograph._decode_workers() == tracker_kymograph._DECODE_WORKERS_CAP
    monkeypatch.setenv("KYMOGRAPH_DECODE_WORKERS", "nonsense")
    assert tracker_kymograph._decode_workers() == tracker_kymograph._DECODE_WORKERS_CAP


# ---------------------------------------------------------------------------
#  /kymograph/batch
# ---------------------------------------------------------------------------
#
# The export builds one kymograph per (microtubule x channel) over ONE
# container's frames. One request each meant one full decode of the container
# each — 54 000 decodes of 900 distinct files for a real 300-frame, 3-channel,
# 60-microtubule container — and the row cache above cannot help, because every
# job carries a different polyline and so hashes to a different key. Measured on
# a real production export, 2026-09-01: 61 requests, 0 frames from cache, 69
# decoded.
#
# The batch endpoint inverts the loop: decode a frame once, sample every
# polyline that wants a row from it, move on. Everything below is about the two
# properties that makes that safe — one decode per frame, and per-item results
# that are identical to what the single endpoint would have returned.


def _batch_payload(pngs, polylines, **overrides):
    """N single-kymograph bodies over the SAME frames, wrapped as a batch."""
    return {
        "items": [_kymo_payload(pngs, rc, **overrides) for rc in polylines]
    }


def _three_polylines():
    """Three DISTINCT horizontal polylines: distinct geometry is what makes
    every row-cache lookup miss, which is the situation the export is in."""
    return [
        [[float(row), float(x)] for x in range(64)] for row in (4.0, 8.0, 12.0)
    ]


def test_batch_decodes_each_frame_once_for_every_polyline(
    client, monkeypatch, tmp_path
):
    """THE test. Three polylines over three frames is three decodes, not nine.

    Mutation check: make ``_run_row_jobs`` group by ``id(job)`` (i.e. stop
    deduplicating) and this asserts 9.
    """
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    pngs = [td_path / f"f{i}.png" for i in range(3)]
    for png in pngs:
        _write_2d_ramp_png(png)

    decodes = _count_decodes(monkeypatch)
    resp = client.post(
        "/api/v1/kymograph/batch",
        json=_batch_payload(pngs, _three_polylines()),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["results"]) == 3
    assert all(r["kymograph"] is not None for r in body["results"])
    assert decodes["n"] == 3, "each frame must be decoded once, for all 3 items"


def test_batch_item_is_byte_identical_to_the_single_endpoint(
    client, monkeypatch, tmp_path
):
    """A batch is a transport, not a second renderer: item i must equal what
    ``POST /kymograph`` returns for the same body, field for field. If this
    ever fails, exported kymographs and velocities have moved."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    pngs = [td_path / f"f{i}.png" for i in range(3)]
    for png in pngs:
        _write_2d_ramp_png(png)
    polylines = _three_polylines()

    singles = [
        client.post("/api/v1/kymograph", json=_kymo_payload(pngs, rc)).json()
        for rc in polylines
    ]
    tracker_kymograph._SAMPLE_CACHE.clear()
    batched = client.post(
        "/api/v1/kymograph/batch", json=_batch_payload(pngs, polylines)
    ).json()["results"]

    assert [r["kymograph"] for r in batched] == singles


def test_batch_serves_a_warm_row_cache_without_decoding(
    client, monkeypatch, tmp_path
):
    """The row cache still applies inside a batch — a repeat costs no decode.
    It just cannot be what makes the export fast, because the export never
    repeats a polyline."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    pngs = [td_path / f"f{i}.png" for i in range(3)]
    for png in pngs:
        _write_2d_ramp_png(png)
    payload = _batch_payload(pngs, _three_polylines())

    first = client.post("/api/v1/kymograph/batch", json=payload).json()
    decodes = _count_decodes(monkeypatch)
    second = client.post("/api/v1/kymograph/batch", json=payload).json()

    assert decodes["n"] == 0
    assert second == first


def test_batch_reports_a_bad_item_without_sinking_the_others(
    client, monkeypatch, tmp_path
):
    """One microtubule with an unusable seed polyline used to cost exactly one
    HTTP request. It must still cost exactly one kymograph."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    pngs = [td_path / f"f{i}.png" for i in range(3)]
    for png in pngs:
        _write_2d_ramp_png(png)
    good = _three_polylines()
    payload = _batch_payload(pngs, [good[0], [[1.0, 1.0]], good[2]])

    resp = client.post("/api/v1/kymograph/batch", json=payload)

    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert results[0]["kymograph"] is not None
    assert results[1]["kymograph"] is None
    assert "vertex" in results[1]["error"]
    assert results[2]["kymograph"] is not None


def test_batch_reports_a_missing_frame_per_item(client, monkeypatch, tmp_path):
    """A channel missing one frame PNG is real — container 4972cad8's IRM
    channel has 299 of 300. It must fail that channel's items and nothing
    else, with the same message the single endpoint 404s with."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    pngs = [td_path / f"f{i}.png" for i in range(3)]
    for png in pngs:
        _write_2d_ramp_png(png)
    polylines = _three_polylines()
    payload = _batch_payload(pngs, polylines)
    payload["items"][1]["frames"][2]["image_path"] = str(td_path / "gone.png")

    resp = client.post("/api/v1/kymograph/batch", json=payload)

    assert resp.status_code == 200, resp.text
    results = resp.json()["results"]
    assert results[0]["kymograph"] is not None
    assert "Frame image missing" in results[1]["error"]
    assert results[2]["kymograph"] is not None


def test_batch_rejects_an_extra_field(client, monkeypatch, tmp_path):
    """extra='forbid', same as every other model here: a typo'd field must
    400/422 rather than be silently ignored."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    payload = _batch_payload([png], [[[8.0, float(x)] for x in range(64)]])
    payload["parallel"] = True

    assert client.post("/api/v1/kymograph/batch", json=payload).status_code == 422


def test_batch_rejects_an_empty_or_oversized_item_list(
    client, monkeypatch, tmp_path
):
    """The decode does not scale with items but the response does, so the item
    count is bounded (see ``_BATCH_MAX_ITEMS``). It is no longer the bound that
    holds the response down — see the output-pixel tests below."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    one = _kymo_payload([png], [[8.0, float(x)] for x in range(64)])

    assert client.post("/api/v1/kymograph/batch", json={"items": []}).status_code == 422
    over = {"items": [one] * (tracker_kymograph._BATCH_MAX_ITEMS + 1)}
    assert client.post("/api/v1/kymograph/batch", json=over).status_code == 422


def test_batch_output_pixel_budget_is_the_old_response_envelope():
    """The number itself, because it is the one thing here that is a judgement
    rather than a mechanism. 64 items x 300 frames x 200 columns is exactly the
    response size ``_BATCH_MAX_ITEMS`` used to imply when every kymograph was
    200 columns wide; keeping it means nothing that fits in one request today
    starts splitting (the largest real export batch measures 3 596 700 px)."""
    assert tracker_kymograph._BATCH_MAX_OUTPUT_PIXELS == 64 * 300 * 200


def test_batch_rejects_more_output_than_the_pixel_budget(
    client, monkeypatch, tmp_path
):
    """Since the column cap was removed a kymograph is as wide as its
    microtubule is long, so the item count bounds nothing: the response is
    O(frames x columns), not O(items). The budget is patched down here so the
    test exercises the RULE rather than rendering 20 MB of PNG; the constant's
    value is pinned by the test above.

    Mutation check: delete the check in ``kymograph_batch`` and this 200s."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    # 2 frames x 64 columns = 128 output pixels per item.
    item = _kymo_payload([png, png], [[8.0, float(x)] for x in range(64)])

    monkeypatch.setattr(tracker_kymograph, "_BATCH_MAX_OUTPUT_PIXELS", 255)
    r = client.post("/api/v1/kymograph/batch", json={"items": [item, item]})
    assert r.status_code == 413, r.text
    assert "256" in r.text and "255" in r.text

    # One more pixel of budget and the same batch is fine.
    monkeypatch.setattr(tracker_kymograph, "_BATCH_MAX_OUTPUT_PIXELS", 256)
    ok = client.post("/api/v1/kymograph/batch", json={"items": [item, item]})
    assert ok.status_code == 200, ok.text
    assert all(e["kymograph"] is not None for e in ok.json()["results"])


def test_batch_of_one_is_exempt_from_the_pixel_budget(
    client, monkeypatch, tmp_path
):
    """``/kymograph`` renders any single kymograph without a size bound, so a
    one-item batch must too. Refusing it would cost that microtubule its
    kymograph outright — there is no way to split a batch of one, so the export
    could not recover.

    Mutation check: drop the ``len(req.items) > 1`` guard and this 413s."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)

    monkeypatch.setattr(tracker_kymograph, "_BATCH_MAX_OUTPUT_PIXELS", 1)
    item = _kymo_payload([png, png], [[8.0, float(x)] for x in range(64)])
    r = client.post("/api/v1/kymograph/batch", json={"items": [item]})
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["kymograph"] is not None


def test_batch_pixel_budget_ignores_an_unusable_seed_polyline(
    client, monkeypatch, tmp_path
):
    """A malformed item cannot decide whether the other 59 are accepted: it
    renders nothing, so it contributes nothing to the budget and comes back as
    a per-item error the way every other bad item does."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)

    bad = {
        "frames": [
            {"frame": 0, "polyline_rc": [[8.0, 0.0]], "image_path": str(png)}
        ],
        "tracked": False,
    }
    good = _kymo_payload([png], [[8.0, float(x)] for x in range(64)])
    r = client.post("/api/v1/kymograph/batch", json={"items": [bad, good]})
    assert r.status_code == 200, r.text
    results = r.json()["results"]
    assert results[0]["kymograph"] is None and "vertex" in results[0]["error"]
    assert results[1]["kymograph"] is not None


def test_batch_does_not_decode_a_frame_twice_across_two_channels(
    client, monkeypatch, tmp_path
):
    """Items are free to name different files; the dedup is over the file's
    stat identity, so a batch that mixes channels decodes each channel's frames
    once rather than once per item. (The export still batches per channel —
    this is about the endpoint's contract, not its caller's policy.)"""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    ch_a = [td_path / f"a{i}.png" for i in range(3)]
    ch_b = [td_path / f"b{i}.png" for i in range(3)]
    for png in ch_a + ch_b:
        _write_2d_ramp_png(png)
    polylines = _three_polylines()
    payload = {
        "items": [
            _kymo_payload(pngs, rc)
            for pngs in (ch_a, ch_b)
            for rc in polylines
        ]
    }

    decodes = _count_decodes(monkeypatch)
    resp = client.post("/api/v1/kymograph/batch", json=payload)

    assert resp.status_code == 200, resp.text
    assert len(resp.json()["results"]) == 6
    assert decodes["n"] == 6, "3 frames x 2 channels, once each"


# ---------------------------------------------------------------------------
#  Line width: bilinear sampling + the perpendicular band
# ---------------------------------------------------------------------------
#
# Two changes land together here and they are independent:
#
# 1. Sampling went nearest-neighbour -> BILINEAR. Every ImageJ polyline path
#    (ProfilePlot, Straightener) and KymoResliceWide sample with
#    ImageProcessor.getInterpolatedValue, which is bilinear
#    (ij/process/ImageProcessor.java L2005-2013); only KymographBuilder uses
#    nearest. It changes every number in every kymograph — measured on frame 0
#    of container 4972cad8, all 60 microtubules, |bilinear - nearest| is 0.59 %
#    of the IRM frame's range on average and 3.86 % at worst, and 99.9 % of
#    columns move.
#
# 2. `line_width` samples a BAND perpendicular to the polyline and reduces it
#    with mean (default, ImageJ's convention) or max (KymoResliceWide's). The
#    default is 1, which is the single-pixel line profile this endpoint has
#    always produced.
#
# The band tests below are written to fail on Multi Kymograph's bug — it adds
# the offset to x and y IDENTICALLY (MultipleKymograph_.java L150-151,
# L299-302), a fixed 45-degree shift with no normal computed anywhere — which
# is why every one of them uses a DIAGONAL feature. A horizontal or vertical
# test passes with that bug present.


def _write_ramp_png(path: Path, height: int = 16, width: int = 64) -> None:
    """``value = col``: bilinear at a half-integer column reads the midpoint of
    two neighbours, nearest reads one of them."""
    from PIL import Image as PILImage

    arr = np.tile(np.arange(width, dtype=np.uint8), (height, 1))
    PILImage.fromarray(arr, mode="L").save(path)


def _write_diagonal_ridge_png(
    path: Path,
    size: int = 96,
    half_width: float = 3.0,
    peak: int = 240,
    base: int = 16,
) -> None:
    """A 45-degree plateau ridge: ``peak`` within ``half_width`` px
    (PERPENDICULAR distance) of the line ``row == col``, ``base`` outside."""
    from PIL import Image as PILImage

    r = np.arange(size)[:, None]
    c = np.arange(size)[None, :]
    d = np.abs(r - c) / np.sqrt(2.0)
    arr = np.where(d <= half_width, peak, base).astype(np.uint8)
    PILImage.fromarray(arr, mode="L").save(path)


def _read_png(path: Path) -> np.ndarray:
    from PIL import Image as PILImage

    return np.array(PILImage.open(path).convert("L"), dtype=np.float32)


def _diag_polyline(lo: float = 20.0, hi: float = 75.0):
    return [[lo, lo], [hi, hi]]


def _resampled(polyline_rc) -> np.ndarray:
    pts = np.asarray(polyline_rc, dtype=np.float32)
    arc = float(np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1)))
    n = max(2, int(round(arc)) + 1)
    return tracker_kymograph._arc_length_resample_polyline(pts, n)


def _bilinear(img: np.ndarray, rows, cols) -> np.ndarray:
    from scipy.ndimage import map_coordinates

    return map_coordinates(
        img,
        np.stack([np.asarray(rows).ravel(), np.asarray(cols).ravel()]),
        order=1,
        mode="constant",
        cval=0.0,
    )


def test_resampler_forces_the_endpoint_and_round_L_plus_one_points():
    """Locks the CITATION corrected on 2026-09-01 as much as the behaviour.

    This is ``PolygonRoi.getEquidistantPoints`` (PolygonRoi.java L1035-1036) —
    ``round(L) + 1`` points with the last one ON the endpoint — and NOT
    ``Roi.getInterpolatedPolygon(step, smooth=false)`` (Roi.java L686-711),
    which the docstring claimed for months and which DROPS an open polyline's
    endpoint. If someone ever "fixes" the code to match the old comment, the
    last column of every kymograph stops being the end of the microtubule and
    this goes red."""
    pts = np.array([[0.0, 0.0], [0.0, 10.0], [7.0, 10.0]], dtype=np.float32)
    arc = 17.0
    n = int(round(arc)) + 1
    out = tracker_kymograph._arc_length_resample_polyline(pts, n)
    assert out.shape == (18, 2)
    assert np.allclose(out[0], pts[0])
    assert np.allclose(out[-1], pts[-1]), "the endpoint must be forced"
    steps = np.linalg.norm(np.diff(out, axis=0), axis=1)
    assert np.allclose(steps, 1.0, atol=1e-4), "1.0 px arc-length step"


def test_sampling_is_bilinear_not_nearest(tmp_path):
    """``order=0`` was justified by a comment claiming it matched ImageJ's
    ``getInterpolatedValue`` zero-fill. Only the zero-fill matched;
    getInterpolatedValue is bilinear.

    On a ``value = col`` ramp a half-integer column has an exact bilinear
    answer, and nearest cannot produce it.

    Mutation check: put ``order=0`` back in ``_sample_line_profile`` and this
    goes red (every value becomes a whole number)."""
    png = tmp_path / "ramp.png"
    _write_ramp_png(png)
    img = _read_png(png)
    pts = np.array([[8.0, 10.5], [8.0, 11.5], [8.0, 12.5]], dtype=np.float32)

    profile = tracker_kymograph._sample_line_profile(img, pts, 1, "mean")

    assert np.allclose(profile, [10.5, 11.5, 12.5], atol=1e-5)
    assert not np.allclose(profile, np.round(profile))


def test_width_one_is_the_plain_line_profile_bit_for_bit(tmp_path):
    """A width-1 band must BE the single-pixel line profile — not merely close
    to it — or ``line_width`` stops being backward compatible the moment a
    caller leaves it alone."""
    png = tmp_path / "ridge.png"
    _write_diagonal_ridge_png(png)
    img = _read_png(png)
    sp = _resampled(_diag_polyline())

    got = tracker_kymograph._sample_line_profile(img, sp, 1, "mean")
    ref = _bilinear(img, sp[:, 0], sp[:, 1]).astype(np.float32)

    assert np.array_equal(got, ref)


@pytest.mark.parametrize(
    "deg", [0.0, 17.0, 30.0, 45.0, 63.0, 90.0, 123.0, 179.0]
)
def test_the_band_normal_is_perpendicular_at_every_angle(deg):
    """The band is only a band ACROSS the line if the offsets go along a real
    normal. Asserted as the dot product with the tangent, at eight angles, so
    a rotation that happens to be right on the axes cannot pass.

    Mutation check: change the rotation ``(tr, tc) -> (tc, -tr)`` to
    ``(tr, tc)`` (Multi Kymograph's non-rotation) and every angle whose tangent
    is not axis-aligned fails."""
    th = np.deg2rad(deg)
    direction = np.array([np.sin(th), np.cos(th)])
    pts = np.arange(40, dtype=np.float64)[:, None] * direction

    normals = tracker_kymograph._band_normals_rc(pts)

    tangents = np.diff(pts, axis=0, prepend=pts[:1])
    tangents[0] = tangents[1]
    dots = np.sum(normals * tangents, axis=1)
    assert np.max(np.abs(dots)) < 1e-9, f"not perpendicular: max |dot| {dots}"
    assert np.allclose(np.linalg.norm(normals, axis=1), 1.0)


def test_a_uniform_diagonal_ridge_keeps_its_true_intensity_at_width_5(tmp_path):
    """A band entirely inside a uniform feature must report that feature's
    intensity exactly — widening the line must not dim it.

    The ridge is at 45 degrees and 8 px wide on each side, so every one of the
    five samples lands deep inside the plateau and bilinear interpolation over
    a constant region is exact."""
    png = tmp_path / "wide_ridge.png"
    _write_diagonal_ridge_png(png, half_width=8.0, peak=240, base=16)
    img = _read_png(png)
    sp = _resampled(_diag_polyline())

    profile = tracker_kymograph._sample_line_profile(img, sp, 5, "mean")

    assert np.all(profile == 240.0), f"band mean drifted: {np.unique(profile)}"


def test_the_band_crosses_a_diagonal_ridge_rather_than_running_along_it(
    tmp_path,
):
    """THE Multi Kymograph guard.

    ``MultipleKymograph_`` adds its ``Linewidth`` offset to x and to y
    identically (L150-151, L299-302) — a fixed 45-degree diagonal shift, no
    normal anywhere — so on a 45-degree feature its "band" never leaves the
    feature. This asserts the band matches an independently-computed
    perpendicular one, and that the buggy parallel one is far away.

    Mutation check: change the rotation to ``(tr, tc)`` and the profile becomes
    the parallel one, i.e. exactly the value this test proves it is not."""
    png = tmp_path / "thin_ridge.png"
    _write_diagonal_ridge_png(png, half_width=3.0, peak=240, base=16)
    img = _read_png(png)
    sp = _resampled(_diag_polyline())
    width = 11
    offsets = (np.arange(width, dtype=np.float64) - (width - 1) / 2.0)[:, None]

    got = tracker_kymograph._sample_line_profile(img, sp, width, "mean")

    # Reference: the analytic normal of a 45-degree line in (row, col).
    unit = np.array([1.0, -1.0]) / np.sqrt(2.0)
    ref = (
        _bilinear(
            img,
            sp[:, 0][None, :] + offsets * unit[0],
            sp[:, 1][None, :] + offsets * unit[1],
        )
        .reshape(width, -1)
        .mean(axis=0)
    )
    assert np.allclose(got, ref, atol=1e-4)

    # Multi Kymograph's actual arithmetic: the same offset on both axes.
    bug = (
        _bilinear(
            img,
            sp[:, 0][None, :] + offsets,
            sp[:, 1][None, :] + offsets,
        )
        .reshape(width, -1)
        .mean(axis=0)
    )
    assert np.all(bug == 240.0), "the buggy band never leaves the ridge"
    assert np.all(got < bug - 40.0), (
        f"band mean {got.mean():.1f} is indistinguishable from the parallel "
        f"one {bug.mean():.1f} — the offsets are not on a normal"
    )


def test_max_reduces_differently_from_mean(tmp_path):
    """``mean`` is ImageJ's convention (ProfilePlot / Straightener average
    across the width and offer no choice) and the default the user asked for;
    ``max`` is KymoResliceWide's default and is offered for its users.

    Mutation check: reduce with ``mean`` unconditionally and the max assertion
    fails; reduce with ``max`` unconditionally and the mean assertion fails."""
    png = tmp_path / "thin_ridge.png"
    _write_diagonal_ridge_png(png, half_width=3.0, peak=240, base=16)
    img = _read_png(png)
    sp = _resampled(_diag_polyline())

    mean_profile = tracker_kymograph._sample_line_profile(img, sp, 11, "mean")
    max_profile = tracker_kymograph._sample_line_profile(img, sp, 11, "max")

    # The centre sample is always on the plateau, so max pins to the peak...
    assert np.all(max_profile == 240.0)
    # ...while the mean carries the background the outer samples reach.
    assert np.all(mean_profile < 200.0)


def test_the_band_is_zero_filled_outside_the_image(tmp_path):
    """Documented, matched behaviour, not an oversight: a band overhanging the
    frame border reads 0 for the samples outside and COUNTS them in the mean,
    so the profile is biased toward zero in proportion to how much of the band
    is off-image. It is the same ``mode='constant', cval=0`` the single-pixel
    path has used since edge-clamping was found to falsely brighten polylines
    that cross the border; extending it across the width keeps one rule."""
    png = tmp_path / "flat.png"
    _write_constant_png(png, 200, height=16, width=64)
    img = _read_png(png)
    # Row 0: a width-5 band centred on it has offsets -2..+2, so two samples
    # sit at rows -2 and -1, outside the image.
    pts = np.array([[0.0, float(c)] for c in range(10, 40)], dtype=np.float32)

    profile = tracker_kymograph._sample_line_profile(img, pts, 5, "mean")

    assert np.allclose(profile, 200.0 * 3.0 / 5.0, atol=1e-4)


def test_line_width_default_renders_exactly_what_it_did_before(
    client, monkeypatch, tmp_path
):
    """The wire default. An omitted ``line_width`` and an explicit 1 must
    produce byte-identical responses, or every existing kymograph moves the
    day this deploys."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    pngs = [td_path / f"f{i}.png" for i in range(3)]
    for p in pngs:
        _write_diagonal_ridge_png(p)
    polyline = _diag_polyline()

    omitted = client.post(
        "/api/v1/kymograph", json=_kymo_payload(pngs, polyline)
    )
    explicit = client.post(
        "/api/v1/kymograph",
        json=_kymo_payload(pngs, polyline, line_width=1, line_reduce="mean"),
    )

    assert omitted.status_code == 200, omitted.text
    assert explicit.status_code == 200, explicit.text
    assert omitted.json() == explicit.json()


def test_line_width_reaches_the_sampler_through_the_endpoint(
    client, monkeypatch, tmp_path
):
    """Tests the WIRING. A request that asks for a width-11 band must get one:
    the CSV must equal the band profile, not the single-pixel one.

    Mutation check: drop ``req.line_width`` from the ``_plan_rows`` call in
    ``_plan_kymograph`` and this goes red while every unit test above stays
    green."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_diagonal_ridge_png(png, half_width=3.0)
    img = _read_png(png)
    polyline = _diag_polyline()
    sp = _resampled(polyline)

    r = client.post(
        "/api/v1/kymograph",
        json=_kymo_payload([png], polyline, line_width=11),
    )

    assert r.status_code == 200, r.text
    row = np.array([float(v) for v in _csv_rows(r.json())[0][1:]])
    expected = tracker_kymograph._sample_line_profile(img, sp, 11, "mean")
    assert np.allclose(row, expected, atol=1e-4)
    plain = tracker_kymograph._sample_line_profile(img, sp, 1, "mean")
    assert not np.allclose(row, plain, atol=1e-4)


def test_line_reduce_reaches_the_sampler_through_the_endpoint(
    client, monkeypatch, tmp_path
):
    """As above for the reduction: ``max`` must actually be applied."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_diagonal_ridge_png(png, half_width=3.0)
    img = _read_png(png)
    polyline = _diag_polyline()
    sp = _resampled(polyline)

    r = client.post(
        "/api/v1/kymograph",
        json=_kymo_payload([png], polyline, line_width=11, line_reduce="max"),
    )

    assert r.status_code == 200, r.text
    row = np.array([float(v) for v in _csv_rows(r.json())[0][1:]])
    assert np.allclose(
        row,
        tracker_kymograph._sample_line_profile(img, sp, 11, "max"),
        atol=1e-4,
    )
    assert not np.allclose(
        row,
        tracker_kymograph._sample_line_profile(img, sp, 11, "mean"),
        atol=1e-4,
    )


def test_row_cache_misses_when_the_line_width_or_reduction_changes(
    client, monkeypatch, tmp_path
):
    """The sampled ROW depends on both, so both are in its key. Without them
    the second request below would be served the first request's rows — the
    user would nudge the width and see the identical picture.

    Mutation check: drop ``line_width`` (or ``line_reduce``) from ``cache_key``
    in ``_plan_rows`` and the decode counts collapse to 0."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_diagonal_ridge_png(png, half_width=3.0)
    polyline = _diag_polyline()

    first = client.post("/api/v1/kymograph", json=_kymo_payload([png], polyline))
    decodes = _count_decodes(monkeypatch)
    wide = client.post(
        "/api/v1/kymograph",
        json=_kymo_payload([png], polyline, line_width=11),
    )
    assert decodes["n"] == 1, "a new width must re-sample, not reuse the row"
    widest = client.post(
        "/api/v1/kymograph",
        json=_kymo_payload([png], polyline, line_width=11, line_reduce="max"),
    )
    assert decodes["n"] == 2, "a new reduction must re-sample too"
    warm = client.post(
        "/api/v1/kymograph",
        json=_kymo_payload([png], polyline, line_width=11),
    )
    assert decodes["n"] == 2, "the width-11 mean row is still cached"

    assert first.json()["csv_base64"] != wide.json()["csv_base64"]
    assert wide.json()["csv_base64"] != widest.json()["csv_base64"]
    assert wide.json() == warm.json()


def _write_offset_stripe_diagonal_png(
    path: Path, size: int = 96, peak: int = 240, stripe: int = 255,
    base: int = 16,
) -> None:
    """A 45-degree ridge with a BRIGHTER stripe 3-4 px off to one side.

    The asymmetry is what separates the four settings the batch test posts: on
    a symmetric ridge the brightest sample of any centred band is the centre
    one, so ``max`` returns exactly the width-1 profile and two of the four
    items come out identical for a reason that has nothing to do with the
    plumbing under test."""
    from PIL import Image as PILImage

    r = np.arange(size)[:, None]
    c = np.arange(size)[None, :]
    # Bands of the INTEGER difference r - c, several pixels thick, so no sample
    # the widths below take lands on a one-pixel feature where the assertion
    # would depend on how bilinear interpolation rounds a boundary.
    k = r - c
    arr = np.full((size, size), base, dtype=np.uint8)
    arr[np.abs(k) <= 2] = peak
    arr[(k >= 5) & (k <= 8)] = stripe
    PILImage.fromarray(arr, mode="L").save(path)


def test_batch_carries_each_item_its_own_line_width(
    client, monkeypatch, tmp_path
):
    """Batch items are plain ``KymographRequest`` bodies and the new fields
    must flow through unchanged — including when four items want different
    bands of the SAME frame, which is why the width and the reduction travel on
    the ``_RowJob`` rather than being read off one request inside
    ``_sample_frame_rows``.

    Mutation check: read the width off ``req`` in ``_sample_frame_rows``
    instead and every item gets the last-planned item's band."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_offset_stripe_diagonal_png(png)
    polyline = _diag_polyline()
    payloads = [
        _kymo_payload([png], polyline),
        _kymo_payload([png], polyline, line_width=5),
        _kymo_payload([png], polyline, line_width=11),
        _kymo_payload([png], polyline, line_width=11, line_reduce="max"),
    ]

    batch = client.post("/api/v1/kymograph/batch", json={"items": payloads})
    assert batch.status_code == 200, batch.text
    got = [item["kymograph"] for item in batch.json()["results"]]
    assert all(k is not None for k in got)

    for batched, payload in zip(got, payloads):
        single = client.post("/api/v1/kymograph", json=payload).json()
        assert batched["csv_base64"] == single["csv_base64"]
    assert len({k["csv_base64"] for k in got}) == 4, (
        "four different bands of one frame must give four different matrices"
    )


@pytest.mark.parametrize(
    "overrides",
    [
        {"line_width": 0},
        {"line_width": 52},
        {"line_reduce": "median"},
    ],
)
def test_kymograph_rejects_an_impossible_line_setting(
    client, monkeypatch, tmp_path, overrides
):
    """The bounds are the ML service's, and the Node route mirrors them. 51 is
    ``_LINE_WIDTH_MAX``; ``line_reduce`` is a closed Literal."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    r = client.post(
        "/api/v1/kymograph",
        json=_kymo_payload(
            [png], [[8.0, float(x)] for x in range(64)], **overrides
        ),
    )
    assert r.status_code == 422, r.text


def test_an_even_width_band_is_centred_on_the_line(tmp_path):
    """ImageJ ``Straightener``'s centring convention, not KymoResliceWide's.

    ``Straightener.java`` L181-182 offsets by ``(w-1)/2`` for BOTH parities;
    KymoResliceWide's ``processWideLine`` uses ``w/2``, which for an even width
    puts the whole band 0.5 px to one side of the drawn line. Odd widths are
    identical under both (``(5-1)/2 == 5//2``), so only an even one can tell
    them apart.

    On a field that varies linearly across the line, a CENTRED band of any
    width returns the centre value exactly — so this is an exact assertion
    rather than a tolerance on a fixture.

    Mutation check: replace ``(line_width - 1) / 2.0`` with ``line_width // 2``
    and the even-width profiles shift by 3 / (2*sqrt(2)) = 1.06 counts."""
    size = 96
    rows = np.arange(size, dtype=np.float32)[:, None]
    cols = np.arange(size, dtype=np.float32)[None, :]
    img = (4.0 * rows + cols).astype(np.float32)
    sp = _resampled(_diag_polyline())

    centre = tracker_kymograph._sample_line_profile(img, sp, 1, "mean")

    for width in (2, 4, 3, 5):
        band = tracker_kymograph._sample_line_profile(img, sp, width, "mean")
        assert np.allclose(band, centre, atol=1e-2), (
            f"width {width} band is off-centre by "
            f"{np.mean(band - centre):+.4f} counts"
        )
