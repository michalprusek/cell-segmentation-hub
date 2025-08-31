# Performance Guidelines for SpheroSeg

This document provides performance guidelines and best practices for working with large datasets in SpheroSeg.

## ML Model Performance (Updated 2025-08-31)

### Model Benchmarks

Production environment testing with NVIDIA RTX A5000 (24GB VRAM):

| Model            | Avg Time/Image | Throughput  | P95 Latency | Batch Size  | Use Case                   |
| ---------------- | -------------- | ----------- | ----------- | ----------- | -------------------------- |
| **HRNet**        | 0.2 seconds    | 5.5 img/sec | <0.3 sec    | 8 (optimal) | High-throughput processing |
| **CBAM-ResUNet** | 0.3 seconds    | 3.0 img/sec | <0.7 sec    | 2 (optimal) | Maximum accuracy analysis  |

### Dynamic Batching Configuration

The system implements dynamic batching for optimal GPU utilization:

- **Queue Delay**: 5ms (groups requests arriving within this window)
- **Batch Timeout**: 50ms (maximum wait time for batch formation)
- **Memory Reserve**: 15% VRAM kept free for stability
- **Max Safe Batch Sizes**: HRNet (12), CBAM-ResUNet (4)

### SLA Compliance

All models maintain P95 latency under 1 second for production SLA compliance:

- HRNet: 99% of requests complete within 300ms
- CBAM-ResUNet: 99% of requests complete within 700ms

## Performance Thresholds

The system implements automatic performance monitoring with the following thresholds:

### Polygon Count Limits

| Level       | Polygon Count | System Response                  |
| ----------- | ------------- | -------------------------------- |
| **Normal**  | < 1,000       | Normal operation                 |
| **Warning** | 1,000 - 5,000 | Performance warning logged       |
| **Error**   | > 5,000       | Error logged, operation may fail |

### Rendering Time Limits

| Level       | Render Time    | System Response     |
| ----------- | -------------- | ------------------- |
| **Normal**  | < 5 seconds    | Normal operation    |
| **Warning** | 5 - 30 seconds | Slow render warning |
| **Error**   | > 30 seconds   | Timeout error       |

### Metrics Calculation Limits

| Level       | Calculation Time | System Response          |
| ----------- | ---------------- | ------------------------ |
| **Normal**  | < 5 seconds      | Normal operation         |
| **Warning** | 5 - 30 seconds   | Slow calculation warning |
| **Error**   | > 30 seconds     | Calculation timeout      |

## Performance Optimizations

### 1. Number Rendering Cache

The system implements an LRU (Least Recently Used) cache for number rendering:

- **Cache Size**: 100 entries maximum
- **Cache Key**: Number + rounded size
- **Hit Rate Monitoring**: Logged every 100 operations
- **Benefits**: 30-50% faster rendering for repeated numbers

#### Cache Statistics

Monitor cache performance using:

