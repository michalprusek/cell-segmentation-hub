#!/usr/bin/env python3
"""Comprehensive batch size testing for all ML models"""

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
import json

def test_model_batch_sizes(model_name, max_batch_size=16):
    """Test various batch sizes for a specific model"""
    
    print(f"\n{'='*60}")
    print(f"🔬 Testing {model_name.upper()}")
    print(f"{'='*60}")
    
    # Import model loader
    from ml.model_loader import ModelLoader
    loader = ModelLoader()
    
    # Test batch sizes
    batch_sizes = [1, 2, 3, 4, 6, 8, 10, 12, 16]
    results = []
    
    for batch_size in batch_sizes:
        if batch_size > max_batch_size:
            break
            
        print(f"\n  Batch size {batch_size}: ", end='')
        
        try:
            # Create batch of test images with consistent size
            # Use a fixed size that's compatible with all models (divisible by 32)
            test_images = []
            for i in range(batch_size):
                # Use fixed size of 1024x1024 (divisible by 32 for most CNN architectures)
                size = 1024  # Fixed size for model compatibility
                test_array = np.random.randint(100, 200, (size, size, 3), dtype=np.uint8)
                test_image = Image.fromarray(test_array, 'RGB')
                test_images.append(test_image)
            
            # Clear GPU cache
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
                start_memory = torch.cuda.memory_allocated() / 1024**2
            
            # Warm-up run (first run is slower)
            if batch_size == 1:
                _ = loader.predict(test_images[0], model_name=model_name, threshold=0.5)
            
            # Timed runs
            times = []
            for run in range(3):
                torch.cuda.synchronize() if torch.cuda.is_available() else None
                
                start_time = time.time()
                
                if batch_size == 1:
                    result = loader.predict(test_images[0], model_name=model_name, threshold=0.5)
                else:
                    # Try batch processing if available
                    if hasattr(loader, 'predict_batch'):
                        try:
                            result = loader.predict_batch(test_images, model_name=model_name, threshold=0.5)
                        except:
                            # Fallback to sequential
                            for img in test_images:
                                result = loader.predict(img, model_name=model_name, threshold=0.5)
                    else:
                        # Sequential processing
                        for img in test_images:
                            result = loader.predict(img, model_name=model_name, threshold=0.5)
                
                torch.cuda.synchronize() if torch.cuda.is_available() else None
                inference_time = time.time() - start_time
                times.append(inference_time)
            
            # Average time
            avg_time = np.mean(times)
            time_per_img = avg_time / batch_size
            throughput = batch_size / avg_time
            
            # Memory stats
            if torch.cuda.is_available():
                peak_memory = torch.cuda.max_memory_allocated() / 1024**2
                memory_used = (peak_memory - start_memory)
            else:
                peak_memory = 0
                memory_used = 0
            
            results.append({
                'batch_size': batch_size,
                'avg_time': avg_time,
                'time_per_image': time_per_img,
                'throughput': throughput,
                'peak_memory_mb': peak_memory,
                'memory_per_image': memory_used / batch_size if batch_size > 0 else 0,
                'success': True
            })
            
            print(f"✅ {throughput:.2f} img/s, {time_per_img:.3f}s/img, {peak_memory:.0f}MB")
            
        except Exception as e:
            error_msg = str(e)
            print(f"❌ {error_msg[:50]}")
            results.append({
                'batch_size': batch_size,
                'error': error_msg,
                'success': False
            })
            
            if "out of memory" in error_msg.lower():
                print("    ⚠️ Out of memory - stopping larger batch sizes")
                break
        
        # Cleanup
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    
    return results

