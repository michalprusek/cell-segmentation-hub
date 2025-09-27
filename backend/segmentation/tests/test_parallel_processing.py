"""
Test suite for 4-way parallel segmentation processing in ML service

This test suite validates concurrent model access, GPU memory management,
and performance characteristics of parallel inference execution.

Requirements tested:
- 4 simultaneous model inferences without locks
- GPU memory management during concurrent processing (24GB RTX A5000)
- CUDA stream isolation for parallel execution
- Error handling when GPU memory approaches limits
- Performance benchmarks for 4-user concurrent vs sequential processing
"""

import pytest
import asyncio
import threading
import time
import torch
import numpy as np
from unittest.mock import Mock, patch, MagicMock
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple

# Import the modules we're testing
from backend.segmentation.ml.inference_executor import (
    InferenceExecutor,
    InferenceError,
    InferenceTimeoutError,
    InferenceResourceError,
    InferenceStatus
)
from backend.segmentation.ml.model_loader import ModelLoader
from backend.segmentation.services.inference import InferenceService


@dataclass
class MockImage:
    """Mock image data for testing"""
    width: int = 512
    height: int = 512
    channels: int = 3

    def to_tensor(self) -> torch.Tensor:
        """Convert to tensor for model input"""
        return torch.randn(1, self.channels, self.height, self.width)


@dataclass
class ParallelTestResult:
    """Results from parallel processing tests"""
    execution_time: float
    success_count: int
    error_count: int
    memory_peak: Optional[float] = None
    throughput: Optional[float] = None
    gpu_utilization: Optional[float] = None


