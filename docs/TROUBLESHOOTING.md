# Troubleshooting Guide

## Table of Contents

- [Common Issues](#common-issues)
  - [Batch Segmentation Issues](#batch-segmentation-issues)
  - [WebSocket Connection Issues](#websocket-connection-issues)
  - [Performance Issues](#performance-issues)
  - [Authentication Issues](#authentication-issues)
- [Debugging Tools](#debugging-tools)
- [Known Bugs and Fixes](#known-bugs-and-fixes)
- [Contact Support](#contact-support)

## Common Issues

### Batch Segmentation Issues

#### Problem: Last Image in Batch Shows "No Segmentation"

**Symptoms:**
- The last image in a batch segmentation shows "no segmentation" status
- Other images in the batch process correctly
- Refreshing the page shows the correct segmentation results

**Root Causes:**
1. **Backend Array Index Misalignment**: When invalid images are skipped in a batch, the ML service returns fewer results than the number of images, causing index misalignment
2. **Frontend Race Condition**: WebSocket updates arrive before the backend has finished writing to the database

**Solution:**

This issue has been fixed in the latest version with a two-part solution:

1. **Backend Fix** (Applied in `/backend/src/services/segmentationService.ts`):
```typescript
// Track valid image indices when building FormData
const validImageIndices: number[] = [];
for (let i = 0; i < images.length; i++) {
  if (image && image.originalPath) {
    validImageIndices.push(i);
    // Add to FormData...
  }
}

// Map ML results back to original positions
for (let resultIndex = 0; resultIndex < batchResult.results.length; resultIndex++) {
  const originalIndex = validImageIndices[resultIndex];
  results[originalIndex] = batchResult.results[resultIndex];
}
```

2. **Frontend Fix** (Applied in `/src/hooks/useProjectData.tsx`):
```typescript
// Retry mechanism for race condition
let segmentationData = await apiClient.getSegmentationResults(imageId);

if (!segmentationData) {
  logger.info(`⏳ Retrying in 500ms...`);
  await new Promise(resolve => setTimeout(resolve, 500));
  segmentationData = await apiClient.getSegmentationResults(imageId);
}
```

**Prevention:**
- Always ensure batch processing maintains proper index tracking
- Implement retry mechanisms for timing-sensitive operations
- Use performance monitoring to detect race conditions

#### Problem: Some Images in Batch Fail to Process

**Symptoms:**
- Random images in a batch show "failed" status
- No clear pattern to which images fail

**Possible Causes:**
- Invalid image format or corrupted files
- Images missing required metadata (width, height)
- Insufficient memory for large batches

**Solution:**
1. Check image validity before processing
2. Ensure all images have required metadata
3. Process in smaller batches if memory issues occur

### WebSocket Connection Issues

#### Problem: Real-time Updates Not Working

**Symptoms:**
- Segmentation status doesn't update in real-time
- Export progress doesn't show
- Queue position doesn't update

**Debugging Steps:**

1. **Check WebSocket Connection:**
```javascript
// In browser console
const socket = window.__wsManager;
console.log('Connected:', socket?.isConnected);
console.log('Room:', socket?.currentRoom);
```

2. **Monitor WebSocket Events:**
```javascript
// Enable debug logging
localStorage.setItem('debug', 'websocket:*');
```

3. **Check Network Tab:**
- Look for WebSocket connection in Network tab
- Should show status 101 (Switching Protocols)
- Check for "socket.io" frames

**Common Fixes:**
- Ensure authentication token is valid
- Check if WebSocket port (3001) is accessible
- Verify nginx WebSocket configuration
- Clear browser cache and reconnect

### Performance Issues

#### Problem: Slow Batch Processing

**Symptoms:**
- Processing takes longer than expected
- UI becomes unresponsive during large batch operations

**Performance Monitoring:**

The application includes built-in performance monitoring:

```javascript
// Check performance stats in console
performanceMonitor.getPerformanceReport();

// Check race condition statistics
performanceMonitor.getRaceConditionStats();
```

**Optimization Tips:**
1. **Batch Size**: Keep batches under 100 images for optimal performance
2. **Image Size**: Resize large images before upload (max 4096x4096 recommended)
3. **Concurrent Processing**: The ML service processes 4 images concurrently by default
4. **Memory Management**: Monitor browser memory usage for large datasets

#### Problem: Race Conditions in Updates

**Detection:**
The performance monitor automatically detects race conditions:

```javascript
// In browser console
const stats = performanceMonitor.getRaceConditionStats();
console.log('Race conditions:', stats);
```

**Indicators:**
- `total`: Number of race conditions detected
- `resolved`: Successfully handled with retry
- `unresolved`: Failed even after retry
- `averageTimeDiff`: Average timing difference (ms)
- `averageRetries`: Average number of retries needed

### Authentication Issues

#### Problem: "Missing Authentication Token" Error

**Symptoms:**
- Sudden logout with Czech error message "Chybí autentizační token"
- API calls failing with 401 status

**Solution:**
1. Clear browser storage:
```javascript
localStorage.clear();
sessionStorage.clear();
```
2. Sign in again
3. Check token expiration settings

## Debugging Tools

### Performance Monitor

The application includes a comprehensive performance monitor:

```javascript
// Import in your code
import { performanceMonitor } from '@/lib/performanceMonitor';

// Record custom metrics
const id = performanceMonitor.startTiming('custom-operation');
// ... perform operation ...
performanceMonitor.endTiming(id);

// Monitor WebSocket timing
performanceMonitor.recordWebSocketUpdate(imageId);
performanceMonitor.recordDatabaseFetch(imageId, duration, success, retryCount);

// Get statistics
const report = performanceMonitor.getPerformanceReport();
const raceStats = performanceMonitor.getRaceConditionStats();
```

### Logging

Enable detailed logging in development:

```javascript
// Set log level
localStorage.setItem('logLevel', 'debug');

// Enable specific modules
localStorage.setItem('debug', 'websocket:*,segmentation:*');
```

### Integration Tests

Run integration tests for batch processing:

```bash
# In Docker container
make shell-be
npm test -- segmentationService.integration.test.ts
```

## Known Bugs and Fixes

### Fixed Issues

1. **Batch Segmentation Index Misalignment** (Fixed in v1.2.0)
   - Issue: Last image in batch showed "no segmentation"
   - Fix: Implemented proper index tracking for invalid images
   - Test: `segmentationService.batch-fix.test.ts`

2. **WebSocket Race Condition** (Fixed in v1.2.0)
   - Issue: Frontend state not updating despite successful processing
   - Fix: Added retry mechanism with 500ms delay
   - Monitor: Performance monitor tracks race conditions

3. **Rate Limiting 503 Errors** (Fixed in v1.1.0)
   - Issue: Bulk segmentation requests causing 503 errors
   - Fix: Increased nginx rate limit to 100 req/s for segmentation endpoints

### Known Limitations

1. **Maximum Batch Size**: 10,000 images per batch
2. **Maximum File Size**: 20MB per image
3. **Concurrent Connections**: Limited to 100 WebSocket connections
4. **Processing Timeout**: 5 minutes per image

## Monitoring and Alerts

### Frontend Monitoring

```javascript
// Monitor memory usage
const memory = performanceMonitor.getMemoryUsage();
if (memory.usedJSHeapSize > memory.jsHeapSizeLimit * 0.9) {
  console.warn('High memory usage detected');
}

// Monitor slow operations
performanceMonitor.getAllStats();
// Operations over 1000ms are automatically logged as warnings
```

### Backend Monitoring

Check backend logs for issues:

```bash
# View backend logs
docker logs spheroseg-blue-backend -f --tail 100

# Search for errors
docker logs spheroseg-blue-backend 2>&1 | grep ERROR

# Monitor WebSocket connections
docker logs spheroseg-blue-backend 2>&1 | grep "WebSocket"
```

## Best Practices

### For Developers

1. **Always Test Batch Operations**: Test with mixed valid/invalid images
2. **Monitor Performance**: Use performance monitor during development
3. **Handle Race Conditions**: Implement retry logic for async operations
4. **Log Appropriately**: Use appropriate log levels (error, warn, info, debug)
5. **Write Tests**: Include integration tests for timing-sensitive code

### For Users

1. **Batch Size**: Start with smaller batches (50-100 images) for testing
2. **Image Format**: Use JPEG or PNG for best compatibility
3. **Network**: Ensure stable connection for large uploads
4. **Browser**: Use latest Chrome or Firefox for best performance
5. **Memory**: Close unnecessary tabs when processing large batches

## Contact Support

If you encounter issues not covered in this guide:

1. **GitHub Issues**: Report bugs at https://github.com/your-org/cell-segmentation-hub/issues
2. **Email Support**: support@spheroseg.com
3. **Documentation**: Check `/docs` folder for additional guides

### Information to Include

When reporting issues, please include:

1. **Browser**: Version and type
2. **Error Messages**: Full error text and stack trace
3. **Steps to Reproduce**: Detailed steps to trigger the issue
4. **Screenshots**: If UI-related
5. **Logs**: Browser console logs and network requests
6. **Performance Stats**: Output from `performanceMonitor.exportMetrics()`

## Appendix

### Environment Variables

Key environment variables affecting performance:

```bash
# Backend
SEGMENTATION_RETRY_TIMEOUT=3000  # Retry timeout in ms
MAX_BATCH_SIZE=10000             # Maximum images per batch
WEBSOCKET_PING_INTERVAL=25000    # WebSocket keepalive

# Frontend
VITE_WS_RECONNECT_ATTEMPTS=10    # WebSocket reconnection attempts
VITE_API_TIMEOUT=30000            # API request timeout
VITE_RETRY_DELAY=500              # Race condition retry delay
```

### Database Queries

Useful queries for debugging:

```sql
-- Check segmentation results for an image
SELECT * FROM segmentation_results WHERE image_id = 'IMAGE_ID';

-- Find images with missing results
SELECT i.id, i.name, i.segmentation_status
FROM images i
LEFT JOIN segmentation_results sr ON i.id = sr.image_id
WHERE i.segmentation_status = 'completed' AND sr.id IS NULL;

-- Check processing times
SELECT
  image_id,
  processing_time,
  created_at
FROM segmentation_results
ORDER BY processing_time DESC
LIMIT 10;
```

### Nginx Configuration

Key nginx settings for troubleshooting:

```nginx
# Rate limiting zones
limit_req_zone $binary_remote_addr zone=segmentation:10m rate=100r/s;

# WebSocket configuration
location /socket.io/ {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

---

*Last Updated: September 2025*
*Version: 1.2.0*