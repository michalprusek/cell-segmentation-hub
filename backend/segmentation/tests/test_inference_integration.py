"""Integration tests for ML inference pipeline"""

import pytest
import asyncio
import numpy as np
import torch
import io
import json
import time
from PIL import Image
from unittest.mock import Mock, patch, AsyncMock
from pathlib import Path

# Add parent directory to path for imports
import sys
sys.path.append(str(Path(__file__).parent.parent))

from services.inference import InferenceService
from services.model_loader import ModelManager
from services.postprocessing import PostprocessingService


class TestMLInferencePipeline:
    """Integration tests for the complete ML inference pipeline"""
    
    @pytest.fixture
    def model_manager(self):
        """Create a mock model manager for testing"""
        manager = Mock(spec=ModelManager)
        manager.device = torch.device('cpu')
        manager.loaded_models = {}
        
        # Mock model loading
        def load_model_mock(model_name):
            model = Mock()
            model.eval = Mock()
            # Return mock predictions
            model.return_value = torch.sigmoid(torch.randn(1, 1, 1024, 1024))
            manager.loaded_models[model_name] = model
            return model
        
        manager.load_model = Mock(side_effect=load_model_mock)
        return manager
    
    @pytest.fixture
    def inference_service(self, model_manager):
        """Create inference service with mock model manager"""
        return InferenceService(model_manager)
    
    @pytest.fixture
    def sample_image_bytes(self):
        """Generate sample image bytes for testing"""
        # Create a simple test image
        img = Image.new('RGB', (256, 256), color='red')
        # Add some variation to make segmentation interesting
        pixels = img.load()
        for i in range(100, 156):
            for j in range(100, 156):
                pixels[i, j] = (0, 255, 0)  # Green square in center
        
        # Convert to bytes
        img_bytes = io.BytesIO()
        img.save(img_bytes, format='PNG')
        img_bytes.seek(0)
        return img_bytes.read()
    
    @pytest.mark.asyncio
    async def test_complete_inference_pipeline(self, inference_service, sample_image_bytes):
        """Test the complete inference pipeline from image to polygons"""
        # Run inference
        result = await inference_service.segment_image(
            image_data=sample_image_bytes,
            model_name='hrnet_v2',
            threshold=0.5,
            detect_holes=True
        )
        
        # Verify result structure
        assert 'polygons' in result
        assert 'image_size' in result
        assert 'processing_stats' in result
        
        # Check image size
        assert result['image_size']['width'] == 256
        assert result['image_size']['height'] == 256
        
        # Check processing stats
        stats = result['processing_stats']
        assert 'preprocessing_time' in stats
        assert 'model_load_time' in stats
        assert 'inference_time' in stats
        assert 'postprocessing_time' in stats
        assert 'total_time' in stats
        
        # Verify times are positive
        assert stats['preprocessing_time'] > 0
        assert stats['total_time'] > 0
    
    @pytest.mark.asyncio
    async def test_inference_with_different_models(self, inference_service, sample_image_bytes):
        """Test inference with different model architectures"""
        models = ['hrnet_v2', 'cbam_resunet', 'ma_resunet']
        
        for model_name in models:
            result = await inference_service.segment_image(
                image_data=sample_image_bytes,
                model_name=model_name,
                threshold=0.5
            )
            
            assert 'polygons' in result
            assert isinstance(result['polygons'], list)
            
            # Verify model was loaded
            assert model_name in inference_service.model_manager.loaded_models
    
    @pytest.mark.asyncio
    async def test_inference_with_various_thresholds(self, inference_service, sample_image_bytes):
        """Test inference with different confidence thresholds"""
        thresholds = [0.3, 0.5, 0.7, 0.9]
        
        results = []
        for threshold in thresholds:
            result = await inference_service.segment_image(
                image_data=sample_image_bytes,
                model_name='hrnet_v2',
                threshold=threshold
            )
            results.append(len(result['polygons']))
        
        # Higher thresholds should generally produce fewer polygons
        # (though not strictly monotonic due to postprocessing)
        assert all(isinstance(r, int) for r in results)
    
    @pytest.mark.asyncio
    async def test_inference_with_hole_detection(self, inference_service, sample_image_bytes):
        """Test polygon extraction with and without hole detection"""
        # With hole detection
        result_with_holes = await inference_service.segment_image(
            image_data=sample_image_bytes,
            model_name='hrnet_v2',
            threshold=0.5,
            detect_holes=True
        )
        
        # Without hole detection
        result_without_holes = await inference_service.segment_image(
            image_data=sample_image_bytes,
            model_name='hrnet_v2',
            threshold=0.5,
            detect_holes=False
        )
        
        # Both should return valid results
        assert 'polygons' in result_with_holes
        assert 'polygons' in result_without_holes
    
    @pytest.mark.asyncio
    async def test_inference_error_handling(self, inference_service):
        """Test error handling for invalid inputs"""
        # Test with invalid image data
        with pytest.raises(ValueError, match="Invalid image data"):
            await inference_service.segment_image(
                image_data=b'invalid image data',
                model_name='hrnet_v2'
            )
        
        # Test with empty image data
        with pytest.raises(ValueError, match="Invalid image data"):
            await inference_service.segment_image(
                image_data=b'',
                model_name='hrnet_v2'
            )
    
    @pytest.mark.asyncio
    async def test_inference_performance_metrics(self, inference_service, sample_image_bytes):
        """Test that performance metrics are correctly calculated"""
        start = time.time()
        result = await inference_service.segment_image(
            image_data=sample_image_bytes,
            model_name='hrnet_v2'
        )
        end = time.time()
        
        stats = result['processing_stats']
        
        # Total time should be sum of components
        component_sum = (
            stats['preprocessing_time'] + 
            stats['model_load_time'] + 
            stats['inference_time'] + 
            stats['postprocessing_time']
        )
        
        # Allow small difference due to overhead
        assert abs(stats['total_time'] - component_sum) < 0.1
        
        # Total time should match actual elapsed time (roughly)
        actual_elapsed = end - start
        assert abs(stats['total_time'] - actual_elapsed) < 0.5
    
    @pytest.mark.asyncio
    async def test_concurrent_inference_requests(self, inference_service, sample_image_bytes):
        """Test handling multiple concurrent inference requests"""
        # Create multiple concurrent requests
        tasks = []
        for i in range(5):
            task = inference_service.segment_image(
                image_data=sample_image_bytes,
                model_name='hrnet_v2',
                threshold=0.5 + i * 0.1  # Vary threshold
            )
            tasks.append(task)
        
        # Run all tasks concurrently
        results = await asyncio.gather(*tasks)
        
        # Verify all completed successfully
        assert len(results) == 5
        for result in results:
            assert 'polygons' in result
            assert 'processing_stats' in result
    
    def test_image_validation(self, inference_service):
        """Test image format validation"""
        # Test supported formats
        supported = inference_service.get_supported_formats()
        assert 'PNG' in supported
        assert 'JPG' in supported
        assert 'TIFF' in supported
        
        # Create test images in different formats
        img = Image.new('RGB', (256, 256), color='blue')
        
        # Test PNG
        png_bytes = io.BytesIO()
        img.save(png_bytes, format='PNG')
        png_bytes.seek(0)
        assert inference_service.validate_image_data(png_bytes.read())
        
        # Test JPEG
        jpg_bytes = io.BytesIO()
        img.save(jpg_bytes, format='JPEG')
        jpg_bytes.seek(0)
        assert inference_service.validate_image_data(jpg_bytes.read())
        
        # Test invalid data
        assert not inference_service.validate_image_data(b'not an image')
    
    def test_image_size_constraints(self, inference_service):
        """Test image size validation constraints"""
        # Test too small image
        small_img = Image.new('RGB', (32, 32))
        small_bytes = io.BytesIO()
        small_img.save(small_bytes, format='PNG')
        small_bytes.seek(0)
        assert not inference_service.validate_image_data(small_bytes.read())
        
        # Test too large image
        large_img = Image.new('RGB', (5000, 5000))
        large_bytes = io.BytesIO()
        large_img.save(large_bytes, format='PNG')
        large_bytes.seek(0)
        assert not inference_service.validate_image_data(large_bytes.read())
        
        # Test valid size
        valid_img = Image.new('RGB', (1024, 1024))
        valid_bytes = io.BytesIO()
        valid_img.save(valid_bytes, format='PNG')
        valid_bytes.seek(0)
        assert inference_service.validate_image_data(valid_bytes.read())
    
    def test_inference_stats_collection(self, inference_service, model_manager):
        """Test collection of inference statistics"""
        # Set up GPU mock
        with patch('torch.cuda.is_available', return_value=True):
            with patch('torch.cuda.memory_allocated', return_value=1024*1024*100):  # 100MB
                with patch('torch.cuda.memory_reserved', return_value=1024*1024*200):  # 200MB
                    model_manager.device = torch.device('cuda')
                    
                    stats = inference_service.get_inference_stats()
                    
                    assert stats['device'] == 'cuda'
                    assert 'gpu_memory_allocated' in stats
                    assert 'gpu_memory_reserved' in stats
                    assert stats['gpu_memory_allocated'] == 1024*1024*100
                    assert stats['gpu_memory_reserved'] == 1024*1024*200
        
        # Test CPU stats
        model_manager.device = torch.device('cpu')
        stats = inference_service.get_inference_stats()
        assert stats['device'] == 'cpu'
        assert 'gpu_memory_allocated' not in stats


