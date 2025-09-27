# Production Inference Optimization Guide

## Overview

This guide describes the production-optimized inference system for HRNet and CBAM-ResUNet models, designed to maximize throughput while meeting SLA latency requirements.

## Key Features

- **Dynamic Batching**: Automatically groups requests for efficient GPU utilization
- **Mixed Precision (FP16)**: Reduces memory usage and improves throughput
- **Memory Format Optimization**: Uses channels_last format for better performance
- **CuDNN Auto-tuning**: Automatically selects optimal kernels
- **Latency Monitoring**: Real-time P50/P95/P99 tracking
- **Queue Management**: Configurable max queue delay for low latency
- **Automatic Failover**: Falls back to standard inference on errors

## Quick Start

### 1. Run Batch Optimization

Find optimal batch sizes for your GPU:

```bash
make optimize-batch
```

This will:

- Test various batch sizes for both models
- Find the "knee" of the latency/throughput curve
- Save configuration to `backend/segmentation/config/production_batch_config.json`

### 2. Test Production Configuration

Validate the optimized configuration:

```bash
make test-production
```

This runs:

- Single request latency tests
- Burst load tests (simulating traffic spikes)
- Sustained load tests (continuous traffic)
- Generates performance plots and metrics

### 3. View Current Configuration

```bash
make show-batch-config
```

## Configuration

### Production Batch Configuration

The system automatically determines optimal batch sizes based on:

- **SLA Target**: P95 latency < 100ms (configurable)
- **Memory Reserve**: 10% VRAM kept free for stability
- **Queue Delay**: Max 5ms wait time for batching

Example configuration:

```json
{
  "configurations": {
    "hrnet": {
      "optimal_batch_size": 12,
      "p95_latency_ms": 85.3,
      "throughput_imgs_per_sec": 140.5,
      "memory_usage_mb": 435
    },
    "cbam_resunet": {
      "optimal_batch_size": 4,
      "p95_latency_ms": 92.7,
      "throughput_imgs_per_sec": 45.2,
      "memory_usage_mb": 294
    }
  }
}
```

### Optimization Parameters

Edit `scripts/optimize_production_batch.py` to adjust:

```python
optimizer = ProductionBatchOptimizer(
    p95_sla_ms=100.0,           # Target P95 latency
    memory_reserve_percent=10.0,  # VRAM reserve percentage
    use_amp=True,                # Use FP16 mixed precision
    use_channels_last=True,      # Memory layout optimization
    use_cudnn_benchmark=True     # CuDNN auto-tuning
)
```

## Production Service API

### Basic Usage

```python
from services.production_inference import get_production_service

# Get singleton service
service = get_production_service()

# Start background processing
await service.start()

# Perform inference
result = await service.infer(
    image=image_array,        # (H, W, 3) numpy array
    model_name="hrnet",       # or "cbam_resunet"
    threshold=0.5,
    timeout=1.0               # Max wait time
)

# Get performance metrics
metrics = service.get_metrics()
print(f"P95 latency: {metrics['hrnet']['p95_latency_ms']}ms")
print(f"Throughput: {metrics['hrnet']['throughput_imgs_per_sec']} img/s")
```

### Integration with Existing System

The optimized service integrates seamlessly:

```python
from services.inference_service_optimized import get_optimized_service

service = get_optimized_service()

# Automatically uses production optimizations when available
polygons, metadata = await service.segment_image_optimized(
    image_array=image,
    model_name="cbam_resunet",
    threshold=0.5
)

print(f"Inference mode: {metadata['inference_mode']}")  # "production_optimized"
print(f"Batch size used: {metadata['batch_size']}")
print(f"P95 latency: {metadata['p95_latency_ms']}ms")
```

## Performance Tuning

### Finding Optimal Batch Size

The system uses an efficiency score to find the "knee" of the curve:

```
efficiency = throughput / sqrt(batch_size)
```

This balances:

- **Throughput**: Higher batch sizes generally improve throughput
- **Latency**: Larger batches increase per-request latency
- **Queue Time**: Waiting for batch to fill adds latency

### Memory Optimization Tips

1. **Use FP16**: Enables ~2x larger batch sizes

   ```python
   use_amp=True  # Automatic Mixed Precision
   ```

