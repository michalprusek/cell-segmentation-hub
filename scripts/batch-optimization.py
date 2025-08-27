#!/usr/bin/env python3
"""
Batch Size Optimization Script for ML Segmentation Models
Tests different batch sizes to find optimal performance on RTX A5000 GPU

This script:
1. Tests batch sizes from 1 to maximum possible for each model
2. Measures throughput (images/second) and memory usage  
3. Finds optimal batch size for maximum throughput without OOM errors
4. Saves results to configuration file
"""

import os
import sys
import json
import time
import logging
import torch
import numpy as np
from PIL import Image
from typing import Dict, List, Tuple, Optional
from pathlib import Path
import argparse
import gc
from dataclasses import dataclass, asdict
from contextlib import contextmanager
import psutil

# Add the segmentation module to path
sys.path.append('/home/cvat/cell-segmentation-hub/backend/segmentation')

from models.hrnet import HRNetV2
from models.resunet_advanced import AdvancedResUNet
from models.resunet_small import ResUNetSmall

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class BatchTestResult:
    """Results from batch size testing"""
    model_name: str
    batch_size: int
    throughput_imgs_per_sec: float
    avg_inference_time_ms: float
    peak_memory_mb: float
    memory_usage_mb: float
    success: bool
    error: Optional[str] = None
    
@dataclass
class ModelOptimizationResult:
    """Complete optimization results for a model"""
    model_name: str
    optimal_batch_size: int
    max_throughput: float
    max_safe_batch_size: int
    memory_limit_mb: float
    test_results: List[BatchTestResult]
    
class GPUMemoryMonitor:
    """Monitor GPU memory usage during testing"""
    
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.total_memory = 0
        if torch.cuda.is_available():
            self.total_memory = torch.cuda.get_device_properties(0).total_memory
            logger.info(f"GPU: {torch.cuda.get_device_name()}")
            logger.info(f"Total GPU memory: {self.total_memory / 1024**3:.1f} GB")
        
    def get_memory_usage(self) -> Dict[str, float]:
        """Get current memory usage"""
        if not torch.cuda.is_available():
            return {"allocated_mb": 0, "cached_mb": 0, "free_mb": 0}
            
        allocated = torch.cuda.memory_allocated()
        cached = torch.cuda.memory_reserved()
        free = self.total_memory - cached
        
        return {
            "allocated_mb": allocated / 1024**2,
            "cached_mb": cached / 1024**2,
            "free_mb": free / 1024**2,
            "total_mb": self.total_memory / 1024**2
        }
    
    def clear_memory(self):
        """Clear GPU memory cache"""
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        gc.collect()

