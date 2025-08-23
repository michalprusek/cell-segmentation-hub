"""
Unit tests for InferenceExecutor module

Tests the thread-safe ML model inference execution system with:
- Proper timeout handling
- Resource cleanup and memory management
- Thread safety for concurrent model access
- Comprehensive error handling and recovery
"""

import pytest
import torch
import time
import threading
from unittest.mock import Mock, patch, MagicMock
from concurrent.futures import TimeoutError as FutureTimeoutError
import numpy as np
from PIL import Image

# Import the module to test
from ml.inference_executor import (
    InferenceExecutor,
    InferenceStatus,
    InferenceError,
    InferenceTimeoutError,
    InferenceResourceError,
    ModelStateError,
    InferenceMetrics,
    get_global_executor
)


class TestInferenceExecutor:
    """Test suite for InferenceExecutor class"""

    @pytest.fixture
    def executor(self):
        """Create a test executor instance"""
        return InferenceExecutor(
            max_workers=2,
            default_timeout=5.0,
            memory_limit_gb=2.0
        )

    @pytest.fixture
    def mock_model(self):
        """Create a mock PyTorch model"""
        model = Mock()
        model.eval = Mock(return_value=model)
        model.to = Mock(return_value=model)
        # Mock inference output
        output_tensor = torch.randn(1, 1, 256, 256)
        model.return_value = output_tensor
        return model

    @pytest.fixture
    def sample_input(self):
        """Create sample input tensor"""
        return torch.randn(1, 3, 256, 256)

    def test_initialization(self):
        """Test InferenceExecutor initialization"""
        executor = InferenceExecutor(
            max_workers=4,
            default_timeout=10.0,
            memory_limit_gb=8.0
        )
        
        assert executor.max_workers == 4
        assert executor.default_timeout == 10.0
        assert executor.memory_limit_gb == 8.0
        assert executor._executor is not None
        assert executor._active_inferences == {}
        assert executor._lock is not None

    def test_successful_inference(self, executor, mock_model, sample_input):
        """Test successful model inference execution"""
        result = executor.execute_inference(
            model=mock_model,
            input_tensor=sample_input,
            model_name="test_model",
            timeout=5.0,
            image_size=(256, 256)
        )
        
        assert result is not None
        assert isinstance(result, torch.Tensor)
        mock_model.assert_called_once_with(sample_input)

    def test_inference_timeout(self, executor, sample_input):
        """Test inference timeout handling"""
        import threading
        
        # Create a model that blocks indefinitely
        slow_model = Mock()
        block_event = threading.Event()
        
        def slow_inference(x):
            # Block indefinitely on event that never gets set
            block_event.wait()
            return torch.randn(1, 1, 256, 256)
        
        slow_model.side_effect = slow_inference
        slow_model.eval = Mock(return_value=slow_model)
        slow_model.to = Mock(return_value=slow_model)
        
        with pytest.raises(InferenceTimeoutError) as exc_info:
            executor.execute_inference(
                model=slow_model,
                input_tensor=sample_input,
                model_name="slow_model",
                timeout=0.5,  # Short timeout
                image_size=(256, 256)
            )
        
        error = exc_info.value
        assert error.model_name == "slow_model"
        assert error.timeout == 0.5
        assert error.image_size == (256, 256)

    def test_concurrent_inference(self, executor, mock_model, sample_input):
        """Test concurrent inference requests"""
        results = []
        errors = []
        
        def run_inference(index):
            try:
                result = executor.execute_inference(
                    model=mock_model,
                    input_tensor=sample_input,
                    model_name=f"model_{index}",
                    timeout=5.0,
                    image_size=(256, 256)
                )
                results.append(result)
            except Exception as e:
                errors.append(e)
        
        # Run multiple inferences concurrently
        threads = []
        for i in range(5):
            thread = threading.Thread(target=run_inference, args=(i,))
            threads.append(thread)
            thread.start()
        
        # Wait for all threads to complete
        for thread in threads:
            thread.join()
        
        # Check results
        assert len(errors) == 0
        assert len(results) == 5
        for result in results:
            assert isinstance(result, torch.Tensor)

    def test_memory_monitoring(self, executor, mock_model, sample_input):
        """Test memory monitoring during inference"""
        with patch('ml.inference_executor.psutil.virtual_memory') as mock_memory:
            # Mock memory usage
            mock_memory.return_value.percent = 50.0
            
            metrics = []
            
            def track_metrics(m):
                metrics.append(m)
            
            # Monkey-patch to track metrics
            original_execute = executor._execute_with_monitoring
            
            def execute_with_tracking(*args, **kwargs):
                result = original_execute(*args, **kwargs)
                if hasattr(executor, '_last_metrics'):
                    track_metrics(executor._last_metrics)
                return result
            
            executor._execute_with_monitoring = execute_with_tracking
            
            result = executor.execute_inference(
                model=mock_model,
                input_tensor=sample_input,
                model_name="test_model",
                timeout=5.0,
                image_size=(256, 256)
            )
            
            assert result is not None

    def test_resource_cleanup_after_timeout(self, executor, sample_input):
        """Test resource cleanup after timeout"""
        # Track active inferences before
        initial_count = len(executor._active_inferences)
        
        slow_model = Mock()
        slow_model.side_effect = lambda x: time.sleep(2)
        slow_model.eval = Mock(return_value=slow_model)
        slow_model.to = Mock(return_value=slow_model)
        
        try:
            executor.execute_inference(
                model=slow_model,
                input_tensor=sample_input,
                model_name="slow_model",
                timeout=0.1,
                image_size=(256, 256)
            )
        except InferenceTimeoutError:
            pass
        
        # Wait a bit for cleanup
        time.sleep(0.5)
        
        # Check that active inferences are cleaned up
        assert len(executor._active_inferences) == initial_count

    def test_model_state_error(self, executor, sample_input):
        """Test handling of model state errors"""
        # Create a model that raises an exception
        error_model = Mock()
        error_model.side_effect = RuntimeError("Model error")
        error_model.eval = Mock(return_value=error_model)
        error_model.to = Mock(return_value=error_model)
        
        with pytest.raises(InferenceError) as exc_info:
            executor.execute_inference(
                model=error_model,
                input_tensor=sample_input,
                model_name="error_model",
                timeout=5.0,
                image_size=(256, 256)
            )
        
        assert "Model error" in str(exc_info.value)

    def test_graceful_shutdown(self, executor):
        """Test graceful shutdown of executor"""
        # Start some work
        model = Mock()
        model.return_value = torch.randn(1, 1, 256, 256)
        model.eval = Mock(return_value=model)
        model.to = Mock(return_value=model)
        
        input_tensor = torch.randn(1, 3, 256, 256)
        
        # Run inference
        result = executor.execute_inference(
            model=model,
            input_tensor=input_tensor,
            model_name="test",
            timeout=5.0,
            image_size=(256, 256)
        )
        
        # Shutdown
        executor.shutdown(wait=True)
        
        # Verify executor is shutdown
        assert executor._executor._shutdown

    def test_get_status(self, executor, mock_model, sample_input):
        """Test getting inference status"""
        # Get initial status
        status = executor.get_status()
        assert status["active_inferences"] == 0
        assert status["total_completed"] >= 0
        
        # Run an inference
        result = executor.execute_inference(
            model=mock_model,
            input_tensor=sample_input,
            model_name="test_model",
            timeout=5.0,
            image_size=(256, 256)
        )
        
        # Check updated status
        status = executor.get_status()
        assert status["total_completed"] >= 1

    @patch('ml.inference_executor.torch.cuda.is_available')
    @patch('ml.inference_executor.torch.cuda.empty_cache')
    def test_cuda_cleanup(self, mock_empty_cache, mock_is_available, executor):
        """Test CUDA memory cleanup"""
        mock_is_available.return_value = True
        
        # Trigger cleanup (usually happens after timeout or error)
        executor._cleanup_resources()
        
        # Verify CUDA cache was cleared
        mock_empty_cache.assert_called_once()

    def test_inference_with_different_devices(self, executor):
        """Test inference with different device configurations"""
        model = Mock()
        model.return_value = torch.randn(1, 1, 256, 256)
        model.eval = Mock(return_value=model)
        model.to = Mock(return_value=model)
        
        input_tensor = torch.randn(1, 3, 256, 256)
        
        # Test with CPU
        with patch('ml.inference_executor.torch.cuda.is_available', return_value=False):
            result = executor.execute_inference(
                model=model,
                input_tensor=input_tensor,
                model_name="cpu_model",
                timeout=5.0,
                image_size=(256, 256)
            )
            assert result is not None

    def test_global_executor_singleton(self):
        """Test that get_global_executor returns singleton"""
        executor1 = get_global_executor()
        executor2 = get_global_executor()
        
        assert executor1 is executor2

    def test_inference_metrics_tracking(self, executor, mock_model, sample_input):
        """Test that inference metrics are properly tracked"""
        # Store original method
        original_run = executor._run_inference
        metrics_captured = []
        
        def run_with_metrics_capture(future, *args, **kwargs):
            result = original_run(future, *args, **kwargs)
            # Capture metrics if available
            if hasattr(future, 'inference_id'):
                inference_id = future.inference_id
                if inference_id in executor._active_inferences:
                    metrics_captured.append(executor._active_inferences[inference_id])
            return result
        
        # Patch the method
        executor._run_inference = run_with_metrics_capture
        
        # Run inference
        result = executor.execute_inference(
            model=mock_model,
            input_tensor=sample_input,
            model_name="test_model",
            timeout=5.0,
            image_size=(256, 256)
        )
        
        assert result is not None

    def test_max_workers_limit(self, executor):
        """Test that max_workers limit is respected"""
        # Create a model that takes time
        slow_model = Mock()
        
        def slow_inference(x):
            time.sleep(0.5)
            return torch.randn(1, 1, 256, 256)
        
        slow_model.side_effect = slow_inference
        slow_model.eval = Mock(return_value=slow_model)
        slow_model.to = Mock(return_value=slow_model)
        
        input_tensor = torch.randn(1, 3, 256, 256)
        
        # Submit more tasks than max_workers
        futures = []
        for i in range(5):  # More than max_workers=2
            thread = threading.Thread(
                target=lambda i=i: executor.execute_inference(
                    model=slow_model,
                    input_tensor=input_tensor,
                    model_name=f"model_{i}",
                    timeout=2.0,
                    image_size=(256, 256)
                )
            )
            thread.start()
            futures.append(thread)
        
        # All should complete eventually
        for thread in futures:
            thread.join(timeout=3.0)

    def test_invalid_input_handling(self, executor, mock_model):
        """Test handling of invalid inputs"""
        # Test with None input
        with pytest.raises(InferenceError):
            executor.execute_inference(
                model=mock_model,
                input_tensor=None,
                model_name="test_model",
                timeout=5.0,
                image_size=(256, 256)
            )
        
        # Test with invalid tensor shape
        invalid_tensor = torch.randn(256, 256)  # Wrong dimensions
        with pytest.raises(InferenceError):
            executor.execute_inference(
                model=mock_model,
                input_tensor=invalid_tensor,
                model_name="test_model",
                timeout=5.0,
                image_size=(256, 256)
            )


