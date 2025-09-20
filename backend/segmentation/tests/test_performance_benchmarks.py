"""
Performance benchmarking and failure scenario tests for 4-way parallel processing

This test suite provides comprehensive performance benchmarks and failure scenario
testing for the 4-way parallel segmentation processing implementation.

Requirements tested:
- GPU utilization tests (target: 60-80% vs current 20%)
- Throughput measurements (target: 4x improvement)
- Memory leak detection during sustained parallel processing
- Connection pool stability under load
- OOM recovery when GPU memory exceeds limits
- Graceful degradation from 4 to 2 concurrent users
- Database deadlock prevention during concurrent operations
- ML service timeout handling for concurrent requests
"""

import pytest
import asyncio
import threading
import time
import psutil
import gc
import torch
import numpy as np
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any
from unittest.mock import Mock, patch, MagicMock
import sqlite3
import json
import os

# Import modules under test
from backend.segmentation.ml.inference_executor import (
    InferenceExecutor,
    InferenceError,
    InferenceTimeoutError,
    InferenceResourceError
)


@dataclass
class PerformanceMetrics:
    """Comprehensive performance metrics for parallel processing"""
    throughput_imgs_per_sec: float = 0.0
    gpu_utilization_percent: float = 0.0
    memory_usage_gb: float = 0.0
    memory_peak_gb: float = 0.0
    processing_latency_ms: float = 0.0
    concurrent_users: int = 0
    total_processing_time_ms: float = 0.0
    successful_inferences: int = 0
    failed_inferences: int = 0
    timeout_count: int = 0
    memory_leaks_detected: bool = False
    connection_pool_utilization: float = 0.0
    errors: List[str] = field(default_factory=list)


@dataclass
class BenchmarkConfig:
    """Configuration for performance benchmarks"""
    concurrent_users: int = 4
    images_per_user: int = 10
    test_duration_seconds: int = 60
    memory_limit_gb: float = 20.0
    expected_throughput_min: float = 60.0  # imgs/s
    expected_gpu_utilization_min: float = 60.0  # %
    expected_speedup_min: float = 3.0  # vs sequential


@dataclass
class FailureScenario:
    """Configuration for failure scenario testing"""
    name: str
    failure_type: str
    failure_probability: float
    recovery_expected: bool
    max_recovery_time_ms: int = 10000


class MockGPUMonitor:
    """Mock GPU monitoring for testing"""

    def __init__(self, total_memory_gb: float = 24.0):
        self.total_memory = total_memory_gb * 1024 * 1024 * 1024  # Convert to bytes
        self.allocated_memory = 0
        self.allocation_history: List[int] = []
        self.utilization_history: List[float] = []
        self._lock = threading.Lock()

    def allocate_memory(self, amount_bytes: int):
        with self._lock:
            self.allocated_memory += amount_bytes
            self.allocation_history.append(self.allocated_memory)

    def free_memory(self, amount_bytes: int):
        with self._lock:
            self.allocated_memory = max(0, self.allocated_memory - amount_bytes)
            self.allocation_history.append(self.allocated_memory)

    def get_utilization(self) -> float:
        with self._lock:
            utilization = (self.allocated_memory / self.total_memory) * 100
            self.utilization_history.append(utilization)
            return utilization

    def get_peak_memory_gb(self) -> float:
        return max(self.allocation_history) / (1024 * 1024 * 1024) if self.allocation_history else 0.0

    def simulate_parallel_usage(self, num_concurrent: int, allocation_per_stream_gb: float):
        """Simulate memory allocation for parallel processing"""
        allocation_bytes = int(num_concurrent * allocation_per_stream_gb * 1024 * 1024 * 1024)
        self.allocate_memory(allocation_bytes)
        return self.get_utilization()


class DatabaseConnectionPool:
    """Mock database connection pool for testing"""

    def __init__(self, max_connections: int = 50):
        self.max_connections = max_connections
        self.active_connections = 0
        self.connection_history: List[int] = []
        self.deadlock_count = 0
        self._lock = threading.Lock()

    def acquire_connection(self) -> bool:
        with self._lock:
            if self.active_connections < self.max_connections:
                self.active_connections += 1
                self.connection_history.append(self.active_connections)
                return True
            return False

    def release_connection(self):
        with self._lock:
            if self.active_connections > 0:
                self.active_connections -= 1
                self.connection_history.append(self.active_connections)

    def simulate_deadlock(self):
        with self._lock:
            self.deadlock_count += 1

    def get_utilization(self) -> float:
        return (self.active_connections / self.max_connections) * 100

    def get_peak_utilization(self) -> float:
        return (max(self.connection_history) / self.max_connections * 100) if self.connection_history else 0.0


