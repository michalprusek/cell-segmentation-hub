# GPU Fallback Behavior Documentation

## Overview

The Cell Segmentation Hub includes intelligent GPU fallback mechanisms to ensure reliable processing even under resource constraints. This document explains how the system handles various GPU-related scenarios and automatically recovers from errors.

## Table of Contents

- [Automatic Batch Size Reduction](#automatic-batch-size-reduction)
- [GPU Out of Memory (OOM) Recovery](#gpu-out-of-memory-oom-recovery)
- [Memory Pressure Detection](#memory-pressure-detection)
- [Performance Monitoring](#performance-monitoring)
- [Troubleshooting Guide](#troubleshooting-guide)

## Automatic Batch Size Reduction

### How It Works

The system continuously monitors GPU memory usage and automatically adjusts batch sizes to prevent failures:

1. **Memory Monitoring**: Real-time tracking of GPU memory utilization
2. **Threshold Detection**: When memory usage exceeds 85%, the system triggers protective measures
3. **Dynamic Adjustment**: Batch size is automatically reduced by 50% when memory pressure is detected
4. **Minimum Guarantee**: System always maintains batch size of at least 1 to ensure processing continues

### Example Scenario

```
Initial state: Processing 12 images with HRNet
Memory usage reaches 87%
→ System reduces batch size to 6
→ Processing continues without interruption
→ User sees slightly longer processing time but no failures
```

## GPU Out of Memory (OOM) Recovery

### Automatic Fallback Mechanism

When the GPU runs out of memory during batch processing, the system automatically:

1. **Clears GPU Cache**: Frees up memory by clearing PyTorch's cache
2. **Retries with Smaller Batch**: Attempts processing with batch size 1
3. **Processes Sequentially**: Falls back to single-image processing if needed
4. **Maintains Results**: Ensures all images are processed, even if slower

### User Experience

- **Transparent Recovery**: Users don't see errors, just slightly longer processing times
- **Status Updates**: WebSocket notifications show current processing status
- **Complete Results**: All images are processed successfully, regardless of batch size

### Example Recovery Flow

```
Batch of 8 images → GPU OOM Error
↓
Clear GPU cache
↓
Retry each image individually
↓
All 8 images processed successfully (takes ~8x longer)
```

## Memory Pressure Detection

### Proactive Monitoring

The system proactively monitors for signs of memory pressure:

| Indicator       | Threshold            | Action                      |
| --------------- | -------------------- | --------------------------- |
| Memory Usage    | >85%                 | Reduce batch size by 50%    |
| Recent Failures | 2+ in last 5 batches | Switch to single-image mode |
| Temperature     | >85°C (if available) | Add cooldown delays         |
| Power Draw      | Near limit           | Reduce processing intensity |

### Metrics Tracked

- **Current Memory**: Real-time GPU memory allocation
- **Peak Memory**: Maximum memory used during session
- **Success Rate**: Percentage of successful batch operations
- **Average Throughput**: Images processed per second

## Performance Monitoring

### Available Metrics

Users can monitor GPU performance through the dashboard:

- **Memory Usage**: Current vs. total GPU memory
- **Processing Speed**: Images per second for each model
- **Batch Efficiency**: Actual vs. optimal batch size
- **Error Recovery**: Number of automatic recoveries performed

### Model-Specific Behavior

Different models have different memory requirements and optimal batch sizes:

| Model            | Optimal Batch Size | Fallback Batch Size | Memory Required |
| ---------------- | ------------------ | ------------------- | --------------- |
| HRNet            | 12                 | 6 → 3 → 1           | ~6 GB           |
| ResUNet Small    | 3                  | 2 → 1               | ~9 GB           |
| ResUNet Advanced | 1                  | 1 (no batching)     | ~9 GB           |

**Note**: ResUNet Advanced uses attention mechanisms that prevent batch processing benefits.

## Troubleshooting Guide

### Common Issues and Solutions

#### Issue: "Processing seems slower than usual"

**Likely Cause**: System is operating in fallback mode due to memory pressure

**Solutions**:

1. Check current GPU memory usage in system metrics
2. Reduce the number of concurrent processing jobs
3. Close other GPU-intensive applications
4. Consider using a model with lower memory requirements (HRNet vs ResUNet Advanced)

#### Issue: "Batch size keeps changing"

**Likely Cause**: Dynamic adjustment based on available memory

**This is Normal**: The system optimizes batch size based on:

- Current GPU memory availability
- Size of images being processed
- Other system load

#### Issue: "Getting timeout errors"

**Likely Cause**: Fallback to single-image processing exceeds timeout

**Solutions**:

1. System automatically extends timeouts for batch operations
2. If persistent, admin can increase `ML_INFERENCE_TIMEOUT` environment variable
3. Default timeout scales with batch size (60s × batch_size)

### Performance Tips

1. **Image Size**: Smaller images allow larger batch sizes
   - Original images are automatically resized to 1024×1024 for processing

2. **Model Selection**:
   - **HRNet**: Best for high-throughput scenarios (up to 17.79 imgs/sec)
   - **ResUNet Small**: Balanced accuracy and speed (6.55 imgs/sec)
   - **ResUNet Advanced**: Highest accuracy, processes one at a time (2.34 imgs/sec)

3. **Queue Management**:
   - Process images in groups of similar sizes for better batching
   - Avoid mixing very large and very small images in the same batch

### System Requirements

For optimal performance without fallbacks:

- **GPU Memory**: Minimum 8GB, recommended 16GB+
- **CUDA Version**: 11.0 or higher
- **Driver**: Latest NVIDIA driver for your GPU
- **System RAM**: 16GB minimum for preprocessing

### Monitoring Commands (Admin)

Administrators can monitor GPU status using:

```bash
# Check GPU memory usage
nvidia-smi

# Monitor in real-time
watch -n 1 nvidia-smi

# View application logs
docker logs spheroseg-app-ml-1
```

## WebSocket Notifications

Users receive real-time updates about processing status:

- **Queue Position**: Your place in the processing queue
- **Processing Status**: `queued` → `processing` → `completed`
- **Batch Information**: Current batch size being used
- **Completion Estimates**: Based on current throughput

## Best Practices

1. **Upload Similar Images Together**: Helps maintain consistent batch sizes
2. **Monitor Peak Hours**: Processing may be slower during high-usage periods
3. **Choose Appropriate Models**: Balance accuracy needs with processing speed
4. **Report Issues**: If fallback behavior seems excessive, contact support

## Technical Details (Advanced Users)

### Fallback Triggers

The system initiates fallback behavior when:

```python
# Memory pressure check
if gpu_memory_percent > 85:
    reduce_batch_size()

# OOM exception handling
try:
    process_batch()
except torch.cuda.OutOfMemoryError:
    clear_cache()
    retry_with_single_images()

# Failure rate monitoring
if recent_failure_rate > 0.4:  # 40% failure rate
    switch_to_safe_mode()
```

### Configuration (Environment Variables)

Administrators can tune fallback behavior:

- `GPU_MEMORY_THRESHOLD`: Memory usage threshold (default: 85%)
- `MIN_BATCH_SIZE`: Minimum batch size to maintain (default: 1)
- `MAX_RETRIES`: Maximum retry attempts (default: 3)
- `FALLBACK_DELAY_MS`: Delay between retries (default: 1000ms)

## Summary

The GPU fallback system ensures:

✅ **Reliability**: Processing always completes, even under resource constraints
✅ **Transparency**: Users are informed about processing status
✅ **Efficiency**: System uses maximum possible batch size for current conditions
✅ **Recovery**: Automatic recovery from errors without user intervention

For additional support or to report issues with GPU processing, please contact the system administrator or file an issue in the project repository.
