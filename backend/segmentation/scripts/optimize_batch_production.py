#!/usr/bin/env python3
"""
Production Batch Size Optimization for Segmentation Models
Finds optimal batch size balancing throughput and latency with stability
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import torch
import numpy as np
import time
import gc
from typing import Dict, List, Tuple
from dataclasses import dataclass
import json
from pathlib import Path
import logging
from PIL import Image

# Import models
from models.hrnet import HRNetV2
from models.cbam_resunet import ResUNetCBAM

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@dataclass
class BenchmarkResult:
    """Stores benchmark results for a batch size"""
    batch_size: int
    mean_latency: float
    p50_latency: float
    p95_latency: float
    p99_latency: float
    throughput: float  # images per second
    memory_used: float  # GB
    memory_peak: float  # GB
    success_rate: float
    stable: bool

class ProductionBatchOptimizer:
    """Optimizes batch size for production deployment"""
    
    def __init__(self, device: str = 'cuda', target_p95_ms: float = 1000.0):
        """
        Args:
            device: Device to run on
            target_p95_ms: Target P95 latency in milliseconds for SLA
        """
        self.device = torch.device(device if torch.cuda.is_available() else 'cpu')
        self.target_p95_ms = target_p95_ms
        
        # Production settings
        self.input_size = (1024, 1024)
        self.warmup_iterations = 50
        self.benchmark_iterations = 100
        self.memory_reserve_percent = 15  # 15% VRAM reserve for stability
        
        logger.info(f"Initialized optimizer on {self.device}")
        logger.info(f"Target P95 latency: {self.target_p95_ms}ms")
        
    def get_gpu_memory_info(self) -> Dict[str, float]:
        """Get GPU memory statistics"""
        if self.device.type == 'cuda':
            torch.cuda.synchronize()
            return {
                'allocated_gb': torch.cuda.memory_allocated() / 1024**3,
                'reserved_gb': torch.cuda.memory_reserved() / 1024**3,
                'total_gb': torch.cuda.get_device_properties(0).total_memory / 1024**3
            }
        return {'allocated_gb': 0, 'reserved_gb': 0, 'total_gb': 0}
    
    def create_test_batch(self, batch_size: int) -> torch.Tensor:
        """Create a test batch of images"""
        # Create realistic input (normalized)
        batch = torch.randn(batch_size, 3, *self.input_size, device=self.device)
        # Apply ImageNet normalization
        mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1).to(self.device)
        std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1).to(self.device)
        batch = (batch * std) + mean
        return batch
    
    def benchmark_batch_size(self, model: torch.nn.Module, batch_size: int) -> BenchmarkResult:
        """Benchmark a specific batch size"""
        logger.info(f"Benchmarking batch size {batch_size}...")
        
        model.eval()
        latencies = []
        memory_peaks = []
        successes = 0
        
        try:
            # Warm-up phase
            logger.info(f"  Warm-up ({self.warmup_iterations} iterations)...")
            for _ in range(self.warmup_iterations):
                with torch.no_grad():
                    batch = self.create_test_batch(batch_size)
                    _ = model(batch)
                    if self.device.type == 'cuda':
                        torch.cuda.synchronize()
            
            # Clear cache before benchmarking
            if self.device.type == 'cuda':
                torch.cuda.empty_cache()
            
            # Benchmark phase
            logger.info(f"  Benchmarking ({self.benchmark_iterations} iterations)...")
            for i in range(self.benchmark_iterations):
                batch = self.create_test_batch(batch_size)
                
                # Time the inference
                if self.device.type == 'cuda':
                    torch.cuda.synchronize()
                    
                start_time = time.perf_counter()
                
                try:
                    with torch.no_grad():
                        output = model(batch)
                        if isinstance(output, tuple):
                            output = output[0]
                    
                    if self.device.type == 'cuda':
                        torch.cuda.synchronize()
                    
                    end_time = time.perf_counter()
                    latency_ms = (end_time - start_time) * 1000
                    latencies.append(latency_ms)
                    successes += 1
                    
                    # Track memory
                    mem_info = self.get_gpu_memory_info()
                    memory_peaks.append(mem_info['allocated_gb'])
                    
                except RuntimeError as e:
                    if 'out of memory' in str(e):
                        logger.warning(f"  OOM at batch size {batch_size}")
                        break
                    raise
                
                # Clear intermediate tensors
                del batch
                if 'output' in locals():
                    del output
                    
                if i % 20 == 0:
                    logger.info(f"    Progress: {i}/{self.benchmark_iterations}")
            
            # Calculate statistics
            if latencies:
                latencies_np = np.array(latencies)
                throughput = (batch_size * 1000) / np.mean(latencies_np)  # images/sec
                
                result = BenchmarkResult(
                    batch_size=batch_size,
                    mean_latency=np.mean(latencies_np),
                    p50_latency=np.percentile(latencies_np, 50),
                    p95_latency=np.percentile(latencies_np, 95),
                    p99_latency=np.percentile(latencies_np, 99),
                    throughput=throughput,
                    memory_used=np.mean(memory_peaks) if memory_peaks else 0,
                    memory_peak=np.max(memory_peaks) if memory_peaks else 0,
                    success_rate=successes / self.benchmark_iterations,
                    stable=True
                )
                
                # Check stability criteria
                if result.p95_latency > self.target_p95_ms:
                    result.stable = False
                    logger.warning(f"  P95 latency {result.p95_latency:.1f}ms exceeds target {self.target_p95_ms}ms")
                
                # Check memory reserve
                mem_info = self.get_gpu_memory_info()
                memory_usage_percent = (result.memory_peak / mem_info['total_gb']) * 100
                if memory_usage_percent > (100 - self.memory_reserve_percent):
                    result.stable = False
                    logger.warning(f"  Memory usage {memory_usage_percent:.1f}% exceeds safe threshold")
                
                return result
            
        except Exception as e:
            logger.error(f"  Failed to benchmark batch size {batch_size}: {e}")
        
        finally:
            # Clean up
            if self.device.type == 'cuda':
                torch.cuda.empty_cache()
            gc.collect()
        
        # Return failed result
        return BenchmarkResult(
            batch_size=batch_size,
            mean_latency=float('inf'),
            p50_latency=float('inf'),
            p95_latency=float('inf'),
            p99_latency=float('inf'),
            throughput=0,
            memory_used=0,
            memory_peak=0,
            success_rate=0,
            stable=False
        )
    
    def find_optimal_batch_size(self, model: torch.nn.Module, model_name: str) -> Dict:
        """Find optimal batch size for a model"""
        logger.info(f"\n{'='*60}")
        logger.info(f"Optimizing {model_name}")
        logger.info(f"{'='*60}")
        
        # Test batch sizes
        batch_sizes = [1, 2, 4, 8, 12, 16, 24, 32]
        results = []
        
        for batch_size in batch_sizes:
            result = self.benchmark_batch_size(model, batch_size)
            results.append(result)
            
            # Log results
            logger.info(f"\nBatch {batch_size} Results:")
            logger.info(f"  Mean latency: {result.mean_latency:.1f}ms")
            logger.info(f"  P50 latency: {result.p50_latency:.1f}ms")
            logger.info(f"  P95 latency: {result.p95_latency:.1f}ms")
            logger.info(f"  P99 latency: {result.p99_latency:.1f}ms")
            logger.info(f"  Throughput: {result.throughput:.1f} img/s")
            logger.info(f"  Memory: {result.memory_used:.2f}GB (peak: {result.memory_peak:.2f}GB)")
            logger.info(f"  Stable: {result.stable}")
            
            # Stop if unstable (OOM or too slow)
            if not result.stable and result.success_rate == 0:
                logger.info(f"Stopping at batch size {batch_size} due to instability")
                break
        
        # Find optimal batch size (knee of the curve)
        stable_results = [r for r in results if r.stable and r.success_rate > 0.95]
        
        if not stable_results:
            logger.warning("No stable batch sizes found!")
            optimal = results[0] if results else None
        else:
            # Sort by throughput
            stable_results.sort(key=lambda x: x.throughput, reverse=True)
            
            # Find knee point - where throughput gain diminishes
            optimal = stable_results[0]
            for i in range(1, len(stable_results)):
                curr = stable_results[i]
                prev = stable_results[i-1]
                
                # If throughput gain is less than 10%, prefer smaller batch
                throughput_gain = (prev.throughput - curr.throughput) / curr.throughput
                if throughput_gain < 0.10 and curr.p95_latency < self.target_p95_ms:
                    optimal = curr
                    break
        
        # Prepare configuration
        config = {
            'model': model_name,
            'optimal_batch_size': optimal.batch_size if optimal else 1,
            'max_safe_batch_size': max([r.batch_size for r in stable_results]) if stable_results else 1,
            'p95_latency_ms': optimal.p95_latency if optimal else float('inf'),
            'throughput_img_per_sec': optimal.throughput if optimal else 0,
            'memory_gb': optimal.memory_peak if optimal else 0,
            'benchmarks': [
                {
                    'batch_size': r.batch_size,
                    'p50_ms': round(r.p50_latency, 1),
                    'p95_ms': round(r.p95_latency, 1),
                    'throughput': round(r.throughput, 1),
                    'memory_gb': round(r.memory_peak, 2),
                    'stable': r.stable
                }
                for r in results
            ]
        }
        
        return config

def main():
    """Main optimization routine"""
    
    # Initialize optimizer
    optimizer = ProductionBatchOptimizer(
        device='cuda',
        target_p95_ms=1000.0  # 1 second P95 latency target
    )
    
    # Print GPU info
    gpu_info = optimizer.get_gpu_memory_info()
    logger.info(f"GPU Memory: {gpu_info['total_gb']:.1f}GB total")
    logger.info(f"Memory reserve: {optimizer.memory_reserve_percent}%")
    
    results = {}
    
    # Optimize HRNet
    logger.info("\nLoading HRNet model...")
    hrnet = HRNetV2(n_class=1, use_instance_norm=True)
    weights_path = Path(__file__).parent.parent / "weights" / "hrnet_best_model.pth"
    if weights_path.exists():
        checkpoint = torch.load(weights_path, map_location=optimizer.device)
        if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
            hrnet.load_state_dict(checkpoint['model_state_dict'], strict=False)
        logger.info("HRNet weights loaded")
    hrnet.to(optimizer.device)
    hrnet.eval()
    
    results['hrnet'] = optimizer.find_optimal_batch_size(hrnet, 'hrnet')
    
    # Clean up
    del hrnet
    torch.cuda.empty_cache()
    gc.collect()
    
    # Optimize CBAM-ResUNet
    logger.info("\nLoading CBAM-ResUNet model...")
    cbam = ResUNetCBAM(
        in_channels=3,
        out_channels=1,
        features=[64, 128, 256, 512],
        use_instance_norm=True,
        dropout_rate=0.0
    )
    weights_path = Path(__file__).parent.parent / "weights" / "cbam_resunet_new.pth"
    if weights_path.exists():
        checkpoint = torch.load(weights_path, map_location=optimizer.device)
        if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
            cbam.load_state_dict(checkpoint['model_state_dict'], strict=False)
        logger.info("CBAM-ResUNet weights loaded")
    cbam.to(optimizer.device)
    cbam.eval()
    
    results['cbam_resunet'] = optimizer.find_optimal_batch_size(cbam, 'cbam_resunet')
    
    # Save results
    output_path = Path(__file__).parent.parent / "config" / "production_batch_config.json"
    output_path.parent.mkdir(exist_ok=True)
    
    final_config = {
        'production_batch_sizes': {
            'hrnet': {
                'optimal': results['hrnet']['optimal_batch_size'],
                'max_safe': results['hrnet']['max_safe_batch_size'],
                'p95_latency_ms': round(results['hrnet']['p95_latency_ms'], 1),
                'throughput_img_s': round(results['hrnet']['throughput_img_per_sec'], 1)
            },
            'cbam_resunet': {
                'optimal': results['cbam_resunet']['optimal_batch_size'],
                'max_safe': results['cbam_resunet']['max_safe_batch_size'],
                'p95_latency_ms': round(results['cbam_resunet']['p95_latency_ms'], 1),
                'throughput_img_s': round(results['cbam_resunet']['throughput_img_per_sec'], 1)
            }
        },
        'dynamic_batching': {
            'enabled': True,
            'max_queue_delay_ms': 5,
            'timeout_ms': 50
        },
        'memory_reserve_percent': optimizer.memory_reserve_percent,
        'detailed_benchmarks': results
    }
    
    with open(output_path, 'w') as f:
        json.dump(final_config, f, indent=2)
    
    # Print summary
    logger.info("\n" + "="*60)
    logger.info("OPTIMIZATION COMPLETE")
    logger.info("="*60)
    
    for model_name, config in results.items():
        logger.info(f"\n{model_name.upper()}:")
        logger.info(f"  Optimal batch size: {config['optimal_batch_size']}")
        logger.info(f"  Max safe batch size: {config['max_safe_batch_size']}")
        logger.info(f"  P95 latency: {config['p95_latency_ms']:.1f}ms")
        logger.info(f"  Throughput: {config['throughput_img_per_sec']:.1f} img/s")
        logger.info(f"  Memory usage: {config['memory_gb']:.2f}GB")
    
    logger.info(f"\nConfiguration saved to: {output_path}")
    
    # Recommendations
    logger.info("\nRECOMMENDATIONS:")
    logger.info("1. Use optimal batch size for online serving (low latency)")
    logger.info("2. Use max safe batch size for offline batch processing")
    logger.info("3. Enable dynamic batching with 5ms queue delay")
    logger.info("4. Monitor P95 latency in production")
    logger.info("5. Keep 15% VRAM reserve for stability")

if __name__ == "__main__":
    main()