2. **Channels Last Format**: Better memory access patterns

   ```python
   model = model.to(memory_format=torch.channels_last)
   ```

3. **CuDNN Benchmark**: Auto-tunes for your specific GPU

   ```python
   torch.backends.cudnn.benchmark = True
   ```

4. **Memory Reserve**: Keep 10-15% VRAM free
   - Prevents OOM from fragmentation
   - Allows for temporary spikes

### Dynamic Batching Strategy

The queue system implements smart batching:

1. **Time Constraint**: Max wait time (default 5ms)
2. **Size Constraint**: Max batch size from optimization
3. **Priority**: Process oldest requests first

```python
# Adjust in DynamicBatchQueue initialization
queue = DynamicBatchQueue(
    max_batch_size=8,        # From optimization
    max_queue_delay_ms=5.0,  # Max wait time
    max_queue_size=100       # Queue capacity
)
```

## Monitoring

### Real-time Metrics

The service tracks:

- **Latency Percentiles**: P50, P95, P99
- **Throughput**: Images per second
- **Queue Size**: Current backlog
- **GPU Memory**: Current usage
- **Batch Utilization**: Average batch size

### Performance Validation

Run the test suite to validate:

```bash
make test-production
```

This generates:

- Latency distribution plots
- Percentile comparisons
- Time series analysis
- SLA compliance report

### Example Test Results

```
HRNet Summary:
  Single Request: P95=42.3ms ✓
  Burst Load: P95=85.7ms ✓
  Sustained Load: P95=93.2ms ✓

CBAM-ResUNet Summary:
  Single Request: P95=68.5ms ✓
  Burst Load: P95=94.3ms ✓
  Sustained Load: P95=98.7ms ✓
```

## Troubleshooting

### High Latency

1. **Check batch size**: May be too large

   ```bash
   make show-batch-config
   ```

2. **Reduce queue delay**: Lower max_queue_delay_ms

3. **Check GPU utilization**:
   ```bash
   nvidia-smi
   ```

### Low Throughput

1. **Increase batch size**: If P95 allows
2. **Enable optimizations**: Ensure AMP and channels_last are enabled
3. **Check for CPU bottlenecks**: Preprocessing might be slow

### Out of Memory

1. **Reduce batch size**: Lower optimal_batch_size
2. **Increase memory reserve**: Set to 15-20%
3. **Check for memory leaks**: Monitor over time

## Best Practices

1. **Regular Re-optimization**: Run quarterly or after hardware changes
2. **Monitor in Production**: Track P95 and throughput metrics
3. **Load Testing**: Validate under expected traffic patterns
4. **Gradual Rollout**: Test with subset of traffic first
5. **Fallback Strategy**: Keep standard inference as backup

## GPU-Specific Recommendations

### NVIDIA RTX A5000 (24GB)

- HRNet: Batch size 12-16
- CBAM-ResUNet: Batch size 4-6

### NVIDIA V100 (16GB)

- HRNet: Batch size 8-12
- CBAM-ResUNet: Batch size 2-4

### NVIDIA T4 (16GB)

- HRNet: Batch size 6-8
- CBAM-ResUNet: Batch size 2-3

## Advanced Configuration

### Custom SLA Requirements

For different latency targets:

```python
# Strict latency (50ms P95)
optimizer = ProductionBatchOptimizer(
    p95_sla_ms=50.0,
    max_queue_delay_ms=2.0
)

# High throughput (200ms P95)
optimizer = ProductionBatchOptimizer(
    p95_sla_ms=200.0,
    max_queue_delay_ms=10.0
)
```

### Multi-GPU Setup

For multi-GPU inference (future enhancement):

```python
# Distribute models across GPUs
model_configs = {
    "hrnet": {"device": "cuda:0", "batch_size": 16},
    "cbam_resunet": {"device": "cuda:1", "batch_size": 8}
}
```

## Conclusion

The production optimization system provides:

- **2-3x throughput improvement** over single-image inference
- **Consistent P95 latency** under 100ms
- **Automatic adaptation** to load patterns
- **Seamless integration** with existing code

For questions or issues, check the logs in `backend/segmentation/logs/` or run diagnostics with `make test-production`.
