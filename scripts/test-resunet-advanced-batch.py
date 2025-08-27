#!/usr/bin/env python3
"""Test batch sizes for ResUNet Advanced model"""

import sys
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).resolve().parent.parent / "backend" / "segmentation"
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

import torch
import numpy as np
from PIL import Image
import time
import gc

def test_resunet_advanced_batch():
    print("="*60)
    print("🔍 Testing ResUNet Advanced Batch Processing")
    print("="*60)
    
    # Check GPU
    print(f"GPU available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        print(f"GPU Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
        
        # Clear cache
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
        print(f"Initial GPU memory: {torch.cuda.memory_allocated() / 1024**2:.1f} MB")
    
    # Import model loader
    from ml.model_loader import ModelLoader
    loader = ModelLoader()
    print(f"ModelLoader device: {loader.device}")
    
    # Create test images
    print("\n📊 Testing batch sizes for resunet_advanced...")
    
    # Test different batch sizes
    batch_sizes = [1, 2, 3, 4, 6, 8]
    results = []
    
    for batch_size in batch_sizes:
        print(f"\n🔹 Testing batch size: {batch_size}")
        
        try:
            # Create batch of test images
            test_images = []
            for i in range(batch_size):
                test_array = np.random.randint(100, 200, (1000, 1000, 3), dtype=np.uint8)
                test_image = Image.fromarray(test_array, 'RGB')
                test_images.append(test_image)
            
            # Clear cache before test
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                if torch.cuda.is_available():
                    torch.cuda.synchronize()
            
            # Time the batch prediction
            start_time = time.time()
            
            # Process batch
            if batch_size == 1:
                # Single image
                result = loader.predict(test_images[0], model_name='resunet_advanced', threshold=0.5)
            else:
                # Try batch processing
                print(f"  Processing batch of {batch_size} images...")
                all_results = []
                
                # Process as batch if method exists
                if hasattr(loader, 'predict_batch'):
                    batch_result = loader.predict_batch(test_images, model_name='resunet_advanced', threshold=0.5)
                    all_results = batch_result
                else:
                    # Process sequentially
                    for img in test_images:
                        result = loader.predict(img, model_name='resunet_advanced', threshold=0.5)
                        all_results.append(result)
            
            inference_time = time.time() - start_time
            
            # Get memory stats
            if torch.cuda.is_available():
                peak_memory = torch.cuda.max_memory_allocated() / 1024**2
                current_memory = torch.cuda.memory_allocated() / 1024**2
            else:
                peak_memory = 0
                current_memory = 0
            
            # Calculate throughput with division by zero protection
            if inference_time > 0 and batch_size > 0:
                throughput = batch_size / inference_time
                time_per_img = inference_time / batch_size
            else:
                throughput = 0
                time_per_img = float('inf')
            time_per_img = inference_time / batch_size
            
            results.append({
                'batch_size': batch_size,
                'inference_time': inference_time,
                'time_per_image': time_per_img,
                'throughput': throughput,
                'peak_memory_mb': peak_memory,
                'current_memory_mb': current_memory
            })
            
            print(f"  ✅ Success!")
            print(f"     Total time: {inference_time:.3f}s")
            print(f"     Time per image: {time_per_img:.3f}s")
            print(f"     Throughput: {throughput:.2f} images/sec")
            print(f"     Peak memory: {peak_memory:.1f} MB")
            
        except Exception as e:
            print(f"  ❌ Failed: {str(e)}")
            results.append({
                'batch_size': batch_size,
                'error': str(e)
            })
            
            # If OOM, stop testing larger sizes
            if "out of memory" in str(e).lower():
                print("  ⚠️ Out of memory - stopping tests")
                break
        
        # Clear memory between tests
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    
    # Summary
    print("\n" + "="*60)
    print("📈 BATCH SIZE OPTIMIZATION RESULTS")
    print("="*60)
    
    valid_results = [r for r in results if 'error' not in r]
    if valid_results:
        # Find optimal batch size (best throughput)
        optimal = max(valid_results, key=lambda x: x['throughput'])
        print(f"✨ Optimal batch size: {optimal['batch_size']}")
        print(f"   Throughput: {optimal['throughput']:.2f} images/sec")
        print(f"   Time per image: {optimal['time_per_image']:.3f}s")
        print(f"   Memory usage: {optimal['peak_memory_mb']:.1f} MB")
        
        # Compare to single image
        single = next((r for r in results if r['batch_size'] == 1), None)
        if single and optimal['batch_size'] > 1:
            speedup = optimal['throughput'] / single['throughput']
            print(f"\n🚀 Speedup vs single image: {speedup:.1f}x")
    
    return results

if __name__ == "__main__":
    results = test_resunet_advanced_batch()