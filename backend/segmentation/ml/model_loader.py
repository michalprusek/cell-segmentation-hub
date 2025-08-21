"""
Model Loader for Spheroid Segmentation Models
Loads pretrained models and provides inference functionality
"""
import os
import json
import torch
import torch.nn.functional as F
from PIL import Image
import numpy as np
import cv2
from typing import Dict, List, Tuple, Any
import logging
from pathlib import Path

# Import model architectures using relative imports

from models.hrnet import HRNetV2
from models.resunet_advanced import AdvancedResUNet
from models.resunet_small import ResUNetSmall

logger = logging.getLogger(__name__)


class ModelConfig:
    """Configuration for a specific model"""
    
    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = json.load(f)
    
    def get(self, key: str, default=None):
        return self.config.get(key, default)


class ModelLoader:
    """Loads and manages pretrained segmentation models"""
    
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
        
        # Processing state tracking
        self.is_processing = False
        self.current_model = None
        self.queue_length = 0
        
        logger.info(f"ModelLoader initialized with device: {self.device}")
    
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
        """Preprocess image for model inference"""
        
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
    
    def predict(self, image: Image.Image, model_name: str, threshold: float = 0.5, detect_holes: bool = True) -> Dict[str, Any]:
        """Perform segmentation on an image"""
        
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
            
            # Check memory before inference
            if self.device.type == 'cuda':
                memory_before = torch.cuda.memory_allocated()
                logger.info(f"GPU memory before inference: {memory_before / 1024**2:.1f} MB")
            
            # Perform inference with timeout
            logger.info(f"Starting inference with {model_name}")
            import signal
            import threading
            
            output = None
            inference_error = None
            
            def run_inference():
                nonlocal output, inference_error
                try:
                    with torch.no_grad():
                        output = model(input_tensor)
                except Exception as e:
                    inference_error = e
            
            # Run inference in a thread with timeout
            inference_thread = threading.Thread(target=run_inference)
            inference_thread.daemon = True
            inference_thread.start()
            
            # Wait for inference with timeout (60 seconds for CPU inference)
            timeout_seconds = 60
            inference_thread.join(timeout=timeout_seconds)
            
            if inference_thread.is_alive():
                logger.error(f"Inference timeout after {timeout_seconds}s for model {model_name}")
                raise TimeoutError(f"Model inference timed out after {timeout_seconds} seconds. The model may be too complex for CPU inference.")
            
            if inference_error:
                raise inference_error
                
            if output is None:
                raise RuntimeError("Inference failed to produce output")
                
            logger.info(f"Inference completed, output shape: {output.shape if not isinstance(output, tuple) else [o.shape for o in output]}")
            
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
                    "confidence_scores": [p["confidence"] for p in polygons]
                }
            }
            
            return result
            
        finally:
            # Reset processing state
            self.is_processing = False
            self.current_model = None
    
    def get_available_models(self) -> List[str]:
        """Get list of available model names"""
        return list(self.AVAILABLE_MODELS.keys())
    
    def get_model_info(self) -> Dict[str, Dict[str, Any]]:
        """Get information about all available models"""
        info = {}
        for name, config in self.AVAILABLE_MODELS.items():
            info[name] = {
                "name": name,
                "description": f"{name.upper()} model for spheroid segmentation",
                "has_pretrained": (self.base_path / config['pretrained_path']).exists(),
                "has_finetuned": (self.base_path / config['finetuned_path']).exists(),
                "recommended_threshold": 0.5
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
        """Get batch size limit for a specific model based on memory requirements"""
        batch_limits = {
            'hrnet': 8,
            'resunet_small': 2,  # Reduced from 4 to 2 for CBAM-ResUNet stability
            'resunet_advanced': 1  # Keep at 1 for MA-ResUNet due to high memory usage
        }
        return batch_limits.get(model_name, 1)