# GPU Memory Optimization Analysis for 8 Concurrent Users

## RTX A5000 24GB VRAM Capacity Study

### Current State Analysis (September 2025)

**Hardware Configuration:**

- GPU: NVIDIA RTX A5000 (24GB VRAM total, 23.56GB usable)
- Current container memory limit: 8GB (Docker limit)
- Current ML service workers: 2 (configurable via ML_INFERENCE_WORKERS)
- Model locking: Per-model RLock prevents true parallelism

**Current Memory Usage Patterns:**

```
Model Memory Requirements (per model instance):
- HRNet: ~435MB peak (batch 8), ~267MB base
- CBAM-ResUNet: ~355MB peak (batch 4), ~249MB base
- UNet-SpheroHQ: ~3.1GB peak (batch 4), estimated 2.8GB base

Total if all models loaded: ~3.8GB base + batch overhead
Available for optimization: ~20GB unused capacity
```

### 1. Memory Optimization Techniques

#### A. Mixed Precision (FP16) Implementation

**Current**: All models run in FP32 precision
**Optimization**: Convert to FP16 for 40-50% memory reduction

```python
# Implementation Strategy:
# 1. Model conversion to half precision
model = model.half()  # Convert to FP16

# 2. Input tensor conversion
input_tensor = input_tensor.half()

# 3. Automatic Mixed Precision (AMP) for stability
from torch.cuda.amp import autocast, GradScaler
with autocast():
    output = model(input_tensor)
```

**Expected Memory Savings:**

- HRNet: 435MB → 220MB (49% reduction)
- CBAM-ResUNet: 355MB → 180MB (49% reduction)
- UNet-SpheroHQ: 3.1GB → 1.6GB (48% reduction)

**Total Memory Requirement (FP16):** ~2.0GB vs current 3.8GB

#### B. Model Quantization Potential

**INT8 Quantization:** Additional 50% memory reduction but requires:

- Model retraining/calibration
- Accuracy validation (potential 2-5% degradation)
- Complex implementation

**Recommendation:** Start with FP16, evaluate INT8 later

#### C. Dynamic Model Loading Strategy

**Current:** All 3 models pre-loaded at startup
**Optimized:** Load models on-demand based on request patterns

```python
class DynamicModelManager:
    def __init__(self, max_models_in_memory=2):
        self.max_models_in_memory = max_models_in_memory
        self.model_cache = {}
        self.usage_tracker = {}

    def get_model(self, model_name):
        if len(self.model_cache) >= self.max_models_in_memory:
            self._evict_least_used()
        return self._load_model(model_name)
```

### 2. Advanced Parallel Processing Architecture

#### A. CUDA Streams Implementation

**Current:** Sequential model execution with threading
**Optimized:** True GPU parallelism using CUDA streams

```python
import torch.cuda

class CUDAStreamManager:
    def __init__(self, num_streams=4):
        self.streams = [torch.cuda.Stream() for _ in range(num_streams)]
        self.stream_index = 0

    def get_next_stream(self):
        stream = self.streams[self.stream_index]
        self.stream_index = (self.stream_index + 1) % len(self.streams)
        return stream

    async def parallel_inference(self, models_inputs):
        results = {}
        for i, (model, input_tensor) in enumerate(models_inputs):
            stream = self.streams[i % len(self.streams)]
            with torch.cuda.stream(stream):
                results[i] = model(input_tensor)

        # Synchronize all streams
        for stream in self.streams:
            stream.synchronize()
        return results
```

#### B. Remove Model-Level Locking

**Current Issue:** Lines 134-151 in inference_executor.py create per-model locks
**Solution:** Remove model locks, use request-level synchronization

```python
# REMOVE from InferenceExecutor.__init__:
# self._model_locks: Dict[str, threading.RLock] = {}

# REMOVE from get_model_lock method:
# return self._model_locks[model_name]

# MODIFY execute_inference to remove model_lock usage:
def execute_inference(self, model, input_tensor, model_name, ...):
    # Remove: model_lock = self.get_model_lock(model_name)
    # Remove: with model_lock: context
    # Direct inference with CUDA stream isolation
```

### 3. Optimal Batch Size Recalculation for 8 Users

#### Memory-Aware Dynamic Batching

