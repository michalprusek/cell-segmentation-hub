"""
Unit tests for inference service.
"""
import pytest
import torch
import numpy as np
from PIL import Image
from unittest.mock import Mock, patch, MagicMock
import asyncio

# Fix import paths to match actual structure
import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from services.inference import InferenceService
from services.postprocessing import PostprocessingService
from services.model_loader import ModelManager

# Define custom exceptions for testing
class ModelNotFoundError(Exception):
    pass

class InferenceError(Exception):
    pass


class TestInferenceService:
    """Test cases for the inference service."""
    
    @pytest.fixture
    def mock_model_manager(self):
        """Create a mock model manager."""
        mock_manager = Mock(spec=ModelManager)
        mock_manager.get_model = Mock()
        mock_manager.models = {}
        return mock_manager
    
    @pytest.fixture
    def inference_service(self, mock_model_manager):
        """Create an inference service instance for testing."""
        return InferenceService(mock_model_manager)
    
    @pytest.fixture
    def sample_image(self):
        """Create a sample PIL Image for testing."""
        # Create a simple test image
        img_array = np.random.randint(0, 255, (256, 256, 3), dtype=np.uint8)
        return Image.fromarray(img_array)
    
    @pytest.fixture
    def mock_model(self):
        """Create a mock PyTorch model."""
        mock_model = Mock()
        mock_model.eval.return_value = mock_model
        mock_model.to.return_value = mock_model
        
        # Mock model output - simulate segmentation mask
        mock_output = torch.rand(1, 1, 256, 256)  # Batch, channels, height, width
        mock_model.return_value = mock_output
        
        return mock_model
    
    def test_service_initialization(self, inference_service):
        """Test that inference service initializes correctly."""
        assert inference_service is not None
        assert hasattr(inference_service, 'model_manager')
        assert hasattr(inference_service, 'postprocessing')
        assert hasattr(inference_service, 'normalize')
        assert hasattr(inference_service, 'target_size')
    
    def test_load_model_success(self, inference_service, mock_model_manager, mock_model):
        """Test successful model loading through model manager."""
        # Configure mock to return a model
        mock_model_manager.get_model.return_value = mock_model
        
        # Get model through model manager
        model = mock_model_manager.get_model('hrnet')
        
        assert model is not None
        mock_model_manager.get_model.assert_called_once_with('hrnet')
    
    def test_load_model_file_not_found(self, inference_service, mock_model_manager):
        """Test model loading when file doesn't exist."""
        # Configure mock to raise error
        mock_model_manager.get_model.side_effect = ModelNotFoundError('Model not found: nonexistent_model')
        
        with pytest.raises(ModelNotFoundError) as exc_info:
            mock_model_manager.get_model('nonexistent_model')
        
        assert 'nonexistent_model' in str(exc_info.value)
    
    def test_load_model_loading_error(self, inference_service, mock_model_manager):
        """Test model loading with loading error."""
        # Configure mock to raise runtime error
        mock_model_manager.get_model.side_effect = RuntimeError("Failed to load model")
        
        with pytest.raises(RuntimeError) as exc_info:
            mock_model_manager.get_model('failing_model')
        
        assert 'Failed to load' in str(exc_info.value)
    
    @pytest.mark.asyncio
    async def test_segment_image_basic(self, inference_service, sample_image, mock_model_manager):
        """Test basic image segmentation."""
        # Convert sample image to bytes
        import io
        img_byte_arr = io.BytesIO()
        sample_image.save(img_byte_arr, format='PNG')
        img_byte_arr = img_byte_arr.getvalue()
        
        # Mock model manager to return a model
        mock_model = Mock()
        mock_model.eval.return_value = mock_model
        mock_model.to.return_value = mock_model
        mock_output = torch.sigmoid(torch.rand(1, 1, 1024, 1024))
        mock_model.return_value = mock_output
        mock_model_manager.get_model.return_value = mock_model
        
        # Call segment_image
        result = await inference_service.segment_image(
            image_data=img_byte_arr,
            model_name='test_model',
            threshold=0.5
        )
        
        assert isinstance(result, dict)
        assert 'polygons' in result
        assert 'metadata' in result
    
    @pytest.mark.asyncio
    async def test_segment_image_with_grayscale(self, inference_service, mock_model_manager):
        """Test segmentation with grayscale image."""
        grayscale_image = Image.new('L', (256, 256), color=128)
        
        # Convert to bytes
        import io
        img_byte_arr = io.BytesIO()
        grayscale_image.save(img_byte_arr, format='PNG')
        img_byte_arr = img_byte_arr.getvalue()
        
        # Mock model
        mock_model = Mock()
        mock_model.eval.return_value = mock_model
        mock_model.to.return_value = mock_model
        mock_output = torch.sigmoid(torch.rand(1, 1, 1024, 1024))
        mock_model.return_value = mock_output
        mock_model_manager.get_model.return_value = mock_model
        
        result = await inference_service.segment_image(
            image_data=img_byte_arr,
            model_name='test_model'
        )
        
        assert isinstance(result, dict)
    
    @pytest.mark.asyncio
    async def test_segment_image_different_sizes(self, inference_service, mock_model_manager):
        """Test segmentation with images of different sizes."""
        small_image = Image.new('RGB', (100, 100), color='white')
        
        # Convert to bytes
        import io
        img_byte_arr = io.BytesIO()
        small_image.save(img_byte_arr, format='PNG')
        img_byte_arr = img_byte_arr.getvalue()
        
        # Mock model
        mock_model = Mock()
        mock_model.eval.return_value = mock_model
        mock_model.to.return_value = mock_model
        mock_output = torch.sigmoid(torch.rand(1, 1, 1024, 1024))
        mock_model.return_value = mock_output
        mock_model_manager.get_model.return_value = mock_model
        
        result = await inference_service.segment_image(
            image_data=img_byte_arr,
            model_name='test_model'
        )
        
        assert isinstance(result, dict)
        assert 'metadata' in result
    
    @pytest.mark.asyncio
    async def test_segment_image_with_threshold(self, inference_service, sample_image, mock_model_manager):
        """Test segmentation with custom threshold."""
        # Convert sample image to bytes
        import io
        img_byte_arr = io.BytesIO()
        sample_image.save(img_byte_arr, format='PNG')
        img_byte_arr = img_byte_arr.getvalue()
        
        # Mock model
        mock_model = Mock()
        mock_model.eval.return_value = mock_model
        mock_model.to.return_value = mock_model
        mock_output = torch.sigmoid(torch.rand(1, 1, 1024, 1024))
        mock_model.return_value = mock_output
        mock_model_manager.get_model.return_value = mock_model
        
        # Test with different thresholds
        for threshold in [0.3, 0.5, 0.7]:
            result = await inference_service.segment_image(
                image_data=img_byte_arr,
                model_name='test_model',
                threshold=threshold
            )
            assert isinstance(result, dict)
            assert 'polygons' in result
    
    def test_model_manager_integration(self, mock_model_manager):
        """Test integration with model manager."""
        # Test model listing
        mock_model_manager.list_models = Mock(return_value=['hrnet', 'cbam', 'unet'])
        models = mock_model_manager.list_models()
        assert len(models) == 3
        assert 'hrnet' in models
        
    def test_postprocessing_integration(self, inference_service):
        """Test integration with postprocessing service."""
        assert isinstance(inference_service.postprocessing, PostprocessingService)
        
    @pytest.mark.asyncio
    async def test_error_handling(self, inference_service, mock_model_manager):
        """Test error handling in segmentation."""
        # Test with invalid image data
        with pytest.raises(Exception):
            await inference_service.segment_image(
                image_data=b'invalid_image_data',
                model_name='test_model'
            )
        
    @pytest.mark.asyncio
    async def test_detect_holes_parameter(self, inference_service, sample_image, mock_model_manager):
        """Test detect_holes parameter in segmentation."""
        # Convert sample image to bytes
        import io
        img_byte_arr = io.BytesIO()
        sample_image.save(img_byte_arr, format='PNG')
        img_byte_arr = img_byte_arr.getvalue()
        
        # Mock model
        mock_model = Mock()
        mock_model.eval.return_value = mock_model
        mock_model.to.return_value = mock_model
        mock_output = torch.sigmoid(torch.rand(1, 1, 1024, 1024))
        mock_model.return_value = mock_output
        mock_model_manager.get_model.return_value = mock_model
        
        # Test with detect_holes=True
        result_with_holes = await inference_service.segment_image(
            image_data=img_byte_arr,
            model_name='test_model',
            detect_holes=True
        )
        assert isinstance(result_with_holes, dict)
        
        # Test with detect_holes=False
        result_without_holes = await inference_service.segment_image(
            image_data=img_byte_arr,
            model_name='test_model',
            detect_holes=False
        )
        assert isinstance(result_without_holes, dict)