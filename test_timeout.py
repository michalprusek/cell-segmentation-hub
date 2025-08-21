#!/usr/bin/env python3
"""
Test script to verify the ML timeout mechanism is working properly
"""
import os
import requests
import json
import time
import base64
from PIL import Image
import io

def create_test_image():
    """Create a simple test image"""
    # Create a 100x100 white image with some black dots
    img = Image.new('RGB', (100, 100), color='white')
    pixels = img.load()
    
    # Add some black dots to make it more interesting for segmentation
    for i in range(10, 90, 20):
        for j in range(10, 90, 20):
            for x in range(i-5, i+5):
                for y in range(j-5, j+5):
                    if 0 <= x < 100 and 0 <= y < 100:
                        pixels[x, y] = (0, 0, 0)
    
    # Convert to base64
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    img_str = base64.b64encode(buffer.getvalue()).decode()
    return f"data:image/png;base64,{img_str}"

def test_ml_service():
    """Test the ML service with timeout mechanism"""
    print("Testing ML Service Timeout Mechanism")
    print("=" * 50)
    
    # Check if ML service is healthy
    base_url = os.environ.get('ML_SERVICE_URL', 'http://localhost:8000')
    health_url = f"{base_url}/health"
    
    try:
        print(f"🔍 Checking ML service health at: {health_url}")
        health_response = requests.get(health_url, timeout=10)
        
        if health_response.status_code != 200:
            print(f"❌ Health check failed with status code: {health_response.status_code}")
            print(f"   Response text: {health_response.text}")
            return False
            
        try:
            health_data = health_response.json()
        except ValueError as json_error:
            print(f"❌ Failed to parse JSON response: {json_error}")
            print(f"   Response text: {health_response.text}")
            return False
            
        print(f"✅ ML Service Health: {health_data.get('status', 'unknown')}")
        print(f"   Models loaded: {health_data.get('models_loaded', 'unknown')}")
        print(f"   GPU available: {health_data.get('gpu_available', 'unknown')}")
        
    except requests.exceptions.ConnectTimeout:
        print(f"❌ Connection timeout to {health_url}")
        return False
    except requests.exceptions.ConnectionError:
        print(f"❌ Connection error to {health_url}")
        return False  
    except requests.exceptions.RequestException as req_error:
        print(f"❌ Request failed to {health_url}: {req_error}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error during health check: {e}")
        return False
    
    # Create test image
    print("\n📸 Creating test image...")
    test_image = create_test_image()
    print(f"   Image data length: {len(test_image)} characters")
    
    # Test segmentation with different models
    models_to_test = ["hrnet", "resunet_small", "resunet_advanced"]
    
    for model_name in models_to_test:
        print(f"\n🧠 Testing model: {model_name}")
        
        test_data = {
            "model_name": model_name,
            "image_data": test_image,
            "detect_holes": True,
            "threshold": 0.5
        }
        
        try:
            start_time = time.time()
            response = requests.post(
                "http://localhost:8000/segment",
                json=test_data,
                timeout=70  # Slightly longer than ML service timeout (60s)
            )
            end_time = time.time()
            
            duration = end_time - start_time
            
            if response.status_code == 200:
                result = response.json()
                print(f"   ✅ Success in {duration:.2f}s")
                print(f"   Polygons found: {len(result.get('polygons', []))}")
                print(f"   Processing time: {result.get('processing_time', 'N/A')}")
            else:
                print(f"   ❌ Failed with status {response.status_code}")
                print(f"   Response: {response.text}")
                
        except requests.exceptions.Timeout:
            print(f"   ⏰ Request timed out after 70s")
        except Exception as e:
            print(f"   ❌ Error: {e}")
    
    print("\n" + "=" * 50)
    print("Test completed!")

if __name__ == "__main__":
    test_ml_service()