**Strategy:** Calculate optimal batch sizes based on available GPU memory and concurrent users

```python
class MemoryAwareBatchSizer:
    def __init__(self, total_gpu_memory_gb=24, reserved_memory_gb=2):
        self.available_memory = (total_gpu_memory_gb - reserved_memory_gb) * 1024**3

    def get_optimal_batch_size(self, model_name, concurrent_users=8):
        base_memory = self.get_base_model_memory(model_name)
        available_per_user = self.available_memory / concurrent_users

        if model_name == "hrnet":
            # FP16: ~220MB peak, can handle batch 6-8 per user
            return min(6, int(available_per_user / (220 * 1024**2)))
        elif model_name == "cbam_resunet":
            # FP16: ~180MB peak, can handle batch 8-10 per user
            return min(8, int(available_per_user / (180 * 1024**2)))
        elif model_name == "unet_spherohq":
            # FP16: ~1.6GB peak, batch 1-2 per user
            return min(2, int(available_per_user / (1.6 * 1024**3)))
```

#### Calculated Optimal Batch Sizes (8 concurrent users, FP16):

**Available memory per user:** (24GB - 2GB) / 8 = 2.75GB per user

| Model         | Current Batch | FP16 Optimized Batch | Memory per User | Throughput Impact                  |
| ------------- | ------------- | -------------------- | --------------- | ---------------------------------- |
| HRNet         | 8             | 6                    | ~1.3GB          | 15% reduction, but 8x concurrency  |
| CBAM-ResUNet  | 2             | 4                    | ~720MB          | 2x batch increase + 8x concurrency |
| UNet-SpheroHQ | 4             | 1                    | ~1.6GB          | 75% reduction, but 8x concurrency  |

### 4. Performance vs Memory Trade-offs

#### Throughput Analysis (8 Concurrent Users)

**Current Sequential Processing:**

- 1 user at a time, queue-based
- HRNet: 17.3 img/s total system throughput
- CBAM: 12.5 img/s total system throughput
- UNet: 1.02 img/s total system throughput

**Optimized Parallel Processing (8 users, FP16, reduced batches):**

- HRNet: 6 users × (17.3 × 0.85) = ~88 img/s total (5x improvement)
- CBAM: 4 users × (12.5 × 2.0) = ~100 img/s total (8x improvement)
- UNet: 1 user × 1.02 = ~8 img/s total (8x improvement through concurrency)

#### Memory Overhead Analysis

**8 Worker Threads Overhead:**

- Python thread overhead: ~8MB per thread = 64MB total
- CUDA context overhead: ~500MB per stream = 2GB total
- Model instance sharing: No additional overhead (shared GPU memory)

**Total Memory Allocation (8 users, FP16):**

```
Base models (shared): 2.0GB
Worker thread overhead: 0.064GB
CUDA streams: 2.0GB
Active batch processing: 8 × 2.75GB = 22GB
Total: ~26GB (exceeds 24GB - need optimization)
```

**Refined Strategy - Model Partitioning:**

- 4 users: HRNet (1.3GB each = 5.2GB)
- 2 users: CBAM-ResUNet (0.7GB each = 1.4GB)
- 2 users: UNet-SpheroHQ (1.6GB each = 3.2GB)
- Overhead: 2.1GB
- **Total: 11.9GB** ✅ Fits in 24GB with 50% headroom

### 5. Implementation Complexity Assessment

#### Low Risk Changes (Immediate Implementation):

1. **Increase worker count**: `ML_INFERENCE_WORKERS=8`
2. **Remove model locks**: Modify inference_executor.py lines 134-151, 221-225
3. **Environment configuration**: Add GPU memory management flags

#### Medium Risk Changes (Staged Implementation):

1. **FP16 Conversion**: Requires model validation and accuracy testing
2. **CUDA Streams**: Complex but well-tested PyTorch feature
3. **Dynamic batch sizing**: Requires queue management refactoring

#### High Risk Changes (Future Implementation):

1. **Model quantization**: Requires extensive validation
2. **Dynamic model loading**: Complex cache management
3. **Memory pooling**: Advanced GPU memory management

### 6. Recommended Implementation Plan

#### Phase 1: Parallel Infrastructure (Week 1)