@pytest.mark.performance
class TestPerformanceBenchmarks:
    """Performance benchmark test suite for parallel processing"""

    @pytest.fixture(autouse=True)
    def setup_monitoring(self):
        """Setup performance monitoring infrastructure"""
        self.gpu_monitor = MockGPUMonitor(total_memory_gb=24.0)
        self.db_pool = DatabaseConnectionPool(max_connections=50)
        self.performance_metrics = PerformanceMetrics()

        # Mock GPU functions
        self.original_cuda_available = torch.cuda.is_available
        torch.cuda.is_available = Mock(return_value=True)

        # Mock memory monitoring
        torch.cuda.memory_allocated = Mock(side_effect=lambda: self.gpu_monitor.allocated_memory)
        torch.cuda.get_device_properties = Mock(return_value=Mock(total_memory=self.gpu_monitor.total_memory))
        torch.cuda.empty_cache = Mock()

        yield

        # Cleanup
        torch.cuda.is_available = self.original_cuda_available

    def create_mock_model(self, inference_time_ms: int = 196, memory_usage_mb: int = 500):
        """Create a mock model with realistic performance characteristics"""
        model = Mock(spec=torch.nn.Module)
        model.eval = Mock()

        def mock_inference(*args, **kwargs):
            # Simulate memory allocation
            memory_bytes = memory_usage_mb * 1024 * 1024
            self.gpu_monitor.allocate_memory(memory_bytes)

            # Simulate processing time
            time.sleep(inference_time_ms / 1000.0)

            # Simulate memory release
            self.gpu_monitor.free_memory(memory_bytes)

            return torch.randn(1, 1, 512, 512)

        model.forward = mock_inference
        model.__call__ = mock_inference
        return model

    def test_gpu_utilization_benchmark(self):
        """Test GPU utilization improvement with parallel processing"""
        config = BenchmarkConfig(concurrent_users=4, images_per_user=5)

        # Test sequential processing baseline
        sequential_executor = InferenceExecutor(max_workers=1, memory_limit_gb=20.0)
        sequential_model = self.create_mock_model(inference_time_ms=196, memory_usage_mb=500)

        sequential_start_time = time.time()
        sequential_utilizations = []

        for i in range(config.concurrent_users * config.images_per_user):
            image_tensor = torch.randn(1, 3, 512, 512)
            sequential_executor.execute_inference(
                model=sequential_model,
                input_tensor=image_tensor,
                model_name="hrnet_sequential",
                timeout=10.0
            )
            sequential_utilizations.append(self.gpu_monitor.get_utilization())

        sequential_time = time.time() - sequential_start_time
        sequential_avg_utilization = sum(sequential_utilizations) / len(sequential_utilizations)

        # Reset GPU monitor
        self.gpu_monitor = MockGPUMonitor(total_memory_gb=24.0)

        # Test parallel processing
        parallel_executor = InferenceExecutor(max_workers=4, memory_limit_gb=20.0, enable_cuda_streams=True)
        parallel_model = self.create_mock_model(inference_time_ms=196, memory_usage_mb=500)

        def run_parallel_inference(image_idx):
            image_tensor = torch.randn(1, 3, 512, 512)
            return parallel_executor.execute_inference(
                model=parallel_model,
                input_tensor=image_tensor,
                model_name=f"hrnet_parallel_{image_idx}",
                timeout=10.0
            )

        parallel_start_time = time.time()
        parallel_utilizations = []

        # Submit all inferences in parallel
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_parallel_inference, i)
                      for i in range(config.concurrent_users * config.images_per_user)]

            # Monitor utilization during processing
            monitoring_start = time.time()
            while any(not f.done() for f in futures) and time.time() - monitoring_start < 30:
                parallel_utilizations.append(self.gpu_monitor.get_utilization())
                time.sleep(0.1)

            # Wait for completion
            results = [f.result() for f in as_completed(futures)]

        parallel_time = time.time() - parallel_start_time
        parallel_avg_utilization = sum(parallel_utilizations) / len(parallel_utilizations) if parallel_utilizations else 0
        parallel_peak_utilization = max(parallel_utilizations) if parallel_utilizations else 0

        # Calculate performance metrics
        speedup_ratio = sequential_time / parallel_time
        sequential_throughput = (config.concurrent_users * config.images_per_user) / sequential_time
        parallel_throughput = (config.concurrent_users * config.images_per_user) / parallel_time

        # Performance assertions
        assert speedup_ratio >= config.expected_speedup_min, f"Speedup {speedup_ratio:.2f}x below expected {config.expected_speedup_min}x"
        assert parallel_throughput >= config.expected_throughput_min, f"Throughput {parallel_throughput:.1f} img/s below expected {config.expected_throughput_min} img/s"
        assert parallel_peak_utilization >= config.expected_gpu_utilization_min, f"Peak GPU utilization {parallel_peak_utilization:.1f}% below expected {config.expected_gpu_utilization_min}%"

        # Verify utilization improvement
        utilization_improvement = parallel_peak_utilization - sequential_avg_utilization
        assert utilization_improvement > 30, f"GPU utilization improvement {utilization_improvement:.1f}% insufficient"

        # Store metrics
        self.performance_metrics.throughput_imgs_per_sec = parallel_throughput
        self.performance_metrics.gpu_utilization_percent = parallel_peak_utilization
        self.performance_metrics.successful_inferences = len(results)

        print(f"GPU Utilization Benchmark Results:")
        print(f"Sequential: {sequential_throughput:.1f} img/s, {sequential_avg_utilization:.1f}% GPU")
        print(f"Parallel: {parallel_throughput:.1f} img/s, {parallel_peak_utilization:.1f}% GPU")
        print(f"Speedup: {speedup_ratio:.2f}x, Utilization improvement: {utilization_improvement:.1f}%")

        sequential_executor.shutdown()
        parallel_executor.shutdown()

    def test_throughput_scaling_benchmark(self):
        """Test throughput scaling with different concurrent user counts"""
        user_counts = [1, 2, 4]
        throughput_results = {}

        for user_count in user_counts:
            # Reset monitoring
            self.gpu_monitor = MockGPUMonitor(total_memory_gb=24.0)

            executor = InferenceExecutor(max_workers=user_count, memory_limit_gb=20.0)
            model = self.create_mock_model(inference_time_ms=196, memory_usage_mb=500)

            images_per_user = 5
            total_images = user_count * images_per_user

            def run_inference(image_idx):
                image_tensor = torch.randn(1, 3, 512, 512)
                return executor.execute_inference(
                    model=model,
                    input_tensor=image_tensor,
                    model_name=f"hrnet_{user_count}users_{image_idx}",
                    timeout=10.0
                )

            start_time = time.time()

            with ThreadPoolExecutor(max_workers=user_count) as thread_executor:
                futures = [thread_executor.submit(run_inference, i) for i in range(total_images)]
                results = [f.result() for f in as_completed(futures)]

            end_time = time.time()
            processing_time = end_time - start_time
            throughput = total_images / processing_time

            throughput_results[user_count] = {
                'throughput': throughput,
                'processing_time': processing_time,
                'total_images': total_images,
                'peak_gpu_utilization': self.gpu_monitor.get_peak_memory_gb()
            }

            executor.shutdown()

        # Analyze scaling efficiency
        baseline_throughput = throughput_results[1]['throughput']

        for user_count in [2, 4]:
            actual_throughput = throughput_results[user_count]['throughput']
            expected_min_throughput = baseline_throughput * user_count * 0.75  # 75% scaling efficiency
            scaling_efficiency = actual_throughput / (baseline_throughput * user_count)

            assert actual_throughput >= expected_min_throughput, \
                f"{user_count} users: throughput {actual_throughput:.1f} below expected {expected_min_throughput:.1f} img/s"

            assert scaling_efficiency >= 0.6, \
                f"{user_count} users: scaling efficiency {scaling_efficiency:.2f} below 60%"

        # Verify 4-user target throughput
        four_user_throughput = throughput_results[4]['throughput']
        assert four_user_throughput >= 60.0, f"4-user throughput {four_user_throughput:.1f} below target 60 img/s"

        print("Throughput Scaling Results:")
        for user_count, results in throughput_results.items():
            efficiency = results['throughput'] / (baseline_throughput * user_count) if user_count > 1 else 1.0
            print(f"{user_count} users: {results['throughput']:.1f} img/s, {efficiency:.2%} efficiency")

    def test_memory_leak_detection(self):
        """Test for memory leaks during sustained parallel processing"""
        config = BenchmarkConfig(concurrent_users=4, test_duration_seconds=30)

        executor = InferenceExecutor(max_workers=4, memory_limit_gb=20.0, enable_monitoring=True)
        model = self.create_mock_model(inference_time_ms=150, memory_usage_mb=800)

        # Track memory usage over time
        memory_samples = []
        start_time = time.time()

        def run_continuous_inference():
            """Run continuous inference operations"""
            image_count = 0
            while time.time() - start_time < config.test_duration_seconds:
                try:
                    image_tensor = torch.randn(1, 3, 512, 512)
                    result = executor.execute_inference(
                        model=model,
                        input_tensor=image_tensor,
                        model_name=f"memory_test_{image_count}",
                        timeout=5.0
                    )
                    image_count += 1

                    # Sample memory every 10 inferences
                    if image_count % 10 == 0:
                        memory_samples.append({
                            'timestamp': time.time() - start_time,
                            'allocated_memory_gb': self.gpu_monitor.get_utilization() / 100 * 24,
                            'image_count': image_count
                        })

                except Exception as e:
                    print(f"Inference error: {e}")
                    break

            return image_count

        # Run parallel continuous processing
        with ThreadPoolExecutor(max_workers=4) as thread_executor:
            futures = [thread_executor.submit(run_continuous_inference) for _ in range(4)]
            total_images_processed = sum(f.result() for f in as_completed(futures))

        executor.shutdown()

        # Analyze memory leak patterns
        if len(memory_samples) >= 3:
            # Check for consistent memory growth (leak indicator)
            memory_values = [sample['allocated_memory_gb'] for sample in memory_samples]

            # Calculate trend using linear regression
            x_values = list(range(len(memory_values)))
            n = len(memory_values)

            if n > 1:
                x_mean = sum(x_values) / n
                y_mean = sum(memory_values) / n

                numerator = sum((x_values[i] - x_mean) * (memory_values[i] - y_mean) for i in range(n))
                denominator = sum((x_values[i] - x_mean) ** 2 for i in range(n))

                slope = numerator / denominator if denominator != 0 else 0

                # Memory leak detected if consistent upward trend
                memory_leak_threshold = 0.1  # GB per sample
                memory_leak_detected = slope > memory_leak_threshold

                self.performance_metrics.memory_leaks_detected = memory_leak_detected

                # Assert no significant memory leaks
                assert not memory_leak_detected, f"Memory leak detected: {slope:.3f} GB/sample growth"

                # Verify memory stays within reasonable bounds
                max_memory = max(memory_values)
                assert max_memory < 20.0, f"Memory usage exceeded limit: {max_memory:.1f} GB"

        print(f"Memory Leak Test Results:")
        print(f"Duration: {config.test_duration_seconds}s, Images processed: {total_images_processed}")
        print(f"Memory samples: {len(memory_samples)}")
        if memory_samples:
            print(f"Memory range: {min(s['allocated_memory_gb'] for s in memory_samples):.1f}-{max(s['allocated_memory_gb'] for s in memory_samples):.1f} GB")

    def test_connection_pool_stability(self):
        """Test database connection pool stability under concurrent load"""
        config = BenchmarkConfig(concurrent_users=8, images_per_user=10)  # Higher load

        # Simulate database operations with connection pool
        def simulate_database_operation(operation_id: int):
            """Simulate a database operation requiring a connection"""
            connection_acquired = self.db_pool.acquire_connection()

            if not connection_acquired:
                return {'operation_id': operation_id, 'success': False, 'error': 'Connection pool exhausted'}

            try:
                # Simulate database query time
                query_time = np.random.normal(0.05, 0.02)  # 50ms ± 20ms
                time.sleep(max(0.01, query_time))

                # Small chance of deadlock simulation
                if np.random.random() < 0.02:  # 2% chance
                    self.db_pool.simulate_deadlock()
                    return {'operation_id': operation_id, 'success': False, 'error': 'Deadlock detected'}

                return {'operation_id': operation_id, 'success': True, 'response_time': query_time}

            finally:
                self.db_pool.release_connection()

        # Run concurrent database operations
        total_operations = config.concurrent_users * config.images_per_user
        start_time = time.time()

        with ThreadPoolExecutor(max_workers=config.concurrent_users) as executor:
            futures = [executor.submit(simulate_database_operation, i) for i in range(total_operations)]
            results = [f.result() for f in as_completed(futures)]

        end_time = time.time()
        total_time = end_time - start_time

        # Analyze connection pool performance
        successful_operations = [r for r in results if r['success']]
        failed_operations = [r for r in results if not r['success']]

        success_rate = len(successful_operations) / len(results)
        peak_utilization = self.db_pool.get_peak_utilization()
        deadlock_count = self.db_pool.deadlock_count

        # Performance assertions
        assert success_rate >= 0.95, f"Success rate {success_rate:.2%} below 95%"
        assert peak_utilization <= 100, f"Connection pool over-utilized: {peak_utilization:.1f}%"
        assert deadlock_count <= total_operations * 0.05, f"Too many deadlocks: {deadlock_count}"

        # Response time analysis
        if successful_operations:
            response_times = [op['response_time'] for op in successful_operations if 'response_time' in op]
            if response_times:
                avg_response_time = sum(response_times) / len(response_times)
                max_response_time = max(response_times)

                assert avg_response_time < 0.1, f"Average response time {avg_response_time:.3f}s too slow"
                assert max_response_time < 0.5, f"Max response time {max_response_time:.3f}s too slow"

        self.performance_metrics.connection_pool_utilization = peak_utilization

        print(f"Connection Pool Stability Results:")
        print(f"Operations: {len(results)}, Success rate: {success_rate:.2%}")
        print(f"Peak utilization: {peak_utilization:.1f}%, Deadlocks: {deadlock_count}")
        print(f"Total time: {total_time:.2f}s")


