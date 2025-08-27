"""
GPU Monitoring and Metrics Module
Provides real-time GPU memory tracking, utilization metrics, and health monitoring
"""

import torch
import time
import threading
import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import json
import os

logger = logging.getLogger(__name__)

@dataclass
class GPUMetrics:
    """GPU metrics snapshot"""
    timestamp: str
    device_id: int
    device_name: str
    memory_allocated_mb: float
    memory_reserved_mb: float
    memory_free_mb: float
    memory_total_mb: float
    memory_usage_percent: float
    utilization_percent: float
    temperature_celsius: Optional[float] = None
    power_draw_watts: Optional[float] = None
    
    def to_dict(self) -> Dict:
        return asdict(self)

@dataclass
class BatchProcessingMetrics:
    """Metrics for batch processing performance"""
    model_name: str
    batch_size: int
    inference_time_ms: float
    throughput_imgs_sec: float
    memory_before_mb: float
    memory_after_mb: float
    memory_delta_mb: float
    gpu_utilization: float
    success: bool
    error_message: Optional[str] = None

class GPUMonitor:
    """
    Real-time GPU monitoring with metrics collection
    """
    
    def __init__(self, sampling_interval: float = 1.0, history_size: int = 100):
        """
        Initialize GPU monitor
        
        Args:
            sampling_interval: Seconds between metric samples
            history_size: Number of historical metrics to retain
        """
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.is_cuda = torch.cuda.is_available()
        self.sampling_interval = sampling_interval
        self.history_size = history_size
        
        # Metrics storage
        self.metrics_history: List[GPUMetrics] = []
        self.batch_metrics: List[BatchProcessingMetrics] = []
        
        # Monitoring thread
        self.monitoring_thread: Optional[threading.Thread] = None
        self.stop_monitoring = threading.Event()
        
        # Performance tracking
        self.peak_memory_mb = 0.0
        self.total_inference_time_ms = 0.0
        self.total_images_processed = 0
        
        if self.is_cuda:
            self.device_properties = torch.cuda.get_device_properties(0)
            self.total_memory_mb = self.device_properties.total_memory / (1024 ** 2)
            logger.info(f"GPU monitoring initialized for {self.device_properties.name} "
                       f"with {self.total_memory_mb:.1f} MB memory")
        else:
            logger.warning("No GPU available, running in CPU mode")
    
    def get_current_metrics(self) -> Optional[GPUMetrics]:
        """Get current GPU metrics"""
        if not self.is_cuda:
            return None
        
        try:
            # Get memory stats
            allocated = torch.cuda.memory_allocated() / (1024 ** 2)
            reserved = torch.cuda.memory_reserved() / (1024 ** 2)
            total = self.total_memory_mb
            free = total - allocated
            usage_percent = (allocated / total) * 100 if total > 0 else 0
            
            # Fix negative memory calculations with max(0, ...)
            free = max(0, free)
            usage_percent = min(100, max(0, usage_percent))
            
            # Try to get utilization (requires nvidia-ml-py)
            utilization = 0.0
            temperature = None
            power_draw = None
            
            try:
                import pynvml
                pynvml.nvmlInit()
                handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                util = pynvml.nvmlDeviceGetUtilizationRates(handle)
                utilization = util.gpu
                
                # Get temperature if available
                try:
                    temperature = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
                except:
                    pass
                
                # Get power draw if available
                try:
                    power_draw = pynvml.nvmlDeviceGetPowerUsage(handle) / 1000.0  # Convert to watts
                except:
                    pass
                    
                pynvml.nvmlShutdown()
            except ImportError:
                pass  # pynvml not available
            except Exception as e:
                logger.debug(f"Could not get GPU utilization: {e}")
            
            metrics = GPUMetrics(
                timestamp=datetime.utcnow().isoformat(),
                device_id=0,
                device_name=self.device_properties.name,
                memory_allocated_mb=round(allocated, 2),
                memory_reserved_mb=round(reserved, 2),
                memory_free_mb=round(free, 2),
                memory_total_mb=round(total, 2),
                memory_usage_percent=round(usage_percent, 2),
                utilization_percent=utilization,
                temperature_celsius=temperature,
                power_draw_watts=power_draw
            )
            
            # Update peak memory
            self.peak_memory_mb = max(self.peak_memory_mb, allocated)
            
            return metrics
            
        except Exception as e:
            logger.error(f"Error getting GPU metrics: {e}")
            return None
    
    def start_monitoring(self):
        """Start background monitoring thread"""
        if self.monitoring_thread and self.monitoring_thread.is_alive():
            logger.warning("Monitoring already running")
            return
        
        self.stop_monitoring.clear()
        self.monitoring_thread = threading.Thread(target=self._monitoring_loop)
        self.monitoring_thread.daemon = True
        self.monitoring_thread.start()
        logger.info("GPU monitoring started")
    
    def stop_monitoring(self):
        """Stop background monitoring"""
        self.stop_monitoring.set()
        if self.monitoring_thread:
            self.monitoring_thread.join(timeout=5)
        logger.info("GPU monitoring stopped")
    
    def _monitoring_loop(self):
        """Background monitoring loop"""
        while not self.stop_monitoring.is_set():
            metrics = self.get_current_metrics()
            if metrics:
                self.metrics_history.append(metrics)
                # Keep history size limited
                if len(self.metrics_history) > self.history_size:
                    self.metrics_history.pop(0)
            
            time.sleep(self.sampling_interval)
    
    def record_batch_processing(
        self, 
        model_name: str, 
        batch_size: int,
        start_time: float,
        memory_before: float,
        success: bool = True,
        error_message: Optional[str] = None
    ) -> BatchProcessingMetrics:
        """
        Record metrics for a batch processing operation
        
        Args:
            model_name: Name of the model used
            batch_size: Number of images in batch
            start_time: Start time from time.time()
            memory_before: GPU memory before processing (bytes)
            success: Whether processing succeeded
            error_message: Error message if failed
        """
        inference_time_ms = (time.time() - start_time) * 1000
        throughput = (batch_size / inference_time_ms) * 1000 if inference_time_ms > 0 else 0
        
        memory_after = torch.cuda.memory_allocated() if self.is_cuda else 0
        memory_delta = memory_after - memory_before
        
        # Fix negative memory calculations
        memory_delta = max(0, memory_delta)
        
        # Get current utilization
        current_metrics = self.get_current_metrics()
        gpu_util = current_metrics.utilization_percent if current_metrics else 0
        
        metrics = BatchProcessingMetrics(
            model_name=model_name,
            batch_size=batch_size,
            inference_time_ms=round(inference_time_ms, 2),
            throughput_imgs_sec=round(throughput, 2),
            memory_before_mb=round(memory_before / (1024 ** 2), 2),
            memory_after_mb=round(memory_after / (1024 ** 2), 2),
            memory_delta_mb=round(memory_delta / (1024 ** 2), 2),
            gpu_utilization=gpu_util,
            success=success,
            error_message=error_message
        )
        
        self.batch_metrics.append(metrics)
        
        # Update totals
        if success:
            self.total_inference_time_ms += inference_time_ms
            self.total_images_processed += batch_size
        
        # Log if memory usage is high
        if current_metrics and current_metrics.memory_usage_percent > 90:
            logger.warning(f"High GPU memory usage: {current_metrics.memory_usage_percent:.1f}%")
        
        return metrics
    
    def get_summary_stats(self) -> Dict:
        """Get summary statistics"""
        if not self.metrics_history:
            return {
                "status": "no_data",
                "gpu_available": self.is_cuda
            }
        
        # Calculate averages from history
        avg_memory = sum(m.memory_allocated_mb for m in self.metrics_history) / len(self.metrics_history)
        avg_utilization = sum(m.utilization_percent for m in self.metrics_history) / len(self.metrics_history)
        
        # Calculate batch processing stats
        successful_batches = [m for m in self.batch_metrics if m.success]
        avg_throughput = (sum(m.throughput_imgs_sec for m in successful_batches) / 
                         len(successful_batches)) if successful_batches else 0
        
        return {
            "status": "monitoring",
            "gpu_available": self.is_cuda,
            "device_name": self.device_properties.name if self.is_cuda else "CPU",
            "total_memory_mb": self.total_memory_mb if self.is_cuda else 0,
            "current_memory_mb": self.metrics_history[-1].memory_allocated_mb if self.metrics_history else 0,
            "peak_memory_mb": round(self.peak_memory_mb, 2),
            "avg_memory_mb": round(avg_memory, 2),
            "avg_utilization_percent": round(avg_utilization, 2),
            "total_images_processed": self.total_images_processed,
            "total_inference_time_ms": round(self.total_inference_time_ms, 2),
            "avg_throughput_imgs_sec": round(avg_throughput, 2),
            "batch_success_rate": len(successful_batches) / len(self.batch_metrics) * 100 if self.batch_metrics else 100,
            "monitoring_duration_seconds": len(self.metrics_history) * self.sampling_interval
        }
    
    def export_metrics(self, filepath: Optional[str] = None) -> str:
        """
        Export metrics to JSON file
        
        Args:
            filepath: Path to save metrics, defaults to metrics_[timestamp].json
        
        Returns:
            Path to saved file
        """
        if not filepath:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
            filepath = f"gpu_metrics_{timestamp}.json"
        
        data = {
            "summary": self.get_summary_stats(),
            "metrics_history": [m.to_dict() for m in self.metrics_history[-50:]],  # Last 50 samples
            "batch_metrics": [asdict(m) for m in self.batch_metrics[-50:]]  # Last 50 batches
        }
        
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)
        
        logger.info(f"Metrics exported to {filepath}")
        return filepath
    
    def should_reduce_batch_size(self, threshold: float = 85.0) -> bool:
        """
        Check if batch size should be reduced based on memory pressure
        
        Args:
            threshold: Memory usage percentage threshold
        
        Returns:
            True if batch size should be reduced
        """
        if not self.is_cuda:
            return False
        
        current = self.get_current_metrics()
        if current and current.memory_usage_percent > threshold:
            logger.warning(f"Memory pressure detected: {current.memory_usage_percent:.1f}% > {threshold}%")
            return True
        
        # Also check if recent batches have failed
        recent_failures = sum(1 for m in self.batch_metrics[-5:] if not m.success)
        if recent_failures >= 2:
            logger.warning(f"Multiple recent batch failures: {recent_failures}/5")
            return True
        
        return False
    
    def cleanup(self):
        """Clean up resources"""
        self.stop_monitoring()
        if self.is_cuda:
            torch.cuda.empty_cache()
            logger.info("GPU cache cleared")

# Global monitor instance
_gpu_monitor: Optional[GPUMonitor] = None

def get_gpu_monitor() -> GPUMonitor:
    """Get or create global GPU monitor instance"""
    global _gpu_monitor
    if _gpu_monitor is None:
        _gpu_monitor = GPUMonitor()
        # Auto-start monitoring if GPU is available
        if _gpu_monitor.is_cuda:
            _gpu_monitor.start_monitoring()
    return _gpu_monitor

def cleanup_gpu_monitor():
    """Clean up global GPU monitor"""
    global _gpu_monitor
    if _gpu_monitor:
        _gpu_monitor.cleanup()
        _gpu_monitor = None