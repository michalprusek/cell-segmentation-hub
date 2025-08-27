#!/usr/bin/env python3
"""GPU vs CPU Benchmark for ML Segmentation"""

import sys
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).resolve().parent.parent / "backend" / "segmentation"
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

import torch
import time
import numpy as np
from ml.model_loader import ModelLoader

def benchmark_inference(device='cuda'):
    """Benchmark model inference on given device"""
    
    print(f"\n{'='*60}")
    print(f"🚀 Segmentation Benchmark - Device: {device}")
    print(f"{'='*60}")
    
    # Initialize model loader
    loader = ModelLoader()
    print(f"✓ ModelLoader initialized on {loader.device}")
    
    # Create test image (1024x1024 RGB)
    from PIL import Image
    test_array = np.random.randint(0, 255, (1024, 1024, 3), dtype=np.uint8)
    test_image = Image.fromarray(test_array, 'RGB')
    
    # Test each model
    models = ['resunet_small', 'hrnet']  # Skip resunet_advanced for quick test
    results = {}
    
    for model_name in models:
        print(f"\n📊 Testing {model_name}...")
        
        # Warm-up run (first run is slower)
        print("  Warm-up run...")
        try:
            _ = loader.predict(test_image, model_name=model_name, threshold=0.5)
        except Exception as e:
            print(f"  ⚠️ Error during warm-up for {model_name}: {str(e)}")
            print(f"  Skipping {model_name} benchmark...")
            continue
        
        # Benchmark runs
        times = []
        for i in range(3):
            start_time = time.time()
            result = loader.predict(test_image, model_name=model_name, threshold=0.5)
            inference_time = time.time() - start_time
            times.append(inference_time)
            print(f"  Run {i+1}: {inference_time:.3f}s")
        
        avg_time = np.mean(times)
        results[model_name] = avg_time
        print(f"  ✅ Average: {avg_time:.3f}s")
    
    return results

def main():
    # Check GPU availability
    print("🔍 System Information:")
    print(f"PyTorch version: {torch.__version__}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        print(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
        device = 'cuda'
    else:
        print("⚠️ GPU not available, using CPU")
        device = 'cpu'
    
    # Run benchmark
    results = benchmark_inference(device)
    
    # Summary
    print(f"\n{'='*60}")
    print("📈 BENCHMARK RESULTS SUMMARY")
    print(f"{'='*60}")
    for model, time_sec in results.items():
        print(f"{model:20s}: {time_sec:.3f} seconds")
    
    # Compare with CPU baseline (from previous measurements)
    cpu_baseline = {
        'resunet_small': 6.9,
        'hrnet': 3.1
    }
    
    if device == 'cuda':
        print(f"\n🚀 PERFORMANCE IMPROVEMENT vs CPU:")
        for model, gpu_time in results.items():
            if model in cpu_baseline:
                speedup = cpu_baseline[model] / gpu_time
                print(f"{model:20s}: {speedup:.1f}x faster (was {cpu_baseline[model]:.1f}s on CPU)")

if __name__ == "__main__":
    main()