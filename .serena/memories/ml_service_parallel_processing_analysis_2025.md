# ML Service Parallel Processing Analysis

## Current Architecture Analysis

### **Current Processing Model: Sequential with Limited Concurrency**

The ML service currently operates with:

1. **ThreadPoolExecutor with 2 Workers**: `InferenceExecutor` uses `max_workers=2` (configurable via `ML_INFERENCE_WORKERS`)
2. **Model-Level Locking**: Each model has a dedicated `threading.RLock` preventing true parallel inference
3. **Sequential Model Access**: Even with ThreadPoolExecutor, models are accessed sequentially due to locking

**Key Files:**

- `/backend/segmentation/ml/inference_executor.py` - Lines 111-128, 146-151
- `/backend/segmentation/ml/model_loader.py` - Lines 105-157

### **GPU Memory Usage Patterns**

**Current GPU: NVIDIA RTX A5000 (24GB VRAM)**

**Batch Configuration from `/backend/segmentation/config/batch_sizes.json`:**

- **HRNetV2**: Optimal batch 8, Max safe 12, ~435MB peak memory
- **CBAM-ResUNet**: Optimal batch 2, Max safe 4, ~354MB peak memory
- **UNet-SpheroHQ**: Optimal batch 4, Max safe 8, ~3.1GB peak memory

**Memory Analysis:**

- Single model inference uses <500MB for HRNet/CBAM
- UNet uses significantly more (~3GB)
- Current memory limit: 8GB in Docker (line 125 in docker-compose.blue.yml)
- Models pre-loaded during startup (lines 45-57 in api/main.py)

### **Model Loading Strategy**

**Current Implementation:**

```python
# From api/main.py lines 45-57
models_to_load = ["hrnet", "cbam_resunet", "unet_spherohq"]
for model_name in models_to_load:
    model_loader_instance.load_model(model_name)
```

**Key Characteristics:**

- All 3 models pre-loaded at startup
- Models kept in memory permanently
- No model swapping or dynamic loading
- Each model ~200-500MB in VRAM when loaded

### **API Communication Pattern**

**Backend ↔ ML Service:**

- HTTP REST API communication via axios
- Single endpoint: `/api/v1/segment` (individual) and `/api/v1/batch-segment` (batch)
- 5-minute timeout (300,000ms)
- Form-data upload with model/threshold parameters

**Critical Files:**

- `/backend/src/services/segmentationService.ts` - Lines 281-291, 696-703

### **Current Resource Constraints**

1. **Memory Bottlenecks:**
   - Docker memory limit: 8GB
   - Model locks prevent parallel GPU utilization
   - Batch processing disabled in production (safety)

2. **Threading Limitations:**
   - Only 2 inference workers
   - Model-level locks serialize access
   - No queue management for concurrent requests

3. **GPU Utilization:**
   - Single model execution at a time
   - Underutilized 24GB VRAM capacity
   - No multi-model parallel processing

## **4-Way Parallel Processing Implementation Strategy**

### **Option A: Multi-Model Parallel Processing (RECOMMENDED)**

**Implementation:**

1. **Remove Model Locks**: Eliminate per-model locks in `InferenceExecutor`
2. **Increase Workers**: Set `ML_INFERENCE_WORKERS=4`
3. **Memory Management**: Implement dynamic batch sizing based on available VRAM
4. **Model Isolation**: Load each model in separate GPU memory contexts

**Code Changes:**

```python
# inference_executor.py - Remove model locks
def get_model_lock(self, model_name: str) -> threading.RLock:
    # Return a dummy lock or remove entirely
    return threading.RLock()  # Individual locks per request, not per model

# model_loader.py - Enable concurrent access
class ModelLoader:
    def __init__(self, max_concurrent_models: int = 4):
        self.max_concurrent_models = max_concurrent_models
        # Remove self._model_locks
```

**Expected Performance:**

- 4 concurrent users with different models
- HRNet: 2 concurrent (batch 4 each) = ~900MB
- CBAM: 2 concurrent (batch 2 each) = ~600MB
- UNet: 1 concurrent (batch 4) = ~3.1GB
- **Total VRAM Usage: ~4.6GB / 24GB (19% utilization)**

### **Option B: Dynamic Model Scheduling**

**Implementation:**

1. **Smart Queue**: Implement model-aware request scheduling
2. **Memory Pooling**: Dynamic model loading/unloading based on demand
3. **Concurrent Batching**: Group requests by model type

**Memory Efficiency:**

- Load only required models dynamically
- Higher GPU memory utilization (80%+)
- More complex implementation

### **Option C: Model Replication Strategy**

**Implementation:**

1. **Model Copies**: Load multiple instances of popular models (HRNet)
2. **Round-Robin**: Distribute requests across model instances
3. **Memory Trade-off**: Higher memory usage for better parallelism

## **Recommended Implementation Plan**

### **Phase 1: Remove Model Locking (Low Risk)**

```python
# File: ml/inference_executor.py
class InferenceExecutor:
    def __init__(self, max_workers: int = 4):  # Increase from 2
        # Remove self._model_locks
        # Remove get_model_lock method
```

### **Phase 2: Enable Concurrent Model Access**

```python
# File: ml/model_loader.py
def execute_inference(self, model, input_tensor, model_name, timeout=None):
    # Remove model_lock = self.get_model_lock(model_name)
    # Remove with model_lock context
    # Direct inference execution
```

### **Phase 3: Memory-Aware Batching**

```python
# Implement dynamic batch sizing based on available VRAM
def get_dynamic_batch_size(self, model_name: str, available_memory_gb: float):
    if available_memory_gb > 8:
        return self.get_max_safe_batch_size(model_name)
    else:
        return max(1, self.get_optimal_batch_size(model_name) // 2)
```

### **Phase 4: Environment Configuration**

```bash
# Environment variables for 4-way processing
ML_INFERENCE_WORKERS=4
ML_MEMORY_LIMIT_GB=6
ML_CONCURRENT_MODELS=3
ML_ENABLE_PARALLEL_INFERENCE=true
```

## **Expected Performance Improvements**

### **Throughput Increase:**

- **Current**: 1 user at a time, ~17 imgs/sec (HRNet)
- **Proposed**: 4 users concurrent, ~60-68 imgs/sec total
- **Improvement**: 4x throughput increase

### **GPU Utilization:**

- **Current**: 15-20% VRAM utilization
- **Proposed**: 60-80% VRAM utilization
- **Concurrent Processing**: 4 simultaneous inference streams

### **Response Time:**

- **Current**: Queue-based sequential processing
- **Proposed**: Immediate processing for up to 4 users
- **Latency**: Same per-image latency, no queuing delays

## **Risk Assessment**

### **Low Risk Changes:**

- Increase worker count
- Remove model locks
- Environment configuration

### **Medium Risk Changes:**

- Dynamic batch sizing
- Concurrent model access
- Memory management improvements

### **Monitoring Requirements:**

- GPU memory usage tracking
- Failed inference rate monitoring
- Performance degradation detection
- OOM error handling

## **Files Requiring Modification**

1. **`/backend/segmentation/ml/inference_executor.py`** - Remove model locks, increase workers
2. **`/backend/segmentation/ml/model_loader.py`** - Enable concurrent access
3. **`/backend/segmentation/config/batch_sizes.json`** - Optimize batch sizes for parallel processing
4. **`docker-compose.blue.yml`** - Increase memory limits and GPU resource allocation
5. **Environment configuration** - Add parallel processing flags

This analysis provides a clear path to implement 4-way parallel processing with the available 24GB GPU memory.