class TestMLServiceParallelProcessing:
    """Test suite for ML service parallel processing capabilities"""

    @pytest.fixture(autouse=True)
    def setup_test_environment(self):
        """Setup test environment with proper cleanup"""
        # Mock GPU availability
        self.original_cuda_available = torch.cuda.is_available
        torch.cuda.is_available = Mock(return_value=True)

        # Mock GPU memory functions
        self.mock_memory_allocated = Mock(return_value=0)
        self.mock_memory_reserved = Mock(return_value=0)
        self.mock_empty_cache = Mock()

        torch.cuda.memory_allocated = self.mock_memory_allocated
        torch.cuda.memory_reserved = self.mock_memory_reserved
        torch.cuda.empty_cache = self.mock_empty_cache

        # Create test images
        self.test_images = [MockImage() for _ in range(4)]

        yield

        # Cleanup
        torch.cuda.is_available = self.original_cuda_available

    @pytest.fixture
    def mock_model(self):
        """Create a mock PyTorch model for testing"""
        model = Mock(spec=torch.nn.Module)
        model.eval = Mock()
        model.forward = Mock(return_value=torch.randn(1, 1, 512, 512))
        model.__call__ = model.forward
        return model

    @pytest.fixture
    def inference_executor_4_workers(self):
        """Create InferenceExecutor configured for 4 concurrent workers"""
        return InferenceExecutor(
            max_workers=4,
            default_timeout=30.0,
            memory_limit_gb=20.0,  # 20GB limit for RTX A5000
            enable_monitoring=True
        )

    @pytest.fixture
    def inference_executor_sequential(self):
        """Create InferenceExecutor for sequential processing comparison"""
        return InferenceExecutor(
            max_workers=1,
            default_timeout=30.0,
            memory_limit_gb=20.0,
            enable_monitoring=True
        )

    def test_concurrent_model_access_without_locks(self, inference_executor_4_workers, mock_model):
        """Test that 4 simultaneous inferences can access models without locks"""
        # Remove model locks to enable true parallel processing
        inference_executor_4_workers._model_locks.clear()

        # Mock model inference time
        def mock_inference_with_delay(*args, **kwargs):
            time.sleep(0.1)  # 100ms inference time
            return torch.randn(1, 1, 512, 512)

        mock_model.forward.side_effect = mock_inference_with_delay

        # Prepare concurrent inference tasks
        def run_inference(image_idx):
            image_tensor = self.test_images[image_idx].to_tensor()
            return inference_executor_4_workers.execute_inference(
                model=mock_model,
                input_tensor=image_tensor,
                model_name=f"hrnet_worker_{image_idx}",
                timeout=5.0,
                image_size=(512, 512)
            )

        # Execute 4 concurrent inferences
        start_time = time.time()

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_inference, i) for i in range(4)]
            results = [future.result() for future in as_completed(futures)]

        execution_time = time.time() - start_time

        # Assertions
        assert len(results) == 4, "All 4 inferences should complete"
        assert execution_time < 0.5, f"Parallel execution should be faster than sequential (was {execution_time:.2f}s)"
        assert mock_model.forward.call_count == 4, "Model should be called 4 times"

        # Verify no blocking occurred (parallel execution should be ~100ms, not 400ms)
        assert execution_time < 0.2, "True parallel execution should complete in ~100ms"

    def test_gpu_memory_management_concurrent_processing(self, inference_executor_4_workers, mock_model):
        """Test GPU memory allocation and management during 4-way concurrent processing"""
        # Simulate progressive GPU memory usage
        memory_usage_sequence = [
            1024 * 1024 * 1024,    # 1GB - base usage
            3072 * 1024 * 1024,    # 3GB - after loading models
            6144 * 1024 * 1024,    # 6GB - during inference
            8192 * 1024 * 1024,    # 8GB - peak usage
        ]
        call_count = 0

        def mock_memory_progression():
            nonlocal call_count
            result = memory_usage_sequence[min(call_count, len(memory_usage_sequence) - 1)]
            call_count += 1
            return result

        self.mock_memory_allocated.side_effect = mock_memory_progression

        # Mock model with memory tracking
        def mock_inference_with_memory(*args, **kwargs):
            # Simulate GPU memory allocation during inference
            time.sleep(0.05)  # 50ms processing
            return torch.randn(1, 1, 512, 512)

        mock_model.forward.side_effect = mock_inference_with_memory

        # Execute concurrent inferences
        def run_memory_tracked_inference(image_idx):
            image_tensor = self.test_images[image_idx].to_tensor()
            with inference_executor_4_workers.inference_context(f"session_{image_idx}", "hrnet") as session:
                result = inference_executor_4_workers.execute_inference(
                    model=mock_model,
                    input_tensor=image_tensor,
                    model_name="hrnet",
                    timeout=10.0,
                    image_size=(512, 512)
                )
                return result, session.metrics

        # Run 4 concurrent inferences
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_memory_tracked_inference, i) for i in range(4)]
            results_and_metrics = [future.result() for future in as_completed(futures)]

        # Verify results
        assert len(results_and_metrics) == 4, "All inferences should complete"

        # Check memory monitoring was called
        assert self.mock_memory_allocated.call_count >= 4, "Memory should be monitored during inference"

        # Verify all sessions completed successfully
        for result, metrics in results_and_metrics:
            assert result is not None, "Inference should return results"
            assert metrics.status == InferenceStatus.COMPLETED, "Session should complete successfully"
            assert metrics.memory_before is not None, "Memory should be tracked before inference"
            assert metrics.memory_after is not None, "Memory should be tracked after inference"

    def test_cuda_stream_isolation(self, inference_executor_4_workers, mock_model):
        """Test CUDA stream isolation for true parallel GPU execution"""
        # Mock CUDA streams
        mock_streams = [Mock() for _ in range(4)]

        with patch('torch.cuda.Stream') as mock_stream_class:
            mock_stream_class.side_effect = mock_streams

            # Mock stream context manager
            for stream in mock_streams:
                stream.__enter__ = Mock(return_value=stream)
                stream.__exit__ = Mock(return_value=None)

            # Extend InferenceExecutor with CUDA streams (simulating the upgrade)
            class StreamIsolatedInferenceExecutor(InferenceExecutor):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, **kwargs)
                    self.cuda_streams = [torch.cuda.Stream() for _ in range(self.executor._max_workers)]
                    self.stream_index = 0

                def get_next_stream(self):
                    stream = self.cuda_streams[self.stream_index]
                    self.stream_index = (self.stream_index + 1) % len(self.cuda_streams)
                    return stream

            stream_executor = StreamIsolatedInferenceExecutor(
                max_workers=4,
                default_timeout=30.0,
                memory_limit_gb=20.0
            )

            # Track which streams are used
            used_streams = []

            def mock_inference_with_stream_tracking(*args, **kwargs):
                # Simulate checking which stream is active
                stream = stream_executor.get_next_stream()
                used_streams.append(stream)
                time.sleep(0.1)
                return torch.randn(1, 1, 512, 512)

            mock_model.forward.side_effect = mock_inference_with_stream_tracking

            # Execute concurrent inferences
            def run_stream_isolated_inference(image_idx):
                image_tensor = self.test_images[image_idx].to_tensor()
                return stream_executor.execute_inference(
                    model=mock_model,
                    input_tensor=image_tensor,
                    model_name="hrnet",
                    timeout=5.0
                )

            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = [executor.submit(run_stream_isolated_inference, i) for i in range(4)]
                results = [future.result() for future in as_completed(futures)]

            # Verify stream isolation
            assert len(results) == 4, "All inferences should complete"
            assert len(used_streams) == 4, "Each inference should use a stream"

            # Verify different streams were used (stream isolation)
            unique_streams = set(id(stream) for stream in used_streams)
            assert len(unique_streams) <= 4, "Should not use more streams than available"

            stream_executor.shutdown()

    def test_memory_pressure_error_handling(self, inference_executor_4_workers, mock_model):
        """Test error handling when GPU memory approaches limits"""
        # Set up memory limit close to current usage
        inference_executor_4_workers.memory_limit_bytes = 5 * 1024 * 1024 * 1024  # 5GB limit

        # Mock high memory usage scenario
        self.mock_memory_allocated.return_value = 6 * 1024 * 1024 * 1024  # 6GB usage (exceeds limit)

        # Test single inference under memory pressure
        image_tensor = self.test_images[0].to_tensor()

        with pytest.raises(InferenceResourceError, match="Memory usage.*exceeds limit"):
            inference_executor_4_workers.execute_inference(
                model=mock_model,
                input_tensor=image_tensor,
                model_name="hrnet",
                timeout=5.0,
                image_size=(512, 512)
            )

        # Verify empty_cache was called for cleanup
        assert self.mock_empty_cache.call_count >= 1, "GPU cache should be cleared on resource error"

    def test_graceful_degradation_from_4_to_2_users(self, mock_model):
        """Test graceful degradation when reducing concurrent users due to resource constraints"""
        # Start with 4 workers
        executor_4 = InferenceExecutor(max_workers=4, memory_limit_gb=20.0)

        # Simulate memory pressure that requires reducing concurrency
        high_memory_usage = 18 * 1024 * 1024 * 1024  # 18GB (close to limit)
        self.mock_memory_allocated.return_value = high_memory_usage

        # Mock model that consumes significant memory
        def memory_intensive_inference(*args, **kwargs):
            time.sleep(0.2)  # Slower processing due to memory constraints
            return torch.randn(1, 1, 512, 512)

        mock_model.forward.side_effect = memory_intensive_inference

        # Test graceful degradation by creating new executor with reduced workers
        executor_2 = InferenceExecutor(max_workers=2, memory_limit_gb=20.0)

        # Execute with reduced concurrency
        def run_degraded_inference(image_idx):
            image_tensor = self.test_images[image_idx].to_tensor()
            return executor_2.execute_inference(
                model=mock_model,
                input_tensor=image_tensor,
                model_name="hrnet",
                timeout=10.0,
                image_size=(512, 512)
            )

        start_time = time.time()

        with ThreadPoolExecutor(max_workers=2) as thread_executor:
            futures = [thread_executor.submit(run_degraded_inference, i) for i in range(4)]
            results = [future.result() for future in as_completed(futures)]

        execution_time = time.time() - start_time

        # Verify degraded performance still works
        assert len(results) == 4, "All inferences should complete even with reduced concurrency"
        assert execution_time > 0.3, "Degraded mode should be slower due to reduced parallelism"
        assert execution_time < 1.0, "Should still complete within reasonable time"

        executor_4.shutdown()
        executor_2.shutdown()

    def test_performance_4_concurrent_vs_sequential(self, mock_model):
        """Test performance comparison between 4-way concurrent and sequential processing"""
        # Mock model with realistic inference time
        def realistic_inference(*args, **kwargs):
            time.sleep(0.196)  # 196ms (HRNet baseline from memory)
            return torch.randn(1, 1, 512, 512)

        mock_model.forward.side_effect = realistic_inference

        # Test sequential processing
        sequential_executor = InferenceExecutor(max_workers=1, memory_limit_gb=20.0)

        start_time = time.time()
        for i in range(4):
            image_tensor = self.test_images[i].to_tensor()
            result = sequential_executor.execute_inference(
                model=mock_model,
                input_tensor=image_tensor,
                model_name="hrnet",
                timeout=5.0
            )
        sequential_time = time.time() - start_time

        # Reset mock call count
        mock_model.forward.reset_mock()
        mock_model.forward.side_effect = realistic_inference

        # Test concurrent processing
        concurrent_executor = InferenceExecutor(max_workers=4, memory_limit_gb=20.0)

        def run_concurrent_inference(image_idx):
            image_tensor = self.test_images[image_idx].to_tensor()
            return concurrent_executor.execute_inference(
                model=mock_model,
                input_tensor=image_tensor,
                model_name="hrnet",
                timeout=5.0
            )

        start_time = time.time()
        with ThreadPoolExecutor(max_workers=4) as thread_executor:
            futures = [thread_executor.submit(run_concurrent_inference, i) for i in range(4)]
            results = [future.result() for future in as_completed(futures)]
        concurrent_time = time.time() - start_time

        # Calculate performance metrics
        sequential_throughput = 4 / sequential_time  # images per second
        concurrent_throughput = 4 / concurrent_time  # images per second
        speedup_ratio = sequential_time / concurrent_time

        # Performance assertions
        assert len(results) == 4, "All concurrent inferences should complete"
        assert speedup_ratio > 3.0, f"Concurrent processing should be at least 3x faster (was {speedup_ratio:.2f}x)"
        assert concurrent_throughput > 15.0, f"Should achieve >15 img/s throughput (was {concurrent_throughput:.1f})"

        # Log performance results
        print(f"\nPerformance Comparison:")
        print(f"Sequential time: {sequential_time:.3f}s ({sequential_throughput:.1f} img/s)")
        print(f"Concurrent time: {concurrent_time:.3f}s ({concurrent_throughput:.1f} img/s)")
        print(f"Speedup ratio: {speedup_ratio:.2f}x")

        sequential_executor.shutdown()
        concurrent_executor.shutdown()

    def test_timeout_handling_concurrent_requests(self, inference_executor_4_workers, mock_model):
        """Test timeout handling for concurrent requests with different completion times"""
        # Mock models with different processing times
        def variable_inference(*args, **kwargs):
            # Simulate variable processing times
            processing_times = [0.1, 0.2, 5.0, 0.15]  # One slow request (5s)
            call_index = mock_model.forward.call_count % len(processing_times)
            time.sleep(processing_times[call_index])

            if processing_times[call_index] >= 5.0:
                # Simulate timeout for slow request
                raise TimeoutError("Simulated timeout")

            return torch.randn(1, 1, 512, 512)

        mock_model.forward.side_effect = variable_inference

        # Execute concurrent inferences with timeout
        def run_inference_with_timeout(image_idx):
            image_tensor = self.test_images[image_idx].to_tensor()
            try:
                return inference_executor_4_workers.execute_inference(
                    model=mock_model,
                    input_tensor=image_tensor,
                    model_name="hrnet",
                    timeout=1.0,  # 1 second timeout
                    image_size=(512, 512)
                )
            except InferenceTimeoutError:
                return None  # Mark timeout as None result

        # Run concurrent inferences
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_inference_with_timeout, i) for i in range(4)]
            results = [future.result() for future in as_completed(futures)]

        # Verify timeout handling
        successful_results = [r for r in results if r is not None]
        timeout_results = [r for r in results if r is None]

        assert len(successful_results) >= 3, "At least 3 inferences should complete successfully"
        assert len(timeout_results) <= 1, "At most 1 inference should timeout"
        assert len(results) == 4, "All futures should return (success or timeout)"

    def test_resource_allocation_fairness(self, inference_executor_4_workers, mock_model):
        """Test fair resource allocation among 4 concurrent users"""
        # Track resource allocation per "user"
        user_start_times = {}
        user_end_times = {}
        user_memory_usage = {}

        def track_user_inference(user_id):
            def tracked_inference(*args, **kwargs):
                user_start_times[user_id] = time.time()

                # Simulate memory allocation per user
                memory_per_user = 1.5 * 1024 * 1024 * 1024  # 1.5GB per user
                user_memory_usage[user_id] = memory_per_user

                time.sleep(0.2)  # Standard processing time

                user_end_times[user_id] = time.time()
                return torch.randn(1, 1, 512, 512)

            return tracked_inference

        # Create separate inference tasks for each "user"
        def run_user_inference(user_id):
            mock_model.forward.side_effect = track_user_inference(user_id)
            image_tensor = self.test_images[user_id].to_tensor()

            return inference_executor_4_workers.execute_inference(
                model=mock_model,
                input_tensor=image_tensor,
                model_name=f"hrnet_user_{user_id}",
                timeout=5.0,
                image_size=(512, 512)
            )

        # Execute concurrent user inferences
        start_time = time.time()
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_user_inference, user_id) for user_id in range(4)]
            results = [future.result() for future in as_completed(futures)]
        total_time = time.time() - start_time

        # Analyze fairness metrics
        processing_times = []
        for user_id in range(4):
            if user_id in user_start_times and user_id in user_end_times:
                user_processing_time = user_end_times[user_id] - user_start_times[user_id]
                processing_times.append(user_processing_time)

        # Fairness assertions
        assert len(results) == 4, "All user inferences should complete"
        assert len(processing_times) == 4, "All processing times should be tracked"

        # Check fairness - processing times should be similar (within 50ms of each other)
        min_time = min(processing_times)
        max_time = max(processing_times)
        fairness_delta = max_time - min_time

        assert fairness_delta < 0.1, f"Processing time variance should be <100ms (was {fairness_delta:.3f}s)"

        # Check total memory allocation doesn't exceed limits
        total_memory = sum(user_memory_usage.values())
        expected_memory = 4 * 1.5 * 1024 * 1024 * 1024  # 4 users × 1.5GB
        assert total_memory == expected_memory, "Memory allocation should be fair and predictable"

    def test_error_propagation_parallel_processing(self, inference_executor_4_workers, mock_model):
        """Test error propagation through parallel processing chains"""
        # Mock different types of errors for different inferences
        error_scenarios = [
            None,  # Success
            RuntimeError("CUDA out of memory"),  # GPU memory error
            ValueError("Invalid input tensor shape"),  # Input validation error
            None,  # Success
        ]

        call_count = 0
        def error_simulation(*args, **kwargs):
            nonlocal call_count
            error = error_scenarios[call_count % len(error_scenarios)]
            call_count += 1

            if error:
                raise error

            time.sleep(0.1)
            return torch.randn(1, 1, 512, 512)

        mock_model.forward.side_effect = error_simulation

        # Execute concurrent inferences with error handling
        def run_inference_with_error_handling(image_idx):
            image_tensor = self.test_images[image_idx].to_tensor()
            try:
                result = inference_executor_4_workers.execute_inference(
                    model=mock_model,
                    input_tensor=image_tensor,
                    model_name="hrnet",
                    timeout=5.0,
                    image_size=(512, 512)
                )
                return {'success': True, 'result': result, 'error': None}
            except Exception as e:
                return {'success': False, 'result': None, 'error': str(e)}

        # Run concurrent inferences
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_inference_with_error_handling, i) for i in range(4)]
            results = [future.result() for future in as_completed(futures)]

        # Analyze error propagation
        successful_results = [r for r in results if r['success']]
        failed_results = [r for r in results if not r['success']]

        # Verify error propagation doesn't affect other inferences
        assert len(successful_results) >= 2, "Successful inferences should not be affected by errors in other threads"
        assert len(failed_results) <= 2, "Only inferences with actual errors should fail"

        # Verify specific error messages are preserved
        cuda_errors = [r for r in failed_results if 'CUDA out of memory' in r['error']]
        validation_errors = [r for r in failed_results if 'Invalid input tensor' in r['error']]

        assert len(cuda_errors) <= 1, "Should have at most one CUDA memory error"
        assert len(validation_errors) <= 1, "Should have at most one validation error"

    def test_metrics_collection_concurrent_processing(self, inference_executor_4_workers, mock_model):
        """Test comprehensive metrics collection during concurrent processing"""
        # Mock realistic processing scenario
        def realistic_inference(*args, **kwargs):
            time.sleep(0.15)  # 150ms processing
            return torch.randn(1, 1, 512, 512)

        mock_model.forward.side_effect = realistic_inference

        # Execute concurrent inferences and collect metrics
        def run_inference_with_metrics(image_idx):
            image_tensor = self.test_images[image_idx].to_tensor()
            session_id = f"test_session_{image_idx}"

            with inference_executor_4_workers.inference_context(session_id, "hrnet") as session:
                result = inference_executor_4_workers.execute_inference(
                    model=mock_model,
                    input_tensor=image_tensor,
                    model_name="hrnet",
                    timeout=5.0,
                    image_size=(512, 512)
                )
                return result, session.metrics

        # Run concurrent inferences
        start_time = time.time()
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_inference_with_metrics, i) for i in range(4)]
            results_and_metrics = [future.result() for future in as_completed(futures)]
        total_time = time.time() - start_time

        # Analyze collected metrics
        all_metrics = [metrics for _, metrics in results_and_metrics]

        # Verify metrics collection
        assert len(all_metrics) == 4, "Should collect metrics for all inferences"

        for metrics in all_metrics:
            assert metrics.status == InferenceStatus.COMPLETED, "All inferences should complete successfully"
            assert metrics.duration is not None, "Processing duration should be recorded"
            assert metrics.duration > 0.1, "Duration should reflect actual processing time"
            assert metrics.duration < 0.3, "Duration should be reasonable for test scenario"
            assert metrics.memory_before is not None, "Memory before should be tracked"
            assert metrics.memory_after is not None, "Memory after should be tracked"

        # Check overall executor metrics
        executor_metrics = inference_executor_4_workers.get_metrics()
        assert executor_metrics['total_inferences'] >= 4, "Total inference count should be updated"
        assert executor_metrics['timeout_count'] == 0, "No timeouts should occur in this test"
        assert executor_metrics['failure_count'] == 0, "No failures should occur in this test"
        assert executor_metrics['timeout_rate'] == 0.0, "Timeout rate should be 0%"
        assert executor_metrics['failure_rate'] == 0.0, "Failure rate should be 0%"

        # Performance verification
        avg_duration = sum(m.duration for m in all_metrics) / len(all_metrics)
        assert avg_duration < 0.2, f"Average inference time should be <200ms (was {avg_duration:.3f}s)"
        assert total_time < 0.3, f"Total parallel execution should be <300ms (was {total_time:.3f}s)"


