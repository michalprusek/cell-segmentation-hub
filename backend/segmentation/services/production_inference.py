"""
Production Inference Service with Dynamic Batching
Optimized for low latency and high throughput in production environment
"""

import asyncio
import torch
import torch.cuda.amp as amp
import numpy as np
import time
import logging
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
from collections import deque
from threading import Lock
import json
from pathlib import Path
from datetime import datetime, timedelta

from ..models.hrnet import HRNetV2
from ..models.cbam_resunet import ResUNetCBAM

logger = logging.getLogger(__name__)

@dataclass
class InferenceRequest:
    """Single inference request"""
    id: str
    image: np.ndarray
    model_name: str
    threshold: float = 0.5
    timestamp: float = field(default_factory=time.time)
    callback: Optional[asyncio.Future] = None

@dataclass
class InferenceMetrics:
    """Metrics for monitoring inference performance"""
    total_requests: int = 0
    total_batches: int = 0
    total_inference_time: float = 0.0
    p50_latency: float = 0.0
    p95_latency: float = 0.0
    p99_latency: float = 0.0
    throughput: float = 0.0
    queue_size: int = 0
    gpu_memory_mb: float = 0.0
    last_update: datetime = field(default_factory=datetime.now)

class DynamicBatchQueue:
    """Queue with dynamic batching support"""
    
    def __init__(
        self,
        max_batch_size: int,
        max_queue_delay_ms: float = 5.0,
        max_queue_size: int = 100
    ):
        self.max_batch_size = max_batch_size
        self.max_queue_delay_ms = max_queue_delay_ms
        self.max_queue_size = max_queue_size
        self.queue = deque(maxlen=max_queue_size)
        self.lock = Lock()
        
    def add(self, request: InferenceRequest) -> bool:
        """Add request to queue"""
        with self.lock:
            if len(self.queue) >= self.max_queue_size:
                return False
            self.queue.append(request)
            return True
    
    def get_batch(self) -> List[InferenceRequest]:
        """Get batch of requests respecting time and size constraints"""
        with self.lock:
            if not self.queue:
                return []
            
            batch = []
            current_time = time.time()
            
            # Get requests up to max batch size
            while self.queue and len(batch) < self.max_batch_size:
                request = self.queue[0]
                
                # Check if first request has waited too long
                if len(batch) == 0:
                    wait_time_ms = (current_time - request.timestamp) * 1000
                    if wait_time_ms < self.max_queue_delay_ms:
                        # Not ready yet, unless we have enough for full batch
                        if len(self.queue) < self.max_batch_size:
                            break
                
                batch.append(self.queue.popleft())
            
            return batch
    
    def size(self) -> int:
        """Get current queue size"""
        with self.lock:
            return len(self.queue)

