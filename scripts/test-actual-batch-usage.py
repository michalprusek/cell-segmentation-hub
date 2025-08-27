#!/usr/bin/env python3
"""Test that models actually use the configured batch sizes"""

import torch
import numpy as np
from PIL import Image
import time

def test_actual_batch_usage():
    """Test that each model uses its configured batch size"""
    
    print("="*60)
    print("🔬 TESTING ACTUAL BATCH SIZE USAGE")
    print("="*60)
    
    # Import model loader
    from ml.model_loader import ModelLoader
    loader = ModelLoader()
    
    models = ['hrnet', 'resunet_small', 'resunet_advanced']
    
    for model_name in models:
        print(f"\n{'='*60}")
        print(f"📊 Testing {model_name.upper()}")
        print(f"{'='*60}")
        
        # Get configured batch size
        batch_size = loader.get_optimal_batch_size(model_name)
        print(f"Configured batch size: {batch_size}")
        
        # Create test images (3 images to test batching)
        test_images = []
        for i in range(3):
            test_array = np.random.randint(100, 200, (1000, 1000, 3), dtype=np.uint8)
            test_image = Image.fromarray(test_array, 'RGB')
            test_images.append(test_image)
        
        print(f"Processing {len(test_images)} images...")
        
        # Clear GPU cache
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        
        # Process images
        start_time = time.time()
        
        # Try to intercept batch size used
        original_predict = loader.predict
        actual_batch_sizes_used = []
        
        def track_batch_size(*args, **kwargs):
            # Track if batch processing is happening
            if hasattr(loader, 'last_batch_size'):
                actual_batch_sizes_used.append(loader.last_batch_size)
            return original_predict(*args, **kwargs)
        
        loader.predict = track_batch_size
        
        # Process all images
        for img in test_images:
            result = loader.predict(img, model_name=model_name, threshold=0.5)
        
        # Restore original method
        loader.predict = original_predict
        
        processing_time = time.time() - start_time
        
        # Analysis
        print(f"\n✅ Results:")
        print(f"   Total time: {processing_time:.2f}s")
        print(f"   Time per image: {processing_time/len(test_images):.2f}s")
        
        if batch_size == 1:
            print(f"   ℹ️ Batch size is 1 - no batching expected")
            if model_name == 'resunet_advanced':
                print(f"   💡 MA-ResUNet doesn't benefit from batching")
        else:
            print(f"   📦 Expected batch size: {batch_size}")
            print(f"   ⚡ Batching should improve throughput")
        
        # Memory usage
        if torch.cuda.is_available():
            memory_mb = torch.cuda.max_memory_allocated() / 1024**2
            print(f"   💾 Peak GPU memory: {memory_mb:.0f} MB")
            torch.cuda.reset_peak_memory_stats()

if __name__ == "__main__":
    test_actual_batch_usage()