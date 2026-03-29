"""
Unit tests for ML model architectures (HRNet, CBAM-ResUNet, UNet, SpermModel).

All tests use small tensors (64x64 or 128x128) to keep execution fast.
No model weights are loaded — only forward passes with randomly-initialized
parameters are exercised.
"""
import sys
import os

import pytest
import torch
import torch.nn as nn

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../")))

from models.hrnet import HRNetV2, BasicBlock, Bottleneck
from models.cbam_resunet import ResUNetCBAM, ChannelAttention, SpatialAttention, ResidualBlockCBAM
from models.unet import UNet
from models.sperm import SpermModel


# ---------------------------------------------------------------------------
# HRNet
# ---------------------------------------------------------------------------

@pytest.mark.model
class TestHRNetV2:
    """Forward-pass shape tests for HRNetV2."""

    def test_hrnet_forward_output_shape(self):
        """Input (1, 3, 256, 256) should produce output (1, 1, 256, 256)."""
        model = HRNetV2(n_class=1)
        model.eval()
        x = torch.randn(1, 3, 256, 256)
        with torch.no_grad():
            out = model(x)
        assert out.shape == (1, 1, 256, 256), (
            f"Expected (1, 1, 256, 256), got {out.shape}"
        )

    def test_hrnet_forward_batch_size(self):
        """Batch size 2 should be preserved in the output."""
        model = HRNetV2(n_class=1)
        model.eval()
        x = torch.randn(2, 3, 256, 256)
        with torch.no_grad():
            out = model(x)
        assert out.shape[0] == 2, f"Expected batch=2, got {out.shape[0]}"
        assert out.shape == (2, 1, 256, 256), f"Unexpected shape {out.shape}"

    def test_hrnet_multi_class(self):
        """n_class=3 should produce 3 output channels."""
        model = HRNetV2(n_class=3)
        model.eval()
        x = torch.randn(1, 3, 256, 256)
        with torch.no_grad():
            out = model(x)
        assert out.shape == (1, 3, 256, 256), (
            f"Expected 3 output channels, got {out.shape}"
        )


# ---------------------------------------------------------------------------
# CBAM-ResUNet building blocks + full model
# ---------------------------------------------------------------------------

@pytest.mark.model
class TestCBAMResUNet:
    """Tests for CBAM attention modules and full ResUNetCBAM."""

    def test_cbam_resunet_forward_shape(self):
        """Default ResUNetCBAM should preserve spatial dimensions."""
        model = ResUNetCBAM(in_channels=3, out_channels=1)
        model.eval()
        x = torch.randn(1, 3, 128, 128)
        with torch.no_grad():
            out = model(x)
        assert out.shape == (1, 1, 128, 128), (
            f"Expected (1, 1, 128, 128), got {out.shape}"
        )

    def test_cbam_channel_attention(self):
        """ChannelAttention should preserve tensor shape."""
        attn = ChannelAttention(in_channels=64)
        attn.eval()
        x = torch.randn(2, 64, 32, 32)
        with torch.no_grad():
            out = attn(x)
        assert out.shape == x.shape, (
            f"ChannelAttention changed shape: {x.shape} -> {out.shape}"
        )

    def test_cbam_spatial_attention(self):
        """SpatialAttention should preserve tensor shape."""
        attn = SpatialAttention(kernel_size=7)
        attn.eval()
        x = torch.randn(2, 32, 64, 64)
        with torch.no_grad():
            out = attn(x)
        assert out.shape == x.shape, (
            f"SpatialAttention changed shape: {x.shape} -> {out.shape}"
        )

    def test_cbam_residual_block_channel_mismatch(self):
        """ResidualBlockCBAM with in_channels != out_channels should use projection."""
        block = ResidualBlockCBAM(in_channels=32, out_channels=64)
        block.eval()
        # adjust_channels should have been created
        assert block.adjust_channels is not None, (
            "Projection (adjust_channels) should be created when channel counts differ"
        )
        x = torch.randn(1, 32, 16, 16)
        with torch.no_grad():
            out = block(x)
        assert out.shape == (1, 64, 16, 16), (
            f"Expected (1, 64, 16, 16), got {out.shape}"
        )

    def test_cbam_residual_block_same_channels(self):
        """ResidualBlockCBAM with equal channels should NOT create a projection."""
        block = ResidualBlockCBAM(in_channels=64, out_channels=64)
        assert block.adjust_channels is None, (
            "Projection should be None when in_channels == out_channels"
        )


# ---------------------------------------------------------------------------
# UNet
# ---------------------------------------------------------------------------

@pytest.mark.model
class TestUNet:
    """Forward-pass shape tests for the standard UNet."""

    def test_unet_forward_shape(self):
        """Default UNet(in=3, out=1) should preserve spatial dimensions."""
        model = UNet(in_channels=3, out_channels=1)
        model.eval()
        x = torch.randn(1, 3, 128, 128)
        with torch.no_grad():
            out = model(x)
        assert out.shape == (1, 1, 128, 128), (
            f"Expected (1, 1, 128, 128), got {out.shape}"
        )

    def test_unet_custom_features(self):
        """UNet with a custom (shorter) feature list should still work."""
        model = UNet(in_channels=3, out_channels=1, features=[16, 32, 64])
        model.eval()
        x = torch.randn(1, 3, 64, 64)
        with torch.no_grad():
            out = model(x)
        assert out.shape == (1, 1, 64, 64), (
            f"Expected (1, 1, 64, 64), got {out.shape}"
        )

    def test_unet_non_power_of_two_input(self):
        """UNet should handle non-power-of-two input sizes (200x200)."""
        model = UNet(in_channels=3, out_channels=1, features=[16, 32, 64])
        model.eval()
        x = torch.randn(1, 3, 200, 200)
        with torch.no_grad():
            out = model(x)
        assert out.shape == (1, 1, 200, 200), (
            f"Expected (1, 1, 200, 200), got {out.shape}"
        )


# ---------------------------------------------------------------------------
# SpermModel wrapper
# ---------------------------------------------------------------------------

@pytest.mark.model
class TestSpermModel:
    """Tests for the SpermModel wrapper (no weights required)."""

    def test_sperm_model_init(self):
        """SpermModel should initialize with _model=None and _device=None."""
        m = SpermModel()
        assert m._model is None, "Expected _model to be None before load_weights()"
        assert m._device is None, "Expected _device to be None before load_weights()"

    def test_sperm_model_predict_without_load_raises(self):
        """predict() before load_weights() should raise RuntimeError."""
        m = SpermModel()
        import numpy as np
        dummy_image = np.zeros((64, 64, 3), dtype=np.uint8)
        with pytest.raises(RuntimeError, match="not loaded"):
            m.predict(dummy_image)

    def test_sperm_model_eval_is_noop(self):
        """eval() should be a no-op that returns self (PyTorch-compatible stub)."""
        m = SpermModel()
        result = m.eval()
        assert result is m, "eval() should return self"

    def test_sperm_model_to_is_noop(self):
        """to(device) should be a no-op that returns self (PyTorch-compatible stub)."""
        m = SpermModel()
        result = m.to(torch.device("cpu"))
        assert result is m, "to() should return self"

    def test_sperm_model_parameters_empty_before_load(self):
        """parameters() should yield nothing when model is not loaded."""
        m = SpermModel()
        params = list(m.parameters())
        assert params == [], "Expected no parameters before load_weights()"
