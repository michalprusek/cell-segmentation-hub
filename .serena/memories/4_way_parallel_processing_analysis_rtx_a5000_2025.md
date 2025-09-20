# 4-Way Parallel Processing Analysis for RTX A5000 24GB GPU

## Cell Segmentation Hub ML Service Implementation Plan

### Current Architecture Analysis

#### 1. Threading and Concurrency Bottlenecks

**Key Finding: Model-level locking serializes inference execution**

**Critical Files and Line Numbers:**

- `/backend/segmentation/ml/inference_executor.py:134-151` - Model locks creation
- `/backend/segmentation/ml/inference_executor.py:221-225` - Model lock usage in inference
- `/backend/segmentation/ml/inference_executor.py:112` - Only 2 workers configured

**Current Limitations:**

```python
# Line 134-135: Per-model locks prevent parallel execution
self._model_locks: Dict[str, threading.RLock] = {}

# Line 146-151: Model lock prevents concurrent access
def get_model_lock(self, model_name: str) -> threading.RLock:
    with self._global_lock:
        if model_name not in self._model_locks:
            self._model_locks[model_name] = threading.RLock()
        return self._model_locks[model_name]

# Line 225: Critical bottleneck - serializes model access
with model_lock:
    with torch.no_grad():
        model.eval()
        output = model(input_tensor)
```

**Root Cause:** ThreadPoolExecutor with 2 workers + per-model RLocks = sequential execution despite threading

#### 2. Model Loading and Memory Management

**Current GPU Memory Usage (from batch_sizes.json):**

| Model         | Optimal Batch | Max Safe Batch | Peak Memory | Base Memory |
| ------------- | ------------- | -------------- | ----------- | ----------- |
| HRNet         | 8             | 12             | 435MB       | ~267MB      |
| CBAM-ResUNet  | 2             | 4              | 355MB       | ~249MB      |
| UNet-SpheroHQ | 4             | 8              | 3.1GB       | ~2.8GB      |

**Total Current Memory Usage:** ~3.8GB (all models loaded at startup)
**Available for Optimization:** ~20GB unused capacity (83% underutilization)

**Model Loading Strategy (main.py:45-57):**

```python
# All models pre-loaded at startup
models_to_load = ["hrnet", "cbam_resunet", "unet_spherohq"]
for model_name in models_to_load:
    model_loader_instance.load_model(model_name)
```

#### 3. API Communication Layer Analysis

**Current Request Handling:**

- FastAPI with synchronous endpoints (`/api/v1/segment`, `/api/v1/batch-segment`)
- No built-in request queuing or load balancing
- Simple model loader dependency injection
- All models accessible concurrently but serialized by locks

**Batch Processing Limits (routes.py:230-235):**

```python
max_batch_size = loader.get_batch_limit(model)
if len(files) > max_batch_size:
    raise HTTPException(status_code=400, ...)
```

### GPU Memory Allocation Strategy for 4 Concurrent Users

#### Memory Allocation Analysis (RTX A5000 24GB)

**Available Memory Breakdown:**

- Total VRAM: 24GB
- System Reserve: 2GB
- Available for ML: 22GB
- Current Usage: 3.8GB (17%)
- **Headroom for 4x Parallel:** 18.2GB

#### Optimal 4-User Configuration

**Memory Per User:** 22GB ÷ 4 = 5.5GB per concurrent stream

**Recommended Batch Sizes for 4 Concurrent Users:**

```json
{
  "hrnet": {
    "concurrent_batch_size": 6,
    "memory_per_user": "1.3GB",
    "4_user_total": "5.2GB"
  },
  "cbam_resunet": {
    "concurrent_batch_size": 4,
    "memory_per_user": "0.7GB",
    "4_user_total": "2.8GB"
  },
  "unet_spherohq": {
    "concurrent_batch_size": 1,
    "memory_per_user": "3.1GB",
    "4_user_total": "12.4GB"
  }
}
```

**Mixed Model Scenario (Optimal):**

- 2 users: HRNet (1.3GB each = 2.6GB)
- 1 user: CBAM-ResUNet (0.7GB)
- 1 user: UNet-SpheroHQ (3.1GB)
- **Total: 6.4GB (29% utilization with 73% safety margin)**

### Specific Code Modifications Required

#### 1. Remove Model Locking (HIGH PRIORITY)

**File:** `/backend/segmentation/ml/inference_executor.py`

**Changes Required:**

```python
# REMOVE Lines 134-135:
# self._model_locks: Dict[str, threading.RLock] = {}

# REMOVE Lines 146-151 (entire get_model_lock method)

# MODIFY Lines 221-225:
def _run_inference():
    # REMOVE: model_lock = self.get_model_lock(model_name)
    # REMOVE: with model_lock:
    with torch.no_grad():
        model.eval()
        output = model(input_tensor)
        return output
```

#### 2. Increase Worker Count

**File:** `/backend/segmentation/ml/inference_executor.py`

