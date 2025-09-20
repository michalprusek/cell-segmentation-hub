"""
ML Service Cancel API Tests
Tests for POST /api/v1/cancel/{job_id} endpoint functionality
"""

import pytest
import asyncio
import time
from unittest.mock import Mock, patch, AsyncMock
from fastapi.testclient import TestClient
from fastapi import status
import torch
import threading
from concurrent.futures import ThreadPoolExecutor

# Mock dependencies before imports
import sys
from unittest.mock import MagicMock

# Mock torch and CUDA
torch_mock = MagicMock()
torch_mock.cuda.is_available.return_value = True
torch_mock.cuda.empty_cache = MagicMock()
torch_mock.cuda.memory_reserved.return_value = 1024 * 1024 * 1024  # 1GB
torch_mock.cuda.memory_allocated.return_value = 512 * 1024 * 1024  # 512MB
sys.modules['torch'] = torch_mock

# Mock the ML models
sys.modules['models.hrnet'] = MagicMock()
sys.modules['models.cbam_resunet'] = MagicMock()
sys.modules['models.unet'] = MagicMock()

# Now import the actual modules
from app.main import app
from app.models.job import JobStatus, SegmentationJob
from app.services.inference_service import InferenceService
from app.services.gpu_manager import GPUManager
from app.core.config import settings

class TestData:
    """Test data fixtures for ML service cancel tests"""

    @staticmethod
    def active_job():
        return {
            "id": "job-ml-001",
            "image_id": "img-001",
            "project_id": "project-456",
            "user_id": "user-789",
            "model_name": "HRNet",
            "status": "processing",
            "progress": 45,
            "gpu_id": "gpu-0",
            "started_at": "2024-01-01T10:00:00Z",
            "estimated_duration": 30.0,
            "memory_usage": 1.2,
        }

    @staticmethod
    def queued_job():
        return {
            "id": "job-ml-002",
            "image_id": "img-002",
            "project_id": "project-456",
            "user_id": "user-789",
            "model_name": "CBAM-ResUNet",
            "status": "queued",
            "progress": 0,
            "gpu_id": None,
            "started_at": None,
            "estimated_duration": 45.0,
            "memory_usage": 0,
        }

    @staticmethod
    def completed_job():
        return {
            "id": "job-ml-003",
            "image_id": "img-003",
            "project_id": "project-456",
            "user_id": "user-789",
            "model_name": "U-Net",
            "status": "completed",
            "progress": 100,
            "gpu_id": "gpu-0",
            "started_at": "2024-01-01T10:00:00Z",
            "completed_at": "2024-01-01T10:00:30Z",
            "estimated_duration": 25.0,
            "memory_usage": 0,
        }

class MockInferenceService:
    """Mock inference service for testing"""

    def __init__(self):
        self.active_jobs = {}
        self.cancelled_jobs = set()
        self.executor = ThreadPoolExecutor(max_workers=2)

    def start_job(self, job_id: str, job_data: dict):
        """Start a mock inference job"""
        future = self.executor.submit(self._simulate_inference, job_id, job_data)
        self.active_jobs[job_id] = {
            'future': future,
            'data': job_data,
            'cancelled': False
        }
        return future

    def _simulate_inference(self, job_id: str, job_data: dict):
        """Simulate inference processing"""
        for i in range(100):
            if job_id in self.cancelled_jobs:
                raise RuntimeError(f"Job {job_id} was cancelled")
            time.sleep(0.01)  # Simulate processing time

        return {"polygons": [], "processing_time": 1.0}

    def cancel_job(self, job_id: str) -> bool:
        """Cancel an active job"""
        if job_id not in self.active_jobs:
            return False

        job = self.active_jobs[job_id]
        job['cancelled'] = True
        self.cancelled_jobs.add(job_id)

        # Try to cancel the future
        future = job['future']
        if not future.done():
            future.cancel()

        return True

    def is_job_active(self, job_id: str) -> bool:
        """Check if job is active"""
        return job_id in self.active_jobs and not self.active_jobs[job_id]['cancelled']

    def cleanup_job(self, job_id: str):
        """Cleanup job resources"""
        if job_id in self.active_jobs:
            del self.active_jobs[job_id]
        self.cancelled_jobs.discard(job_id)