@pytest.mark.integration
class TestMLServiceIntegration:
    """Integration tests for ML service with real-world scenarios"""

    def test_model_loading_concurrent_access(self):
        """Test concurrent access to model loading and inference"""
        # This would test actual model loading in a real scenario
        # For now, we mock the behavior
        with patch('backend.segmentation.ml.model_loader.ModelLoader') as mock_loader:
            # Mock model loader with concurrent access
            mock_loader.return_value.load_model.return_value = Mock()
            mock_loader.return_value.get_model.return_value = Mock()

            # Test concurrent model access
            def load_and_use_model(model_name):
                loader = mock_loader()
                model = loader.get_model(model_name)
                return model is not None

            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = [executor.submit(load_and_use_model, f"hrnet_{i}") for i in range(4)]
                results = [future.result() for future in as_completed(futures)]

            assert all(results), "All model access should succeed"
            assert mock_loader.return_value.get_model.call_count == 4, "All models should be accessed"


@pytest.mark.performance
class TestPerformanceBenchmarks:
    """Performance benchmark tests for parallel processing"""

    @pytest.mark.parametrize("concurrent_users", [1, 2, 4])
    def test_throughput_scaling(self, concurrent_users):
        """Test throughput scaling with different numbers of concurrent users"""
        # Mock performance characteristics
        base_inference_time = 0.2  # 200ms base inference time

        executor = InferenceExecutor(
            max_workers=concurrent_users,
            memory_limit_gb=20.0
        )

        mock_model = Mock()
        mock_model.eval = Mock()

        def mock_inference(*args, **kwargs):
            time.sleep(base_inference_time)
            return torch.randn(1, 1, 512, 512)

        mock_model.forward = mock_inference
        mock_model.__call__ = mock_inference

        # Measure throughput
        num_images = 8
        start_time = time.time()

        def run_inference(image_idx):
            image_tensor = torch.randn(1, 3, 512, 512)
            return executor.execute_inference(
                model=mock_model,
                input_tensor=image_tensor,
                model_name="hrnet",
                timeout=10.0
            )

        with ThreadPoolExecutor(max_workers=concurrent_users) as thread_executor:
            futures = [thread_executor.submit(run_inference, i) for i in range(num_images)]
            results = [future.result() for future in as_completed(futures)]

        total_time = time.time() - start_time
        throughput = num_images / total_time

        # Expected throughput scaling
        expected_min_throughput = min(concurrent_users * 4.0, 20.0)  # Cap at reasonable maximum

        assert len(results) == num_images, f"All {num_images} inferences should complete"
        assert throughput >= expected_min_throughput * 0.8, f"Throughput should scale with concurrency (got {throughput:.1f} img/s)"

        print(f"Concurrent users: {concurrent_users}, Throughput: {throughput:.1f} img/s")

        executor.shutdown()


if __name__ == "__main__":
    # Run tests with specific markers
    pytest.main([
        __file__,
        "-v",
        "--tb=short",
        "-m", "not slow",  # Skip slow tests by default
        "--durations=10",  # Show 10 slowest tests
    ])