"""Inference service for image segmentation"""

import logging
import time
import io
import cv2
import numpy as np
import torch
import torchvision.transforms as transforms
from PIL import Image
from typing import Dict, Any, List

# Use relative imports instead of sys.path manipulation
from .model_loader import ModelManager
from .postprocessing import PostprocessingService

logger = logging.getLogger(__name__)

class InferenceService:
    """Service for performing image segmentation inference"""
    
    def __init__(self, model_manager: ModelManager):
        self.model_manager = model_manager
        self.postprocessing = PostprocessingService()
        
        # ImageNet normalization (same as training)
        self.normalize = transforms.Normalize(
            mean=[0.485, 0.456, 0.406], 
            std=[0.229, 0.224, 0.225]
        )
        
        # Target size for models
        self.target_size = (1024, 1024)
    
    async def segment_image(self, image_data: bytes, model_name: str, 
                          threshold: float = 0.5, detect_holes: bool = True) -> Dict[str, Any]:
        """
        Perform segmentation on image data
        
        Args:
            image_data: Raw image bytes
            model_name: Name of the model to use
            threshold: Segmentation threshold
            detect_holes: Whether to detect holes/internal structures
            
        Returns:
            Dictionary with polygons and metadata
        """
        start_time = time.time()
        
        try:
            # Load and preprocess image
            image, original_size = self._load_and_preprocess_image(image_data)
            preprocessing_time = time.time() - start_time
            
            logger.info(f"Image preprocessed in {preprocessing_time:.3f}s, "
                       f"original size: {original_size}, target size: {self.target_size}")
            
            # Load model
            model_load_start = time.time()
            model = self.model_manager.load_model(model_name)
            model_load_time = time.time() - model_load_start
            
            logger.info(f"Model {model_name} loaded in {model_load_time:.3f}s")
            
            # Run inference
            inference_start = time.time()
            mask = self._run_inference(model, image)
            inference_time = time.time() - inference_start
            
            logger.info(f"Inference completed in {inference_time:.3f}s")
            
            # Postprocess mask to polygons
            postprocess_start = time.time()
            
            # Resize mask back to original size if needed
            if mask.shape != original_size:
                mask = cv2.resize(mask, original_size, interpolation=cv2.INTER_LINEAR)
            
            polygons = self.postprocessing.mask_to_polygons(mask, threshold, detect_holes)
            polygons = self.postprocessing.optimize_polygons(polygons)
            
            postprocess_time = time.time() - postprocess_start
            
            total_time = time.time() - start_time
            
            logger.info(f"Postprocessing completed in {postprocess_time:.3f}s, "
                       f"found {len(polygons)} polygons, total time: {total_time:.3f}s")
            
            return {
                "polygons": polygons,
                "image_size": {
                    "width": original_size[0],
                    "height": original_size[1]
                },
                "processing_stats": {
                    "preprocessing_time": preprocessing_time,
                    "model_load_time": model_load_time,
                    "inference_time": inference_time,
                    "postprocessing_time": postprocess_time,
                    "total_time": total_time
                }
            }
            
        except Exception as e:
            logger.error(f"Segmentation failed: {e}")
            raise RuntimeError(f"Segmentation failed: {str(e)}")
    
    def _load_and_preprocess_image(self, image_data: bytes) -> tuple:
        """Load and preprocess image for model input"""
        try:
            # Load image from bytes
            image = Image.open(io.BytesIO(image_data)).convert('RGB')
            original_size = image.size  # (width, height)
            
            # Convert to numpy array
            image_np = np.array(image)
            
            # Resize to target size
            image_resized = cv2.resize(image_np, self.target_size)
            
            # Convert to tensor and normalize
            image_tensor = torch.from_numpy(image_resized).permute(2, 0, 1).float() / 255.0
            
            # Apply ImageNet normalization
            image_tensor = self.normalize(image_tensor)
            
            # Add batch dimension
            image_tensor = image_tensor.unsqueeze(0)
            
            # Move to device
            device = self.model_manager.device
            image_tensor = image_tensor.to(device)
            
            return image_tensor, original_size
            
        except Exception as e:
            logger.error(f"Failed to preprocess image: {e}")
            raise ValueError(f"Invalid image data: {str(e)}")
    
    def _run_inference(self, model: torch.nn.Module, image: torch.Tensor) -> np.ndarray:
        """Run model inference on preprocessed image"""
        try:
            model.eval()
            
            with torch.no_grad():
                # Forward pass
                output = model(image)
                
                # Handle different output formats
                if isinstance(output, tuple):
                    output = output[0]  # Take first output for models that return tuples
                
                # Apply sigmoid activation
                output = torch.sigmoid(output)
                
                # Convert to numpy
                mask = output.squeeze().cpu().numpy()
                
                # Ensure mask is 2D
                if len(mask.shape) > 2:
                    mask = mask[0]  # Take first channel if multiple channels
                
                return mask
                
        except Exception as e:
            logger.error(f"Inference failed: {e}")
            raise RuntimeError(f"Model inference failed: {str(e)}")
    
    def get_supported_formats(self) -> List[str]:
        """Get list of supported image formats"""
        return ['PNG', 'JPG', 'JPEG', 'TIFF', 'TIF', 'BMP']
    
    def validate_image_data(self, image_data: bytes) -> bool:
        """Validate that image data is valid and supported"""
        try:
            image = Image.open(io.BytesIO(image_data))
            
            # Check format
            if image.format not in self.get_supported_formats():
                return False
            
            # Check size constraints
            width, height = image.size
            if width < 64 or height < 64:
                return False
            
            if width > 4096 or height > 4096:
                return False
            
            return True
            
        except Exception:
            return False
    
    def get_inference_stats(self) -> Dict[str, Any]:
        """Get inference statistics and memory usage"""
        stats = {
            "device": str(self.model_manager.device),
            "loaded_models": len(self.model_manager.loaded_models),
            "target_size": self.target_size,
            "supported_formats": self.get_supported_formats()
        }
        
        # Add memory stats if CUDA is available
        if self.model_manager.device.type == 'cuda':
            stats.update({
                "gpu_memory_allocated": torch.cuda.memory_allocated(),
                "gpu_memory_reserved": torch.cuda.memory_reserved()
            })
        
        return stats