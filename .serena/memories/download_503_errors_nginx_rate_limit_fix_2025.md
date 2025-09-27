# Download 503 Errors - Nginx Rate Limiting Fix

## Date: 2025-09-26

## Problem Description

Downloads at `/api/projects/{id}/export/{jobId}/download` were returning 503 Service Unavailable errors due to restrictive nginx rate limiting configuration.

## Root Cause Analysis

### 1. **Rate Limiting Configuration Mismatch**

**Problem**: Download endpoints were using inadequate rate limiting settings:

```nginx
# BEFORE (problematic)
location ~ ^/api/projects/[^/]+/export/[^/]+/download$ {
    limit_req zone=api burst=10 nodelay;  # ❌ Only 10 burst capacity!
}

# Regular API endpoints had HIGHER limits:
location /api {
    limit_req zone=api burst=80 nodelay;  # ✅ 80 burst capacity
}
```

**Issue**: Downloads had **8x lower** burst capacity (10) than regular API calls (80), which is backwards since downloads are larger, longer-running requests.

### 2. **Missing Download Zone**

The nginx configuration lacked a dedicated rate limiting zone for downloads, forcing them to compete with regular API calls for the same limited pool.

### 3. **Green Environment Missing Download Endpoint**

The `nginx.green.conf` file was completely missing the download endpoint configuration, meaning downloads would fail entirely in the green environment.

## Solution Implemented

### 1. **Created Dedicated Download Rate Limiting Zone**

**Both `nginx.blue.conf` and `nginx.green.conf`:**

```nginx
# Rate limiting zones
limit_req_zone $binary_remote_addr zone=download:10m rate=10r/s;
```

### 2. **Updated Download Endpoint Configuration**

**Blue Environment (`nginx.blue.conf`):**

```nginx
# Export download endpoints - optimized for large file downloads
location ~ ^/api/projects/[^/]+/export/[^/]+/download$ {
    limit_req zone=download burst=50 nodelay;  # ✅ 5x increase from 10 to 50
    limit_conn addr 5;  # Allow up to 5 concurrent downloads per IP

    # Extended timeouts for large file downloads (30 minutes)
    proxy_read_timeout 1800s;
    proxy_connect_timeout 75s;
    proxy_send_timeout 1800s;

    # Disable buffering for streaming large files
    proxy_buffering off;
    proxy_request_buffering off;

    # Increase buffer sizes for large responses
    proxy_buffer_size 16k;
    proxy_buffers 32 16k;
    proxy_busy_buffers_size 64k;

    # Set max temp file size for downloads (1GB)
    proxy_max_temp_file_size 1024m;

    # Disable cache for downloads
    proxy_cache off;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

### 3. **Added Missing Green Environment Configuration**

**Green Environment (`nginx.green.conf`):**

- Added the complete download endpoint configuration (was entirely missing)
- Replicated all optimizations from blue environment
- Ensured environment-specific headers: `X-Environment "production-green"`

## Rate Limiting Comparison

| Endpoint Type | Zone           | Rate      | Burst  | Connection Limit | Use Case                  |
| ------------- | -------------- | --------- | ------ | ---------------- | ------------------------- |
| General       | `general`      | 10r/s     | N/A    | N/A              | Basic requests            |
| API           | `api`          | 30r/s     | 80     | 10               | Regular API calls         |
| Segmentation  | `segmentation` | 100r/s    | 100    | 15               | Bulk segmentation results |
| Upload        | `upload`       | 5r/s      | 10     | N/A              | File uploads              |
| **Download**  | `download`     | **10r/s** | **50** | **5**            | **Large file downloads**  |

## Key Improvements

### 1. **Burst Capacity**

- **Before**: 10 burst requests
- **After**: 50 burst requests
- **Improvement**: 500% increase

### 2. **Dedicated Zone**

- Downloads no longer compete with regular API calls
- Isolated rate limiting for better predictability

### 3. **Connection Management**

- Limited to 5 concurrent downloads per IP
- Prevents resource exhaustion while allowing reasonable usage

### 4. **Green Environment Parity**

- Both blue and green environments now have identical download capabilities
- Eliminates deployment-related download failures

## Backend Compatibility

The backend `exportController.ts` implementation is compatible with these changes:

```typescript
// Uses res.sendFile() for streaming
res.sendFile(resolvedFilePath, err => {
  if (err) {
    logger.error('Send file error:', err, 'ExportController');
  }
});
```

- Single HTTP request per download
- No chunking or range requests
- Streams up to 1GB files efficiently
- Proper Content-Disposition headers for browser handling

## Deployment Process

### 1. **Configuration Update**

```bash
# Updated both environment configs
/home/cvat/cell-segmentation-hub/docker/nginx/nginx.blue.conf
/home/cvat/cell-segmentation-hub/docker/nginx/nginx.green.conf
```

### 2. **Nginx Reload**

```bash
# Test configuration syntax
docker exec nginx-main nginx -t