class TestInferenceIntegration:
    """Integration tests for InferenceExecutor with model_loader"""
    
    @pytest.fixture
    def sample_image(self):
        """Create a sample PIL image"""
        return Image.new('RGB', (256, 256), color='red')
    
    @patch('ml.inference_executor.get_global_executor')
    def test_integration_with_model_loader(self, mock_get_executor, sample_image):
        """Test integration with model_loader.py predict method"""
        # Mock the executor
        mock_executor = Mock()
        mock_get_executor.return_value = mock_executor
        
        # Mock successful inference
        mock_output = torch.randn(1, 1, 256, 256)
        mock_executor.execute_inference.return_value = mock_output
        
        # This would be called from model_loader.predict()
        result = mock_executor.execute_inference(
            model=Mock(),
            input_tensor=torch.randn(1, 3, 256, 256),
            model_name="hrnet",
            timeout=60.0,
            image_size=(256, 256)
        )
        
        assert result is not None
        assert result.shape == (1, 1, 256, 256)
    
    def test_timeout_error_propagation(self):
        """Test that timeout errors are properly propagated"""
        executor = InferenceExecutor(max_workers=1, default_timeout=0.1)
        
        # Create a slow model
        slow_model = Mock()
        slow_model.side_effect = lambda x: time.sleep(1)
        slow_model.eval = Mock(return_value=slow_model)
        slow_model.to = Mock(return_value=slow_model)
        
        with pytest.raises(InferenceTimeoutError) as exc_info:
            executor.execute_inference(
                model=slow_model,
                input_tensor=torch.randn(1, 3, 256, 256),
                model_name="slow_model",
                timeout=0.1,
                image_size=(512, 512)
            )
        
        error = exc_info.value
        assert "slow_model" in str(error)
        assert "0.1" in str(error)
        assert "512" in str(error)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])