class MockGPUManager:
    """Mock GPU manager for testing"""

    def __init__(self):
        self.allocated_memory = {}
        self.active_jobs = {}

    def allocate_gpu(self, job_id: str, memory_mb: int = 1024) -> str:
        """Allocate GPU for job"""
        gpu_id = "gpu-0"
        self.allocated_memory[job_id] = memory_mb
        self.active_jobs[job_id] = gpu_id
        return gpu_id

    def release_gpu(self, job_id: str):
        """Release GPU allocation"""
        if job_id in self.allocated_memory:
            del self.allocated_memory[job_id]
        if job_id in self.active_jobs:
            del self.active_jobs[job_id]

    def clear_gpu_memory(self, gpu_id: str):
        """Clear GPU memory"""
        torch_mock.cuda.empty_cache()

    def get_memory_usage(self, gpu_id: str) -> dict:
        """Get GPU memory usage"""
        return {
            "allocated": torch_mock.cuda.memory_allocated(),
            "reserved": torch_mock.cuda.memory_reserved(),
            "free": 8 * 1024 * 1024 * 1024 - torch_mock.cuda.memory_reserved()  # 8GB total
        }

# Global instances for testing
mock_inference_service = MockInferenceService()
mock_gpu_manager = MockGPUManager()

# Mock the services in the app
app.state.inference_service = mock_inference_service
app.state.gpu_manager = mock_gpu_manager

@pytest.fixture
def client():
    """Test client fixture"""
    return TestClient(app)

@pytest.fixture
def active_job_data():
    """Active job test data"""
    return TestData.active_job()

@pytest.fixture
def queued_job_data():
    """Queued job test data"""
    return TestData.queued_job()

@pytest.fixture
def completed_job_data():
    """Completed job test data"""
    return TestData.completed_job()

@pytest.fixture(autouse=True)
def cleanup_services():
    """Cleanup services after each test"""
    yield
    mock_inference_service.cancelled_jobs.clear()
    mock_inference_service.active_jobs.clear()
    mock_gpu_manager.allocated_memory.clear()
    mock_gpu_manager.active_jobs.clear()

