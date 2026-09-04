"""
Unit tests for segmentation API endpoints.

All synchronous tests use the ``client`` fixture from conftest.py which runs
the FastAPI lifespan (model-loader init) via the context-manager form of
TestClient.  Async tests use the ``async_client`` fixture (ASGITransport).

Actual API surface (verified against the running app):
- GET  /health                 → {status, timestamp, models_loaded, gpu_available}
- GET  /api/v1/status          → {status, is_processing, current_model, queue_length,
                                   available, timestamp}  (status ∈ {"idle","processing"})
- GET  /api/v1/models          → {models: {name: {...}}}   (dict, not list)
- POST /api/v1/segment         → file=UploadFile, model=str (default "hrnet"),
                                   threshold=float, detect_holes=bool
                                   → {model_used, polygons, processing_time, ...}
- POST /api/v1/batch-segment   → files=List[UploadFile], model=str
                                   → {success, results: [...], ...}
"""
import pytest
import io
from pathlib import Path
from PIL import Image
from fastapi.testclient import TestClient
from httpx import AsyncClient

from api.main import app

#: The HRNet checkpoint every test that actually SEGMENTS below needs. It is
#: untracked (791 MB) and staged by `make download-weights`, so a fresh clone or
#: a git worktree does not have it — and without this guard those tests do not
#: skip, they FAIL, with the route's own 500 and a "Model weights not found"
#: line in the captured log. Seven of them did. A run that means "this checkout
#: has no weights" then reads as "the segmentation endpoint is broken", which is
#: how a genuinely red ML suite ends up being ignored.
#:
#: The validation-only tests in this class (unknown model, missing file, bad
#: threshold) are NOT marked: they are rejected before any model is loaded and
#: are worth keeping runnable everywhere.
#: RELATIVE, resolved against the cwd, because that is what
#: ``ModelLoader.AVAILABLE_MODELS['hrnet']['pretrained_path']`` —
#: ``'weights/hrnet_best_model.pth'`` — is, and torch.load opens it from
#: wherever the process is. An absolute ``/app/...`` would match the loader
#: only under ``make test-ml``'s ``-w /app`` and would otherwise skip these
#: tests on a box that DOES have the weights, which is the same
#: "green and tested nothing" outcome the guard is here to remove.
_HRNET_CHECKPOINT = Path.cwd() / "weights" / "hrnet_best_model.pth"
requires_hrnet = pytest.mark.skipif(
    not _HRNET_CHECKPOINT.exists(),
    reason=f"HRNet checkpoint not staged at {_HRNET_CHECKPOINT} "
    "(make download-weights)",
)


def _make_jpeg_bytes(width: int = 256, height: int = 256) -> bytes:
    """Helper: create a small valid JPEG image as bytes."""
    img = Image.new('RGB', (width, height), color=(128, 128, 128))
    buf = io.BytesIO()
    img.save(buf, format='JPEG')
    return buf.getvalue()


