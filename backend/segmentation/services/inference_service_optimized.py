"""
Optimized Inference Service with Production Batching
Integrates with existing system while providing production optimizations
"""

import logging
import torch
import numpy as np
import asyncio
from typing import List, Tuple, Optional, Dict, Any
from pathlib import Path
import json

from .production_inference import ProductionInferenceService, get_production_service
from .postprocessing import extract_polygons

logger = logging.getLogger(__name__)

class OptimizedInferenceService:
    """
    Wrapper service that integrates production optimizations
    with existing inference pipeline
    """
    
    def __init__(self):
        """Initialize optimized inference service"""
        self.production_service = None
        self.config = self._load_config()
        self._init_production_service()
    
    def _load_config(self) -> Dict:
        """Load production configuration"""
        config_path = Path(__file__).parent.parent / "config" / "production_batch_config.json"
        
        if config_path.exists():
            with open(config_path, 'r') as f:
                return json.load(f)
        else:
            # Default configuration if optimization hasn't been run
            return {
                "configurations": {
                    "hrnet": {
                        "optimal_batch_size": 8,
                        "p95_latency_ms": 100
                    },
                    "cbam_resunet": {
                        "optimal_batch_size": 4,
                        "p95_latency_ms": 150
                    }
                }
            }
    
    def _init_production_service(self):
        """Initialize production service if available"""
        try:
            if torch.cuda.is_available():
                self.production_service = get_production_service()
                asyncio.create_task(self.production_service.start())
                logger.info("Production inference service initialized")
            else:
                logger.warning("CUDA not available, using fallback inference")
        except Exception as e:
            logger.error(f"Failed to initialize production service: {e}")
            self.production_service = None
    
    async def segment_image_optimized(
        self,
        image_array: np.ndarray,
        model_name: str = "hrnet",
        threshold: float = 0.5,
        min_area: int = 100,
        detect_holes: bool = True
    ) -> Tuple[List[List[Tuple[float, float]]], Dict[str, Any]]:
        """
        Perform optimized segmentation with production batching
        
        Args:
            image_array: Input image array (H, W, 3)
            model_name: Model to use
            threshold: Segmentation threshold
            min_area: Minimum polygon area
            detect_holes: Whether to detect holes in polygons
        
        Returns:
            Tuple of (polygons, metadata)
        """
        
        # Validate model name
        if model_name not in ["hrnet", "cbam_resunet"]:
            raise ValueError(f"Unknown model: {model_name}")
        
        # Use production service if available
        if self.production_service:
            try:
                # Get segmentation mask
                mask = await self.production_service.infer(
                    image=image_array,
                    model_name=model_name,
                    threshold=threshold,
                    timeout=2.0  # 2 second timeout
                )
                
                # Extract polygons
                polygons = extract_polygons(
                    mask,
                    min_area=min_area,
                    detect_holes=detect_holes
                )
                
                # Get metrics
                metrics = self.production_service.get_metrics()[model_name]
                
                metadata = {
                    "model": model_name,
                    "threshold": threshold,
                    "inference_mode": "production_optimized",
                    "batch_size": self.config["configurations"][model_name]["optimal_batch_size"],
                    "p95_latency_ms": metrics["p95_latency_ms"],
                    "throughput": metrics["throughput_imgs_per_sec"],
                    "polygon_count": len(polygons)
                }
                
                return polygons, metadata
                
            except Exception as e:
                logger.error(f"Production inference failed: {e}, falling back to standard")
                # Fall through to standard inference
        
        # Fallback to standard inference
        return await self._fallback_inference(
            image_array, model_name, threshold, min_area, detect_holes
        )
    
    async def _fallback_inference(
        self,
        image_array: np.ndarray,
        model_name: str,
        threshold: float,
        min_area: int,
        detect_holes: bool
    ) -> Tuple[List[List[Tuple[float, float]]], Dict[str, Any]]:
        """Fallback to standard inference without optimization"""
        # Import here to avoid circular dependency
        from .inference_service import InferenceService
        
        service = InferenceService()
        
        # Process single image
        result = service.process_single_image(
            image_array,
            model_name=model_name,
            threshold=threshold
        )
        
        # Extract polygons
        polygons = extract_polygons(
            result["mask"],
            min_area=min_area,
            detect_holes=detect_holes
        )
        
        metadata = {
            "model": model_name,
            "threshold": threshold,
            "inference_mode": "standard",
            "batch_size": 1,
            "inference_time_ms": result.get("inference_time", 0) * 1000,
            "polygon_count": len(polygons)
        }
        
        return polygons, metadata
    
    def get_optimal_batch_size(self, model_name: str) -> int:
        """Get optimal batch size for model"""
        return self.config["configurations"][model_name]["optimal_batch_size"]
    
    def get_performance_metrics(self) -> Dict[str, Any]:
        """Get current performance metrics"""
        if self.production_service:
            return self.production_service.get_metrics()
        return {}


# Singleton instance
_optimized_service: Optional[OptimizedInferenceService] = None

def get_optimized_service() -> OptimizedInferenceService:
    """Get singleton optimized inference service"""
    global _optimized_service
    if _optimized_service is None:
        _optimized_service = OptimizedInferenceService()
    return _optimized_service