"""
Comprehensive Test Suite for 4-Way Parallel Inference Processing
Tests the enhanced InferenceExecutor with CUDA streams and concurrent execution
"""

import pytest
import torch
import threading
import time
import concurrent.futures
from unittest.mock import Mock, patch, MagicMock
import numpy as np

from ml.inference_executor import (
    InferenceExecutor,
    InferenceError,
    InferenceResourceError,
    InferenceTimeoutError,
    InferenceStatus,
    get_global_executor,
    cleanup_global_executor
)


class TestParallelInferenceExecutor:
    """Test suite for parallel inference execution"""

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        """Setup and teardown for each test"""
        # Cleanup any existing global executor
        cleanup_global_executor()
        yield
        # Cleanup after test
        cleanup_global_executor()

    @pytest.fixture
    def mock_model(self):
        """Create a mock PyTorch model"""
        model = Mock()
        model.eval = Mock()

        # Mock model output
        def mock_forward(x):
            # Simulate some processing time
            time.sleep(0.01)
            # Return tensor-like output
            return torch.zeros((x.shape[0], 1, 256, 256))

        model.side_effect = mock_forward
        return model

    @pytest.fixture
    def executor(self):
        """Create an InferenceExecutor for testing"""
        return InferenceExecutor(
            max_workers=4,
            default_timeout=10.0,
            memory_limit_gb=1.0,  # Small limit for testing
            enable_monitoring=True,
            enable_cuda_streams=True
        )

    def test_initialization_with_parallel_features(self, executor):
        """Test executor initialization with parallel processing features"""
        assert executor.executor._max_workers == 4
        assert executor.enable_cuda_streams is True
        assert executor.memory_limit_bytes == 1024 * 1024 * 1024  # 1GB

        # Check CUDA streams creation (when CUDA is available)
        if torch.cuda.is_available():
            assert len(executor.cuda_streams) == 4
            assert all(isinstance(stream, torch.cuda.Stream) for stream in executor.cuda_streams)
        else:
            assert len(executor.cuda_streams) == 0

    def test_cuda_stream_allocation(self, executor):
        """Test CUDA stream allocation and cycling"""
        if not torch.cuda.is_available():
            pytest.skip("CUDA not available")

        # Test stream allocation cycling
        streams = []
        for _ in range(8):  # Request more streams than available
            stream = executor.get_next_cuda_stream()
            streams.append(stream)

        # Should cycle through the 4 available streams
        assert streams[0] == streams[4]  # First and fifth should be the same
        assert streams[1] == streams[5]
        assert streams[2] == streams[6]
        assert streams[3] == streams[7]

    def test_concurrent_inference_execution(self, executor, mock_model):
        """Test concurrent inference execution without model locks"""
        input_tensor = torch.randn(2, 3, 256, 256)

        def run_inference(model_name):
            """Run single inference"""
            return executor.execute_inference(
                model=mock_model,
                input_tensor=input_tensor,
                model_name=model_name,
                timeout=5.0
            )

        # Run 4 concurrent inferences
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as thread_executor:
            futures = []
            start_time = time.time()

            for i in range(4):
                future = thread_executor.submit(run_inference, f"model_{i}")
                futures.append(future)

            # Wait for all to complete
            results = [future.result() for future in futures]
            end_time = time.time()

        # All inferences should complete successfully
        assert len(results) == 4
        assert all(result is not None for result in results)

        # Parallel execution should be faster than sequential
        # (This is a rough test - exact timing depends on mock model)
        total_time = end_time - start_time
        assert total_time < 0.5  # Should be much faster than 4 * 0.01 + overhead

    @patch('torch.cuda.is_available', return_value=True)
    @patch('torch.cuda.get_device_properties')
    @patch('torch.cuda.memory_allocated')
    def test_gpu_memory_pressure_detection(self, mock_allocated, mock_properties, mock_available, executor):
        """Test GPU memory pressure detection and cleanup"""
        # Mock GPU properties
        mock_device = Mock()
        mock_device.total_memory = 24 * 1024**3  # 24GB
        mock_properties.return_value = mock_device

        # Test normal memory usage (50%)
        mock_allocated.return_value = 12 * 1024**3
        executor._check_gpu_memory_pressure()  # Should not raise

        # Test high memory usage (95%) - should trigger emergency cleanup
        mock_allocated.return_value = 22.8 * 1024**3

        with patch.object(executor, '_emergency_memory_cleanup') as mock_cleanup:
            mock_allocated.side_effect = [
                22.8 * 1024**3,  # Initial high usage
                10 * 1024**3     # After cleanup
            ]
            executor._check_gpu_memory_pressure()
            mock_cleanup.assert_called_once()

    @patch('torch.cuda.is_available', return_value=True)
    @patch('torch.cuda.empty_cache')
    def test_emergency_memory_cleanup(self, mock_empty_cache, mock_available, executor):
        """Test emergency memory cleanup procedure"""
        # Add mock CUDA streams
        mock_streams = [Mock() for _ in range(4)]
        executor.cuda_streams = mock_streams

        with patch('gc.collect') as mock_gc:
            executor._emergency_memory_cleanup()

            # Should clear CUDA cache
            mock_empty_cache.assert_called_once()

            # Should synchronize all streams
            for stream in mock_streams:
                stream.synchronize.assert_called_once()

            # Should trigger garbage collection
            mock_gc.assert_called_once()

    def test_inference_with_cuda_stream_isolation(self, executor, mock_model):
        """Test that inference uses CUDA streams for isolation"""
        if not torch.cuda.is_available():
            pytest.skip("CUDA not available")

        input_tensor = torch.randn(1, 3, 256, 256)

        with patch('torch.cuda.stream') as mock_stream_context:
            executor.execute_inference(
                model=mock_model,
                input_tensor=input_tensor,
                model_name="test_model"
            )

            # Should use CUDA stream context
            mock_stream_context.assert_called_once()

    def test_metrics_include_parallel_processing_info(self, executor):
        """Test that metrics include parallel processing information"""
        metrics = executor.get_metrics()

        # Check parallel processing metrics
        assert "parallel_processing" in metrics
        parallel_metrics = metrics["parallel_processing"]

        assert parallel_metrics["max_workers"] == 4
        assert parallel_metrics["cuda_streams_enabled"] is True
        assert "cuda_streams_count" in parallel_metrics
        assert "current_stream_index" in parallel_metrics

        # Check GPU metrics if CUDA is available
        if torch.cuda.is_available():
            assert "gpu_metrics" in metrics
            gpu_metrics = metrics["gpu_metrics"]
            assert "total_memory_gb" in gpu_metrics
            assert "allocated_memory_gb" in gpu_metrics
            assert "memory_utilization" in gpu_metrics
            assert "device_name" in gpu_metrics

    def test_resource_error_on_out_of_memory(self, executor, mock_model):
        """Test proper error handling on GPU out of memory"""
        input_tensor = torch.randn(1, 3, 256, 256)

        # Mock model to raise OOM error
        def mock_oom_forward(x):
            raise RuntimeError("CUDA out of memory")

        mock_model.side_effect = mock_oom_forward

        with pytest.raises(InferenceResourceError) as exc_info:
            executor.execute_inference(
                model=mock_model,
                input_tensor=input_tensor,
                model_name="oom_model"
            )

        assert "GPU out of memory" in str(exc_info.value)

    def test_graceful_shutdown_with_cuda_streams(self, executor):
        """Test graceful shutdown synchronizes CUDA streams"""
        if not torch.cuda.is_available():
            pytest.skip("CUDA not available")

        # Start some mock work
        mock_streams = [Mock() for _ in range(4)]
        executor.cuda_streams = mock_streams

        with patch('torch.cuda.empty_cache') as mock_empty_cache:
            executor.shutdown(wait=True, timeout=5)

            # Should synchronize all streams
            for stream in mock_streams:
                stream.synchronize.assert_called_once()

            # Should clear CUDA cache
            mock_empty_cache.assert_called_once()

    def test_environment_variable_configuration(self):
        """Test that environment variables properly configure the executor"""
        with patch.dict('os.environ', {
            'ML_INFERENCE_WORKERS': '8',
            'ML_INFERENCE_TIMEOUT': '120',
            'ML_MEMORY_LIMIT_GB': '16',
            'ML_ENABLE_CUDA_STREAMS': 'false',
            'ML_ENABLE_MONITORING': 'false'
        }):
            executor = get_global_executor()

            assert executor.executor._max_workers == 8
            assert executor.default_timeout == 120.0
            assert executor.memory_limit_bytes == 16 * 1024**3
            assert executor.enable_cuda_streams is False
            assert executor.enable_monitoring is False

    def test_concurrent_inference_performance_benchmark(self, executor, mock_model):
        """Benchmark test for concurrent inference performance"""
        input_tensor = torch.randn(4, 3, 256, 256)  # Batch of 4

        def run_single_inference():
            return executor.execute_inference(
                model=mock_model,
                input_tensor=input_tensor,
                model_name="benchmark_model",
                timeout=10.0
            )

        # Sequential execution
        start_time = time.time()
        for _ in range(4):
            run_single_inference()
        sequential_time = time.time() - start_time

        # Concurrent execution
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as thread_executor:
            start_time = time.time()
            futures = [thread_executor.submit(run_single_inference) for _ in range(4)]
            [future.result() for future in futures]
            concurrent_time = time.time() - start_time

        # Concurrent should be faster (accounting for some overhead)
        # This is a rough test since we're using mocks
        print(f"Sequential: {sequential_time:.3f}s, Concurrent: {concurrent_time:.3f}s")
        assert concurrent_time < sequential_time * 0.8  # Should be at least 20% faster


class TestGlobalExecutorManagement:
    """Test global executor management with parallel processing"""

    def test_global_executor_singleton_with_parallel_config(self):
        """Test global executor singleton behavior with parallel configuration"""
        cleanup_global_executor()

        # First call should create new executor
        executor1 = get_global_executor()
        assert executor1 is not None
        assert executor1.executor._max_workers == 4  # Default from environment

        # Second call should return same instance
        executor2 = get_global_executor()
        assert executor1 is executor2

        cleanup_global_executor()

    def test_global_executor_cleanup(self):
        """Test global executor cleanup"""
        executor = get_global_executor()
        assert executor is not None

        cleanup_global_executor()

        # Should create new instance after cleanup
        new_executor = get_global_executor()
        assert new_executor is not executor


@pytest.mark.integration
class TestIntegrationWithRealModels:
    """Integration tests with actual model loading (if available)"""

    @pytest.mark.skipif(not torch.cuda.is_available(), reason="CUDA not available")
    def test_real_model_parallel_inference(self):
        """Integration test with real model (requires actual model files)"""
        # This test should be run in the actual environment with loaded models
        # Skip if not in full test environment
        pytest.skip("Integration test - requires full environment setup")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])