class ProductionInferenceService:
    """
    Production-optimized inference service with:
    - Dynamic batching
    - Mixed precision (FP16)
    - Memory optimization
    - Latency monitoring
    - Automatic failover
    """
    
    def __init__(self, config_path: Optional[str] = None):
        """Initialize production inference service"""
        
        # Load configuration
        if config_path is None:
            config_path = Path(__file__).parent.parent / "config" / "production_batch_config.json"
        
        with open(config_path, 'r') as f:
            self.config = json.load(f)
        
        # Setup device
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if not torch.cuda.is_available():
            logger.warning("CUDA not available, falling back to CPU")
        
        # Configure optimizations
        if torch.cuda.is_available():
            torch.backends.cudnn.benchmark = True
            torch.backends.cudnn.deterministic = False
        
        # Model configurations from optimization
        self.model_configs = {
            "hrnet": {
                "batch_size": self.config["configurations"]["hrnet"]["optimal_batch_size"],
                "p95_target": self.config["configurations"]["hrnet"]["p95_latency_ms"],
                "model": None,
                "queue": None
            },
            "cbam_resunet": {
                "batch_size": self.config["configurations"]["cbam_resunet"]["optimal_batch_size"],
                "p95_target": self.config["configurations"]["cbam_resunet"]["p95_latency_ms"],
                "model": None,
                "queue": None
            }
        }
        
        # Initialize models
        self._load_models()
        
        # Initialize queues
        for model_name, config in self.model_configs.items():
            config["queue"] = DynamicBatchQueue(
                max_batch_size=config["batch_size"],
                max_queue_delay_ms=5.0,  # 5ms max wait
                max_queue_size=100
            )
        
        # Metrics tracking
        self.metrics = {
            "hrnet": InferenceMetrics(),
            "cbam_resunet": InferenceMetrics()
        }
        self.latency_buffer = {
            "hrnet": deque(maxlen=1000),
            "cbam_resunet": deque(maxlen=1000)
        }
        
        # Start background processing
        self.running = True
        self.processing_tasks = {}
        
    def _load_models(self):
        """Load and optimize models"""
        
        # Load HRNet
        logger.info("Loading HRNet model...")
        hrnet = HRNetV2(n_class=1, use_instance_norm=True)
        hrnet_weights = Path(__file__).parent.parent / "weights" / "hrnet_best_model.pth"
        
        if hrnet_weights.exists():
            try:
                checkpoint = torch.load(hrnet_weights, map_location=self.device, weights_only=True)
                if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                    hrnet.load_state_dict(checkpoint['model_state_dict'], strict=False)
                else:
                    hrnet.load_state_dict(checkpoint, strict=False)
                logger.info("HRNet weights loaded")
            except Exception as e:
                logger.error(f"Failed to load HRNet weights: {e}")
        
        hrnet = hrnet.to(self.device)
        hrnet.eval()
        hrnet = hrnet.to(memory_format=torch.channels_last)
        self.model_configs["hrnet"]["model"] = hrnet
        
        # Load CBAM-ResUNet
        logger.info("Loading CBAM-ResUNet model...")
        cbam = ResUNetCBAM(
            in_channels=3,
            out_channels=1,
            features=[64, 128, 256, 512],
            use_instance_norm=True,
            dropout_rate=0.15
        )
        cbam_weights = Path(__file__).parent.parent / "weights" / "cbam_resunet_new.pth"
        
        if cbam_weights.exists():
            try:
                checkpoint = torch.load(cbam_weights, map_location=self.device, weights_only=True)
                if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                    cbam.load_state_dict(checkpoint['model_state_dict'], strict=False)
                else:
                    cbam.load_state_dict(checkpoint, strict=False)
                logger.info("CBAM-ResUNet weights loaded")
            except Exception as e:
                logger.error(f"Failed to load CBAM-ResUNet weights: {e}")
        
        cbam = cbam.to(self.device)
        cbam.eval()
        cbam = cbam.to(memory_format=torch.channels_last)
        self.model_configs["cbam_resunet"]["model"] = cbam
        
        # Warmup models
        self._warmup_models()
    
    def _warmup_models(self, iterations: int = 10):
        """Warmup models for optimal performance"""
        logger.info("Warming up models...")
        
        for model_name, config in self.model_configs.items():
            model = config["model"]
            batch_size = config["batch_size"]
            
            dummy_input = torch.randn(
                batch_size, 3, 1024, 1024,
                device=self.device,
                dtype=torch.float16
            ).to(memory_format=torch.channels_last)
            
            with torch.no_grad():
                for _ in range(iterations):
                    with amp.autocast():
                        _ = model(dummy_input)
                    torch.cuda.synchronize()
            
            logger.info(f"{model_name} warmup complete")
    
    def preprocess_batch(
        self,
        images: List[np.ndarray]
    ) -> torch.Tensor:
        """Preprocess batch of images for inference"""
        # Stack images
        batch = np.stack(images, axis=0)
        
        # Convert to tensor
        tensor = torch.from_numpy(batch).float()
        
        # Normalize to [0, 1]
        tensor = tensor / 255.0
        
        # Move to device and optimize format
        tensor = tensor.to(self.device)
        tensor = tensor.to(memory_format=torch.channels_last)
        
        return tensor
    
    def postprocess_batch(
        self,
        output: torch.Tensor,
        threshold: float = 0.5
    ) -> List[np.ndarray]:
        """Postprocess batch output to binary masks"""
        with torch.no_grad():
            # Apply sigmoid
            output = torch.sigmoid(output)
            
            # Threshold
            masks = (output > threshold).float()
            
            # Convert to numpy
            masks = masks.cpu().numpy()
            
            # Split batch
            results = [masks[i, 0] for i in range(masks.shape[0])]
            
        return results
    
    async def process_batch(
        self,
        model_name: str,
        requests: List[InferenceRequest]
    ):
        """Process a batch of requests"""
        if not requests:
            return
        
        start_time = time.time()
        config = self.model_configs[model_name]
        model = config["model"]
        metrics = self.metrics[model_name]
        
        try:
            # Prepare batch
            images = [req.image for req in requests]
            batch_tensor = self.preprocess_batch(images)
            
            # Run inference
            with torch.no_grad():
                with amp.autocast():
                    output = model(batch_tensor)
            
            torch.cuda.synchronize()
            
            # Postprocess
            thresholds = [req.threshold for req in requests]
            avg_threshold = np.mean(thresholds)
            results = self.postprocess_batch(output, avg_threshold)
            
            # Calculate latency
            inference_time = time.time() - start_time
            latency_per_image = inference_time / len(requests)
            
            # Update metrics
            metrics.total_requests += len(requests)
            metrics.total_batches += 1
            metrics.total_inference_time += inference_time
            
            # Track latency
            self.latency_buffer[model_name].append(latency_per_image * 1000)  # Convert to ms
            
            # Return results via callbacks
            for req, result in zip(requests, results):
                if req.callback:
                    req.callback.set_result(result)
            
            # Log performance
            if metrics.total_batches % 100 == 0:
                self._update_metrics(model_name)
                logger.info(
                    f"{model_name}: Batch {metrics.total_batches}, "
                    f"Size: {len(requests)}, "
                    f"Latency: {latency_per_image*1000:.2f}ms/img, "
                    f"Queue: {config['queue'].size()}"
                )
            
        except Exception as e:
            logger.error(f"Batch processing failed for {model_name}: {e}")
            # Return error to callbacks
            for req in requests:
                if req.callback:
                    req.callback.set_exception(e)
    
    def _update_metrics(self, model_name: str):
        """Update performance metrics"""
        metrics = self.metrics[model_name]
        latencies = list(self.latency_buffer[model_name])
        
        if latencies:
            metrics.p50_latency = np.percentile(latencies, 50)
            metrics.p95_latency = np.percentile(latencies, 95)
            metrics.p99_latency = np.percentile(latencies, 99)
            
            # Calculate throughput
            if metrics.total_inference_time > 0:
                metrics.throughput = metrics.total_requests / metrics.total_inference_time
        
        # GPU memory
        if torch.cuda.is_available():
            metrics.gpu_memory_mb = torch.cuda.memory_allocated() / 1024**2
        
        metrics.queue_size = self.model_configs[model_name]["queue"].size()
        metrics.last_update = datetime.now()
    
    async def process_queue_continuously(self, model_name: str):
        """Continuously process queue for a model"""
        config = self.model_configs[model_name]
        queue = config["queue"]
        
        while self.running:
            # Get batch
            batch = queue.get_batch()
            
            if batch:
                await self.process_batch(model_name, batch)
            else:
                # No requests, wait a bit
                await asyncio.sleep(0.001)  # 1ms
    
    async def infer(
        self,
        image: np.ndarray,
        model_name: str = "hrnet",
        threshold: float = 0.5,
        timeout: float = 1.0
    ) -> np.ndarray:
        """
        Perform inference on a single image
        
        Args:
            image: Input image (H, W, 3) in RGB format
            model_name: Model to use ("hrnet" or "cbam_resunet")
            threshold: Segmentation threshold
            timeout: Max wait time in seconds
        
        Returns:
            Binary mask (H, W)
        """
        if model_name not in self.model_configs:
            raise ValueError(f"Unknown model: {model_name}")
        
        # Create request
        request = InferenceRequest(
            id=f"{model_name}_{time.time()}",
            image=image,
            model_name=model_name,
            threshold=threshold,
            callback=asyncio.Future()
        )
        
        # Add to queue
        queue = self.model_configs[model_name]["queue"]
        if not queue.add(request):
            raise RuntimeError("Queue is full")
        
        # Wait for result
        try:
            result = await asyncio.wait_for(request.callback, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            raise TimeoutError(f"Inference timeout after {timeout}s")
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get current performance metrics"""
        return {
            model_name: {
                "total_requests": m.total_requests,
                "total_batches": m.total_batches,
                "p50_latency_ms": round(m.p50_latency, 2),
                "p95_latency_ms": round(m.p95_latency, 2),
                "p99_latency_ms": round(m.p99_latency, 2),
                "throughput_imgs_per_sec": round(m.throughput, 2),
                "queue_size": m.queue_size,
                "gpu_memory_mb": round(m.gpu_memory_mb, 0),
                "last_update": m.last_update.isoformat()
            }
            for model_name, m in self.metrics.items()
        }
    
    async def start(self):
        """Start background processing"""
        self.running = True
        
        # Start processing tasks for each model
        for model_name in self.model_configs.keys():
            task = asyncio.create_task(self.process_queue_continuously(model_name))
            self.processing_tasks[model_name] = task
        
        logger.info("Production inference service started")
    
    async def stop(self):
        """Stop background processing"""
        self.running = False
        
        # Wait for tasks to complete
        for task in self.processing_tasks.values():
            task.cancel()
        
        await asyncio.gather(*self.processing_tasks.values(), return_exceptions=True)
        
        logger.info("Production inference service stopped")
    
    def __del__(self):
        """Cleanup on deletion"""
        if hasattr(self, 'running') and self.running:
            self.running = False


# Singleton instance
_service_instance: Optional[ProductionInferenceService] = None

def get_production_service() -> ProductionInferenceService:
    """Get singleton production inference service"""
    global _service_instance
    if _service_instance is None:
        _service_instance = ProductionInferenceService()
    return _service_instance