"""
GPU Monitoring API Endpoints
Provides REST endpoints for GPU metrics and monitoring data
"""

from fastapi import APIRouter, HTTPException
from typing import Dict, Any, Optional
import logging
import sys
import os

# Add monitoring module to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from monitoring.gpu_monitor import get_gpu_monitor, cleanup_gpu_monitor
    gpu_monitor_available = True
except ImportError:
    gpu_monitor_available = False

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/monitoring", tags=["monitoring"])

@router.get("/gpu/status")
async def get_gpu_status() -> Dict[str, Any]:
    """
    Get current GPU status and metrics
    
    Returns:
        Dictionary containing GPU metrics and status
    """
    if not gpu_monitor_available:
        return {
            "status": "unavailable",
            "message": "GPU monitoring not available",
            "gpu_present": False
        }
    
    try:
        monitor = get_gpu_monitor()
        current_metrics = monitor.get_current_metrics()
        
        if current_metrics:
            return {
                "status": "active",
                "gpu_present": True,
                "device": {
                    "id": current_metrics.device_id,
                    "name": current_metrics.device_name
                },
                "memory": {
                    "allocated_mb": current_metrics.memory_allocated_mb,
                    "reserved_mb": current_metrics.memory_reserved_mb,
                    "free_mb": current_metrics.memory_free_mb,
                    "total_mb": current_metrics.memory_total_mb,
                    "usage_percent": current_metrics.memory_usage_percent
                },
                "utilization": {
                    "gpu_percent": current_metrics.utilization_percent,
                    "temperature_celsius": current_metrics.temperature_celsius,
                    "power_watts": current_metrics.power_draw_watts
                },
                "timestamp": current_metrics.timestamp
            }
        else:
            return {
                "status": "no_gpu",
                "message": "No GPU available, running on CPU",
                "gpu_present": False
            }
            
    except Exception as e:
        logger.error(f"Error getting GPU status: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/gpu/summary")
async def get_gpu_summary() -> Dict[str, Any]:
    """
    Get GPU monitoring summary statistics
    
    Returns:
        Dictionary containing summary statistics
    """
    if not gpu_monitor_available:
        return {
            "status": "unavailable",
            "message": "GPU monitoring not available"
        }
    
    try:
        monitor = get_gpu_monitor()
        summary = monitor.get_summary_stats()
        return summary
        
    except Exception as e:
        logger.error(f"Error getting GPU summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/gpu/batch-metrics")
async def get_batch_metrics(limit: int = 50) -> Dict[str, Any]:
    """
    Get recent batch processing metrics
    
    Args:
        limit: Maximum number of metrics to return (default 50)
    
    Returns:
        Dictionary containing batch processing metrics
    """
    if not gpu_monitor_available:
        return {
            "status": "unavailable",
            "message": "GPU monitoring not available",
            "metrics": []
        }
    
    try:
        monitor = get_gpu_monitor()
        
        # Get recent batch metrics
        batch_metrics = monitor.batch_metrics[-limit:] if monitor.batch_metrics else []
        
        # Calculate statistics
        if batch_metrics:
            successful = [m for m in batch_metrics if m.success]
            failed = [m for m in batch_metrics if not m.success]
            
            avg_throughput = (sum(m.throughput_imgs_sec for m in successful) / 
                            len(successful)) if successful else 0
            
            avg_inference_time = (sum(m.inference_time_ms for m in successful) / 
                                len(successful)) if successful else 0
            
            stats = {
                "total_batches": len(batch_metrics),
                "successful": len(successful),
                "failed": len(failed),
                "success_rate": len(successful) / len(batch_metrics) * 100,
                "avg_throughput_imgs_sec": round(avg_throughput, 2),
                "avg_inference_time_ms": round(avg_inference_time, 2)
            }
        else:
            stats = {
                "total_batches": 0,
                "successful": 0,
                "failed": 0,
                "success_rate": 100.0,
                "avg_throughput_imgs_sec": 0,
                "avg_inference_time_ms": 0
            }
        
        # Format metrics for response
        formatted_metrics = []
        for m in batch_metrics:
            formatted_metrics.append({
                "model": m.model_name,
                "batch_size": m.batch_size,
                "inference_time_ms": m.inference_time_ms,
                "throughput_imgs_sec": m.throughput_imgs_sec,
                "memory_delta_mb": m.memory_delta_mb,
                "gpu_utilization": m.gpu_utilization,
                "success": m.success,
                "error": m.error_message
            })
        
        return {
            "status": "active",
            "statistics": stats,
            "metrics": formatted_metrics
        }
        
    except Exception as e:
        logger.error(f"Error getting batch metrics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/gpu/export-metrics")
async def export_metrics(filepath: Optional[str] = None) -> Dict[str, Any]:
    """
    Export GPU metrics to a JSON file
    
    Args:
        filepath: Optional path to save the metrics file
    
    Returns:
        Dictionary with export status and file path
    """
    if not gpu_monitor_available:
        return {
            "status": "unavailable",
            "message": "GPU monitoring not available"
        }
    
    try:
        monitor = get_gpu_monitor()
        exported_file = monitor.export_metrics(filepath)
        
        return {
            "status": "success",
            "message": "Metrics exported successfully",
            "filepath": exported_file
        }
        
    except Exception as e:
        logger.error(f"Error exporting metrics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/gpu/memory-pressure")
async def check_memory_pressure() -> Dict[str, Any]:
    """
    Check if GPU is under memory pressure
    
    Returns:
        Dictionary indicating memory pressure status
    """
    if not gpu_monitor_available:
        return {
            "status": "unavailable",
            "under_pressure": False,
            "message": "GPU monitoring not available"
        }
    
    try:
        monitor = get_gpu_monitor()
        under_pressure = monitor.should_reduce_batch_size()
        current_metrics = monitor.get_current_metrics()
        
        return {
            "status": "active",
            "under_pressure": under_pressure,
            "memory_usage_percent": current_metrics.memory_usage_percent if current_metrics else 0,
            "recommendation": "Reduce batch size" if under_pressure else "Normal operation",
            "threshold": 85.0
        }
        
    except Exception as e:
        logger.error(f"Error checking memory pressure: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/gpu/clear-cache")
async def clear_gpu_cache() -> Dict[str, Any]:
    """
    Clear GPU cache to free up memory
    
    Returns:
        Dictionary with operation status
    """
    if not gpu_monitor_available:
        return {
            "status": "unavailable",
            "message": "GPU monitoring not available"
        }
    
    try:
        import torch
        if torch.cuda.is_available():
            before = torch.cuda.memory_allocated() / (1024 ** 2)
            torch.cuda.empty_cache()
            after = torch.cuda.memory_allocated() / (1024 ** 2)
            
            return {
                "status": "success",
                "message": "GPU cache cleared",
                "memory_freed_mb": round(before - after, 2),
                "memory_before_mb": round(before, 2),
                "memory_after_mb": round(after, 2)
            }
        else:
            return {
                "status": "no_gpu",
                "message": "No GPU available"
            }
            
    except Exception as e:
        logger.error(f"Error clearing GPU cache: {e}")
        raise HTTPException(status_code=500, detail=str(e))