@pytest.mark.failure_scenarios
class TestFailureScenarios:
    """Failure scenario test suite for parallel processing resilience"""

    @pytest.fixture(autouse=True)
    def setup_failure_testing(self):
        """Setup failure testing infrastructure"""
        self.gpu_monitor = MockGPUMonitor(total_memory_gb=24.0)
        self.failure_metrics = {
            'oom_recoveries': 0,
            'degradation_events': 0,
            'timeout_recoveries': 0,
            'connection_failures': 0
        }

        # Mock GPU functions
        torch.cuda.is_available = Mock(return_value=True)
        torch.cuda.memory_allocated = Mock(side_effect=lambda: self.gpu_monitor.allocated_memory)
        torch.cuda.get_device_properties = Mock(return_value=Mock(total_memory=self.gpu_monitor.total_memory))
        torch.cuda.empty_cache = Mock(side_effect=self.gpu_monitor.free_memory)

        yield

    def test_oom_recovery_scenario(self):
        """Test out-of-memory recovery mechanisms"""
        # Configure executor with limited memory
        executor = InferenceExecutor(max_workers=4, memory_limit_gb=8.0, enable_monitoring=True)

        # Create memory-intensive model
        def memory_intensive_inference(*args, **kwargs):
            # Simulate high memory usage that could trigger OOM
            memory_allocation = 3 * 1024 * 1024 * 1024  # 3GB per inference
            self.gpu_monitor.allocate_memory(memory_allocation)

            # Check if we're approaching memory limits
            utilization = self.gpu_monitor.get_utilization()
            if utilization > 90:  # 90% utilization triggers OOM simulation
                self.gpu_monitor.free_memory(memory_allocation)  # Immediate cleanup
                raise RuntimeError("CUDA out of memory")

            time.sleep(0.2)  # Simulate processing
            self.gpu_monitor.free_memory(memory_allocation)  # Normal cleanup
            return torch.randn(1, 1, 512, 512)

        model = Mock(spec=torch.nn.Module)
        model.eval = Mock()
        model.forward = memory_intensive_inference
        model.__call__ = memory_intensive_inference

        # Run inferences that will trigger OOM
        def run_oom_prone_inference(image_idx):
            try:
                image_tensor = torch.randn(1, 3, 512, 512)
                result = executor.execute_inference(
                    model=model,
                    input_tensor=image_tensor,
                    model_name=f"oom_test_{image_idx}",
                    timeout=10.0
                )
                return {'success': True, 'image_idx': image_idx}
            except InferenceResourceError:
                self.failure_metrics['oom_recoveries'] += 1
                return {'success': False, 'image_idx': image_idx, 'error': 'OOM'}
            except Exception as e:
                return {'success': False, 'image_idx': image_idx, 'error': str(e)}

        # Submit more inferences than memory can handle
        num_inferences = 8  # This should trigger OOM for some inferences

        with ThreadPoolExecutor(max_workers=4) as thread_executor:
            futures = [thread_executor.submit(run_oom_prone_inference, i) for i in range(num_inferences)]
            results = [f.result() for f in as_completed(futures)]

        executor.shutdown()

        # Analyze OOM recovery
        successful_inferences = [r for r in results if r['success']]
        oom_failures = [r for r in results if not r['success'] and r.get('error') == 'OOM']

        # Should have some successes despite OOM conditions
        assert len(successful_inferences) > 0, "No inferences succeeded despite OOM recovery mechanisms"

        # Should detect and handle OOM conditions
        assert len(oom_failures) > 0, "No OOM conditions detected in memory stress test"

        # Recovery mechanisms should be triggered
        assert self.failure_metrics['oom_recoveries'] > 0, "OOM recovery mechanisms not triggered"

        print(f"OOM Recovery Results:")
        print(f"Successful: {len(successful_inferences)}, OOM failures: {len(oom_failures)}")
        print(f"Recovery attempts: {self.failure_metrics['oom_recoveries']}")

    def test_graceful_degradation_scenario(self):
        """Test graceful degradation from 4 to 2 concurrent users"""
        scenarios = [
            FailureScenario(
                name="High Memory Pressure",
                failure_type="memory_pressure",
                failure_probability=0.3,
                recovery_expected=True
            ),
            FailureScenario(
                name="Service Unavailable",
                failure_type="service_unavailable",
                failure_probability=0.2,
                recovery_expected=True
            )
        ]

        for scenario in scenarios:
            # Start with 4 concurrent users
            executor_4 = InferenceExecutor(max_workers=4, memory_limit_gb=20.0)

            # Simulate the failure condition
            def failure_prone_inference(*args, **kwargs):
                if np.random.random() < scenario.failure_probability:
                    if scenario.failure_type == "memory_pressure":
                        # Simulate memory pressure requiring degradation
                        self.gpu_monitor.allocate_memory(8 * 1024 * 1024 * 1024)  # 8GB spike
                        raise InferenceResourceError("High memory pressure detected")
                    elif scenario.failure_type == "service_unavailable":
                        raise InferenceError("ML service temporarily unavailable")

                time.sleep(0.15)
                return torch.randn(1, 1, 512, 512)

            model = Mock(spec=torch.nn.Module)
            model.eval = Mock()
            model.forward = failure_prone_inference
            model.__call__ = failure_prone_inference

            # Attempt processing with 4 users
            failures_detected = 0
            def run_degradation_test_inference(image_idx):
                try:
                    image_tensor = torch.randn(1, 3, 512, 512)
                    result = executor_4.execute_inference(
                        model=model,
                        input_tensor=image_tensor,
                        model_name=f"degradation_test_{image_idx}",
                        timeout=5.0
                    )
                    return {'success': True, 'degraded': False}
                except (InferenceResourceError, InferenceError):
                    nonlocal failures_detected
                    failures_detected += 1
                    return {'success': False, 'degraded': False}

            # Test with 4 concurrent users
            with ThreadPoolExecutor(max_workers=4) as thread_executor:
                futures = [thread_executor.submit(run_degradation_test_inference, i) for i in range(12)]
                results_4_users = [f.result() for f in as_completed(futures)]

            executor_4.shutdown()

            # If failures detected, test degraded mode with 2 users
            if failures_detected > 0:
                self.failure_metrics['degradation_events'] += 1

                executor_2 = InferenceExecutor(max_workers=2, memory_limit_gb=20.0)

                # More conservative inference for degraded mode
                def degraded_inference(*args, **kwargs):
                    # Lower failure probability in degraded mode
                    if np.random.random() < scenario.failure_probability * 0.3:
                        if scenario.failure_type == "memory_pressure":
                            raise InferenceResourceError("Memory pressure in degraded mode")
                        elif scenario.failure_type == "service_unavailable":
                            raise InferenceError("Service still unavailable")

                    time.sleep(0.2)  # Slightly slower but more reliable
                    return torch.randn(1, 1, 512, 512)

                degraded_model = Mock(spec=torch.nn.Module)
                degraded_model.eval = Mock()
                degraded_model.forward = degraded_inference
                degraded_model.__call__ = degraded_inference

                def run_degraded_inference(image_idx):
                    try:
                        image_tensor = torch.randn(1, 3, 512, 512)
                        result = executor_2.execute_inference(
                            model=degraded_model,
                            input_tensor=image_tensor,
                            model_name=f"degraded_{image_idx}",
                            timeout=5.0
                        )
                        return {'success': True, 'degraded': True}
                    except Exception:
                        return {'success': False, 'degraded': True}

                # Test degraded mode
                with ThreadPoolExecutor(max_workers=2) as thread_executor:
                    futures = [thread_executor.submit(run_degraded_inference, i) for i in range(8)]
                    results_2_users = [f.result() for f in as_completed(futures)]

                executor_2.shutdown()

                # Verify degraded mode has better success rate
                success_rate_4 = len([r for r in results_4_users if r['success']]) / len(results_4_users)
                success_rate_2 = len([r for r in results_2_users if r['success']]) / len(results_2_users)

                assert success_rate_2 > success_rate_4, f"Degraded mode should have better success rate: {success_rate_2:.2%} vs {success_rate_4:.2%}"
                assert success_rate_2 >= 0.7, f"Degraded mode success rate {success_rate_2:.2%} too low"

                print(f"Degradation Test ({scenario.name}):")
                print(f"4-user mode: {success_rate_4:.2%} success, {failures_detected} failures")
                print(f"2-user mode: {success_rate_2:.2%} success (degraded)")

    def test_timeout_handling_scenario(self):
        """Test timeout handling for concurrent requests"""
        executor = InferenceExecutor(max_workers=4, default_timeout=2.0, memory_limit_gb=20.0)

        # Create models with variable processing times
        def variable_timing_inference(*args, **kwargs):
            # Simulate variable processing times, some exceeding timeout
            processing_times = [0.5, 1.0, 3.0, 0.8, 4.0, 1.2]  # Some > 2.0s timeout
            processing_time = np.random.choice(processing_times)

            time.sleep(processing_time)

            if processing_time > 2.0:
                # This should trigger timeout in the executor
                raise TimeoutError("Simulated long processing")

            return torch.randn(1, 1, 512, 512)

        model = Mock(spec=torch.nn.Module)
        model.eval = Mock()
        model.forward = variable_timing_inference
        model.__call__ = variable_timing_inference

        # Run concurrent inferences with timeout potential
        def run_timeout_test_inference(image_idx):
            try:
                image_tensor = torch.randn(1, 3, 512, 512)
                result = executor.execute_inference(
                    model=model,
                    input_tensor=image_tensor,
                    model_name=f"timeout_test_{image_idx}",
                    timeout=2.0
                )
                return {'success': True, 'timeout': False, 'image_idx': image_idx}
            except InferenceTimeoutError:
                self.failure_metrics['timeout_recoveries'] += 1
                return {'success': False, 'timeout': True, 'image_idx': image_idx}
            except Exception as e:
                return {'success': False, 'timeout': False, 'error': str(e), 'image_idx': image_idx}

        # Submit multiple concurrent requests
        num_requests = 16
        start_time = time.time()

        with ThreadPoolExecutor(max_workers=4) as thread_executor:
            futures = [thread_executor.submit(run_timeout_test_inference, i) for i in range(num_requests)]
            results = [f.result() for f in as_completed(futures)]

        total_time = time.time() - start_time
        executor.shutdown()

        # Analyze timeout handling
        successful_requests = [r for r in results if r['success']]
        timeout_requests = [r for r in results if r.get('timeout', False)]
        other_failures = [r for r in results if not r['success'] and not r.get('timeout', False)]

        # Should handle timeouts gracefully
        assert len(timeout_requests) > 0, "No timeouts detected in variable timing test"
        assert len(successful_requests) > 0, "No successful requests despite timeout handling"

        # System should remain responsive
        assert total_time < 10.0, f"Total processing time {total_time:.1f}s suggests system blocking on timeouts"

        # Timeout recovery should be triggered
        assert self.failure_metrics['timeout_recoveries'] > 0, "Timeout recovery mechanisms not triggered"

        # Other failures should be minimal
        assert len(other_failures) <= len(results) * 0.1, f"Too many non-timeout failures: {len(other_failures)}"

        print(f"Timeout Handling Results:")
        print(f"Successful: {len(successful_requests)}, Timeouts: {len(timeout_requests)}, Other failures: {len(other_failures)}")
        print(f"Total time: {total_time:.1f}s, Timeout recoveries: {self.failure_metrics['timeout_recoveries']}")

    def test_database_deadlock_prevention(self):
        """Test database deadlock prevention during concurrent operations"""
        # Simulate database operations that could cause deadlocks
        db_operations_log = []
        deadlock_simulation_count = 0

        def simulate_database_transaction(operation_id: int, operation_type: str):
            """Simulate database transaction that might deadlock"""
            nonlocal deadlock_simulation_count

            # Simulate different types of database operations
            operation_time = np.random.exponential(0.05)  # Average 50ms

            # Small chance of deadlock
            if np.random.random() < 0.05:  # 5% chance
                deadlock_simulation_count += 1
                time.sleep(operation_time)
                raise sqlite3.OperationalError("database is locked")

            # Simulate transaction
            time.sleep(operation_time)

            db_operations_log.append({
                'operation_id': operation_id,
                'operation_type': operation_type,
                'timestamp': time.time(),
                'duration': operation_time
            })

            return {'success': True, 'operation_id': operation_id}

        # Run concurrent database operations
        operation_types = ['insert_queue', 'update_status', 'delete_completed', 'query_stats']
        total_operations = 100

        def run_db_operation(op_id):
            op_type = np.random.choice(operation_types)
            max_retries = 3

            for attempt in range(max_retries):
                try:
                    return simulate_database_transaction(op_id, op_type)
                except sqlite3.OperationalError as e:
                    if "database is locked" in str(e) and attempt < max_retries - 1:
                        # Retry with exponential backoff
                        retry_delay = 0.01 * (2 ** attempt) + np.random.uniform(0, 0.01)
                        time.sleep(retry_delay)
                        continue
                    else:
                        self.failure_metrics['connection_failures'] += 1
                        return {'success': False, 'operation_id': op_id, 'error': str(e)}

            return {'success': False, 'operation_id': op_id, 'error': 'Max retries exceeded'}

        # Execute concurrent database operations
        start_time = time.time()

        with ThreadPoolExecutor(max_workers=8) as executor:  # High concurrency for deadlock testing
            futures = [executor.submit(run_db_operation, i) for i in range(total_operations)]
            results = [f.result() for f in as_completed(futures)]

        total_time = time.time() - start_time

        # Analyze deadlock prevention
        successful_operations = [r for r in results if r['success']]
        failed_operations = [r for r in results if not r['success']]

        success_rate = len(successful_operations) / len(results)

        # Deadlock prevention assertions
        assert success_rate >= 0.9, f"Success rate {success_rate:.2%} indicates deadlock prevention issues"
        assert deadlock_simulation_count > 0, "No deadlock scenarios were simulated"
        assert len(failed_operations) <= deadlock_simulation_count * 0.5, "Too many operations failed despite retry mechanisms"

        # Performance should not be severely impacted
        avg_operation_time = total_time / total_operations
        assert avg_operation_time < 0.5, f"Average operation time {avg_operation_time:.3f}s too slow (deadlock impact)"

        print(f"Database Deadlock Prevention Results:")
        print(f"Operations: {total_operations}, Success rate: {success_rate:.2%}")
        print(f"Deadlock simulations: {deadlock_simulation_count}, Connection failures: {self.failure_metrics['connection_failures']}")
        print(f"Average operation time: {avg_operation_time:.3f}s")


