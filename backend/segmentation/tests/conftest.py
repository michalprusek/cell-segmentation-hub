"""
Pytest configuration for ML service tests
"""

import sys
import os
import pytest
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

# Fixtures for common test data
@pytest.fixture
def mock_image():
    """Provide a mock image for testing"""
    import numpy as np
    return np.random.rand(256, 256, 3).astype(np.float32)

@pytest.fixture
def mock_model():
    """Provide a mock PyTorch model"""
    from unittest.mock import Mock
    import torch
    
    model = Mock()
    model.return_value = torch.randn(1, 2, 256, 256)
    return model

@pytest.fixture(autouse=True)
def cleanup_executor():
    """Cleanup global executor after each test"""
    yield
    # Cleanup after test
    from ml.inference_executor import shutdown_global_executor
    shutdown_global_executor()

@pytest.fixture
def timeout_settings():
    """Provide timeout settings for tests"""
    return {
        'default': 60.0,
        'short': 1.0,
        'medium': 10.0,
        'long': 120.0
    }