#!/usr/bin/env python3
"""Simple GPU test script for debugging"""

import sys
import os

print("=== GPU Detection Test ===")
print(f"Python version: {sys.version}")
print(f"Environment variables:")
print(f"  CUDA_VISIBLE_DEVICES: {os.environ.get('CUDA_VISIBLE_DEVICES', 'not set')}")
print(f"  NVIDIA_VISIBLE_DEVICES: {os.environ.get('NVIDIA_VISIBLE_DEVICES', 'not set')}")
print()

try:
    import torch
    print(f"PyTorch version: {torch.__version__}")
    print(f"CUDA built: {torch.version.cuda}")
    print(f"CUDA available: {torch.cuda.is_available()}")
    
    if torch.cuda.is_available():
        print(f"CUDA device count: {torch.cuda.device_count()}")
        print(f"Current device: {torch.cuda.current_device()}")
        print(f"Device name: {torch.cuda.get_device_name(0)}")
        print(f"Device capability: {torch.cuda.get_device_capability(0)}")
        
        # Test simple GPU operation
        x = torch.randn(100, 100).cuda()
        y = torch.randn(100, 100).cuda()
        z = x @ y
        print(f"Simple GPU operation successful: tensor shape {z.shape}")
    else:
        print("CUDA not available - running on CPU")
        # Check why CUDA is not available
        import subprocess
        try:
            result = subprocess.run(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], 
                                  capture_output=True, text=True)
            if result.returncode == 0:
                print(f"GPU detected by nvidia-smi: {result.stdout.strip()}")
            else:
                print("nvidia-smi not available or failed")
        except:
            print("Could not run nvidia-smi")
            
except ImportError as e:
    print(f"PyTorch not installed: {e}")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()