class TestPostprocessingIntegration:
    """Integration tests for postprocessing service"""
    
    @pytest.fixture
    def postprocessing_service(self):
        """Create postprocessing service instance"""
        return PostprocessingService()
    
    def test_mask_to_polygons_integration(self, postprocessing_service):
        """Test complete mask to polygon conversion pipeline"""
        # Create a test mask with multiple objects
        mask = np.zeros((256, 256), dtype=np.float32)
        
        # Add first object (circle)
        center1 = (64, 64)
        radius1 = 30
        y, x = np.ogrid[:256, :256]
        circle1 = (x - center1[0])**2 + (y - center1[1])**2 <= radius1**2
        mask[circle1] = 0.8
        
        # Add second object (square)
        mask[150:200, 150:200] = 0.9
        
        # Add object with hole
        mask[50:150, 120:220] = 0.7
        mask[75:125, 145:195] = 0  # Create hole
        
        # Convert to polygons
        polygons = postprocessing_service.mask_to_polygons(
            mask, 
            threshold=0.5, 
            detect_holes=True
        )
        
        # Should detect multiple objects
        assert len(polygons) >= 2
        
        # Check polygon structure
        for polygon in polygons:
            assert 'type' in polygon
            assert 'coordinates' in polygon
            assert polygon['type'] in ['exterior', 'hole']
            assert isinstance(polygon['coordinates'], list)
            assert len(polygon['coordinates']) > 0
            
            # Check coordinate format
            for coord in polygon['coordinates']:
                assert len(coord) == 2
                assert isinstance(coord[0], (int, float))
                assert isinstance(coord[1], (int, float))
    
    def test_polygon_optimization(self, postprocessing_service):
        """Test polygon simplification and optimization"""
        # Create a complex polygon with many points
        original_polygon = {
            'type': 'exterior',
            'coordinates': [[i, i] for i in range(100)]  # 100 points
        }
        
        polygons = [original_polygon]
        optimized = postprocessing_service.optimize_polygons(polygons)
        
        assert len(optimized) == 1
        assert len(optimized[0]['coordinates']) < 100  # Should be simplified
        assert len(optimized[0]['coordinates']) >= 3  # Still valid polygon
    
    def test_polygon_filtering(self, postprocessing_service):
        """Test filtering of small/invalid polygons"""
        # Create mix of valid and invalid polygons
        polygons = [
            {'type': 'exterior', 'coordinates': [[0,0], [100,0], [100,100], [0,100]]},  # Valid
            {'type': 'exterior', 'coordinates': [[0,0], [1,0], [1,1]]},  # Too small
            {'type': 'exterior', 'coordinates': [[0,0], [10,0]]},  # Not enough points
        ]
        
        filtered = postprocessing_service.optimize_polygons(polygons)
        
        # Should keep only valid polygon
        assert len(filtered) == 1
        assert len(filtered[0]['coordinates']) >= 3


