# GPU Support Status - SpheroSeg Application

## Current Status (August 27, 2025)

### ⚠️ GPU Not Currently Active

Despite having a powerful NVIDIA RTX A5000 (24GB VRAM) available on the server, the ML service is currently running on CPU due to a driver/library compatibility issue.

## Hardware Available

- **GPU**: NVIDIA RTX A5000
  - Architecture: GA102GL (Ampere)
  - Memory: 24GB GDDR6
  - CUDA Cores: 8192
  - Compute Capability: 8.6
- **Server Specs**:
  - CPU: Intel Xeon E-2388G @ 3.20GHz (4 cores)
  - RAM: 40GB
  - OS: Ubuntu 24.04

## Software Environment

- **Host System**:
  - NVIDIA Driver: 570.86.15 (Very recent version)
  - CUDA Toolkit: 12.8
  - nvidia-container-toolkit: Installed
- **Container Environment**:
  - PyTorch: 2.3.1+cu121 (CUDA 12.1 support)
  - Python: 3.10
  - Current device: **CPU** (not GPU)

## Issue Description

### Driver/Library Version Mismatch

When attempting to use nvidia runtime:

```
nvidia-container-cli: initialization error: nvml error: driver/library version mismatch
```

**Root Cause**: The host has NVIDIA driver 570.86.15 with CUDA 12.8, while the container expects CUDA 12.1. The NVML library version (570.133.20) doesn't match the loaded kernel module version.

## Current Performance (CPU-only)

| Model            | Current Time (CPU) | Expected Time (GPU) | Potential Speedup |
| ---------------- | ------------------ | ------------------- | ----------------- |
| HRNet            | ~3.1 seconds       | ~0.2 seconds        | **15x faster**    |
| ResUNet Small    | ~6.9 seconds       | ~0.4 seconds        | **17x faster**    |
| ResUNet Advanced | ~18.1 seconds      | ~1.2 seconds        | **15x faster**    |

## Configuration Implemented

All Docker Compose files have been updated with GPU support configuration:

### docker-compose.green.yml

```yaml
green-ml:
  runtime: nvidia # Currently disabled due to mismatch
  environment:
    - NVIDIA_VISIBLE_DEVICES=all
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

### Files Updated:

- ✅ `docker-compose.yml` - Development environment
- ✅ `docker-compose.green.yml` - Production environment
- ✅ `docker-compose.staging.yml` - Staging environment
- ✅ `docker/ml-gpu.Dockerfile` - GPU-optimized Dockerfile created
- ✅ `scripts/enable-gpu-support.sh` - Helper script for GPU activation

## Resolution Options

### Option 1: Fix Driver Compatibility (Recommended)

1. Downgrade NVIDIA driver to 525.xx or 535.xx series
2. OR upgrade container PyTorch to match CUDA 12.8
3. Restart all services

### Option 2: Use Alternative Runtime

1. Use nvidia-container-runtime instead of nvidia runtime
2. Manually map CUDA libraries from host
3. More complex but avoids driver changes

### Option 3: Build Custom Image

1. Create Docker image with exact CUDA version matching host
2. Compile PyTorch from source if needed
3. Most control but requires maintenance

## How to Activate GPU (When Fixed)

1. **Resolve driver mismatch** (see options above)

2. **Enable nvidia runtime in docker-compose.green.yml**:

   ```yaml
   green-ml:
     runtime: nvidia
   ```

3. **Restart ML service**:

   ```bash
   docker compose -f docker-compose.green.yml up -d green-ml
   ```

4. **Verify GPU detection**:
   ```bash
   docker exec green-ml python -c "import torch; print(torch.cuda.is_available())"
   ```

## Impact on Users

- **Current**: Segmentation takes 3-18 seconds depending on model
- **With GPU**: Would take 0.2-1.2 seconds (10-20x improvement)
- **User Experience**: Currently acceptable but could be significantly better
- **Scalability**: CPU limits concurrent users; GPU would allow 10x more

## Recommendations

1. **Short-term**: Application works on CPU, acceptable for current load
2. **Medium-term**: Resolve driver compatibility for 15x performance gain
3. **Long-term**: Consider multi-GPU setup for even better scalability

## Files for Reference

- Configuration: `/docker-compose.green.yml`
- GPU Dockerfile: `/docker/ml-gpu.Dockerfile`
- Enable script: `/scripts/enable-gpu-support.sh`
- This document: `/docs/GPU-STATUS.md`
- Full guide: `/docs/GPU-CONFIGURATION.md`

---

_Last updated: August 27, 2025_
_Status: GPU hardware available but not active due to driver compatibility issue_
