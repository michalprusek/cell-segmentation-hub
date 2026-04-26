"""Unit tests for GPUMonitor — focused on the CPU-only path that runs in CI.

We verify behaviour when no GPU is available (`torch.cuda.is_available()`
returns False), since the GH Actions test runner is CPU-only. GPU-only paths
require an actual CUDA device and live in the integration suite.
"""

import os
import sys
import time
from unittest.mock import patch

import pytest

sys.path.insert(
    0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
)


@pytest.fixture
def cpu_monitor():
    """Build a GPUMonitor with CUDA forced off — exercises the no-GPU code paths."""
    with patch("torch.cuda.is_available", return_value=False):
        from monitoring.gpu_monitor import GPUMonitor
        return GPUMonitor(sampling_interval=0.1, history_size=5)


def test_get_current_metrics_returns_none_without_gpu(cpu_monitor):
    """When CUDA is not available, snapshots are skipped (returns None)."""
    assert cpu_monitor.get_current_metrics() is None


def test_summary_stats_reports_no_data_initially(cpu_monitor):
    """Empty history → 'no_data' status, with the gpu_available flag echoed."""
    stats = cpu_monitor.get_summary_stats()
    assert stats == {"status": "no_data", "gpu_available": False}


def test_record_batch_processing_with_no_gpu_yields_zero_memory(cpu_monitor):
    """memory_after on CPU is 0; delta is therefore non-negative even after clamp."""
    start = time.time() - 0.05  # 50ms ago
    result = cpu_monitor.record_batch_processing(
        model_name="hrnet",
        batch_size=4,
        start_time=start,
        memory_before=0,
        success=True,
    )
    assert result.model_name == "hrnet"
    assert result.batch_size == 4
    assert result.success is True
    assert result.memory_before_mb == 0.0
    assert result.memory_after_mb == 0.0
    assert result.memory_delta_mb == 0.0
    # Throughput is computed from inference_time_ms; should be positive.
    assert result.throughput_imgs_sec > 0
    # Counter updates only on success.
    assert cpu_monitor.total_images_processed == 4


def test_record_batch_processing_failure_does_not_update_totals(cpu_monitor):
    """A failed batch is recorded but doesn't bump cumulative totals."""
    start = time.time()
    result = cpu_monitor.record_batch_processing(
        model_name="hrnet",
        batch_size=8,
        start_time=start,
        memory_before=0,
        success=False,
        error_message="OOM",
    )
    assert result.success is False
    assert result.error_message == "OOM"
    assert cpu_monitor.total_images_processed == 0
    assert cpu_monitor.total_inference_time_ms == 0.0


def test_summary_stats_with_populated_history(cpu_monitor):
    """With metrics in history, summary returns 'monitoring' status, the
    documented field names, and a CPU device label."""
    from monitoring.gpu_monitor import GPUMetrics

    sample = GPUMetrics(
        timestamp="2026-04-26T00:00:00",
        device_id=0,
        device_name="mock",
        memory_allocated_mb=100.0,
        memory_reserved_mb=120.0,
        memory_free_mb=900.0,
        memory_total_mb=1000.0,
        memory_usage_percent=10.0,
        utilization_percent=50.0,
    )
    for _ in range(3):
        cpu_monitor.metrics_history.append(sample)

    stats = cpu_monitor.get_summary_stats()
    assert stats["status"] == "monitoring"
    assert stats["gpu_available"] is False
    assert stats["device_name"] == "CPU"
    assert stats["total_memory_mb"] == 0
    assert stats["avg_memory_mb"] == pytest.approx(100.0)
    assert stats["avg_utilization_percent"] == pytest.approx(50.0)
    # No batches recorded → success rate defaults to 100.
    assert stats["batch_success_rate"] == 100
