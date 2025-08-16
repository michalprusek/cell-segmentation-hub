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
                model = AdvancedResUNet(in_channels=3, out_channels=1, features=[64, 128, 256, 512])
            elif model_name == 'resunet_small':
                # Use correct feature dimensions matching trained weights: [48, 96, 192, 384, 512]  
                model = ResUNetSmall(in_channels=3, out_channels=1, features=[48, 96, 192, 384, 512])
            else:
                raise ValueError(f"Unknown model architecture: {model_name}")
            
            # Load weights securely - only load weights, not arbitrary code
            logger.info(f"Loading {model_name} weights from: {weights_full_path}")
            checkpoint = torch.load(weights_full_path, map_location=self.device, weights_only=True)
            
            # Handle different checkpoint formats
            if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
                model.load_state_dict(checkpoint['model_state_dict'], strict=False)
            elif isinstance(checkpoint, dict) and 'state_dict' in checkpoint:
                model.load_state_dict(checkpoint['state_dict'], strict=False)
            else:
                model.load_state_dict(checkpoint, strict=False)
            
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
    
    def predict(self, image: Image.Image, model_name: str, threshold: float = 0.5) -> Dict[str, Any]:
        """Perform segmentation on an image"""
        
        # Set processing state
        self.is_processing = True
        self.current_model = model_name
        
        try:
            original_size = image.size  # (width, height)
            
            # Get model
            model = self.get_model(model_name)
            
            # Preprocess image
            input_tensor = self.preprocess_image(image)
            
            # Perform inference
            with torch.no_grad():
                output = model(input_tensor)
            
            # Handle different output formats
            if isinstance(output, tuple):
                output = output[0]  # Take main output
            
            # Postprocess
            binary_mask = self.postprocess_mask(output, original_size, threshold)
        
            # Find contours for polygon extraction - use CHAIN_APPROX_SIMPLE to compress segments
            contours, _ = cv2.findContours(binary_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            # Convert contours to polygons - preserve full resolution without simplification
            polygons = []
            for i, contour in enumerate(contours):
                # Skip very small contours (area < 100 pixels)
                if cv2.contourArea(contour) < 100:
                    continue
                    
                # Use original contour without simplification for maximum precision
                original_points = len(contour)
                
                # Convert to list of points
                polygon_points = []
                for point in contour:
                    x, y = point[0]
                    polygon_points.append([float(x), float(y)])
                
                if len(polygon_points) >= 3:  # Valid polygon needs at least 3 points
                    polygons.append({
                        "id": f"polygon_{len(polygons) + 1}",
                        "points": polygon_points,
                        "type": "external",
                        "class": "spheroid",
                        "confidence": float(torch.sigmoid(output).max().item()),
                        "vertices_count": original_points
                    })
                    
                    logger.info(f"Polygon {i+1}: {original_points} vertices preserved")
            
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
    
    def get_batch_limit(self, model_name: str) -> int:
        """Get batch size limit for a specific model based on memory requirements"""
        batch_limits = {
            'hrnet': 8,
            'resunet_small': 4,
            'resunet_advanced': 2
        }
        return batch_limits.get(model_name, 1)