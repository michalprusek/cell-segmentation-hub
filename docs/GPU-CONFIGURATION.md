# GPU Configuration for SpheroSeg ML Services

## Overview

The SpheroSeg application includes GPU support for accelerated ML inference using NVIDIA GPUs. When properly configured, GPU acceleration can improve segmentation performance by 10-20x compared to CPU-only processing.

## Hardware Requirements

- **GPU**: NVIDIA GPU with CUDA Compute Capability 6.0 or higher
- **Driver**: NVIDIA Driver 470.xx or newer
- **Memory**: At least 4GB GPU memory recommended

### Current Server Configuration

- **GPU**: NVIDIA RTX A5000 (24GB VRAM)
- **Driver**: Version 570.86.15
- **CUDA**: 12.1 compatible

## Software Requirements

1. **NVIDIA Container Toolkit** (nvidia-docker)
2. **Docker Compose** v2.0 or newer
3. **PyTorch** with CUDA support (included in container)

## Configuration Steps

### 1. Enable GPU in Docker Compose

The Docker Compose files have been configured with GPU support:

```yaml
services:
  ml-service:
    runtime: nvidia # Use NVIDIA runtime
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - CUDA_VISIBLE_DEVICES=0
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

### 2. Using the Enable Script

Run the provided script to check GPU availability and create override files:

```bash
./scripts/enable-gpu-support.sh
```

### 3. Starting Services with GPU

For development environment:

```bash
docker compose up -d ml-service
```

For production (green) environment:

```bash
docker compose -f docker-compose.green.yml up -d green-ml
```

### 4. Verify GPU Detection

Check if GPU is detected in the container:

```bash
# For development
docker exec spheroseg-ml python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"

# For production
docker exec green-ml python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

## Performance Comparison

| Model            | CPU Time | GPU Time | Speedup | Optimal Batch Size |
| ---------------- | -------- | -------- | ------- | ------------------ |
| HRNet            | 3.1s     | 0.064s   | 48.4x   | 12                 |
| ResUNet Small    | 6.9s     | 0.088s   | 78.4x   | 3                  |
| ResUNet Advanced | 18.1s    | 0.43s    | 42.1x   | 1                  |

_Note: Actual performance depends on image size and GPU model_

## Troubleshooting

### Driver/Library Version Mismatch

If you encounter:

```
nvidia-container-cli: initialization error: nvml error: driver/library version mismatch
```

Solutions:

1. Restart the Docker service: `sudo systemctl restart docker`
2. Update NVIDIA drivers to match CUDA version in container
3. Use a different PyTorch image with matching CUDA version

### GPU Not Detected

If `torch.cuda.is_available()` returns False:

1. Check Docker runtime: `docker info | grep nvidia`
2. Verify GPU visibility: `nvidia-smi`
3. Check container logs: `docker logs [container-name]`
4. Ensure `runtime: nvidia` is set in docker-compose.yml

### Memory Issues

If you get CUDA out of memory errors:

1. Reduce batch size in model configuration
2. Increase GPU memory limits in Docker Compose
3. Use a smaller model (e.g., ResUNet Small instead of Advanced)

## Alternative: CPU-Only Mode

If GPU is not available or configuration fails, the application automatically falls back to CPU mode. This is slower but ensures the application remains functional.

To explicitly disable GPU:

```yaml
environment:
  - CUDA_VISIBLE_DEVICES=-1 # Disable GPU
```

## Monitoring GPU Usage

Monitor GPU utilization during segmentation:

```bash
# Real-time GPU monitoring
nvidia-smi -l 1

# Check GPU memory usage
nvidia-smi --query-gpu=memory.used,memory.total --format=csv

# Monitor specific container
docker stats green-ml
```

## Future Improvements

1. **Multi-GPU Support**: Enable parallel processing across multiple GPUs
2. **Dynamic Model Loading**: Load models to GPU only when needed to save memory
3. **Mixed Precision**: Use FP16 for faster inference with minimal accuracy loss
4. **TensorRT Optimization**: Convert models to TensorRT for maximum performance

## References

- [NVIDIA Container Toolkit Documentation](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
- [PyTorch CUDA Documentation](https://pytorch.org/docs/stable/cuda.html)
- [Docker GPU Support](https://docs.docker.com/compose/gpu-support/)