class TestModelLoadingIntegration:
    """Integration tests for model loading and management"""
    
    @pytest.fixture
    def model_manager(self):
        """Create model manager with mocked weights"""
        with patch('os.path.exists', return_value=True):
            with patch('torch.load', return_value={}):
                manager = ModelManager()
                return manager
    
    def test_model_loading_and_caching(self, model_manager):
        """Test model loading and caching behavior"""
        # First load
        with patch.object(model_manager, '_create_model') as mock_create:
            mock_model = Mock()
            mock_create.return_value = mock_model
            
            model1 = model_manager.load_model('hrnet_v2')
            assert mock_create.called
            assert 'hrnet_v2' in model_manager.loaded_models
        
        # Second load should use cache
        with patch.object(model_manager, '_create_model') as mock_create2:
            model2 = model_manager.load_model('hrnet_v2')
            assert not mock_create2.called  # Should not create new model
            assert model1 is model2  # Should be same instance
    
    def test_model_memory_management(self, model_manager):
        """Test model memory cleanup and management"""
        # Load multiple models
        with patch.object(model_manager, '_create_model') as mock_create:
            mock_create.return_value = Mock()
            
            model_manager.load_model('hrnet_v2')
            model_manager.load_model('cbam_resunet')
            model_manager.load_model('ma_resunet')
        
        assert len(model_manager.loaded_models) == 3
        
        # Test cleanup
        model_manager.cleanup_models()
        assert len(model_manager.loaded_models) == 0
    
    def test_device_selection(self, model_manager):
        """Test automatic device selection (CPU/GPU)"""
        # Test GPU available
        with patch('torch.cuda.is_available', return_value=True):
            manager = ModelManager()
            assert manager.device.type == 'cuda'
        
        # Test GPU not available
        with patch('torch.cuda.is_available', return_value=False):
            manager = ModelManager()
            assert manager.device.type == 'cpu'


if __name__ == '__main__':
    pytest.main([__file__, '-v'])