class TestSegmentationEndpoints:
    """Test cases for segmentation API endpoints."""

    def test_health_endpoint(self, client: TestClient):
        """Test health check endpoint."""
        response = client.get("/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data

    def test_status_endpoint(self, client: TestClient):
        """Test status endpoint returns the expected shape.

        The ``status`` field cycles through "idle" / "processing"; we accept
        any non-error string.  The response does NOT contain "operational" or
        "system_info" — those were stale expectations from an older API version.
        """
        response = client.get("/api/v1/status")
        assert response.status_code == 200

        data = response.json()
        assert "status" in data
        assert data["status"] in ("idle", "processing")
        assert "is_processing" in data
        assert "available" in data
        assert "timestamp" in data

    def test_models_list_endpoint(self, client: TestClient):
        """Test models list endpoint.

        /api/v1/models returns {models: {name: {...}}} — a dict keyed by model
        name, not a list.  Confirmed model names include at least 'hrnet'.
        """
        response = client.get("/api/v1/models")
        assert response.status_code == 200

        data = response.json()
        assert "models" in data
        # The value is a dict mapping name → info dict, not a list
        assert isinstance(data["models"], dict)
        assert "hrnet" in data["models"]

    @requires_hrnet
    @pytest.mark.asyncio
    async def test_segment_image_success(self, async_client: AsyncClient, sample_image_bytes: bytes):
        """Test successful image segmentation.

        File param name is ``file`` (not ``image``); model param is ``model``
        (not ``model_name``).  Response contains ``polygons`` (list) at the top
        level, not inside a ``metadata`` key.
        """
        files = {"file": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {"model": "hrnet"}

        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 200

        result = response.json()
        assert "polygons" in result
        assert isinstance(result["polygons"], list)
        assert "model_used" in result
        assert result["model_used"] == "hrnet"

    @pytest.mark.asyncio
    async def test_segment_image_invalid_model(self, async_client: AsyncClient, sample_image_bytes: bytes):
        """Test segmentation with invalid model name returns an error response."""
        files = {"file": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {"model": "invalid_model"}

        response = await async_client.post("/api/v1/segment", files=files, data=data)
        # The API returns 4xx or 5xx for an unknown model
        assert response.status_code in (400, 422, 500)

        result = response.json()
        # Error info lives in either "detail" or "error" depending on status
        assert "detail" in result or "error" in result

    @pytest.mark.asyncio
    async def test_segment_image_no_file(self, async_client: AsyncClient):
        """Test segmentation without image file returns 422 Validation Error."""
        data = {"model": "hrnet"}

        response = await async_client.post("/api/v1/segment", data=data)
        assert response.status_code == 422  # Validation error

        result = response.json()
        assert "detail" in result

    @pytest.mark.asyncio
    async def test_segment_image_invalid_file_type(self, async_client: AsyncClient):
        """Test segmentation with a non-image file returns 400."""
        text_content = b"This is not an image"
        files = {"file": ("test.txt", io.BytesIO(text_content), "text/plain")}
        data = {"model": "hrnet"}

        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 400

        result = response.json()
        assert "detail" in result

    @requires_hrnet
    @pytest.mark.asyncio
    async def test_segment_image_large_file(self, async_client: AsyncClient):
        """Test segmentation with a large image file (5000×5000).

        The app does not currently enforce a strict file-size limit at the HTTP
        layer (nginx does, but not the FastAPI handler directly).  The request
        should either succeed (200) or be rejected (400/413).
        """
        large_image_bytes = _make_jpeg_bytes(width=5000, height=5000)

        files = {"file": ("large.jpg", io.BytesIO(large_image_bytes), "image/jpeg")}
        data = {"model": "hrnet"}

        response = await async_client.post("/api/v1/segment", files=files, data=data)
        # Accept success or rejection — we just need it not to crash the server
        assert response.status_code in (200, 400, 413)

    @requires_hrnet
    def test_segment_image_missing_model_parameter(self, client: TestClient, sample_image_bytes: bytes):
        """Test segmentation without model name uses the default model (hrnet).

        The ``model`` form field has a default value of "hrnet", so omitting it
        is not a validation error — the request succeeds with the default.
        """
        files = {"file": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}

        response = client.post("/api/v1/segment", files=files)
        # Default model "hrnet" is used when model param is omitted
        assert response.status_code == 200

        result = response.json()
        assert "polygons" in result

    @pytest.mark.asyncio
    async def test_segment_batch_images_success(self, async_client: AsyncClient, sample_image_bytes: bytes):
        """Test batch image segmentation via /api/v1/batch-segment.

        File list param name is ``files`` (not ``images``); model param is
        ``model`` (not ``model_name``).  Batch endpoint URL is
        ``/api/v1/batch-segment``, not ``/api/v1/segment/batch``.
        """
        files = [
            ("files", ("test1.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")),
            ("files", ("test2.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")),
        ]
        data = {"model": "hrnet"}

        response = await async_client.post("/api/v1/batch-segment", files=files, data=data)
        assert response.status_code == 200

        result = response.json()
        assert "results" in result
        assert isinstance(result["results"], list)
        assert len(result["results"]) == 2

        for image_result in result["results"]:
            assert "filename" in image_result
            assert "polygons" in image_result

    @pytest.mark.asyncio
    async def test_segment_batch_images_empty(self, async_client: AsyncClient):
        """Test batch segmentation with no images returns 422 (missing required field)."""
        data = {"model": "hrnet"}

        response = await async_client.post("/api/v1/batch-segment", data=data)
        # FastAPI validation: the ``files`` field is required
        assert response.status_code == 422

        result = response.json()
        assert "detail" in result

    @requires_hrnet
    @pytest.mark.asyncio
    async def test_segment_with_postprocessing_options(self, async_client: AsyncClient, sample_image_bytes: bytes):
        """Test segmentation with optional threshold parameter."""
        files = {"file": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {
            "model": "hrnet",
            "threshold": 0.5,
        }

        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 200

        result = response.json()
        assert "polygons" in result

    @requires_hrnet
    @pytest.mark.asyncio
    async def test_segment_with_custom_parameters(self, async_client: AsyncClient, sample_image_bytes: bytes):
        """Test segmentation with a non-default model selection."""
        files = {"file": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {"model": "hrnet"}

        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 200

        result = response.json()
        assert "polygons" in result
        assert "model_used" in result
        assert result["model_used"] == "hrnet"

    def test_cors_headers(self, client: TestClient):
        """Test that CORS headers are properly set on OPTIONS."""
        response = client.options("/api/v1/status")

        # Check for CORS headers
        assert "access-control-allow-origin" in response.headers
        assert "access-control-allow-methods" in response.headers
        assert "access-control-allow-headers" in response.headers

    def test_no_rate_limiting_on_normal_use(self, client: TestClient):
        """Verify that normal (non-abusive) request volumes are not rate-limited.

        The app does not implement per-client rate limiting in the FastAPI
        handler layer (that is handled upstream by nginx in production).
        20 sequential health-check requests should all succeed.
        """
        responses = []
        for _ in range(20):
            response = client.get("/api/v1/status")
            responses.append(response)

        status_codes = [r.status_code for r in responses]
        # All should be 200 — no in-process rate limiter
        assert all(sc == 200 for sc in status_codes)

    @requires_hrnet
    @pytest.mark.asyncio
    async def test_concurrent_segmentation_requests(self, async_client: AsyncClient, sample_image_bytes: bytes):
        """Test handling of concurrent segmentation requests."""
        import asyncio

        async def make_request():
            files = {"file": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
            data = {"model": "hrnet"}
            response = await async_client.post("/api/v1/segment", files=files, data=data)
            return response.status_code

        # Make 3 concurrent requests
        tasks = [make_request() for _ in range(3)]
        results = await asyncio.gather(*tasks)

        # All should succeed
        assert all(status == 200 for status in results)

    @requires_hrnet
    @pytest.mark.slow
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_reported_processing_time_is_bounded_by_the_round_trip(
        self, async_client: AsyncClient, sample_image_bytes: bytes
    ):
        """``processing_time`` on the wire is a real, seconds-valued duration.

        Renamed from ``test_segmentation_performance``, which asserted
        ``wall_clock < 60.0`` on an HRNet call that takes ~0.2 s on this card —
        a 300x margin, inside a pytest timeout that would have fired anyway,
        and green through any regression short of a hang. It could not measure
        performance and its other two assertions duplicated
        ``test_segment_image_success``.

        What the clock can settle here is a UNIT question, and it is the one
        that has bitten this field before: the server reports the time it spent
        segmenting, so that number must be positive and must not exceed the
        round trip the caller just measured. Reporting milliseconds in a field
        the frontend renders as seconds would fail this on any real image; a
        `time.time()`/`perf_counter()` mix-up would too.
        """
        import time

        files = {"file": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {"model": "hrnet"}

        start_time = time.perf_counter()
        response = await async_client.post("/api/v1/segment", files=files, data=data)
        round_trip = time.perf_counter() - start_time

        assert response.status_code == 200
        result = response.json()
        assert "polygons" in result
        reported = result["processing_time"]
        assert isinstance(reported, (int, float))
        assert reported > 0.0, "a completed segmentation took no measurable time"
        assert reported <= round_trip, (
            f"server reported {reported} s of processing inside a "
            f"{round_trip:.3f} s round trip — wrong unit, or the wrong clock"
        )
