"""
Inference Executor Module for Thread-Safe ML Model Inference

This module provides a production-ready inference execution system with:
- Proper timeout handling using concurrent.futures
- Resource cleanup and memory management
- Thread safety for concurrent model access
- Comprehensive error handling and recovery
"""

import logging
import time
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from contextlib import contextmanager
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Optional, Callable
import torch
import psutil
import os

logger = logging.getLogger(__name__)


class InferenceStatus(Enum):
    """Status of an inference request"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    TIMEOUT = "timeout"
    FAILED = "failed"
    CANCELLED = "cancelled"


class InferenceError(Exception):
    """Base exception for inference errors"""
    pass


class InferenceTimeoutError(InferenceError):
    """Raised when inference exceeds timeout"""
    def __init__(self, model_name: str, timeout: float, image_size: tuple):
        self.model_name = model_name
        self.timeout = timeout
        self.image_size = image_size
        super().__init__(
            f"Model '{model_name}' inference timed out after {timeout}s for image {image_size}. "
            f"Consider using a simpler model or increasing timeout."
        )


class InferenceResourceError(InferenceError):
    """Raised when resource limits are exceeded"""
    pass


class ModelStateError(InferenceError):
    """Raised when model is in invalid state"""
    pass


@dataclass
class InferenceMetrics:
    """Metrics for an inference request"""
    start_time: float
    end_time: Optional[float] = None
    memory_before: Optional[int] = None
    memory_after: Optional[int] = None
    status: InferenceStatus = InferenceStatus.PENDING
    error: Optional[str] = None
    
    @property
    def duration(self) -> Optional[float]:
        if self.end_time:
            return self.end_time - self.start_time
        return None
    
    @property
    def memory_delta(self) -> Optional[int]:
        if self.memory_before and self.memory_after:
            return self.memory_after - self.memory_before
        return None


class InferenceSession:
    """Context for a single inference session"""
    
    def __init__(self, session_id: str, model_name: str):
        self.session_id = session_id
        self.model_name = model_name
        self.metrics = InferenceMetrics(start_time=time.time())
        self._lock = threading.RLock()
        
    def update_status(self, status: InferenceStatus, error: Optional[str] = None):
        """Thread-safe status update"""
        with self._lock:
            self.metrics.status = status
            if error:
                self.metrics.error = error
            if status in [InferenceStatus.COMPLETED, InferenceStatus.FAILED, 
                         InferenceStatus.TIMEOUT, InferenceStatus.CANCELLED]:
                self.metrics.end_time = time.time()


class InferenceExecutor:
    """
    Thread-safe inference executor with timeout and resource management
    """
    
    def __init__(self, 
                 max_workers: int = 2,
                 default_timeout: float = 60.0,
                 memory_limit_gb: float = 4.0,
                 enable_monitoring: bool = True):
        """
        Initialize the inference executor
        
        Args:
            max_workers: Maximum number of concurrent inference threads
            default_timeout: Default timeout in seconds for inference
            memory_limit_gb: Maximum memory usage in GB
            enable_monitoring: Enable resource monitoring
        """
        self.executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="inference"
        )
        self.default_timeout = default_timeout
        self.memory_limit_bytes = int(memory_limit_gb * 1024 * 1024 * 1024)
        self.enable_monitoring = enable_monitoring
        
        # Thread safety
        self._model_locks: Dict[str, threading.RLock] = {}
        self._sessions: Dict[str, InferenceSession] = {}
        self._global_lock = threading.RLock()
        
        # Metrics
        self.total_inferences = 0
        self.timeout_count = 0
        self.failure_count = 0
        
        logger.info(f"InferenceExecutor initialized with {max_workers} workers, "
                   f"{default_timeout}s timeout, {memory_limit_gb}GB memory limit")
    
    def get_model_lock(self, model_name: str) -> threading.RLock:
        """Get or create a lock for a specific model"""
        with self._global_lock:
            if model_name not in self._model_locks:
                self._model_locks[model_name] = threading.RLock()
            return self._model_locks[model_name]
    
    @contextmanager
    def inference_context(self, session_id: str, model_name: str):
        """Context manager for inference session"""
        session = InferenceSession(session_id, model_name)
        
        with self._global_lock:
            self._sessions[session_id] = session
        
        try:
            # Record initial memory
            if self.enable_monitoring:
                session.metrics.memory_before = self._get_memory_usage()
            
            session.update_status(InferenceStatus.RUNNING)
            yield session
            
            # Record final memory
            if self.enable_monitoring:
                session.metrics.memory_after = self._get_memory_usage()
            
            session.update_status(InferenceStatus.COMPLETED)
            
        except Exception as e:
            session.update_status(InferenceStatus.FAILED, str(e))
            raise
        
        finally:
            # Cleanup session
            with self._global_lock:
                self._sessions.pop(session_id, None)
            
            # Log metrics
            if session.metrics.duration:
                logger.info(f"Inference {session_id} completed in {session.metrics.duration:.2f}s "
                          f"with status {session.metrics.status.value}")
    
    def execute_inference(self,
                         model: torch.nn.Module,
                         input_tensor: torch.Tensor,
                         model_name: str,
                         timeout: Optional[float] = None,
                         image_size: Optional[tuple] = None) -> torch.Tensor:
        """
        Execute model inference with timeout and resource management
        
        Args:
            model: PyTorch model to run inference on
            input_tensor: Input tensor for the model
            model_name: Name of the model for logging
            timeout: Timeout in seconds (uses default if None)
            image_size: Original image size for error reporting
            
        Returns:
            Model output tensor
            
        Raises:
            InferenceTimeoutError: If inference exceeds timeout
            InferenceResourceError: If resource limits are exceeded
            InferenceError: For other inference failures
        """
        timeout = timeout or self.default_timeout
        session_id = f"{model_name}_{time.time()}_{threading.get_ident()}"
        
        # Check resources before starting
        if self.enable_monitoring:
            self._check_resources()
        
        # Get model-specific lock to prevent concurrent access
        model_lock = self.get_model_lock(model_name)
        
        def _run_inference():
            """Inner function to run inference with proper locking"""
            with model_lock:
                with torch.no_grad():
                    # Ensure model is in eval mode
                    model.eval()
                    
                    # Run inference
                    output = model(input_tensor)
                    
                    # Handle different output formats
                    if isinstance(output, tuple):
                        output = output[0]
                    
                    return output
        
        try:
            with self.inference_context(session_id, model_name) as session:
                # Submit inference task to executor
                future = self.executor.submit(_run_inference)
                
                # Wait for result with timeout
                try:
                    result = future.result(timeout=timeout)
                    self.total_inferences += 1
                    return result
                    
                except FutureTimeoutError:
                    # Cancel the future if still running
                    future.cancel()
                    
                    # Update metrics
                    session.update_status(InferenceStatus.TIMEOUT)
                    self.timeout_count += 1
                    
                    # Clean up CUDA memory if applicable
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    
                    # Raise timeout error with details
                    raise InferenceTimeoutError(
                        model_name=model_name,
                        timeout=timeout,
                        image_size=image_size or (0, 0)
                    )
                
                except Exception as e:
                    # Update metrics
                    session.update_status(InferenceStatus.FAILED, str(e))
                    self.failure_count += 1
                    
                    # Clean up on failure
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    
                    logger.error(f"Inference failed for {model_name}: {e}")
                    raise InferenceError(f"Inference failed: {str(e)}") from e
        
        except Exception as e:
            logger.error(f"Inference execution error for {model_name}: {e}")
            raise
    
    def _check_resources(self):
        """Check if resources are within limits"""
        memory_usage = self._get_memory_usage()
        
        if memory_usage > self.memory_limit_bytes:
            raise InferenceResourceError(
                f"Memory usage ({memory_usage / 1024**3:.2f}GB) exceeds limit "
                f"({self.memory_limit_bytes / 1024**3:.2f}GB)"
            )
        
        # Check CPU usage
        cpu_percent = psutil.cpu_percent(interval=0.1)
        if cpu_percent > 95:
            logger.warning(f"High CPU usage detected: {cpu_percent}%")
    
    def _get_memory_usage(self) -> int:
        """Get current memory usage in bytes"""
        if torch.cuda.is_available():
            return torch.cuda.memory_allocated()
        else:
            process = psutil.Process(os.getpid())
            return process.memory_info().rss
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get executor metrics"""
        return {
            "total_inferences": self.total_inferences,
            "timeout_count": self.timeout_count,
            "failure_count": self.failure_count,
            "timeout_rate": self.timeout_count / max(1, self.total_inferences),
            "failure_rate": self.failure_count / max(1, self.total_inferences),
            "active_sessions": len(self._sessions),
            "memory_usage_gb": self._get_memory_usage() / 1024**3
        }
    
    def shutdown(self, wait: bool = True, timeout: float = 30):
        """Shutdown the executor gracefully"""
        logger.info("Shutting down InferenceExecutor...")
        
        # Cancel any pending sessions
        with self._global_lock:
            for session in self._sessions.values():
                session.update_status(InferenceStatus.CANCELLED)
        
        # Shutdown executor
        self.executor.shutdown(wait=wait, timeout=timeout)
        
        # Clear CUDA cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        
        logger.info(f"InferenceExecutor shutdown complete. Metrics: {self.get_metrics()}")
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.shutdown()


# Singleton instance for global use
_global_executor: Optional[InferenceExecutor] = None
_executor_lock = threading.Lock()


def get_global_executor(**kwargs) -> InferenceExecutor:
    """Get or create the global inference executor"""
    global _global_executor
    
    with _executor_lock:
        if _global_executor is None:
            # Get configuration from environment
            max_workers = int(os.getenv("ML_INFERENCE_WORKERS", "2"))
            timeout = float(os.getenv("ML_INFERENCE_TIMEOUT", "60"))
            memory_limit = float(os.getenv("ML_MEMORY_LIMIT_GB", "4"))
            
            _global_executor = InferenceExecutor(
                max_workers=max_workers,
                default_timeout=timeout,
                memory_limit_gb=memory_limit,
                **kwargs
            )
        
        return _global_executor


def cleanup_global_executor():
    """Cleanup the global executor"""
    global _global_executor
    
    with _executor_lock:
        if _global_executor:
            _global_executor.shutdown()
            _global_executor = None