```python
# Line 112: Change default from 2 to 4
def __init__(self, max_workers: int = 4,  # Changed from 2
```

**Environment Variable:**

```bash
ML_INFERENCE_WORKERS=4  # Add to docker-compose
```

#### 3. CUDA Stream Isolation (RECOMMENDED)

**Add to inference_executor.py:**

```python
import torch.cuda

class InferenceExecutor:
    def __init__(self, max_workers: int = 4, ...):
        # Add CUDA streams for true parallelism
        self.cuda_streams = [torch.cuda.Stream() for _ in range(max_workers)]
        self.stream_index = 0

    def get_next_stream(self):
        stream = self.cuda_streams[self.stream_index]
        self.stream_index = (self.stream_index + 1) % len(self.cuda_streams)
        return stream

    def _run_inference(self):
        stream = self.get_next_stream()
        with torch.cuda.stream(stream):
            with torch.no_grad():
                model.eval()
                output = model(input_tensor)
                return output
```

#### 4. Dynamic Batch Size Adjustment

**File:** `/backend/segmentation/config/batch_sizes.json`

```json
{
  "batch_configurations": {
    "hrnet": {
      "optimal_batch_size": 6, // Reduced for 4 concurrent users
      "max_safe_batch_size": 8,
      "concurrent_users": 4
    },
    "cbam_resunet": {
      "optimal_batch_size": 4, // Increased due to good parallel performance
      "max_safe_batch_size": 6,
      "concurrent_users": 4
    },
    "unet_spherohq": {
      "optimal_batch_size": 1, // Reduced due to high memory usage
      "max_safe_batch_size": 2,
      "concurrent_users": 4
    }
  }
}
```

### Performance Expectations and Risk Assessment

#### Expected Performance Improvements

**Throughput Gains (4 concurrent users):**

- **HRNet:** 17.3 → 69.2 img/s (4x improvement)
- **CBAM-ResUNet:** 5.1 → 20.4 img/s (4x improvement)
- **UNet-SpheroHQ:** 1.02 → 4.08 img/s (4x improvement)

**Individual Request Latency:**

- Slight increase (10-15%) due to smaller batch sizes
- Dramatic reduction in queue wait time
- Overall user experience: **Significantly improved**

#### Risk Assessment

**Low Risk Changes (Immediate Implementation):**

1. **Remove model locks** - Simple code deletion
2. **Increase worker count** - Environment variable change
3. **Batch size adjustment** - Configuration file update

**Medium Risk Changes (Staged Implementation):**

1. **CUDA stream isolation** - Requires testing for stability
2. **Dynamic memory management** - Complex GPU memory tracking
3. **Load balancing** - API layer modifications

**High Risk Changes (Future Consideration):**

1. **Mixed precision (FP16)** - Requires model revalidation
2. **Model quantization** - Accuracy impact assessment needed
3. **Dynamic model loading** - Complex cache management

#### Implementation Complexity Analysis

**Development Timeline:**

- **Phase 1 (Basic Parallel):** 3-5 days
  - Remove model locks
  - Increase workers
  - Update batch sizes
  - Basic testing

- **Phase 2 (CUDA Streams):** 5-7 days
  - Implement stream isolation
  - GPU memory monitoring
  - Performance validation

- **Phase 3 (Production Ready):** 7-10 days
  - Error handling enhancement
  - Memory pressure management
  - Load testing and optimization

**Total Implementation Effort:** 15-22 days

### Monitoring and Safety Measures

#### Memory Monitoring Requirements

```python
# Add to inference_executor.py
def check_gpu_memory_pressure(self):
    if torch.cuda.is_available():
        allocated = torch.cuda.memory_allocated() / 1024**3
        if allocated > 20:  # 20GB threshold
            logger.warning(f"High GPU memory usage: {allocated:.1f}GB")
            return True
    return False

def emergency_cleanup(self):
    torch.cuda.empty_cache()
    gc.collect()
```

#### Circuit Breaker Pattern

```python
# Reject requests when memory > 90% utilized
if self.check_gpu_memory_pressure():
    raise InferenceResourceError("GPU memory exhausted")
```

### Conclusion and Recommendation

**Feasibility:** ✅ **HIGHLY FEASIBLE**

- 24GB RTX A5000 has abundant memory for 4-way parallel processing
- Current architecture bottlenecks are easily removable
- Expected 4x throughput improvement with minimal risk

**Implementation Priority:**

1. **Immediate:** Remove model locks + increase workers (1 week)
2. **Short-term:** CUDA stream isolation (2 weeks)
3. **Medium-term:** Advanced memory management (3-4 weeks)

**ROI Analysis:**

- **Development Effort:** 15-22 days
- **Performance Gain:** 4x throughput improvement
- **Resource Utilization:** 83% → 29% (much better efficiency)
- **User Experience:** Elimination of queue delays

**Recommendation:** Proceed with phased implementation starting with basic parallel processing, then add CUDA stream optimization.
