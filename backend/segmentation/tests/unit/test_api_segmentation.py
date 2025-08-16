"""
Unit tests for segmentation API endpoints.
"""
import pytest
import io
from PIL import Image
from fastapi.testclient import TestClient
from httpx import AsyncClient

from api.main import app


class TestSegmentationEndpoints:
    """Test cases for segmentation API endpoints."""
    
    def test_health_endpoint(self, client: TestClient):
        """Test health check endpoint."""
        response = client.get("/health")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "healthy"
        assert "timestamp" in data
        assert "version" in data
    
    def test_status_endpoint(self, client: TestClient):
        """Test status endpoint."""
        response = client.get("/api/v1/status")
        assert response.status_code == 200
        
        data = response.json()
        assert data["status"] == "operational"
        assert "models" in data
        assert "system_info" in data
    
    def test_models_list_endpoint(self, client: TestClient):
        """Test models list endpoint."""
        response = client.get("/api/v1/models")
        assert response.status_code == 200
        
        data = response.json()
        assert "models" in data
        assert isinstance(data["models"], list)
        
        # Check that we have expected models
        model_names = [model["name"] for model in data["models"]]
        assert "hrnet" in model_names
        assert "resunet_small" in model_names
        assert "resunet_advanced" in model_names
    
    @pytest.mark.asyncio
    async def test_segment_image_success(self, async_client: AsyncClient, sample_image_bytes: bytes, mock_model_inference):
        """Test successful image segmentation."""
        files = {"image": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {"model_name": "hrnet"}
        
        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 200
        
        result = response.json()
        assert "polygons" in result
        assert "metadata" in result
        assert isinstance(result["polygons"], list)
        assert len(result["polygons"]) > 0
        
        # Check polygon structure
        polygon = result["polygons"][0]
        assert "points" in polygon
        assert "confidence" in polygon
        assert "area" in polygon
        assert "centroid" in polygon
        assert isinstance(polygon["points"], list)
        assert isinstance(polygon["confidence"], float)
    
    @pytest.mark.asyncio
    async def test_segment_image_invalid_model(self, async_client: AsyncClient, sample_image_bytes: bytes):
        """Test segmentation with invalid model name."""
        files = {"image": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {"model_name": "invalid_model"}
        
        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 400
        
        result = response.json()
        assert "error" in result
        assert "invalid_model" in result["error"].lower()
    
    @pytest.mark.asyncio
    async def test_segment_image_no_file(self, async_client: AsyncClient):
        """Test segmentation without image file."""
        data = {"model_name": "hrnet"}
        
        response = await async_client.post("/api/v1/segment", data=data)
        assert response.status_code == 422  # Validation error
        
        result = response.json()
        assert "detail" in result
    
    @pytest.mark.asyncio
    async def test_segment_image_invalid_file_type(self, async_client: AsyncClient):
        """Test segmentation with non-image file."""
        text_content = b"This is not an image"
        files = {"image": ("test.txt", io.BytesIO(text_content), "text/plain")}
        data = {"model_name": "hrnet"}
        
        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 400
        
        result = response.json()
        assert "error" in result
        assert "image" in result["error"].lower()
    
    @pytest.mark.asyncio
    async def test_segment_image_large_file(self, async_client: AsyncClient):
        """Test segmentation with file that exceeds size limit."""
        # Create a large dummy image (simulate large file)
        large_image = Image.new('RGB', (5000, 5000), color='white')
        image_buffer = io.BytesIO()
        large_image.save(image_buffer, format='JPEG', quality=95)
        large_image_bytes = image_buffer.getvalue()
        
        files = {"image": ("large.jpg", io.BytesIO(large_image_bytes), "image/jpeg")}
        data = {"model_name": "hrnet"}
        
        response = await async_client.post("/api/v1/segment", files=files, data=data)
        
        # Depending on implementation, this might be 413 (Payload Too Large) or 400
        assert response.status_code in [400, 413]
    
    def test_segment_image_missing_model_parameter(self, client: TestClient, sample_image_bytes: bytes):
        """Test segmentation without model name parameter."""
        files = {"image": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        
        response = client.post("/api/v1/segment", files=files)
        assert response.status_code == 422  # Validation error
        
        result = response.json()
        assert "detail" in result
    
    @pytest.mark.asyncio
    async def test_segment_batch_images_success(self, async_client: AsyncClient, sample_image_bytes: bytes, mock_model_inference):
        """Test batch image segmentation."""
        files = [
            ("images", ("test1.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")),
            ("images", ("test2.jpg", io.BytesIO(sample_image_bytes), "image/jpeg"))
        ]
        data = {"model_name": "hrnet"}
        
        response = await async_client.post("/api/v1/segment/batch", files=files, data=data)
        assert response.status_code == 200
        
        result = response.json()
        assert "results" in result
        assert isinstance(result["results"], list)
        assert len(result["results"]) == 2
        
        for image_result in result["results"]:
            assert "filename" in image_result
            assert "polygons" in image_result
            assert "metadata" in image_result
    
    @pytest.mark.asyncio
    async def test_segment_batch_images_empty(self, async_client: AsyncClient):
        """Test batch segmentation with no images."""
        data = {"model_name": "hrnet"}
        
        response = await async_client.post("/api/v1/segment/batch", data=data)
        assert response.status_code == 400
        
        result = response.json()
        assert "error" in result
        assert "no images" in result["error"].lower()
    
    @pytest.mark.asyncio
    async def test_segment_with_postprocessing_options(self, async_client: AsyncClient, sample_image_bytes: bytes, mock_model_inference):
        """Test segmentation with postprocessing options."""
        files = {"image": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {
            "model_name": "hrnet",
            "min_area": 100,
            "confidence_threshold": 0.5,
            "remove_edge_objects": True
        }
        
        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 200
        
        result = response.json()
        assert "polygons" in result
        
        # Check that postprocessing was applied (all polygons should meet criteria)
        for polygon in result["polygons"]:
            assert polygon["area"] >= 100
            assert polygon["confidence"] >= 0.5
    
    @pytest.mark.asyncio
    async def test_segment_with_custom_parameters(self, async_client: AsyncClient, sample_image_bytes: bytes, mock_model_inference):
        """Test segmentation with custom model parameters."""
        files = {"image": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {
            "model_name": "resunet_small",
            "image_size": 512,
            "overlap": 0.2,
            "batch_size": 2
        }
        
        response = await async_client.post("/api/v1/segment", files=files, data=data)
        assert response.status_code == 200
        
        result = response.json()
        assert "polygons" in result
        assert "metadata" in result
        
        # Check that custom parameters were used
        metadata = result["metadata"]
        assert metadata["model_name"] == "resunet_small"
    
    def test_cors_headers(self, client: TestClient):
        """Test that CORS headers are properly set."""
        response = client.options("/api/v1/status")
        
        # Check for CORS headers
        assert "access-control-allow-origin" in response.headers
        assert "access-control-allow-methods" in response.headers
        assert "access-control-allow-headers" in response.headers
    
    def test_rate_limiting(self, client: TestClient):
        """Test rate limiting functionality."""
        # Make multiple requests quickly
        responses = []
        for i in range(20):  # Exceed rate limit
            response = client.get("/api/v1/status")
            responses.append(response)
        
        # At least one should be rate limited
        status_codes = [r.status_code for r in responses]
        assert 429 in status_codes  # Too Many Requests
    
    @pytest.mark.asyncio
    async def test_concurrent_segmentation_requests(self, async_client: AsyncClient, sample_image_bytes: bytes, mock_model_inference):
        """Test handling of concurrent segmentation requests."""
        import asyncio
        
        async def make_request():
            files = {"image": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
            data = {"model_name": "hrnet"}
            response = await async_client.post("/api/v1/segment", files=files, data=data)
            return response.status_code
        
        # Make 5 concurrent requests
        tasks = [make_request() for _ in range(5)]
        results = await asyncio.gather(*tasks)
        
        # All should succeed
        assert all(status == 200 for status in results)
    
    @pytest.mark.slow
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_segmentation_performance(self, async_client: AsyncClient, sample_image_bytes: bytes):
        """Test segmentation performance (integration test)."""
        import time
        
        start_time = time.time()
        
        files = {"image": ("test.jpg", io.BytesIO(sample_image_bytes), "image/jpeg")}
        data = {"model_name": "resunet_small"}  # Use fastest model
        
        response = await async_client.post("/api/v1/segment", files=files, data=data)
        
        end_time = time.time()
        processing_time = end_time - start_time
        
        assert response.status_code == 200
        # Should complete within reasonable time (adjust based on hardware)
        assert processing_time < 30.0  # 30 seconds max
        
        result = response.json()
        assert "metadata" in result
        assert "processing_time" in result["metadata"]