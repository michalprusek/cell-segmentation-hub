#!/usr/bin/env python3
"""Verify batch configuration is loaded correctly"""

import sys
import os
import json

# Add parent directory to path dynamically
from pathlib import Path

if os.path.exists('/app'):
    # Running in Docker
    sys.path.insert(0, '/app')
else:
    # Running locally
    project_root = Path(__file__).resolve().parent.parent / "backend" / "segmentation"
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

from ml.model_loader import ModelLoader

def verify_batch_config():
    """Verify batch configuration is loaded correctly"""
    
    print("="*60)
    print("🔍 VERIFYING BATCH CONFIGURATION")
    print("="*60)
    
    # Load configuration file dynamically
    config_path = os.environ.get("BATCH_CONFIG_PATH", 
                                 "/app/config/batch_sizes.json" if os.path.exists('/app') 
                                 else str(Path(__file__).resolve().parent.parent / "backend" / "segmentation" / "config" / "batch_sizes.json"))
    print(f"\n📁 Loading config from: {config_path}")
    
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            file_config = json.load(f)
        print("✅ Configuration file found")
    else:
        print("❌ Configuration file not found!")
        return
    
    # Initialize ModelLoader
    print("\n🚀 Initializing ModelLoader...")
    loader = ModelLoader()
    
    # Test each model
    models = ['hrnet', 'resunet_small', 'resunet_advanced']
    
    print("\n📊 BATCH SIZE CONFIGURATION:")
    print("-"*60)
    
    all_match = True
    for model in models:
        file_batch = file_config['batch_configurations'][model]['optimal_batch_size']
        loader_batch = loader.get_optimal_batch_size(model)
        
        match = "✅" if file_batch == loader_batch else "❌"
        print(f"\n{model.upper()}:")
        print(f"  File config:   {file_batch}")
        print(f"  Loader config: {loader_batch}")
        print(f"  Status: {match}")
        
        if file_batch != loader_batch:
            all_match = False
            print(f"  ⚠️ MISMATCH DETECTED!")
    
    print("\n" + "="*60)
    if all_match:
        print("✅ ALL CONFIGURATIONS MATCH!")
    else:
        print("❌ CONFIGURATION MISMATCHES DETECTED!")
        print("   The ModelLoader may be using cached or default values")
    print("="*60)
    
    # Show expected performance
    print("\n📈 EXPECTED PERFORMANCE:")
    print("-"*60)
    for model in models:
        batch_size = file_config['batch_configurations'][model]['optimal_batch_size']
        throughput = file_config['batch_configurations'][model]['expected_throughput']
        print(f"{model.upper()}:")
        print(f"  Batch size: {batch_size}")
        print(f"  Expected throughput: {throughput:.2f} img/s")

if __name__ == "__main__":
    verify_batch_config()