class TestMLCancelAPI:
    """Test class for ML service cancel API"""

    def test_cancel_active_job_success(self, client, active_job_data):
        """Test successful cancellation of active job"""
        job_id = active_job_data["id"]

        # Start a mock job
        mock_inference_service.start_job(job_id, active_job_data)
        mock_gpu_manager.allocate_gpu(job_id)

        # Cancel the job
        response = client.post(f"/api/v1/cancel/{job_id}")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert data["success"] is True
        assert data["message"] == "Job cancelled successfully"
        assert data["job_id"] == job_id
        assert "cancelled_at" in data
        assert "gpu_memory_freed" in data

        # Verify job is cancelled
        assert not mock_inference_service.is_job_active(job_id)
        assert job_id in mock_inference_service.cancelled_jobs

    def test_cancel_queued_job_success(self, client, queued_job_data):
        """Test successful cancellation of queued job"""
        job_id = queued_job_data["id"]

        # Add job to queue (not started yet)
        mock_inference_service.active_jobs[job_id] = {
            'future': None,
            'data': queued_job_data,
            'cancelled': False
        }

        response = client.post(f"/api/v1/cancel/{job_id}")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert data["success"] is True
        assert data["job_id"] == job_id
        assert mock_inference_service.active_jobs[job_id]['cancelled'] is True

    def test_cancel_nonexistent_job(self, client):
        """Test cancellation of non-existent job"""
        response = client.post("/api/v1/cancel/non-existent-job")

        assert response.status_code == status.HTTP_404_NOT_FOUND
        data = response.json()

        assert data["detail"] == "Job not found"

    def test_cancel_already_completed_job(self, client, completed_job_data):
        """Test cancellation of already completed job"""
        job_id = completed_job_data["id"]

        response = client.post(f"/api/v1/cancel/{job_id}")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()

        assert "already completed" in data["detail"].lower()

    def test_cancel_already_cancelled_job(self, client, active_job_data):
        """Test cancellation of already cancelled job"""
        job_id = active_job_data["id"]

        # Start and cancel job first
        mock_inference_service.start_job(job_id, active_job_data)
        mock_inference_service.cancel_job(job_id)

        # Try to cancel again
        response = client.post(f"/api/v1/cancel/{job_id}")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()

        assert "already cancelled" in data["detail"].lower()

    def test_gpu_memory_cleanup_on_cancel(self, client, active_job_data):
        """Test GPU memory is cleaned up on cancellation"""
        job_id = active_job_data["id"]

        # Start job with GPU allocation
        mock_inference_service.start_job(job_id, active_job_data)
        gpu_id = mock_gpu_manager.allocate_gpu(job_id, 2048)  # 2GB

        # Get initial memory usage
        initial_memory = mock_gpu_manager.get_memory_usage(gpu_id)

        # Cancel job
        response = client.post(f"/api/v1/cancel/{job_id}")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        # Verify GPU resources were cleaned up
        assert "gpu_memory_freed" in data
        assert job_id not in mock_gpu_manager.active_jobs
        assert job_id not in mock_gpu_manager.allocated_memory

    def test_concurrent_job_cancellations(self, client):
        """Test concurrent cancellation of multiple jobs"""
        job_ids = ["job-concurrent-1", "job-concurrent-2", "job-concurrent-3"]

        # Start multiple jobs
        for i, job_id in enumerate(job_ids):
            job_data = TestData.active_job()
            job_data["id"] = job_id
            job_data["image_id"] = f"img-{i+1}"
            mock_inference_service.start_job(job_id, job_data)
            mock_gpu_manager.allocate_gpu(job_id)

        # Cancel all jobs concurrently
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(client.post, f"/api/v1/cancel/{job_id}")
                for job_id in job_ids
            ]

            responses = [future.result() for future in futures]

        # All cancellations should succeed
        for response in responses:
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["success"] is True

        # All jobs should be cancelled
        for job_id in job_ids:
            assert not mock_inference_service.is_job_active(job_id)

    def test_cancel_with_pytorch_process_interruption(self, client, active_job_data):
        """Test cancellation interrupts PyTorch processing"""
        job_id = active_job_data["id"]

        # Mock PyTorch inference in progress
        with patch('torch.cuda.is_available', return_value=True), \
             patch('torch.cuda.empty_cache') as mock_empty_cache:

            mock_inference_service.start_job(job_id, active_job_data)
            mock_gpu_manager.allocate_gpu(job_id)

            response = client.post(f"/api/v1/cancel/{job_id}")

            assert response.status_code == status.HTTP_200_OK

            # Verify GPU cache was cleared
            mock_empty_cache.assert_called()

    def test_cancel_high_memory_job(self, client):
        """Test cancellation of job using high GPU memory"""
        job_data = TestData.active_job()
        job_id = job_data["id"]

        # Simulate high memory usage (6GB)
        mock_inference_service.start_job(job_id, job_data)
        mock_gpu_manager.allocate_gpu(job_id, 6 * 1024)  # 6GB

        response = client.post(f"/api/v1/cancel/{job_id}")

        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert data["success"] is True
        assert data["gpu_memory_freed"] >= 6 * 1024  # At least 6GB freed

    def test_cancel_with_database_update_simulation(self, client, active_job_data):
        """Test cancellation updates job status in database (simulated)"""
        job_id = active_job_data["id"]

        mock_inference_service.start_job(job_id, active_job_data)

        with patch('app.services.database_service.update_job_status') as mock_db_update:
            response = client.post(f"/api/v1/cancel/{job_id}")

            assert response.status_code == status.HTTP_200_OK

            # Verify database update was called
            mock_db_update.assert_called_with(job_id, JobStatus.CANCELLED)

    def test_cancel_with_websocket_notification_simulation(self, client, active_job_data):
        """Test cancellation sends WebSocket notification (simulated)"""
        job_id = active_job_data["id"]

        mock_inference_service.start_job(job_id, active_job_data)

        with patch('app.services.websocket_service.notify_job_cancelled') as mock_ws_notify:
            response = client.post(f"/api/v1/cancel/{job_id}")

            assert response.status_code == status.HTTP_200_OK

            # Verify WebSocket notification was sent
            mock_ws_notify.assert_called_with(job_id, active_job_data["user_id"])

    def test_cancel_performance_benchmark(self, client, active_job_data):
        """Test cancellation completes within performance benchmark"""
        job_id = active_job_data["id"]

        mock_inference_service.start_job(job_id, active_job_data)
        mock_gpu_manager.allocate_gpu(job_id)

        start_time = time.time()
        response = client.post(f"/api/v1/cancel/{job_id}")
        end_time = time.time()

        cancellation_time = (end_time - start_time) * 1000  # Convert to ms

        assert response.status_code == status.HTTP_200_OK
        assert cancellation_time < 500  # Should complete in less than 500ms

    def test_cancel_memory_leak_prevention(self, client):
        """Test cancellation doesn't cause memory leaks"""
        job_ids = [f"job-memory-test-{i}" for i in range(20)]

        # Start and cancel many jobs
        for job_id in job_ids:
            job_data = TestData.active_job()
            job_data["id"] = job_id

            mock_inference_service.start_job(job_id, job_data)
            mock_gpu_manager.allocate_gpu(job_id)

            response = client.post(f"/api/v1/cancel/{job_id}")
            assert response.status_code == status.HTTP_200_OK

        # Verify no jobs are left in memory
        assert len(mock_inference_service.active_jobs) == 0
        assert len(mock_gpu_manager.active_jobs) == 0
        assert len(mock_gpu_manager.allocated_memory) == 0

    def test_cancel_with_model_specific_cleanup(self, client):
        """Test cancellation handles model-specific cleanup"""
        models = ["HRNet", "CBAM-ResUNet", "U-Net"]

        for i, model_name in enumerate(models):
            job_data = TestData.active_job()
            job_data["id"] = f"job-model-{i}"
            job_data["model_name"] = model_name

            mock_inference_service.start_job(job_data["id"], job_data)

            response = client.post(f"/api/v1/cancel/{job_data['id']}")

            assert response.status_code == status.HTTP_200_OK
            data = response.json()
            assert data["success"] is True

    def test_cancel_with_error_handling(self, client, active_job_data):
        """Test cancellation handles errors gracefully"""
        job_id = active_job_data["id"]

        # Simulate error during cancellation
        mock_inference_service.start_job(job_id, active_job_data)

        with patch.object(mock_inference_service, 'cancel_job', side_effect=Exception("GPU error")):
            response = client.post(f"/api/v1/cancel/{job_id}")

            # Should handle error gracefully
            assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
            data = response.json()
            assert "error" in data["detail"].lower()

    def test_cancel_invalid_job_id_format(self, client):
        """Test cancellation with invalid job ID format"""
        invalid_ids = [
            "",
            "a" * 1000,  # Very long ID
            "invalid/job/id",
            "job id with spaces",
            "job-id-with-special-chars!@#$%"
        ]

        for invalid_id in invalid_ids:
            response = client.post(f"/api/v1/cancel/{invalid_id}")

            # Should either return 404 or handle gracefully
            assert response.status_code in [
                status.HTTP_404_NOT_FOUND,
                status.HTTP_400_BAD_REQUEST
            ]

    def test_cancel_with_timeout_handling(self, client, active_job_data):
        """Test cancellation handles timeout scenarios"""
        job_id = active_job_data["id"]

        # Start long-running job
        mock_inference_service.start_job(job_id, active_job_data)

        # Simulate timeout during cancellation
        with patch.object(mock_inference_service, 'cancel_job') as mock_cancel:
            # Mock a slow cancellation
            def slow_cancel(job_id):
                time.sleep(2)  # Simulate slow cancellation
                return True

            mock_cancel.side_effect = slow_cancel

            start_time = time.time()
            response = client.post(f"/api/v1/cancel/{job_id}")
            end_time = time.time()

            # Should complete even if it takes time
            assert response.status_code == status.HTTP_200_OK
            assert (end_time - start_time) >= 2  # Should wait for cancellation