```javascript
const stats = NUMBER_PATHS.getCacheStats();
console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`);
console.log(`Cache size: ${stats.size} entries`);
```

### 2. Performance Monitoring

All major operations are monitored and logged:

```
Visualization generated: output.png | Metrics: 1500 polygons in 3200ms (cache hit rate: 75.3%)
Metrics calculated: 2000 polygons across 10 images in 4500ms (444 polygons/sec)
```

### 3. Visual Regression Testing

Automated visual tests ensure consistent rendering:

- Single digit rendering (0-9) at multiple sizes
- Multi-digit numbers (10-999)
- Large numbers with dot pattern (>999)
- Cross-browser consistency tests

## Best Practices for Large Datasets

### 1. Image Processing

**Recommended Limits:**

- Maximum polygons per image: 1,000
- Maximum images per batch: 50
- Maximum total polygons per export: 10,000

**Tips:**

- Process images in batches
- Use pagination for large projects
- Consider simplifying polygons if count is very high

### 2. Export Optimization

**For datasets with >1,000 polygons:**

1. Disable visualization generation if not needed
2. Export metrics in CSV format (lighter than Excel)
3. Process in smaller batches
4. Use scale conversion only when necessary

### 3. Memory Management

**Browser Limits:**

- Chrome: ~4GB memory limit
- Firefox: ~2GB memory limit
- Safari: ~1GB memory limit

**Tips:**

- Clear cache periodically for long sessions
- Close unused tabs to free memory
- Restart browser if performance degrades

## Performance Monitoring API

### Backend Monitoring

```typescript
// Visualization Generator
const metrics = {
  totalPolygons: polygons.length,
  renderTime: Date.now() - startTime,
  cacheHitRate: NUMBER_PATHS.getCacheStats().hitRate,
  warningThresholdExceeded: polygons.length > 1000,
};
```

### Frontend Monitoring

```typescript
// Using performance observer
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.name.includes('visualization')) {
      console.log(`${entry.name}: ${entry.duration}ms`);
    }
  }
});
observer.observe({ entryTypes: ['measure'] });
```

## Troubleshooting Performance Issues

### Slow Rendering

**Symptoms:**

- Visualization takes >5 seconds
- Browser becomes unresponsive

**Solutions:**

1. Reduce polygon count per image
2. Disable polygon numbering (`showNumbers: false`)
3. Reduce stroke width and transparency
4. Clear number rendering cache

### High Memory Usage

**Symptoms:**

- Browser crashes or freezes
- "Out of memory" errors

**Solutions:**

1. Process smaller batches
2. Reduce image resolution
3. Clear browser cache
4. Use Chrome's Memory Profiler

### Cache Inefficiency

**Symptoms:**

- Low cache hit rate (<30%)
- Repeated slow renders

**Solutions:**

1. Ensure consistent font sizes
2. Group similar operations
3. Clear and rebuild cache

## Configuration Options

### Adjusting Thresholds

Edit performance constants in the source code:

```typescript
// backend/src/services/visualization/visualizationGenerator.ts
private readonly WARN_POLYGON_COUNT = 1000;  // Adjust warning threshold
private readonly ERROR_POLYGON_COUNT = 5000; // Adjust error threshold
private readonly WARN_RENDER_TIME_MS = 5000; // Adjust time warning
private readonly ERROR_RENDER_TIME_MS = 30000; // Adjust time error
```

### Cache Configuration

```typescript
// backend/src/services/visualization/numberPaths.ts
private maxCacheSize = 100; // Adjust cache size limit
```

## Monitoring Dashboard

### Prometheus Metrics

The following metrics are exposed for Prometheus:

- `spheroseg_polygon_count` - Number of polygons processed
- `spheroseg_render_time_ms` - Visualization render time
- `spheroseg_cache_hit_rate` - Number rendering cache hit rate
- `spheroseg_metrics_calc_time_ms` - Metrics calculation time

### Grafana Dashboards

Import the performance dashboard from `/monitoring/dashboards/performance.json`:

- Real-time polygon processing rate
- Cache hit rate over time
- Render time percentiles
- Memory usage trends

## Testing Performance

### Load Testing

Run performance tests:

```bash
npm run test:performance
```

### Visual Regression Tests

Run visual consistency tests:

```bash
npm run test:e2e -- visual-regression-numbers.spec.ts
```

### Benchmark Suite

Compare performance across versions:

```bash
npm run benchmark
```

## Recommended System Requirements

### Minimum Requirements

- **CPU**: Dual-core 2.0 GHz
- **RAM**: 4 GB
- **Browser**: Chrome 90+, Firefox 88+, Safari 14+
- **Network**: 10 Mbps for uploads

### Recommended for Large Datasets

- **CPU**: Quad-core 2.5 GHz or better
- **RAM**: 8 GB or more
- **Browser**: Latest Chrome with 4GB allocated
- **Network**: 50 Mbps or faster
- **GPU**: Hardware acceleration enabled

## Future Optimizations

### Planned Improvements

1. **WebWorker Processing**: Move heavy computations to background threads
2. **Progressive Rendering**: Stream visualization updates
3. **Adaptive Quality**: Reduce quality for very large datasets
4. **Server-Side Rendering**: Generate visualizations on backend for huge datasets
5. **WebGL Acceleration**: Use GPU for polygon rendering

## Support

For performance-related issues:

1. Check browser console for warnings/errors
2. Review performance metrics in logs
3. Contact support with performance data
4. Include dataset size and browser info