def main():
    """Test all models and find optimal batch sizes"""
    
    print("="*60)
    print("🚀 COMPREHENSIVE BATCH SIZE TESTING")
    print("="*60)
    
    # GPU info
    if torch.cuda.is_available():
        print(f"✅ GPU: {torch.cuda.get_device_name(0)}")
        print(f"   Memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
    else:
        print("❌ No GPU available - running on CPU")
    
    # Models to test
    models = ['hrnet', 'resunet_small', 'resunet_advanced']
    all_results = {}
    
    # Test each model
    for model in models:
        results = test_model_batch_sizes(model)
        all_results[model] = results
    
    # Analysis and recommendations
    print("\n" + "="*60)
    print("📊 OPTIMIZATION SUMMARY")
    print("="*60)
    
    recommendations = {}
    
    for model, results in all_results.items():
        valid_results = [r for r in results if r.get('success', False)]
        
        if valid_results:
            # Find optimal (best throughput)
            optimal = max(valid_results, key=lambda x: x['throughput'])
            
            # Find max safe (largest that worked)
            max_safe = max(valid_results, key=lambda x: x['batch_size'])
            
            # Get single image baseline
            single = next((r for r in valid_results if r['batch_size'] == 1), None)
            
            recommendations[model] = {
                'optimal_batch_size': optimal['batch_size'],
                'max_safe_batch_size': max_safe['batch_size'],
                'optimal_throughput': optimal['throughput'],
                'optimal_time_per_img': optimal['time_per_image'],
                'optimal_memory_mb': optimal['peak_memory_mb'],
                'single_throughput': single['throughput'] if single else 0,
                'speedup': optimal['throughput'] / single['throughput'] if single else 0
            }
            
            print(f"\n{model.upper()}:")
            print(f"  📌 Optimal batch size: {optimal['batch_size']}")
            print(f"     Throughput: {optimal['throughput']:.2f} images/sec")
            print(f"     Time per image: {optimal['time_per_image']:.3f} seconds")
            print(f"     Memory usage: {optimal['peak_memory_mb']:.0f} MB")
            
            if single and optimal['batch_size'] > 1:
                speedup = optimal['throughput'] / single['throughput']
                print(f"  🚀 Speedup vs single: {speedup:.1f}x faster")
            
            print(f"  💾 Max safe batch: {max_safe['batch_size']} (up to {max_safe['peak_memory_mb']:.0f} MB)")
    
    # Save recommendations
    # Get config path from environment or use relative path
    import os
    config_path = os.environ.get('TEST_BATCH_CONFIG', 
                                 Path(__file__).resolve().parent / 'recommended_batch_sizes.json')
    
    # Ensure path exists
    if not Path(config_path).exists():
        print(f"⚠️ Config file not found: {config_path}")
        config_path = None
    with open(config_path, 'w') as f:
        json.dump({
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
            'gpu': torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU',
            'recommendations': recommendations,
            'detailed_results': all_results
        }, f, indent=2)
    
    print(f"\n💾 Saved recommendations to: {config_path}")
    
    # Check against current config
    print("\n" + "="*60)
    print("⚠️ CONFIGURATION CHECK")
    print("="*60)
    
    try:
        with open('/home/cvat/spheroseg-app/backend/segmentation/config/batch_sizes.json', 'r') as f:
            current_config = json.load(f)
            
        print("\nCurrent configuration vs. tested optimal:")
        for model in models:
            current = current_config.get('batch_configurations', {}).get(model, {})
            recommended = recommendations.get(model, {})
            
            current_batch = current.get('optimal_batch_size', 1)
            recommended_batch = recommended.get('optimal_batch_size', 1)
            
            status = "✅" if current_batch == recommended_batch else "⚠️"
            print(f"\n{model}: {status}")
            print(f"  Current: batch_size={current_batch}")
            print(f"  Tested:  batch_size={recommended_batch}")
            
            if current_batch != recommended_batch:
                print(f"  💡 Update needed: change from {current_batch} to {recommended_batch}")
                if recommended_batch > current_batch:
                    potential_speedup = recommended.get('speedup', 1.0)
                    print(f"     Potential speedup: {potential_speedup:.1f}x")
    except Exception as e:
        print(f"Could not read current config: {e}")
    
    return recommendations

if __name__ == "__main__":
    recommendations = main()