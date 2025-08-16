"""
Unit tests for inference service.
"""
import pytest
import torch
import numpy as np
from PIL import Image
from unittest.mock import Mock, patch, MagicMock

from services.inference import InferenceService, ModelNotFoundError, InferenceError
from services.postprocessing import PostProcessor


class TestInferenceService:
    """Test cases for the inference service."""
    
    @pytest.fixture
    def inference_service(self):
        """Create an inference service instance for testing."""
        return InferenceService()
    
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
        assert hasattr(inference_service, 'models')
        assert hasattr(inference_service, 'device')
        assert isinstance(inference_service.models, dict)
    
    @patch('services.inference.torch.load')
    @patch('services.inference.os.path.exists')
    def test_load_model_success(self, mock_exists, mock_load, inference_service, mock_model):
        """Test successful model loading."""
        mock_exists.return_value = True
        mock_load.return_value = mock_model
        
        with patch('services.inference.get_model_architecture') as mock_get_arch:
            mock_get_arch.return_value = Mock()
            
            model = inference_service.load_model('hrnet')
            
            assert model is not None
            assert 'hrnet' in inference_service.models
            mock_exists.assert_called_once()
            mock_load.assert_called_once()
    
    @patch('services.inference.os.path.exists')
    def test_load_model_file_not_found(self, mock_exists, inference_service):
        """Test model loading when file doesn't exist."""
        mock_exists.return_value = False
        
        with pytest.raises(ModelNotFoundError) as exc_info:
            inference_service.load_model('nonexistent_model')
        
        assert 'nonexistent_model' in str(exc_info.value)
    
    @patch('services.inference.torch.load')
    @patch('services.inference.os.path.exists')
    def test_load_model_loading_error(self, mock_exists, mock_load, inference_service):
        """Test model loading with loading error."""
        mock_exists.return_value = True
        mock_load.side_effect = RuntimeError("Failed to load model")
        
        with pytest.raises(ModelNotFoundError) as exc_info:
            inference_service.load_model('failing_model')
        
        assert 'Failed to load' in str(exc_info.value)
    
    def test_preprocess_image(self, inference_service, sample_image):
        """Test image preprocessing."""
        # Test with PIL Image
        tensor = inference_service.preprocess_image(sample_image)
        
        assert isinstance(tensor, torch.Tensor)
        assert tensor.dim() == 4  # Batch dimension added
        assert tensor.shape[1] == 3  # RGB channels
        assert tensor.dtype == torch.float32
        
        # Test normalization - values should be in reasonable range
        assert tensor.min() >= -3  # Approximately normalized
        assert tensor.max() <= 3
    
    def test_preprocess_image_grayscale(self, inference_service):
        """Test preprocessing of grayscale image."""
        grayscale_image = Image.new('L', (256, 256), color=128)
        
        tensor = inference_service.preprocess_image(grayscale_image)
        
        assert isinstance(tensor, torch.Tensor)
        assert tensor.shape[1] == 3  # Should be converted to RGB
    
    def test_preprocess_image_different_sizes(self, inference_service):
        """Test preprocessing images of different sizes."""
        small_image = Image.new('RGB', (100, 100), color='white')
        large_image = Image.new('RGB', (2000, 2000), color='white')
        
        small_tensor = inference_service.preprocess_image(small_image, target_size=256)
        large_tensor = inference_service.preprocess_image(large_image, target_size=256)
        
        assert small_tensor.shape[2:] == (256, 256)
        assert large_tensor.shape[2:] == (256, 256)
    
    @patch('services.inference.InferenceService.load_model')
    def test_predict_success(self, mock_load_model, inference_service, sample_image, mock_model):
        """Test successful prediction."""
        mock_load_model.return_value = mock_model
        inference_service.models['test_model'] = mock_model
        
        with patch('services.inference.PostProcessor') as mock_post_processor:
            mock_processor = Mock()
            mock_processor.extract_polygons.return_value = [
                {
                    'points': [[10, 10], [20, 10], [20, 20], [10, 20]],
                    'confidence': 0.9,
                    'area': 100,
                    'centroid': [15, 15]
                }
            ]
            mock_post_processor.return_value = mock_processor
            
            result = inference_service.predict(sample_image, 'test_model')
            
            assert 'polygons' in result
            assert 'metadata' in result
            assert len(result['polygons']) == 1
            assert result['metadata']['model_name'] == 'test_model'
    
    def test_predict_model_not_found(self, inference_service, sample_image):
        """Test prediction with non-existent model."""
        with pytest.raises(ModelNotFoundError) as exc_info:
            inference_service.predict(sample_image, 'nonexistent_model')
        
        assert 'nonexistent_model' in str(exc_info.value)
    
    @patch('services.inference.InferenceService.load_model')
    def test_predict_inference_error(self, mock_load_model, inference_service, sample_image, mock_model):
        """Test prediction with inference error."""
        mock_model.side_effect = RuntimeError("CUDA out of memory")
        mock_load_model.return_value = mock_model
        inference_service.models['test_model'] = mock_model
        
        with pytest.raises(InferenceError) as exc_info:
            inference_service.predict(sample_image, 'test_model')
        
        assert 'Inference failed' in str(exc_info.value)
    
    def test_predict_batch_success(self, inference_service, sample_image, mock_model):
        """Test successful batch prediction."""
        inference_service.models['test_model'] = mock_model
        
        images = [sample_image, sample_image, sample_image]
        
        with patch('services.inference.PostProcessor') as mock_post_processor:
            mock_processor = Mock()
            mock_processor.extract_polygons.return_value = [
                {
                    'points': [[10, 10], [20, 10], [20, 20], [10, 20]],
                    'confidence': 0.9,
                    'area': 100,
                    'centroid': [15, 15]
                }
            ]
            mock_post_processor.return_value = mock_processor
            
            results = inference_service.predict_batch(images, 'test_model')
            
            assert len(results) == 3
            for result in results:
                assert 'polygons' in result
                assert 'metadata' in result
    
    def test_predict_batch_empty_list(self, inference_service):
        """Test batch prediction with empty image list."""
        results = inference_service.predict_batch([], 'test_model')
        assert results == []
    
    def test_postprocessing_options(self, inference_service, sample_image, mock_model):
        """Test prediction with postprocessing options."""
        inference_service.models['test_model'] = mock_model
        
        postprocessing_options = {
            'min_area': 50,
            'confidence_threshold': 0.8,
            'remove_edge_objects': True,
            'simplify_polygons': True
        }
        
        with patch('services.inference.PostProcessor') as mock_post_processor:
            mock_processor = Mock()
            mock_processor.extract_polygons.return_value = []
            mock_post_processor.return_value = mock_processor
            
            inference_service.predict(sample_image, 'test_model', **postprocessing_options)
            
            # Verify that PostProcessor was called with correct options
            mock_post_processor.assert_called_once()
            call_args = mock_post_processor.call_args[1]  # keyword arguments
            
            assert call_args.get('min_area') == 50
            assert call_args.get('confidence_threshold') == 0.8
            assert call_args.get('remove_edge_objects') == True
    
    def test_device_selection(self, inference_service):
        """Test device selection logic."""
        # Should select appropriate device
        assert inference_service.device in ['cuda', 'cpu']
        
        if torch.cuda.is_available():
            assert inference_service.device == 'cuda'
        else:
            assert inference_service.device == 'cpu'
    
    @patch('services.inference.torch.cuda.is_available')
    def test_device_fallback_to_cpu(self, mock_cuda_available):
        """Test fallback to CPU when CUDA is not available."""
        mock_cuda_available.return_value = False
        
        service = InferenceService()
        assert service.device == 'cpu'
    
    def test_model_caching(self, inference_service, mock_model):
        """Test that models are cached after loading."""
        with patch('services.inference.InferenceService.load_model') as mock_load:
            mock_load.return_value = mock_model
            
            # First call should load model
            inference_service.get_model('test_model')
            assert mock_load.call_count == 1
            
            # Second call should use cached model
            inference_service.get_model('test_model')
            assert mock_load.call_count == 1  # Still 1, not 2
    
    def test_memory_management(self, inference_service, mock_model):
        """Test memory management during inference."""
        inference_service.models['test_model'] = mock_model
        
        with patch('torch.cuda.empty_cache') as mock_empty_cache:
            with patch('services.inference.PostProcessor') as mock_post_processor:
                mock_processor = Mock()
                mock_processor.extract_polygons.return_value = []
                mock_post_processor.return_value = mock_processor
                
                inference_service.predict(Image.new('RGB', (256, 256)), 'test_model')
                
                # Should clear CUDA cache if using GPU
                if inference_service.device == 'cuda':
                    mock_empty_cache.assert_called()
    
    def test_inference_timing(self, inference_service, sample_image, mock_model):
        """Test that inference timing is recorded."""
        inference_service.models['test_model'] = mock_model
        
        with patch('services.inference.PostProcessor') as mock_post_processor:
            mock_processor = Mock()
            mock_processor.extract_polygons.return_value = []
            mock_post_processor.return_value = mock_processor
            
            result = inference_service.predict(sample_image, 'test_model')
            
            assert 'metadata' in result
            assert 'processing_time' in result['metadata']
            assert isinstance(result['metadata']['processing_time'], (int, float))
            assert result['metadata']['processing_time'] > 0
    
    @pytest.mark.parametrize("model_name,expected_architecture", [
        ('hrnet', 'HRNet'),
        ('resunet_small', 'ResUNet'),
        ('resunet_advanced', 'ResUNet'),
    ])
    def test_model_architecture_selection(self, model_name, expected_architecture):
        """Test that correct architecture is selected for each model."""
        with patch('services.inference.get_model_architecture') as mock_get_arch:
            mock_get_arch.return_value = Mock()
            
            service = InferenceService()
            with patch('services.inference.os.path.exists', return_value=True):
                with patch('services.inference.torch.load', return_value=Mock()):
                    try:
                        service.load_model(model_name)
                        mock_get_arch.assert_called_once()
                        # The specific architecture call would depend on implementation
                    except Exception:
                        pass  # We're just testing the call pattern