# Reload without downtime
docker exec nginx-main nginx -s reload
```

### 3. **Verification**

```bash
# Health check passed
curl -I "https://spherosegapp.utia.cas.cz/health"
# Returns: HTTP/2 200, X-Environment: production-blue
```

## Expected Results

### Before Fix

- 503 Service Unavailable during export downloads
- Downloads competing with API calls for rate limit quota
- Green environment downloads completely broken
- Burst capacity of only 10 requests

### After Fix

- Downloads have dedicated rate limiting zone
- 50 burst capacity (5x increase)
- Both blue/green environments support downloads
- Up to 5 concurrent downloads per IP
- 30-minute timeouts for large files

## Monitoring Recommendations

1. **Track Download Success Rate**

   ```bash
   # Monitor download endpoint specifically
   grep "download" /var/log/nginx/access.log | grep "503"
   ```

2. **Rate Limit Headers**

   ```bash
   # Check rate limit utilization
   curl -I "https://spherosegapp.utia.cas.cz/api/projects/{id}/export/{jobId}/download"
   # Look for: RateLimit-Remaining header
   ```

3. **Connection Pool Usage**
   ```bash
   # Monitor concurrent downloads
   netstat -an | grep ":4001" | grep ESTABLISHED | wc -l
   ```

## Files Modified

1. **`/home/cvat/cell-segmentation-hub/docker/nginx/nginx.blue.conf`**
   - Added `zone=download:10m rate=10r/s`
   - Updated download endpoint: `burst=50 nodelay`
   - Added `limit_conn addr 5`

2. **`/home/cvat/cell-segmentation-hub/docker/nginx/nginx.green.conf`**
   - Added `zone=download:10m rate=10r/s`
   - Added complete download endpoint configuration (was missing)
   - Mirrored all blue environment optimizations

## Critical Success Factors

- **Dedicated Rate Limiting**: Downloads isolated from general API traffic
- **Appropriate Burst Capacity**: 50 requests allows for retry scenarios and multiple users
- **Environment Parity**: Both blue and green support downloads identically
- **Connection Limiting**: Prevents resource exhaustion while allowing reasonable concurrency
- **Streaming Optimization**: nginx configured for large file downloads with proper timeouts

## Future Improvements

1. **Dynamic Rate Limiting**: Adjust limits based on file size
2. **User-Based Limits**: Different limits for different user tiers
3. **Geographic Rate Limiting**: Consider user location for limits
4. **Download Analytics**: Track download patterns and optimize accordingly
5. **Resume Support**: Add HTTP range request support for interrupted downloads

## Key Takeaways

- Rate limiting zones should match the specific use case (downloads vs API calls)
- Download endpoints require higher burst capacity than regular API endpoints
- Both blue/green environments must have identical configurations
- Large file downloads need specific nginx optimizations (buffering, timeouts)
- Configuration changes require both environments to be updated simultaneously
