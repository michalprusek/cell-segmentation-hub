"""
Model Loader for Spheroid Segmentation Models
Loads pretrained models and provides inference functionality with batch processing support
"""
import os
import json
import torch
import torch.nn.functional as F
from PIL import Image
import numpy as np
import cv2
from typing import Dict, List, Tuple, Any, Optional, Union
import logging
from pathlib import Path
import time
import uuid
import sys

# Add monitoring module to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from monitoring.gpu_monitor import get_gpu_monitor, GPUMonitor
    gpu_monitor_available = True
except ImportError:
    gpu_monitor_available = False
    GPUMonitor = None

# Import model architectures using relative imports
from models.hrnet import HRNetV2
from models.resunet_advanced import AdvancedResUNet
from models.resunet_small import ResUNetSmall

# Import the new inference executor
from .inference_executor import (
    InferenceExecutor, 
    InferenceTimeoutError,
    InferenceError,
    get_global_executor
)

logger = logging.getLogger(__name__)


class BatchConfig:
    """Configuration for batch processing"""
    
    def __init__(self, config_path: str = None):
        """Load batch size configuration from file"""
        if config_path and Path(config_path).exists():
            with open(config_path, 'r') as f:
                self.config = json.load(f)
                logger.info(f"Loaded batch configuration from {config_path}")
        else:
            # Default fallback configuration
            self.config = {
                "batch_configurations": {
                    "hrnet": {
                        "optimal_batch_size": 4,
                        "max_safe_batch_size": 8,
                        "expected_throughput": 2.5,
                        "memory_limit_mb": 8000
                    },
                    "resunet_small": {
                        "optimal_batch_size": 2,
                        "max_safe_batch_size": 4,
                        "expected_throughput": 1.8,
                        "memory_limit_mb": 10000
                    },
                    "resunet_advanced": {
                        "optimal_batch_size": 1,
                        "max_safe_batch_size": 2,
                        "expected_throughput": 1.0,
                        "memory_limit_mb": 15000
                    }
                }
            }
            if config_path:
                logger.warning(f"Batch config not found at {config_path}, using defaults")
    
    def get_optimal_batch_size(self, model_name: str) -> int:
        """Get optimal batch size for model"""
        return self.config.get("batch_configurations", {}).get(model_name, {}).get("optimal_batch_size", 1)
    
    def get_max_safe_batch_size(self, model_name: str) -> int:
        """Get maximum safe batch size for model"""
        return self.config.get("batch_configurations", {}).get(model_name, {}).get("max_safe_batch_size", 1)
    
    def get_expected_throughput(self, model_name: str) -> float:
        """Get expected throughput for model"""
        return self.config.get("batch_configurations", {}).get(model_name, {}).get("expected_throughput", 1.0)


class ModelConfig:
    """Configuration for a specific model"""
    
    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = json.load(f)
    
    def get(self, key: str, default=None):
        return self.config.get(key, default)


