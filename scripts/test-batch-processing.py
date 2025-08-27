#!/usr/bin/env python3
"""
Test script for batch processing functionality
Tests the new batch processing methods in the model loader
"""

import sys
import time
import torch
from PIL import Image
import numpy as np
from pathlib import Path

# Add the segmentation module to path dynamically
import os
from pathlib import Path

# Try to find the project root
if os.path.exists('/app'):
    # Running in Docker
    sys.path.append('/app')
else:
    # Running locally - add backend/segmentation to path
    project_root = Path(__file__).resolve().parent.parent / "backend" / "segmentation"
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

from ml.model_loader import ModelLoader

def create_test_images(count=5, size=(1000, 1000)):
    """Create test images for batch processing"""
    images = []
    
    # Create different test patterns
    for i in range(count):
        # Create a test pattern - circles with different positions
        img_array = np.zeros((*size, 3), dtype=np.uint8)
        
        # Add some random circles to simulate cells
        center_x = 200 + (i * 150) % (size[0] - 400)
        center_y = 200 + (i * 100) % (size[1] - 400)
        
        # Create circular pattern
        y_coords, x_coords = np.ogrid[:size[0], :size[1]]
        mask = (x_coords - center_x)**2 + (y_coords - center_y)**2 <= 50**2
        
        img_array[mask] = [100 + i*30, 100 + i*20, 100 + i*10]  # Different colors per image
        
        # Convert to PIL Image
        image = Image.fromarray(img_array, 'RGB')
        images.append(image)
        
    return images

def main():
    print("=" * 60)
    print("BATCH PROCESSING TEST")
    print("=" * 60)
    
    # Initialize model loader
    # Use dynamic base path
    base_path = "/app" if os.path.exists("/app") else str(Path(__file__).resolve().parent.parent / "backend" / "segmentation")
    model_loader = ModelLoader(base_path=base_path)
    
    # Create test images
    print("Creating test images...")
    test_images = create_test_images(count=10)
    print(f"Created {len(test_images)} test images")
    
    # Test batch configuration loading
    print("\nBatch Configuration:")
    for model_name in ["hrnet", "resunet_small"]:
        optimal_batch = model_loader.get_optimal_batch_size(model_name)
        max_batch = model_loader.get_max_safe_batch_size(model_name)
        print(f"  {model_name}: optimal={optimal_batch}, max_safe={max_batch}")
    
    # Test single image processing (baseline)
    print("\n" + "-" * 40)
    print("SINGLE IMAGE PROCESSING TEST")
    print("-" * 40)
    
    start_time = time.time()
    single_results = []
    
    for i, image in enumerate(test_images[:3]):  # Test with 3 images
        print(f"Processing image {i+1}/3...")
        result = model_loader.predict(image, "hrnet")
        single_results.append(result)
        print(f"  Found {len(result['polygons'])} polygons")
    
    single_time = time.time() - start_time
    print(f"Single processing time: {single_time:.2f} seconds")
    print(f"Average per image: {single_time/3:.2f} seconds")
    
    # Test batch processing
    print("\n" + "-" * 40)
    print("BATCH PROCESSING TEST")
    print("-" * 40)
    
    start_time = time.time()
    
    # Test with automatic optimal batch size
    print("Testing with automatic batch size...")
    batch_results = model_loader.predict_batch(test_images, "hrnet")
    
    batch_time = time.time() - start_time
    print(f"Batch processing time: {batch_time:.2f} seconds")
    print(f"Average per image: {batch_time/len(test_images):.2f} seconds")
    print(f"Speedup: {single_time/3 / (batch_time/len(test_images)):.2f}x")
    
    # Verify results with defensive error handling
    print(f"Processed {len(batch_results)} images in batch")
    for i, result in enumerate(batch_results):
        try:
            # Safely get processing info
            processing_info = result.get('processing_info')
            if processing_info:
                batch_size = processing_info.get('batch_size', 'unknown')
                batch_pos = processing_info.get('batch_position', 'unknown')
            else:
                batch_size = 'unknown'
                batch_pos = 'unknown'
            
            # Safely get polygon count
            polygons_data = result.get('polygons', [])
            if isinstance(polygons_data, (list, tuple)):
                polygons = len(polygons_data)
            else:
                polygons = 0
            
            print(f"  Image {i+1}: {polygons} polygons (batch_size={batch_size}, pos={batch_pos})")
        except Exception as e:
            print(f"  Image {i+1}: Error processing result: {str(e)}")
            continue
    
    # Test custom batch size
    print("\nTesting with custom batch size (4)...")
    start_time = time.time()
    
    custom_batch_results = model_loader.predict_batch(test_images[:8], "hrnet", batch_size=4)
    
    custom_time = time.time() - start_time
    print(f"Custom batch processing time: {custom_time:.2f} seconds")
    print(f"Average per image: {custom_time/8:.2f} seconds")
    
    # Test with ResUNet Small
    print("\nTesting ResUNet Small...")
    start_time = time.time()
    
    resunet_results = model_loader.predict_batch(test_images[:4], "resunet_small")
    
    resunet_time = time.time() - start_time
    print(f"ResUNet Small batch time: {resunet_time:.2f} seconds")
    print(f"Average per image: {resunet_time/4:.2f} seconds")
    
    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Single image processing: {single_time/3:.3f}s per image")
    print(f"HRNet batch processing: {batch_time/len(test_images):.3f}s per image")
    print(f"ResUNet Small batch: {resunet_time/4:.3f}s per image")
    print(f"Overall speedup: {(single_time/3) / (batch_time/len(test_images)):.1f}x")
    
    # Memory info
    if torch.cuda.is_available():
        memory_used = torch.cuda.memory_allocated() / 1024**2
        print(f"GPU memory used: {memory_used:.1f} MB")
    
    print("\nBatch processing test completed successfully!")
    return 0

if __name__ == "__main__":
    exit(main())