```python
# File: backend/segmentation/ml/inference_executor.py
class InferenceExecutor:
    def __init__(self, max_workers: int = 8):  # Increase from 2
        # Remove self._model_locks
        self.cuda_streams = [torch.cuda.Stream() for _ in range(max_workers)]

    def execute_inference(self, model, input_tensor, model_name, stream_id=0):
        # Remove model locking
        # Add CUDA stream isolation
        with torch.cuda.stream(self.cuda_streams[stream_id]):
            with torch.no_grad():
                return model(input_tensor)
```

#### Phase 2: Mixed Precision (Week 2)

```python
# Add to model loading
def load_model_fp16(self, model_name):
    model = self._load_model_base(model_name)
    model = model.half()  # Convert to FP16
    return model

# Modify inference pipeline
def execute_inference_fp16(self, model, input_tensor, ...):
    input_tensor = input_tensor.half()
    with torch.cuda.amp.autocast():
        output = model(input_tensor)
    return output.float()  # Convert back to FP32 for compatibility
```

#### Phase 3: Dynamic Memory Management (Week 3)

```python
# Environment configuration
ML_INFERENCE_WORKERS=8
ML_GPU_MEMORY_LIMIT_GB=22
ML_ENABLE_FP16=true
ML_CUDA_STREAMS=8
ML_DYNAMIC_BATCHING=true
```

### 7. Risk Mitigation Strategies

#### Memory Exhaustion Prevention:

1. **GPU Memory Monitoring**: Real-time VRAM usage tracking
2. **Circuit Breaker**: Reject requests when memory > 90% utilized
3. **Graceful Degradation**: Fall back to smaller batch sizes
4. **Emergency Cleanup**: Force garbage collection on OOM

#### Error Handling Enhancement:

```python
class GPUMemoryManager:
    def __init__(self):
        self.memory_threshold = 0.9  # 90% of available memory

    def check_memory_availability(self, required_memory_gb):
        current_usage = torch.cuda.memory_allocated() / 1024**3
        if current_usage + required_memory_gb > self.memory_threshold * 24:
            raise InferenceResourceError("GPU memory exhausted")

    def emergency_cleanup(self):
        torch.cuda.empty_cache()
        gc.collect()
```

### 8. Expected Performance Characteristics

#### Latency Impact:

- **Individual request latency**: Slight increase (5-10%) due to smaller batches
- **Queue wait time**: Dramatic reduction (8x more concurrent processing)
- **Total user experience**: Significant improvement despite higher individual latency

#### Throughput Gains:

- **HRNet**: 17→88 img/s (5x improvement)
- **CBAM**: 12.5→100 img/s (8x improvement)
- **UNet**: 1→8 img/s (8x improvement)

#### GPU Utilization:

- **Current**: 15-20% VRAM utilization
- **Optimized**: 80-90% VRAM utilization
- **Concurrency**: 8 simultaneous inference streams

### 9. Monitoring and Observability

#### Key Metrics to Track:

```python
# GPU Memory Metrics
torch.cuda.memory_allocated() / 1024**3  # Current allocation
torch.cuda.memory_reserved() / 1024**3   # Reserved memory
torch.cuda.max_memory_allocated() / 1024**3  # Peak usage

# Performance Metrics
concurrent_inferences = len(active_sessions)
avg_queue_wait_time = sum(wait_times) / len(wait_times)
memory_utilization_percent = current_usage / total_memory
```

#### Health Checks:

1. **Memory pressure alerts** when usage > 85%
2. **Performance degradation** when latency > 2x baseline
3. **Failed inference rate** tracking for FP16 accuracy validation

### 10. Conclusion

**Feasibility**: ✅ **HIGHLY FEASIBLE** with 24GB RTX A5000

**Memory Allocation Summary (8 concurrent users):**

- **Total Available**: 24GB
- **Required for 8 users**: ~12GB (FP16 + optimized batching)
- **Safety Margin**: 50% headroom for spikes and system overhead

**Implementation Effort:**

- **Phase 1** (Parallel): 2-3 days development, low risk
- **Phase 2** (FP16): 1 week development + testing, medium risk
- **Phase 3** (Dynamic): 1 week development, medium risk

**ROI**: Exceptional - 5-8x throughput improvement for moderate development effort

**Recommendation**: Proceed with phased implementation starting with parallel infrastructure, then FP16 optimization.
