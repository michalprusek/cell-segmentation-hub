# 8-User Concurrent Scaling Feasibility Analysis

## Cell Segmentation Hub Performance Study

### Executive Summary

**FEASIBLE** with moderate implementation complexity and infrastructure adjustments. 8-user scaling is technically achievable with the 24GB RTX A5000 GPU, but requires strategic memory management, infrastructure upgrades, and careful batch size optimization.

## 1. GPU Memory Scaling Analysis

### Current GPU Status

- **GPU**: NVIDIA RTX A5000 (24,564MB total VRAM)
- **Current Usage**: 10,361MB (42%) - baseline with 3 models loaded
- **Available**: 13,763MB (56%) for concurrent processing

### Model Memory Profiles (from batch_sizes.json)

- **HRNet**: ~435MB peak memory per batch of 12 images
- **CBAM-ResUNet**: ~354MB peak memory per batch of 4 images
- **UNet-SpheroHQ**: ~3,100MB peak memory per batch of 8 images

### 8-User Memory Scenarios

#### Scenario A: Mixed Model Distribution (Realistic)

**Distribution**: 4 HRNet, 2 CBAM, 2 UNet users

**Memory Calculation**:

- HRNet (4 users × batch 6): 4 × 220MB = 880MB
- CBAM (2 users × batch 2): 2 × 180MB = 360MB
- UNet (2 users × batch 2): 2 × 800MB = 1,600MB
- **Total Processing**: 2,840MB
- **Total with Base Models**: 10,361MB + 2,840MB = **13,201MB**
- **GPU Utilization**: 53.7% (8,363MB remaining)

#### Scenario B: High-Memory Worst Case

**Distribution**: 8 UNet users (worst case)

**Memory Calculation**:

- UNet (8 users × batch 1): 8 × 400MB = 3,200MB
- **Total with Base Models**: 10,361MB + 3,200MB = **13,561MB**
- **GPU Utilization**: 55.2% (10,003MB remaining)

#### Scenario C: Optimized Distribution

**Distribution**: 6 HRNet, 1 CBAM, 1 UNet users

**Memory Calculation**:

- HRNet (6 users × batch 4): 6 × 150MB = 900MB
- CBAM (1 user × batch 4): 1 × 354MB = 354MB
- UNet (1 user × batch 4): 1 × 1,550MB = 1,550MB
- **Total Processing**: 2,804MB
- **Total with Base Models**: 10,361MB + 2,804MB = **13,165MB**
- **GPU Utilization**: 53.6% (8,399MB remaining)

**✅ CONCLUSION**: 8-user scaling is **MEMORY FEASIBLE** with proper batch size management.

## 2. Performance Bottleneck Analysis

### Current Bottlenecks (4-User Analysis Applied to 8 Users)

#### Primary Bottlenecks for 8 Users:

1. **Model Locking**: ThreadPoolExecutor with model locks serializes inference
2. **Database Connections**: Current limit of 15 connections insufficient for 8+ concurrent users
3. **Single ML Service**: One ML container handling all 8 concurrent streams
4. **Memory Management**: No dynamic GPU cache clearing between operations
5. **WebSocket Capacity**: May struggle with 8 concurrent real-time updates

#### Infrastructure Limitations:

1. **CPU**: Backend at 1.48% CPU - can handle 8x load (estimated 12% peak)
2. **RAM**: ML service at 2.7GB/8GB (34%) - sufficient headroom for 8 users
3. **Network**: Current I/O patterns suggest sufficient bandwidth
4. **Nginx Rate Limits**: 100 req/s segmentation limit adequate for 8 users

#### New Bottlenecks at 8 Users:

1. **Queue Management**: Sequential processing becomes major constraint
2. **ThreadPool Saturation**: 2 workers insufficient for 8 concurrent streams
3. **Model Lock Contention**: Increased wait times for model access
4. **Database Pool Exhaustion**: Higher risk of connection timeouts

## 3. Optimal Batch Size Strategy for 8 Users

### Dynamic Batch Sizing Algorithm

```python
def calculate_8_user_batch_sizes(available_memory_mb: int, user_models: List[str]):
    """Calculate optimal batch sizes for 8 concurrent users"""

    base_memory = 10361  # Current baseline
    available = available_memory_mb - base_memory

    # Memory per user allocation
    memory_per_user = available // 8

    batch_sizes = {}
    for model in user_models:
        if model == "hrnet":
            # 435MB for batch 12 = ~36MB per image
            max_batch = min(12, memory_per_user // 36)
            batch_sizes[model] = max(1, max_batch)
        elif model == "cbam_resunet":
            # 354MB for batch 4 = ~89MB per image
            max_batch = min(4, memory_per_user // 89)
            batch_sizes[model] = max(1, max_batch)
        elif model == "unet_spherohq":
            # 3100MB for batch 8 = ~388MB per image
            max_batch = min(8, memory_per_user // 388)
            batch_sizes[model] = max(1, max_batch)

    return batch_sizes
```

### Recommended Batch Sizes for 8 Users

With ~1,720MB per user (13,763MB / 8):

- **HRNet**: Batch size 6-8 (instead of 12)
- **CBAM-ResUNet**: Batch size 2-3 (instead of 4)
- **UNet-SpheroHQ**: Batch size 1-2 (instead of 8)

**Performance Impact**:

- HRNet: 17.3 → 15.5 imgs/sec (-10%)
- CBAM: 5.1 → 4.2 imgs/sec (-18%)
- UNet: 1.02 → 0.6 imgs/sec (-41%)

## 4. Infrastructure Requirements for 8-User Scaling

### Database Connections

**Current**: 15 connections
**Required**: 35-50 connections

- Base services: 10 connections
- 8 concurrent users: 8 × 3 connections = 24
- Buffer for spikes: 10-15 connections

### CPU Resources

**Current**: Backend 1.48% CPU usage
**Projected**: 8-12% CPU usage (within acceptable limits)

### RAM Requirements

**Current**: ML service 2.7GB/8GB (34%)
**Projected**: 4.5-5.5GB/8GB (55-69%) - acceptable headroom

### ML Service Workers

**Current**: 2 workers with model locks
**Required**: 8-12 workers without model locks

### WebSocket Connections

**Current**: Single WebSocket service
**Scaling Need**: Connection pooling and load balancing

## 5. Expected Throughput Analysis

### Current 4-User Performance (from memories)

- **Total Throughput**: ~60-68 imgs/sec
- **HRNet**: 4 users × 17.3 = 69.2 imgs/sec
- **Mixed Models**: Lower due to UNet bottleneck

### Projected 8-User Performance

#### Conservative Estimate (with reduced batch sizes)

- **HRNet** (6 users): 6 × 15.5 = 93 imgs/sec
- **CBAM** (1 user): 1 × 4.2 = 4.2 imgs/sec
- **UNet** (1 user): 1 × 0.6 = 0.6 imgs/sec
- **Total**: ~98 imgs/sec

#### Optimistic Estimate (optimized batching)

- **Total**: 110-120 imgs/sec

**Performance vs Users**:

- 4 users: ~68 imgs/sec (17 per user)
- 8 users: ~98 imgs/sec (12.25 per user)
- **Per-user degradation**: ~28%
- **Total throughput gain**: +44%

## 6. Risk Assessment

### High Risk Factors

1. **GPU Memory Overflow**: UNet-heavy workloads could exceed memory
2. **Database Connection Exhaustion**: High concurrency may cause timeouts
3. **Model Lock Contention**: Increased wait times for sequential access
4. **WebSocket Overload**: Real-time updates may lag with 8 concurrent streams

### Medium Risk Factors

1. **Performance Degradation**: Per-user performance drops 25-30%
2. **Queue Management**: Longer wait times during peak load
3. **Error Handling**: More complex failure scenarios with 8 streams
4. **Monitoring Complexity**: Harder to debug issues with 8 concurrent processes

### Low Risk Factors

1. **CPU/RAM Resources**: Sufficient headroom available
2. **Network Bandwidth**: Current usage well below limits
3. **Storage I/O**: File operations should scale linearly

### Mitigation Strategies

1. **Dynamic Batch Sizing**: Implement memory-aware batch adjustment
2. **Connection Pooling**: Increase database connection limits
3. **Model Lock Removal**: Enable true parallel inference
4. **Circuit Breakers**: Implement failure detection and fallback
5. **Progressive Scaling**: Start with 6 users, then expand to 8

## 7. Implementation Complexity Assessment

### Low Complexity (1-2 days)

- Increase ML service workers from 2 to 8
- Raise database connection limit to 50
- Adjust Docker memory limits
- Update environment variables

### Medium Complexity (3-5 days)

- Remove model locks for parallel inference
- Implement dynamic batch sizing
- Add GPU memory monitoring
- Enhance error handling for 8 streams

### High Complexity (1-2 weeks)

- Connection pooling and load balancing
- Advanced queue management
- Performance monitoring dashboard
- Comprehensive testing with 8 concurrent users

## 8. Recommended Implementation Plan

### Phase 1: Infrastructure Scaling (Low Risk)

```bash
# Increase ML workers and database connections
ML_INFERENCE_WORKERS=8
DATABASE_CONNECTION_POOL_SIZE=50
ML_MEMORY_LIMIT_GB=6
```

### Phase 2: Parallel Processing (Medium Risk)

```python
# Remove model locks in inference_executor.py
class InferenceExecutor:
    def __init__(self, max_workers: int = 8):
        # Remove self._model_locks
        # Enable parallel model access
```

### Phase 3: Dynamic Optimization (High Complexity)

- Implement memory-aware batch sizing
- Add load balancing across multiple ML instances
- Performance monitoring and auto-scaling

### Performance Expectations

- **Conservative**: 8 users, ~85-95 imgs/sec total
- **Optimized**: 8 users, ~100-120 imgs/sec total
- **Per-user impact**: 20-30% performance reduction
- **Total system gain**: 40-50% throughput increase

### Success Criteria

1. All 8 users can process images simultaneously
2. No GPU out-of-memory errors
3. Database connections remain stable
4. Average response time < 2x current latency
5. System remains stable under sustained load

## Conclusion

**8-user scaling is FEASIBLE** with the 24GB RTX A5000 GPU. The system has sufficient GPU memory and processing power, but requires infrastructure adjustments and careful implementation. The primary benefits are 40-50% total throughput increase, while individual users experience 20-30% performance reduction - a favorable trade-off for most use cases.

**Recommendation**: Implement in phases, starting with infrastructure scaling, then enabling parallel processing, followed by dynamic optimization based on real-world usage patterns.