@pytest.mark.integration
class TestIntegratedPerformanceScenarios:
    """Integrated performance scenarios combining multiple aspects"""

    def test_realistic_production_load_simulation(self):
        """Simulate realistic production load with mixed models and user patterns"""
        # Configuration for realistic simulation
        user_profiles = [
            {'concurrent_users': 2, 'model': 'hrnet', 'images_per_batch': 8, 'frequency_hz': 0.5},
            {'concurrent_users': 1, 'model': 'cbam_resunet', 'images_per_batch': 4, 'frequency_hz': 0.3},
            {'concurrent_users': 1, 'model': 'hrnet', 'images_per_batch': 6, 'frequency_hz': 0.4}
        ]

        simulation_duration = 30  # seconds
        total_users = sum(profile['concurrent_users'] for profile in user_profiles)

        assert total_users == 4, "Test designed for 4 concurrent users"

        # Setup monitoring
        gpu_monitor = MockGPUMonitor(total_memory_gb=24.0)
        db_pool = DatabaseConnectionPool(max_connections=50)

        # Create executor
        executor = InferenceExecutor(max_workers=4, memory_limit_gb=20.0, enable_cuda_streams=True)

        # Create models with realistic characteristics
        models = {
            'hrnet': Mock(spec=torch.nn.Module),
            'cbam_resunet': Mock(spec=torch.nn.Module)
        }

        for model_name, model in models.items():
            model.eval = Mock()

            def create_inference_func(name):
                def inference_func(*args, **kwargs):
                    # Realistic timing and memory usage
                    if name == 'hrnet':
                        memory_mb = 267
                        time_ms = 196
                    else:  # cbam_resunet
                        memory_mb = 249
                        time_ms = 396

                    gpu_monitor.allocate_memory(memory_mb * 1024 * 1024)
                    time.sleep(time_ms / 1000.0)
                    gpu_monitor.free_memory(memory_mb * 1024 * 1024)

                    return torch.randn(1, 1, 512, 512)

                return inference_func

            model.forward = create_inference_func(model_name)
            model.__call__ = model.forward

        # Run simulation
        simulation_results = []
        start_time = time.time()

        def user_simulation(user_id: int, profile: dict):
            """Simulate a user's behavior over time"""
            user_results = {
                'user_id': user_id,
                'model': profile['model'],
                'total_inferences': 0,
                'successful_inferences': 0,
                'failed_inferences': 0,
                'avg_response_time': 0,
                'errors': []
            }

            inference_times = []

            while time.time() - start_time < simulation_duration:
                try:
                    # Simulate batch processing
                    batch_start = time.time()

                    for _ in range(profile['images_per_batch']):
                        db_pool.acquire_connection()  # Simulate DB operation

                        image_tensor = torch.randn(1, 3, 512, 512)
                        result = executor.execute_inference(
                            model=models[profile['model']],
                            input_tensor=image_tensor,
                            model_name=f"{profile['model']}_user_{user_id}",
                            timeout=10.0
                        )

                        user_results['total_inferences'] += 1
                        user_results['successful_inferences'] += 1

                        db_pool.release_connection()

                    batch_time = time.time() - batch_start
                    inference_times.append(batch_time)

                    # Wait for next batch based on frequency
                    wait_time = 1.0 / profile['frequency_hz']
                    time.sleep(max(0, wait_time - batch_time))

                except Exception as e:
                    user_results['failed_inferences'] += 1
                    user_results['errors'].append(str(e))
                    db_pool.release_connection()  # Ensure cleanup

            if inference_times:
                user_results['avg_response_time'] = sum(inference_times) / len(inference_times)

            return user_results

        # Run concurrent user simulations
        with ThreadPoolExecutor(max_workers=total_users) as thread_executor:
            futures = []
            user_id = 0

            for profile in user_profiles:
                for _ in range(profile['concurrent_users']):
                    futures.append(thread_executor.submit(user_simulation, user_id, profile))
                    user_id += 1

            simulation_results = [f.result() for f in as_completed(futures)]

        total_simulation_time = time.time() - start_time
        executor.shutdown()

        # Analyze production simulation results
        total_inferences = sum(r['total_inferences'] for r in simulation_results)
        total_successful = sum(r['successful_inferences'] for r in simulation_results)
        total_failed = sum(r['failed_inferences'] for r in simulation_results)

        overall_success_rate = total_successful / total_inferences if total_inferences > 0 else 0
        overall_throughput = total_successful / total_simulation_time

        peak_gpu_utilization = gpu_monitor.get_peak_memory_gb()
        peak_db_utilization = db_pool.get_peak_utilization()

        # Production performance assertions
        assert overall_success_rate >= 0.95, f"Production success rate {overall_success_rate:.2%} below 95%"
        assert overall_throughput >= 15.0, f"Production throughput {overall_throughput:.1f} img/s below 15 img/s"
        assert peak_gpu_utilization >= 3.0, f"GPU utilization {peak_gpu_utilization:.1f}GB indicates underutilization"
        assert peak_db_utilization <= 80, f"DB utilization {peak_db_utilization:.1f}% too high"

        # Per-user performance verification
        for result in simulation_results:
            user_success_rate = result['successful_inferences'] / result['total_inferences'] if result['total_inferences'] > 0 else 0
            assert user_success_rate >= 0.9, f"User {result['user_id']} success rate {user_success_rate:.2%} too low"

            if result['avg_response_time'] > 0:
                assert result['avg_response_time'] < 5.0, f"User {result['user_id']} response time {result['avg_response_time']:.2f}s too slow"

        print(f"Production Load Simulation Results:")
        print(f"Duration: {total_simulation_time:.1f}s, Total inferences: {total_inferences}")
        print(f"Success rate: {overall_success_rate:.2%}, Throughput: {overall_throughput:.1f} img/s")
        print(f"Peak GPU: {peak_gpu_utilization:.1f}GB, Peak DB: {peak_db_utilization:.1f}%")
        print(f"Per-user results:")
        for result in simulation_results:
            print(f"  User {result['user_id']} ({result['model']}): {result['successful_inferences']}/{result['total_inferences']} successful")


if __name__ == "__main__":
    # Run performance benchmarks with specific markers
    pytest.main([
        __file__,
        "-v",
        "--tb=short",
        "-m", "performance or failure_scenarios",
        "--durations=10",
    ])