@pytest.mark.asyncio
class TestMLCancelAPIAsync:
    """Async tests for ML service cancel API"""

    async def test_async_job_cancellation(self, client, active_job_data):
        """Test asynchronous job cancellation"""
        job_id = active_job_data["id"]

        # Start async job
        mock_inference_service.start_job(job_id, active_job_data)

        # Cancel asynchronously
        response = client.post(f"/api/v1/cancel/{job_id}")

        assert response.status_code == status.HTTP_200_OK

        # Verify job is cancelled
        await asyncio.sleep(0.1)  # Allow for async cleanup
        assert not mock_inference_service.is_job_active(job_id)

    async def test_async_batch_cancellation(self, client):
        """Test asynchronous batch cancellation"""
        job_ids = [f"async-job-{i}" for i in range(5)]

        # Start multiple async jobs
        for job_id in job_ids:
            job_data = TestData.active_job()
            job_data["id"] = job_id
            mock_inference_service.start_job(job_id, job_data)

        # Cancel all jobs
        tasks = []
        for job_id in job_ids:
            response = client.post(f"/api/v1/cancel/{job_id}")
            assert response.status_code == status.HTTP_200_OK

        # Wait for all cancellations to complete
        await asyncio.sleep(0.5)

        # Verify all jobs are cancelled
        for job_id in job_ids:
            assert not mock_inference_service.is_job_active(job_id)

if __name__ == "__main__":
    # Run tests
    pytest.main([__file__, "-v"])