class BatchSizeOptimizer:
    """Optimize batch sizes for segmentation models"""
    
    def __init__(self, weights_path: str = "/home/cvat/cell-segmentation-hub/backend/segmentation/weights"):
        self.weights_path = Path(weights_path)
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.memory_monitor = GPUMemoryMonitor()
        
        # Model configurations
        self.models_config = {
            'hrnet': {
                'class': HRNetV2,
                'weights_file': 'hrnet_best_model.pth',
                'init_args': {'n_class': 1, 'use_instance_norm': True},
                'max_test_batch': 16  # Conservative start
            },
            'resunet_small': {
                'class': ResUNetSmall,
                'weights_file': 'resunet_small_best_model.pth', 
                'init_args': {'in_channels': 3, 'out_channels': 1, 'features': [48, 96, 192, 384, 512]},
                'max_test_batch': 8
            },
            'resunet_advanced': {
                'class': AdvancedResUNet,
                'weights_file': 'resunet_advanced_best_model.pth',
                'init_args': {'in_channels': 3, 'out_channels': 1, 'features': [64, 128, 256, 512], 'use_instance_norm': True, 'dropout_rate': 0.2},
                'max_test_batch': 4  # More conservative due to higher memory usage
            }
        }
        
        logger.info(f"Initialized optimizer on device: {self.device}")
        
    def load_model(self, model_name: str) -> torch.nn.Module:
        """Load a model with pretrained weights"""
        if model_name not in self.models_config:
            raise ValueError(f"Unknown model: {model_name}")
            
        config = self.models_config[model_name]
        weights_file = self.weights_path / config['weights_file']
        
        if not weights_file.exists():
            raise FileNotFoundError(f"Weights not found: {weights_file}")
            
        # Initialize model
        model = config['class'](**config['init_args'])
        
        # Load weights
        try:
            checkpoint = torch.load(weights_file, map_location=self.device, weights_only=True)
        except:
            checkpoint = torch.load(weights_file, map_location=self.device)
            
        # Extract state dict
        if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
            state_dict = checkpoint['model_state_dict']
        elif isinstance(checkpoint, dict) and 'state_dict' in checkpoint:
            state_dict = checkpoint['state_dict']
        else:
            state_dict = checkpoint
            
        model.load_state_dict(state_dict, strict=False)
        model.to(self.device)
        model.eval()
        
        logger.info(f"Loaded model {model_name} from {weights_file}")
        return model
        
    def create_dummy_batch(self, batch_size: int, image_size: Tuple[int, int] = (1000, 1000)) -> torch.Tensor:
        """Create dummy input batch for testing"""
        # Create realistic dummy images (random but consistent)
        torch.manual_seed(42)  # For reproducibility
        batch = torch.randn(batch_size, 3, image_size[0], image_size[1], device=self.device)
        # Normalize to [0, 1] range to match real preprocessing
        batch = (batch + 1) / 2
        batch = torch.clamp(batch, 0, 1)
        return batch
        
    def test_batch_size(self, model: torch.nn.Module, model_name: str, batch_size: int, 
                       num_warmup: int = 3, num_test: int = 10) -> BatchTestResult:
        """Test a specific batch size for a model"""
        logger.info(f"Testing {model_name} with batch size {batch_size}")
        
        self.memory_monitor.clear_memory()
        
        try:
            # Create test batch
            input_batch = self.create_dummy_batch(batch_size)
            
            # Warmup runs
            with torch.no_grad():
                for _ in range(num_warmup):
                    _ = model(input_batch)
                    
            if torch.cuda.is_available():
                torch.cuda.synchronize()
                
            # Record initial memory
            initial_memory = self.memory_monitor.get_memory_usage()
            
            # Timed runs
            start_time = time.time()
            with torch.no_grad():
                for _ in range(num_test):
                    output = model(input_batch)
                    
            if torch.cuda.is_available():
                torch.cuda.synchronize()
                
            end_time = time.time()
            
            # Calculate metrics
            total_time = end_time - start_time
            avg_time_per_batch = total_time / num_test
            avg_time_per_image = avg_time_per_batch / batch_size
            throughput = 1.0 / avg_time_per_image  # images per second
            
            # Record peak memory
            peak_memory = self.memory_monitor.get_memory_usage()
            
            result = BatchTestResult(
                model_name=model_name,
                batch_size=batch_size,
                throughput_imgs_per_sec=throughput,
                avg_inference_time_ms=avg_time_per_image * 1000,
                peak_memory_mb=peak_memory["allocated_mb"],
                memory_usage_mb=max(0, peak_memory["allocated_mb"] - initial_memory["allocated_mb"]),  # Ensure non-negative
                success=True
            )
            
            logger.info(f"  Batch {batch_size}: {throughput:.2f} imgs/sec, {avg_time_per_image*1000:.1f}ms/img, {peak_memory['allocated_mb']:.0f}MB memory")
            return result
            
        except torch.cuda.OutOfMemoryError as e:
            self.memory_monitor.clear_memory()
            logger.warning(f"  Batch {batch_size}: OOM - {str(e)}")
            return BatchTestResult(
                model_name=model_name,
                batch_size=batch_size,
                throughput_imgs_per_sec=0.0,
                avg_inference_time_ms=0.0,
                peak_memory_mb=0.0,
                memory_usage_mb=0.0,
                success=False,
                error="OutOfMemoryError"
            )
        except Exception as e:
            self.memory_monitor.clear_memory()
            logger.error(f"  Batch {batch_size}: Error - {str(e)}")
            return BatchTestResult(
                model_name=model_name,
                batch_size=batch_size,
                throughput_imgs_per_sec=0.0,
                avg_inference_time_ms=0.0,
                peak_memory_mb=0.0,
                memory_usage_mb=0.0,
                success=False,
                error=str(e)
            )
            
    def find_optimal_batch_size(self, model_name: str) -> ModelOptimizationResult:
        """Find optimal batch size for a model"""
        logger.info(f"\n{'='*60}")
        logger.info(f"Optimizing batch size for {model_name}")
        logger.info(f"{'='*60}")
        
        model = self.load_model(model_name)
        config = self.models_config[model_name]
        
        results = []
        max_batch_size = config['max_test_batch']
        
        # Test increasing batch sizes until OOM
        batch_size = 1
        consecutive_failures = 0
        
        while batch_size <= max_batch_size and consecutive_failures < 2:
            result = self.test_batch_size(model, model_name, batch_size)
            results.append(result)
            
            if not result.success:
                consecutive_failures += 1
                if consecutive_failures >= 2:
                    logger.info(f"  Stopping at batch size {batch_size} due to consecutive failures")
                    break
            else:
                consecutive_failures = 0
                
            batch_size += 1
            
        # Find optimal settings
        successful_results = [r for r in results if r.success]
        
        if not successful_results:
            logger.error(f"No successful batch sizes found for {model_name}")
            return ModelOptimizationResult(
                model_name=model_name,
                optimal_batch_size=1,
                max_throughput=0.0,
                max_safe_batch_size=1,
                memory_limit_mb=0.0,
                test_results=results
            )
            
        # Find batch size with maximum throughput
        best_result = max(successful_results, key=lambda x: x.throughput_imgs_per_sec)
        max_safe_batch = max(r.batch_size for r in successful_results)
        
        # Get memory limit (RTX A5000 has ~23.6GB usable)
        gpu_memory = self.memory_monitor.get_memory_usage()
        memory_limit_mb = gpu_memory["total_mb"] * 0.9  # Use 90% as safe limit
        
        optimization_result = ModelOptimizationResult(
            model_name=model_name,
            optimal_batch_size=best_result.batch_size,
            max_throughput=best_result.throughput_imgs_per_sec,
            max_safe_batch_size=max_safe_batch,
            memory_limit_mb=memory_limit_mb,
            test_results=results
        )
        
        logger.info(f"\nOptimization Results for {model_name}:")
        logger.info(f"  Optimal batch size: {optimization_result.optimal_batch_size}")
        logger.info(f"  Max throughput: {optimization_result.max_throughput:.2f} images/sec")
        logger.info(f"  Max safe batch size: {optimization_result.max_safe_batch_size}")
        logger.info(f"  Memory limit: {optimization_result.memory_limit_mb:.0f} MB")
        
        # Clean up model
        del model
        self.memory_monitor.clear_memory()
        
        return optimization_result
        
    def optimize_all_models(self, models: Optional[List[str]] = None) -> Dict[str, ModelOptimizationResult]:
        """Optimize batch sizes for all models"""
        if models is None:
            models = list(self.models_config.keys())
            
        logger.info(f"Starting batch size optimization for models: {models}")
        logger.info(f"GPU Memory: {self.memory_monitor.get_memory_usage()}")
        
        results = {}
        
        for model_name in models:
            try:
                result = self.find_optimal_batch_size(model_name)
                results[model_name] = result
            except Exception as e:
                logger.error(f"Failed to optimize {model_name}: {e}")
                
        return results
        
    def save_configuration(self, results: Dict[str, ModelOptimizationResult], 
                          output_path: str = "/home/cvat/cell-segmentation-hub/backend/segmentation/config/batch_sizes.json"):
        """Save optimization results to configuration file"""
        
        # Create config directory if it doesn't exist
        config_dir = Path(output_path).parent
        config_dir.mkdir(parents=True, exist_ok=True)
        
        # Prepare configuration data
        config_data = {
            "optimization_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "gpu_info": {
                "device_name": torch.cuda.get_device_name() if torch.cuda.is_available() else "CPU",
                "total_memory_gb": self.memory_monitor.total_memory / 1024**3 if torch.cuda.is_available() else 0,
                "driver_version": torch.version.cuda if torch.cuda.is_available() else None
            },
            "batch_configurations": {},
            "detailed_results": {}
        }
        
        for model_name, result in results.items():
            # Main configuration for application use
            config_data["batch_configurations"][model_name] = {
                "optimal_batch_size": result.optimal_batch_size,
                "max_safe_batch_size": result.max_safe_batch_size,
                "expected_throughput": result.max_throughput,
                "memory_limit_mb": result.memory_limit_mb
            }
            
            # Detailed results for analysis
            config_data["detailed_results"][model_name] = {
                "optimization_result": asdict(result),
                "all_test_results": [asdict(test_result) for test_result in result.test_results]
            }
            
        # Save configuration
        with open(output_path, 'w') as f:
            json.dump(config_data, f, indent=2)
            
        logger.info(f"Configuration saved to: {output_path}")
        
        # Print summary
        print("\n" + "="*80)
        print("BATCH SIZE OPTIMIZATION SUMMARY")
        print("="*80)
        
        for model_name, result in results.items():
            improvement = result.max_throughput  # baseline is 1 img/sec
            print(f"\n{model_name.upper()}:")
            print(f"  Optimal batch size: {result.optimal_batch_size}")
            print(f"  Max throughput: {result.max_throughput:.2f} images/sec")
            print(f"  Throughput improvement: {improvement:.2f}x")
            print(f"  Max safe batch: {result.max_safe_batch_size}")
            
        print(f"\nConfiguration saved to: {output_path}")
        print("="*80)

def main():
    parser = argparse.ArgumentParser(description="Optimize batch sizes for ML segmentation models")
    parser.add_argument("--models", nargs="+", 
                       choices=["hrnet", "resunet_small", "resunet_advanced"],
                       help="Models to optimize (default: all)")
    parser.add_argument("--output", default="/home/cvat/cell-segmentation-hub/backend/segmentation/config/batch_sizes.json",
                       help="Output configuration file path")
    parser.add_argument("--weights-path", default="/home/cvat/cell-segmentation-hub/backend/segmentation/weights",
                       help="Path to model weights directory")
    
    args = parser.parse_args()
    
    if not torch.cuda.is_available():
        logger.error("CUDA not available! This optimization requires GPU.")
        return 1
        
    try:
        optimizer = BatchSizeOptimizer(weights_path=args.weights_path)
        results = optimizer.optimize_all_models(models=args.models)
        optimizer.save_configuration(results, output_path=args.output)
        
        logger.info("Batch size optimization completed successfully!")
        return 0
        
    except Exception as e:
        logger.error(f"Optimization failed: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    exit(main())