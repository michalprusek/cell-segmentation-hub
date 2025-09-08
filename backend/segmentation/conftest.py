"""
Pytest configuration and fixtures for ML service tests.
"""
import os
import sys
import asyncio
from typing import AsyncGenerator, Generator
import pytest
import torch
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from httpx import AsyncClient

# Use proper imports instead of sys.path manipulation
# sys.path.insert(0, os.path.dirname(__file__))

from api.main import app


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def client() -> TestClient:
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client for the FastAPI app."""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def sample_image() -> Image.Image:
    """Create a sample PIL Image for testing."""
    # Create a simple test image (RGB, 256x256)
    image = Image.new('RGB', (256, 256), color='white')
    
    # Add some patterns to make it more realistic
    # Set seed for deterministic test images
    np.random.seed(42)
    pixels = image.load()
    for i in range(256):
        for j in range(256):
            # Create some circular patterns to simulate cells
            center_x, center_y = 128, 128
            distance = ((i - center_x) ** 2 + (j - center_y) ** 2) ** 0.5
            if 50 < distance < 70:
                pixels[i, j] = (100, 100, 100)  # Gray circle
            elif distance < 30:
                pixels[i, j] = (50, 50, 50)     # Dark center
    
    return image


@pytest.fixture
def sample_image_bytes(sample_image: Image.Image) -> bytes:
    """Convert sample image to bytes."""
    import io
    buffer = io.BytesIO()
    sample_image.save(buffer, format='JPEG')
    return buffer.getvalue()


@pytest.fixture
def sample_tensor() -> torch.Tensor:
    """Create a sample tensor for testing."""
    # Set seed for deterministic tensors
    torch.manual_seed(42)
    return torch.randn(1, 3, 256, 256)


@pytest.fixture
def sample_mask() -> torch.Tensor:
    """Create a sample mask tensor for testing."""
    mask = torch.zeros(1, 1, 256, 256)
    # Add some circular masks to simulate cell segmentation
    center_x, center_y = 128, 128
    radius = 50
    
    for i in range(256):
        for j in range(256):
            distance = ((i - center_x) ** 2 + (j - center_y) ** 2) ** 0.5
            if distance < radius:
                mask[0, 0, i, j] = 1.0
    
    return mask


@pytest.fixture
def mock_model_weights() -> dict:
    """Create mock model weights for testing."""
    # Set seed for deterministic weights
    torch.manual_seed(42)
    return {
        'conv1.weight': torch.randn(64, 3, 7, 7),
        'conv1.bias': torch.randn(64),
        'bn1.weight': torch.randn(64),
        'bn1.bias': torch.randn(64),
    }


@pytest.fixture(autouse=True)
def setup_test_environment():
    """Setup test environment variables."""
    os.environ['ENVIRONMENT'] = 'test'
    os.environ['LOG_LEVEL'] = 'DEBUG'
    os.environ['MODEL_PATH'] = '/tmp/test_models'
    
    # Ensure model directory exists
    os.makedirs('/tmp/test_models', exist_ok=True)
    
    yield
    
    # Cleanup after tests
    import shutil
    if os.path.exists('/tmp/test_models'):
        shutil.rmtree('/tmp/test_models')


@pytest.fixture
def disable_gpu():
    """Disable GPU for tests to ensure consistent behavior."""
    original_device = os.environ.get('CUDA_VISIBLE_DEVICES')
    os.environ['CUDA_VISIBLE_DEVICES'] = ''
    
    yield
    
    # Restore original setting
    if original_device is not None:
        os.environ['CUDA_VISIBLE_DEVICES'] = original_device
    elif 'CUDA_VISIBLE_DEVICES' in os.environ:
        del os.environ['CUDA_VISIBLE_DEVICES']


@pytest.fixture
def mock_model_inference(monkeypatch):
    """Mock model inference to avoid loading actual models in tests."""
    def mock_predict(image, model_name):
        # Return a mock segmentation result
        height, width = 256, 256
        if hasattr(image, 'size'):
            width, height = image.size
        
        # Create mock polygons (simple rectangles)
        polygons = [
            {
                'points': [[50, 50], [150, 50], [150, 150], [50, 150]],
                'confidence': 0.95,
                'area': 10000,
                'centroid': [100, 100]
            },
            {
                'points': [[200, 200], [250, 200], [250, 250], [200, 250]],
                'confidence': 0.87,
                'area': 2500,
                'centroid': [225, 225]
            }
        ]
        
        return {
            'polygons': polygons,
            'metadata': {
                'model_name': model_name,
                'image_size': [width, height],
                'processing_time': 0.1,
                'total_objects': len(polygons)
            }
        }
    
    # Use context manager for proper monkeypatch cleanup
    with monkeypatch.context() as m:
        # Only mock existing modules
        try:
            m.setattr('services.inference.predict_with_model', mock_predict, raising=False)
        except:
            pass
        yield mock_predict


# Pytest configuration
def pytest_configure(config):
    """Configure pytest with custom markers."""
    config.addinivalue_line(
        "markers", "unit: mark test as a unit test"
    )
    config.addinivalue_line(
        "markers", "integration: mark test as an integration test"
    )
    config.addinivalue_line(
        "markers", "slow: mark test as slow running"
    )
    config.addinivalue_line(
        "markers", "gpu: mark test as requiring GPU"
    )
    config.addinivalue_line(
        "markers", "model: mark test as involving ML models"
    )


def pytest_collection_modifyitems(config, items):
    """Modify test collection to add markers based on test location."""
    for item in items:
        # Add unit marker to tests in unit directories
        if "unit" in str(item.fspath):
            item.add_marker(pytest.mark.unit)
        
        # Add integration marker to tests in integration directories
        if "integration" in str(item.fspath):
            item.add_marker(pytest.mark.integration)
        
        # Add model marker to tests that involve models
        if "model" in str(item.fspath) or "inference" in str(item.fspath):
            item.add_marker(pytest.mark.model)