"""Model loader service with lazy loading and singleton pattern"""

import logging
import torch
import threading
from pathlib import Path
from typing import Dict, Optional, Any
from contextlib import contextmanager

from ..models.hrnet import HRNetV2
from ..models.cbam_resunet import ResUNetCBAM

logger = logging.getLogger(__name__)

class ModelManager:
    """Singleton model manager with lazy loading"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if hasattr(self, '_initialized'):
            return
        
        self._initialized = True
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.loaded_models: Dict[str, torch.nn.Module] = {}
        self.model_configs = self._get_model_configs()
        self._model_locks = {}
        
        logger.info(f"Model manager initialized with device: {self.device}")
        
        # Initialize locks for each model
        for model_name in self.model_configs:
            self._model_locks[model_name] = threading.Lock()
    
    def _get_model_configs(self) -> Dict[str, Dict[str, Any]]:
        """Get model configurations"""
        weights_dir = Path(__file__).parent.parent / "weights"
        
        return {
            "hrnet": {
                "class": HRNetV2,
                "weights_path": weights_dir / "hrnet_best_model.pth",
                "params": {
                    "n_class": 1,
                    "use_instance_norm": True
                },
                "description": "High-Resolution Network for semantic segmentation",
                "parameters": 66_000_000
            },
            "cbam_resunet": {
                "class": ResUNetCBAM,
                "weights_path": weights_dir / "cbam_resunet_new.pth",
                "params": {
                    "in_channels": 3,
                    "out_channels": 1,
                    "features": [64, 128, 256, 512],
                    "use_instance_norm": True,
                    "dropout_rate": 0.15
                },
                "description": "ResUNet with CBAM attention for precise segmentation",
                "parameters": 45_000_000
            }
        }
    
    def is_model_available(self, model_name: str) -> bool:
        """Check if model weights are available"""
        if model_name not in self.model_configs:
            return False
        
        weights_path = self.model_configs[model_name]["weights_path"]
        return weights_path.exists()
    
    def get_model_info(self, model_name: str) -> Optional[Dict[str, Any]]:
        """Get model information"""
        if model_name not in self.model_configs:
            return None
        
        config = self.model_configs[model_name]
        return {
            "name": model_name,
            "description": config["description"],
            "parameters": config["parameters"],
            "available": self.is_model_available(model_name),
            "loaded": model_name in self.loaded_models
        }
    
    @contextmanager
    def _model_lock(self, model_name: str):
        """Context manager for model-specific locks"""
        lock = self._model_locks.get(model_name)
        if lock is None:
            raise ValueError(f"No lock found for model: {model_name}")
        
        lock.acquire()
        try:
            yield
        finally:
            lock.release()
    
    def load_model(self, model_name: str) -> torch.nn.Module:
        """Load model with lazy loading (thread-safe)"""
        if model_name not in self.model_configs:
            raise ValueError(f"Unknown model: {model_name}")
        
        # Check if already loaded
        if model_name in self.loaded_models:
            logger.info(f"Model {model_name} already loaded")
            return self.loaded_models[model_name]
        
        # Thread-safe loading
        with self._model_lock(model_name):
            # Double-check after acquiring lock
            if model_name in self.loaded_models:
                return self.loaded_models[model_name]
            
            logger.info(f"Loading model: {model_name}")
            
            config = self.model_configs[model_name]
            weights_path = config["weights_path"]
            
            if not weights_path.exists():
                raise FileNotFoundError(f"Model weights not found: {weights_path}")
            
            try:
                # Create model instance
                model_class = config["class"]
                model_params = config["params"]
                
                logger.info(f"Creating {model_name} with params: {model_params}")
                model = model_class(**model_params)
                
                # Load weights with fallback loading strategies
                checkpoint = self._load_checkpoint_safe(weights_path)
                
                # Extract state dict
                if 'model_state_dict' in checkpoint:
                    state_dict = checkpoint['model_state_dict']
                    if 'epoch' in checkpoint:
                        logger.info(f"Model trained for {checkpoint['epoch']} epochs")
                    if 'best_iou' in checkpoint:
                        logger.info(f"Best IoU: {checkpoint['best_iou']:.4f}")
                else:
                    state_dict = checkpoint
                
                # Load state dict with error handling
                missing_keys, unexpected_keys = model.load_state_dict(state_dict, strict=False)
                
                if missing_keys:
                    logger.warning(f"Missing keys in {model_name}: {len(missing_keys)} keys")
                    logger.debug(f"Missing keys: {missing_keys[:10]}...")  # Log first 10 missing keys
                if unexpected_keys:
                    logger.warning(f"Unexpected keys in {model_name}: {len(unexpected_keys)} keys")
                    logger.debug(f"Unexpected keys: {unexpected_keys[:10]}...")  # Log first 10 unexpected keys
                
                # Move to device and set eval mode
                model.to(self.device)
                model.eval()
                
                # Validate model
                self._validate_model(model, model_name)
                
                # Cache the loaded model
                self.loaded_models[model_name] = model
                
                logger.info(f"Successfully loaded model: {model_name}")
                return model
                
            except Exception as e:
                logger.error(f"Failed to load model {model_name}: {e}")
                raise RuntimeError(f"Failed to load model {model_name}: {str(e)}")
    
    def _load_checkpoint_safe(self, weights_path: Path) -> Dict[str, Any]:
        """Load checkpoint with multiple fallback strategies"""
        try:
            # Try with weights_only=True first (safer for PyTorch 2.x)
            return torch.load(weights_path, map_location=self.device, weights_only=True)
        except Exception as e1:
            logger.warning(f"Failed to load with weights_only=True: {e1}")
            try:
                # Fallback to weights_only=False
                return torch.load(weights_path, map_location=self.device, weights_only=False)
            except Exception as e2:
                logger.error(f"Failed to load checkpoint: {e2}")
                raise e2
    
    def _validate_model(self, model: torch.nn.Module, model_name: str):
        """Validate that the model works correctly"""
        try:
            with torch.no_grad():
                # Test with dummy input
                dummy_input = torch.randn(1, 3, 1024, 1024, device=self.device)
                output = model(dummy_input)
                
                # Handle different output formats
                if isinstance(output, tuple):
                    output = output[0]
                
                # Validate output shape - must be 4D with batch=1 and channels=1
                if output.ndim != 4:
                    raise ValueError(f"Invalid output dimensions: {output.ndim}, expected 4D tensor")
                if output.shape[0] != 1 or output.shape[1] != 1:
                    raise ValueError(f"Invalid output shape: {output.shape}, expected batch=1, channels=1")
                if output.shape[2] <= 0 or output.shape[3] <= 0:
                    raise ValueError(f"Invalid spatial dimensions: {output.shape[2]}x{output.shape[3]}")
                
                # Check for NaN or Inf values
                if torch.isnan(output).any():
                    raise ValueError("Model output contains NaN values")
                
                if torch.isinf(output).any():
                    raise ValueError("Model output contains Inf values")
                
                # Test sigmoid activation
                sigmoid_output = torch.sigmoid(output)
                sigmoid_range = (sigmoid_output.min().item(), sigmoid_output.max().item())
                
                if not (0 <= sigmoid_range[0] <= 1 and 0 <= sigmoid_range[1] <= 1):
                    raise ValueError(f"Invalid sigmoid output range: {sigmoid_range}")
                
                logger.info(f"Model {model_name} validation passed - output range: {sigmoid_range}")
                
        except Exception as e:
            logger.error(f"Model validation failed for {model_name}: {e}")
            raise RuntimeError(f"Model validation failed: {str(e)}")
    
    def unload_model(self, model_name: str):
        """Unload model from memory"""
        if model_name in self.loaded_models:
            with self._model_lock(model_name):
                if model_name in self.loaded_models:
                    del self.loaded_models[model_name]
                    if self.device.type == 'cuda':
                        torch.cuda.empty_cache()
                    logger.info(f"Unloaded model: {model_name}")
    
    def cleanup(self):
        """Clean up all loaded models"""
        logger.info("Cleaning up model manager...")
        for model_name in list(self.loaded_models.keys()):
            self.unload_model(model_name)
        logger.info("Model manager cleaned up")
    
    def get_memory_usage(self) -> Dict[str, Any]:
        """Get memory usage information"""
        info = {
            "loaded_models": len(self.loaded_models),
            "device": str(self.device)
        }
        
        if self.device.type == 'cuda':
            info.update({
                "gpu_memory_allocated": torch.cuda.memory_allocated(),
                "gpu_memory_reserved": torch.cuda.memory_reserved(),
                "gpu_memory_cached": torch.cuda.memory_cached() if hasattr(torch.cuda, 'memory_cached') else 0
            })
        
        return info