class ModelLoader:
    """Loads and manages pretrained segmentation models with batch processing support"""
    
    AVAILABLE_MODELS = {
        'hrnet': {
            'class': HRNetV2,
            'pretrained_path': 'weights/hrnet_best_model.pth',
            'finetuned_path': 'weights/hrnet_best_model.pth',
            'config_path': None
        },
        'resunet_advanced': {
            'class': AdvancedResUNet,
            'pretrained_path': 'weights/resunet_advanced_best_model.pth',
            'finetuned_path': 'weights/resunet_advanced_best_model.pth',
            'config_path': None
        },
        'resunet_small': {
            'class': ResUNetSmall,
            'pretrained_path': 'weights/resunet_small_best_model.pth',
            'finetuned_path': 'weights/resunet_small_best_model.pth',
            'config_path': None
        }
    }
    
    def __init__(self, base_path: str = "."):
        self.base_path = Path(base_path)
        self.loaded_models: Dict[str, torch.nn.Module] = {}
        self.model_configs: Dict[str, ModelConfig] = {}
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # Load batch processing configuration
        batch_config_path = self.base_path / "config" / "batch_sizes.json"
        self.batch_config = BatchConfig(str(batch_config_path) if batch_config_path.exists() else None)
        
        # Initialize GPU monitoring if available
        self.gpu_monitor: Optional[GPUMonitor] = None
        if gpu_monitor_available and torch.cuda.is_available():
            try:
                self.gpu_monitor = get_gpu_monitor()
                logger.info("GPU monitoring enabled")
            except Exception as e:
                logger.warning(f"Could not initialize GPU monitoring: {e}")
                self.gpu_monitor = None
        
        # Processing state tracking
        self.is_processing = False
        self.current_model = None
        self.queue_length = 0
        self.last_batch_size = 1  # Track last used batch size for reporting
        
        logger.info(f"ModelLoader initialized with device: {self.device}")
        logger.info(f"Batch processing enabled with config: {batch_config_path.exists()}")
    
    def load_model(self, model_name: str, use_finetuned: bool = True) -> torch.nn.Module:
        """Load a specific model with pretrained weights"""
        
        if model_name not in self.AVAILABLE_MODELS:
            raise ValueError(f"Model {model_name} not available. Choose from: {list(self.AVAILABLE_MODELS.keys())}")
        
        model_info = self.AVAILABLE_MODELS[model_name]
        
        # Load configuration (optional)
        if model_info['config_path'] is not None:
            config_path = self.base_path / model_info['config_path']
            if config_path.exists():
                self.model_configs[model_name] = ModelConfig(str(config_path))
            else:
                logger.warning(f"Config file not found for {model_name}, using defaults")
                self.model_configs[model_name] = ModelConfig.__new__(ModelConfig)
                self.model_configs[model_name].config = {}
        else:
            # No config file specified
            self.model_configs[model_name] = ModelConfig.__new__(ModelConfig)
            self.model_configs[model_name].config = {}
        
        # Choose weights path
        weights_path = (
            model_info['finetuned_path'] if use_finetuned and 
            (self.base_path / model_info['finetuned_path']).exists()
            else model_info['pretrained_path']
        )
        
        weights_full_path = self.base_path / weights_path
        
        if not weights_full_path.exists():
            raise FileNotFoundError(f"Model weights not found: {weights_full_path}")
        
        # Initialize model
        try:
            if model_name == 'hrnet':
                model = HRNetV2(n_class=1, use_instance_norm=True)
            elif model_name == 'resunet_advanced':
                # Use correct feature dimensions matching trained weights: [64, 128, 256, 512]
                model = AdvancedResUNet(in_channels=3, out_channels=1, features=[64, 128, 256, 512], use_instance_norm=True, dropout_rate=0.2)
            elif model_name == 'resunet_small':
                # Use correct feature dimensions matching trained weights: [48, 96, 192, 384, 512]  
                model = ResUNetSmall(in_channels=3, out_channels=1, features=[48, 96, 192, 384, 512])
            else:
                raise ValueError(f"Unknown model architecture: {model_name}")
            
            # Load weights with fallback strategies for compatibility
            logger.info(f"Loading {model_name} weights from: {weights_full_path}")
            try:
                # Try weights_only=True first (safer for PyTorch 2.x)
                checkpoint = torch.load(weights_full_path, map_location=self.device, weights_only=True)
            except Exception as e1:
                logger.warning(f"Failed to load with weights_only=True: {e1}")
                try:
                    # Fallback without weights_only parameter for older PyTorch versions
                    checkpoint = torch.load(weights_full_path, map_location=self.device)
                    logger.info(f"Successfully loaded {model_name} without weights_only parameter")
                except Exception as e2:
                    logger.error(f"Failed to load checkpoint completely: {e2}")
                    raise e2
            
            # Extract state dict
            if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                state_dict = checkpoint['model_state_dict']
            elif isinstance(checkpoint, dict) and 'state_dict' in checkpoint:
                state_dict = checkpoint['state_dict']
            else:
                state_dict = checkpoint
            
            # For ResUNet models, try to auto-detect features from weights
            if model_name in ['resunet_advanced', 'resunet_small']:
                detected_features = self._detect_features_from_weights(state_dict, model_name)
                if detected_features:
                    logger.info(f"Auto-detected features for {model_name}: {detected_features}")
                    # Recreate model with detected features
                    if model_name == 'resunet_advanced':
                        model = AdvancedResUNet(in_channels=3, out_channels=1, features=detected_features, use_instance_norm=True, dropout_rate=0.2)
                    elif model_name == 'resunet_small':
                        model = ResUNetSmall(in_channels=3, out_channels=1, features=detected_features)
            
            # Load state dict
            model.load_state_dict(state_dict, strict=False)
            
            model.to(self.device)
            model.eval()
            
            self.loaded_models[model_name] = model
            
            logger.info(f"Successfully loaded model: {model_name}")
            return model
            
        except Exception as e:
            logger.error(f"Error loading model {model_name}: {str(e)}")
            raise
    
    def get_model(self, model_name: str) -> torch.nn.Module:
        """Get a loaded model (load if not already loaded)"""
        logger.info(f"Getting model: {model_name}")
        if model_name not in self.loaded_models:
            logger.info(f"Model {model_name} not loaded, loading now...")
            self.load_model(model_name)
        else:
            logger.info(f"Model {model_name} already loaded")
        return self.loaded_models[model_name]
    
    def preprocess_image(self, image: Image.Image, target_size: Tuple[int, int] = (1024, 1024)) -> torch.Tensor:
        """Preprocess single image for model inference"""
        
        # Convert to RGB if needed
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        # Resize image
        image = image.resize(target_size, Image.Resampling.LANCZOS)
        
        # Convert to numpy array and normalize
        image_np = np.array(image).astype(np.float32) / 255.0
        
        # Convert to tensor and add batch dimension
        image_tensor = torch.from_numpy(image_np.transpose(2, 0, 1)).unsqueeze(0)
        
        return image_tensor.to(self.device)
    
    def preprocess_image_batch(self, images: List[Image.Image], target_size: Tuple[int, int] = (1024, 1024)) -> torch.Tensor:
        """Preprocess batch of images for model inference"""
        
        batch_tensors = []
        
        for image in images:
            # Convert to RGB if needed
            if image.mode != 'RGB':
                image = image.convert('RGB')
            
            # Resize image
            image = image.resize(target_size, Image.Resampling.LANCZOS)
            
            # Convert to numpy array and normalize
            image_np = np.array(image).astype(np.float32) / 255.0
            
            # Convert to tensor (no batch dimension yet)
            image_tensor = torch.from_numpy(image_np.transpose(2, 0, 1))
            batch_tensors.append(image_tensor)
        
        # Stack into batch tensor
        batch_tensor = torch.stack(batch_tensors, dim=0)
        
        return batch_tensor.to(self.device)
    
    def postprocess_mask(self, mask: torch.Tensor, original_size: Tuple[int, int], 
                        threshold: float = 0.5) -> np.ndarray:
        """Postprocess model output to create binary mask"""
        
        # Apply sigmoid activation if needed
        if mask.min() < 0 or mask.max() > 1:
            mask = torch.sigmoid(mask)
        
        # Remove batch and channel dimensions
        mask = mask.squeeze().cpu().numpy()
        
        # Resize back to original size
        mask_resized = cv2.resize(mask, original_size, interpolation=cv2.INTER_LINEAR)
        
        # Apply threshold
        binary_mask = (mask_resized > threshold).astype(np.uint8)
        
        return binary_mask
    
    def postprocess_mask_batch(self, masks: torch.Tensor, original_sizes: List[Tuple[int, int]], 
                              threshold: float = 0.5) -> List[np.ndarray]:
        """Postprocess batch of model outputs to create binary masks"""
        
        # Apply sigmoid activation if needed
        if masks.min() < 0 or masks.max() > 1:
            masks = torch.sigmoid(masks)
        
        # Remove channel dimension (keep batch dimension)
        if masks.dim() == 4 and masks.size(1) == 1:
            masks = masks.squeeze(1)  # Remove channel dimension
        
        masks_cpu = masks.cpu().numpy()
        processed_masks = []
        
        for i, (mask, original_size) in enumerate(zip(masks_cpu, original_sizes)):
            # Resize back to original size
            mask_resized = cv2.resize(mask, original_size, interpolation=cv2.INTER_LINEAR)
            
            # Apply threshold
            binary_mask = (mask_resized > threshold).astype(np.uint8)
            processed_masks.append(binary_mask)
        
        return processed_masks
    
    def get_optimal_batch_size(self, model_name: str) -> int:
        """Get optimal batch size for a model"""
        return self.batch_config.get_optimal_batch_size(model_name)
    
    def get_max_safe_batch_size(self, model_name: str) -> int:
        """Get maximum safe batch size for a model"""
        return self.batch_config.get_max_safe_batch_size(model_name)
    
    def predict(self, image: Image.Image, model_name: str, threshold: float = 0.5, detect_holes: bool = True, timeout: Optional[float] = None) -> Dict[str, Any]:
        """
        Perform segmentation on an image with improved timeout handling
        
        Args:
            image: PIL Image to segment
            model_name: Name of the model to use
            threshold: Segmentation threshold
            detect_holes: Whether to detect holes in segmentation
            timeout: Optional timeout override (uses env variable if not specified)
        
        Returns:
            Dictionary containing segmentation results
            
        Raises:
            InferenceTimeoutError: If inference exceeds timeout
            InferenceError: For other inference failures
        """
        
        # Set processing state
        self.is_processing = True
        self.current_model = model_name
        
        try:
            original_size = image.size  # (width, height)
            logger.info(f"Starting prediction for {model_name}, image size: {original_size}, detect_holes: {detect_holes}")
            
            # Get model
            model = self.get_model(model_name)
            logger.info(f"Model {model_name} loaded successfully")
            
            # Preprocess image
            input_tensor = self.preprocess_image(image)
            logger.info(f"Image preprocessed, tensor shape: {input_tensor.shape}, device: {input_tensor.device}")
            
            # Get the global inference executor
            executor = get_global_executor()
            
            # Use environment variable for timeout if not specified
            if timeout is None:
                timeout = float(os.getenv("ML_INFERENCE_TIMEOUT", "60"))
            
            # Log resource usage before inference
            if self.device.type == 'cuda':
                memory_before = torch.cuda.memory_allocated()
                logger.info(f"GPU memory before inference: {memory_before / 1024**2:.1f} MB")
            
            # Perform inference with proper timeout handling
            logger.info(f"Starting inference with {model_name}, timeout: {timeout}s")
            
            try:
                output = executor.execute_inference(
                    model=model,
                    input_tensor=input_tensor,
                    model_name=model_name,
                    timeout=timeout,
                    image_size=original_size
                )
                logger.info(f"Inference completed, output shape: {output.shape if not isinstance(output, tuple) else [o.shape for o in output]}")
                
            except InferenceTimeoutError:
                # Re-raise with additional context
                self.is_processing = False
                self.current_model = None
                raise
                
            except Exception as e:
                # Wrap other exceptions
                self.is_processing = False
                self.current_model = None
                raise InferenceError(f"Inference failed for {model_name}: {str(e)}") from e
            
            # Check memory after inference
            if self.device.type == 'cuda':
                memory_after = torch.cuda.memory_allocated()
                logger.info(f"GPU memory after inference: {memory_after / 1024**2:.1f} MB")
            
            # Handle different output formats
            if isinstance(output, tuple):
                output = output[0]  # Take main output
            
            # Postprocess
            binary_mask = self.postprocess_mask(output, original_size, threshold)
        
            # If detect_holes is False, fill all holes in the binary mask
            if not detect_holes:
                # Create filled mask by flood-filling from edges
                h, w = binary_mask.shape
                filled_mask = binary_mask.copy()
                
                # Find all contours
                temp_contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                
                # Fill all contours (this fills holes)
                for contour in temp_contours:
                    cv2.fillPoly(filled_mask, [contour], 255)
                
                binary_mask = filled_mask
                logger.info("Holes detection disabled - filled all holes in binary mask")
            
            # Find contours for polygon extraction with hierarchy
            if detect_holes:
                # Use RETR_TREE to detect holes and internal structures
                contours, hierarchy = cv2.findContours(binary_mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
            else:
                # Use RETR_EXTERNAL to detect only external boundaries (holes already filled)
                contours, hierarchy = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            # Convert contours to polygons with hierarchy information
            polygons = []
            filtered_count = 0
            polygon_id_counter = 1
            
            if hierarchy is not None:
                hierarchy = hierarchy[0]  # OpenCV returns hierarchy as shape (1, N, 4)
            
            for i, contour in enumerate(contours):
                # Skip very small contours (area < 50 pixels) - aligned with postprocessing service
                if cv2.contourArea(contour) < 50:
                    filtered_count += 1
                    continue
                    
                # Use original contour without simplification for maximum precision
                original_points = len(contour)
                
                # Convert to list of points
                polygon_points = []
                for point in contour:
                    x, y = point[0]
                    polygon_points.append({"x": float(x), "y": float(y)})
                
                if len(polygon_points) >= 3:  # Valid polygon needs at least 3 points
                    # Determine polygon type based on hierarchy and detect_holes setting
                    polygon_type = "external"
                    parent_id = None
                    
                    if detect_holes and hierarchy is not None:
                        # hierarchy[i] = [next, previous, first_child, parent]
                        parent_idx = hierarchy[i][3]
                        if parent_idx != -1:
                            # This is an internal contour (hole)
                            polygon_type = "internal"
                            # Find the parent polygon ID (need to account for filtered contours)
                            parent_polygon_id = None
                            for j, existing_polygon in enumerate(polygons):
                                if existing_polygon.get("contour_index") == parent_idx:
                                    parent_polygon_id = existing_polygon["id"]
                                    break
                            parent_id = parent_polygon_id
                    
                    polygon_data = {
                        "id": f"polygon_{polygon_id_counter}",
                        "points": polygon_points,
                        "type": polygon_type,
                        "class": "spheroid",
                        "confidence": float(torch.sigmoid(output).max().item()),
                        "vertices_count": original_points,
                        "contour_index": i  # Temporary field to help with hierarchy mapping
                    }
                    
                    if parent_id:
                        polygon_data["parent_id"] = parent_id
                    
                    polygons.append(polygon_data)
                    polygon_id_counter += 1
                    
                    logger.info(f"Polygon {polygon_id_counter-1}: {original_points} vertices, type: {polygon_type}")
            
            # Remove temporary contour_index field
            for polygon in polygons:
                polygon.pop("contour_index", None)
            
            # Log polygon detection results with hierarchy information
            total_contours = len(contours)
            external_count = len([p for p in polygons if p["type"] == "external"])
            internal_count = len([p for p in polygons if p["type"] == "internal"])
            
            logger.info(f"Polygon detection: {len(polygons)} valid polygons from {total_contours} contours "
                       f"({external_count} external, {internal_count} internal, filtered {filtered_count} small contours)")
            
            if len(polygons) == 0:
                logger.warning(f"No valid polygons detected! Total contours: {total_contours}, filtered: {filtered_count}")
                logger.warning(f"Binary mask stats - shape: {binary_mask.shape}, unique values: {np.unique(binary_mask)}")
                logger.warning(f"Model output stats - min: {output.min().item():.6f}, max: {output.max().item():.6f}, mean: {output.mean().item():.6f}")
                logger.warning(f"After sigmoid - min: {torch.sigmoid(output).min().item():.6f}, max: {torch.sigmoid(output).max().item():.6f}")
            elif internal_count > 0:
                logger.info(f"Detected {internal_count} holes/internal polygons within cells")
            
            result = {
                "model_used": model_name,
                "threshold_used": threshold,
                "image_size": {"width": original_size[0], "height": original_size[1]},
                "polygons": polygons,
                "processing_info": {
                    "device": str(self.device),
                    "num_polygons": len(polygons),
                    "confidence_scores": [p["confidence"] for p in polygons],
                    "batch_size": 1  # Single image processing
                }
            }
            
            return result
            
        finally:
            # Reset processing state
            self.is_processing = False
            self.current_model = None
    
    def predict_batch(self, images: List[Image.Image], model_name: str, batch_size: Optional[int] = None, 
                     threshold: float = 0.5, detect_holes: bool = True, timeout: Optional[float] = None) -> List[Dict[str, Any]]:
        """
        Perform batch segmentation on multiple images with automatic batching
        
        Args:
            images: List of PIL Images to segment
            model_name: Name of the model to use
            batch_size: Batch size to use (uses optimal if None)
            threshold: Segmentation threshold
            detect_holes: Whether to detect holes in segmentation
            timeout: Optional timeout override per batch
        
        Returns:
            List of dictionaries containing segmentation results
            
        Raises:
            InferenceTimeoutError: If inference exceeds timeout
            InferenceError: For other inference failures
        """
        
        if not images:
            return []
            
        # Determine batch size
        if batch_size is None:
            batch_size = self.get_optimal_batch_size(model_name)
        
        # Ensure batch size doesn't exceed safe limit
        max_safe_batch = self.get_max_safe_batch_size(model_name)
        if batch_size > max_safe_batch:
            logger.warning(f"Requested batch size {batch_size} exceeds safe limit {max_safe_batch}, using safe limit")
            batch_size = max_safe_batch
        
        # Store batch size for reporting
        self.last_batch_size = batch_size
        
        logger.info(f"Starting batch prediction for {len(images)} images with {model_name}, batch_size: {batch_size}")
        
        # Set processing state
        self.is_processing = True
        self.current_model = model_name
        
        try:
            # Get model
            model = self.get_model(model_name)
            
            # Store original sizes
            original_sizes = [img.size for img in images]
            
            # Process images in batches
            all_results = []
            
            for batch_start in range(0, len(images), batch_size):
                batch_end = min(batch_start + batch_size, len(images))
                batch_images = images[batch_start:batch_end]
                batch_original_sizes = original_sizes[batch_start:batch_end]
                current_batch_size = len(batch_images)
                
                logger.info(f"Processing batch {batch_start//batch_size + 1}/{(len(images) + batch_size - 1)//batch_size} "
                           f"(images {batch_start}-{batch_end-1})")
                
                # Preprocess batch
                batch_tensor = self.preprocess_image_batch(batch_images)
                
                # Get the global inference executor
                executor = get_global_executor()
                
                # Use environment variable for timeout if not specified
                if timeout is None:
                    timeout = float(os.getenv("ML_INFERENCE_TIMEOUT", "60"))
                
                # Track GPU metrics if monitoring is available
                start_time = time.time()
                memory_before = torch.cuda.memory_allocated() if self.device.type == 'cuda' else 0
                
                # Log resource usage before inference
                if self.device.type == 'cuda':
                    logger.info(f"GPU memory before batch inference: {memory_before / 1024**2:.1f} MB")
                    
                    # Check if we should reduce batch size based on memory pressure
                    if self.gpu_monitor and self.gpu_monitor.should_reduce_batch_size():
                        if current_batch_size > 1:
                            logger.warning(f"Memory pressure detected, reducing batch size from {current_batch_size} to {current_batch_size // 2}")
                            current_batch_size = max(1, current_batch_size // 2)
                            batch_images = batch_images[:current_batch_size]
                            batch_original_sizes = batch_original_sizes[:current_batch_size]
                            batch_tensor = self.preprocess_image_batch(batch_images)
                
                # Perform batch inference with GPU OOM handling
                try:
                    batch_output = executor.execute_inference(
                        model=model,
                        input_tensor=batch_tensor,
                        model_name=model_name,
                        timeout=timeout * current_batch_size,  # Scale timeout with batch size
                        image_size=batch_original_sizes[0]  # Representative size
                    )
                    logger.info(f"Batch inference completed, output shape: {batch_output.shape}")
                    
                except torch.cuda.OutOfMemoryError as e:
                    logger.warning(f"GPU OOM with batch size {current_batch_size}, attempting recovery...")
                    torch.cuda.empty_cache()
                    
                    # Try with batch size 1 as fallback
                    if current_batch_size > 1:
                        logger.info(f"Retrying with batch size 1...")
                        batch_results = []
                        for single_image in batch_images:
                            single_tensor = self.preprocess_image_batch([single_image])
                            single_output = executor.execute_inference(
                                model=model,
                                input_tensor=single_tensor,
                                model_name=model_name,
                                timeout=timeout,
                                image_size=single_image.size
                            )
                            batch_results.append(single_output)
                        batch_output = torch.cat(batch_results, dim=0)
                        logger.info(f"Successfully processed batch with single-image fallback")
                    else:
                        raise InferenceError(
                            model_name=model_name,
                            error=f"GPU out of memory even with batch size 1: {str(e)}"
                        )
                    
                except InferenceTimeoutError as e:
                    self.is_processing = False
                    self.current_model = None
                    raise InferenceTimeoutError(
                        model_name=model_name,
                        timeout=timeout,
                        image_size=f"batch_{current_batch_size}_images"
                    )
                    
                except Exception as e:
                    self.is_processing = False
                    self.current_model = None
                    raise InferenceError(f"Batch inference failed for {model_name}: {str(e)}") from e
                
                # Check memory after inference and record metrics
                if self.device.type == 'cuda':
                    memory_after = torch.cuda.memory_allocated()
                    memory_delta = max(0, memory_after - memory_before)  # Fix negative memory with max(0, ...)
                    logger.info(f"GPU memory after batch inference: {memory_after / 1024**2:.1f} MB (delta: {memory_delta / 1024**2:.1f} MB)")
                    
                    # Record batch processing metrics if monitoring is available
                    if self.gpu_monitor:
                        success = True
                        error_msg = None
                        try:
                            metrics = self.gpu_monitor.record_batch_processing(
                                model_name=model_name,
                                batch_size=current_batch_size,
                                start_time=start_time,
                                memory_before=memory_before,
                                success=success,
                                error_message=error_msg
                            )
                            logger.debug(f"Batch metrics recorded: throughput={metrics.throughput_imgs_sec:.2f} imgs/sec")
                        except Exception as e:
                            logger.warning(f"Could not record batch metrics: {e}")
                
                # Handle different output formats
                if isinstance(batch_output, tuple):
                    batch_output = batch_output[0]  # Take main output
                
                # Postprocess batch
                batch_masks = self.postprocess_mask_batch(batch_output, batch_original_sizes, threshold)
                
                # Process each mask in the batch to extract polygons
                for i, (mask, original_size, image) in enumerate(zip(batch_masks, batch_original_sizes, batch_images)):
                    
                    # If detect_holes is False, fill all holes
                    if not detect_holes:
                        h, w = mask.shape
                        filled_mask = mask.copy()
                        temp_contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                        for contour in temp_contours:
                            cv2.fillPoly(filled_mask, [contour], 255)
                        mask = filled_mask
                    
                    # Find contours
                    if detect_holes:
                        contours, hierarchy = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
                    else:
                        contours, hierarchy = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                    
                    # Convert contours to polygons
                    polygons = []
                    filtered_count = 0
                    polygon_id_counter = 1
                    
                    if hierarchy is not None:
                        hierarchy = hierarchy[0]
                    
                    for j, contour in enumerate(contours):
                        if cv2.contourArea(contour) < 50:
                            filtered_count += 1
                            continue
                        
                        original_points = len(contour)
                        polygon_points = []
                        
                        for point in contour:
                            x, y = point[0]
                            polygon_points.append({"x": float(x), "y": float(y)})
                        
                        if len(polygon_points) >= 3:
                            polygon_type = "external"
                            parent_id = None
                            
                            if detect_holes and hierarchy is not None:
                                parent_idx = hierarchy[j][3]
                                if parent_idx != -1:
                                    polygon_type = "internal"
                                    # Find parent polygon ID
                                    for k, existing_polygon in enumerate(polygons):
                                        if existing_polygon.get("contour_index") == parent_idx:
                                            parent_id = existing_polygon["id"]
                                            break
                            
                            # Get confidence from the specific mask output
                            mask_output = batch_output[i] if batch_output.dim() > 3 else batch_output
                            confidence = float(torch.sigmoid(mask_output).max().item())
                            
                            polygon_data = {
                                "id": f"polygon_{polygon_id_counter}",
                                "points": polygon_points,
                                "type": polygon_type,
                                "class": "spheroid",
                                "confidence": confidence,
                                "vertices_count": original_points,
                                "contour_index": j
                            }
                            
                            if parent_id:
                                polygon_data["parent_id"] = parent_id
                            
                            polygons.append(polygon_data)
                            polygon_id_counter += 1
                    
                    # Remove temporary contour_index field
                    for polygon in polygons:
                        polygon.pop("contour_index", None)
                    
                    # Create result for this image
                    result = {
                        "model_used": model_name,
                        "threshold_used": threshold,
                        "image_size": {"width": original_size[0], "height": original_size[1]},
                        "polygons": polygons,
                        "processing_info": {
                            "device": str(self.device),
                            "num_polygons": len(polygons),
                            "confidence_scores": [p["confidence"] for p in polygons],
                            "batch_size": current_batch_size,
                            "batch_position": i + 1
                        }
                    }
                    
                    all_results.append(result)
                    
                    logger.info(f"  Image {batch_start + i + 1}: {len(polygons)} polygons extracted")
            
            logger.info(f"Batch processing completed: {len(images)} images processed in batches of {batch_size}")
            return all_results
            
        finally:
            # Reset processing state
            self.is_processing = False
            self.current_model = None
    
    def get_available_models(self) -> List[str]:
        """Get list of available model names"""
        return list(self.AVAILABLE_MODELS.keys())
    
    def get_model_info(self) -> Dict[str, Dict[str, Any]]:
        """Get information about all available models including batch configuration"""
        info = {}
        for name, config in self.AVAILABLE_MODELS.items():
            info[name] = {
                "name": name,
                "description": f"{name.upper()} model for spheroid segmentation",
                "has_pretrained": (self.base_path / config['pretrained_path']).exists(),
                "has_finetuned": (self.base_path / config['finetuned_path']).exists(),
                "recommended_threshold": 0.5,
                "optimal_batch_size": self.get_optimal_batch_size(name),
                "max_safe_batch_size": self.get_max_safe_batch_size(name),
                "expected_throughput": self.batch_config.get_expected_throughput(name)
            }
        return info
    
    def _detect_features_from_weights(self, state_dict: dict, model_name: str) -> List[int]:
        """Auto-detect feature dimensions from model weights"""
        try:
            features = []
            
            # Look for encoder blocks patterns
            if model_name == 'resunet_advanced':
                # Pattern: encoder1.0.conv1.weight, encoder2.0.conv1.weight, etc.
                for i in range(1, 6):  # Check up to 5 encoder levels
                    key = f"encoder{i}.0.conv1.weight"
                    if key in state_dict:
                        out_channels = state_dict[key].shape[0]
                        features.append(out_channels)
                        logger.info(f"Detected encoder{i} features: {out_channels}")
                    else:
                        break
                        
            elif model_name == 'resunet_small':
                # Pattern: downs.0.conv1.weight, downs.1.conv1.weight, etc.
                for i in range(6):  # Check up to 6 encoder levels
                    key = f"downs.{i}.conv1.weight"
                    if key in state_dict:
                        out_channels = state_dict[key].shape[0]
                        features.append(out_channels)
                        logger.info(f"Detected downs.{i} features: {out_channels}")
                    else:
                        break
            
            if len(features) > 0:
                logger.info(f"Successfully detected {len(features)} feature levels: {features}")
                return features
            else:
                logger.warning(f"Could not detect features from weights for {model_name}")
                return None
                
        except Exception as e:
            logger.error(f"Error detecting features from weights: {e}")
            return None
    
    def get_batch_limit(self, model_name: str) -> int:
        """Get batch size limit for a specific model based on memory requirements (legacy method)"""
        # Use the new batch configuration system
        return self.get_max_safe_batch_size(model_name)