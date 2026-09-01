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
    ordinary traffic. The middle one's ring reaches both neighbours. Measured
    together its background is the field (40); measured alone its ring is half
    neighbour, the ImageJ tie-rule median lands on the neighbour (200), and a
    streak 5x brighter than the field reports ZERO contrast. So the assertion
    below fails loudly on a per-track regression rather than drifting a few
    percent.
    """
    from PIL import Image as PILImage

    cols, field, bright, width, T = (20, 26, 32), 40, 200, 60, 20

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
            row[c - 1:c + 2] = bright
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
    """``target_width`` reaches a row only through ``n_samples``, so that is
    what the key carries. Two target_widths that clamp to the same n_samples
    SHOULD hit (the rows are genuinely identical); one that changes it must
    not."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    polyline_rc = [[8.0, float(x)] for x in range(64)]

    decodes = _count_decodes(monkeypatch)
    wide = client.post(
        "/api/v1/kymograph", json=_kymo_payload([png], polyline_rc, target_width=64)
    )
    assert wide.status_code == 200, wide.text
    assert wide.json()["length_px"] == 64
    assert decodes["n"] == 1

    # 200 clamps back to the same 64 samples (the arc length is the binding
    # constraint), so this is a legitimate hit and must not re-decode.
    same = client.post(
        "/api/v1/kymograph", json=_kymo_payload([png], polyline_rc, target_width=200)
    )
    assert same.status_code == 200, same.text
    assert same.json()["length_px"] == 64
    assert decodes["n"] == 1, "re-decoded for an identical n_samples"

    narrow = client.post(
        "/api/v1/kymograph", json=_kymo_payload([png], polyline_rc, target_width=20)
    )
    assert narrow.status_code == 200, narrow.text
    assert narrow.json()["length_px"] == 20
    assert decodes["n"] == 2, "served a 20-sample row from the 64-sample entry"


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
    bookkeeping counts too: at the default target_width a row is 800 B and its
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
    """The response is O(items) even though the decode is not, so the item
    count is bounded (see ``_BATCH_MAX_ITEMS``)."""
    td_path = tmp_path.resolve()
    monkeypatch.setattr(tracker_kymograph, "_UPLOAD_ROOT", td_path)
    png = td_path / "f0.png"
    _write_gradient_png(png)
    one = _kymo_payload([png], [[8.0, float(x)] for x in range(64)])

    assert client.post("/api/v1/kymograph/batch", json={"items": []}).status_code == 422
    over = {"items": [one] * (tracker_kymograph._BATCH_MAX_ITEMS + 1)}
    assert client.post("/api/v1/kymograph/batch", json=over).status_code == 422


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
