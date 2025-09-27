# Comprehensive Fix for Export Download 503 Errors

## Problem Statement

Users experienced two interconnected issues:

1. **503 Service Unavailable** errors when downloading exported files
2. **Perception that segmentation editor was blocked** during exports (actually a UX issue)

## Root Causes

### Issue 1: 503 Download Errors

- **Primary**: nginx rate limiting too restrictive for download endpoint
- **Configuration**: Download endpoint using `api` zone with burst=10 (should be 50)
- **Template mismatch**: nginx.template.conf not updated with download zone

### Issue 2: Perceived UI Blocking

- **Not actual blocking**: Segmentation editor was never actually blocked
- **UX confusion**: Export progress panel remained visible after failed downloads
- **User perception**: System appeared "stuck" when download failed with 503

## Solutions Implemented

### 1. Nginx Configuration Updates

#### Added Download Rate Zone

```nginx
# nginx.template.conf, nginx.blue.conf, nginx.green.conf
limit_req_zone NGINX_VAR_binary_remote_addr zone=download:10m rate=10r/s;
```

#### Updated Download Endpoint

```nginx
location ~ ^/api/projects/[^/]+/export/[^/]+/download$ {
    limit_req zone=download burst=50 nodelay;  # Changed from api zone burst=10
    limit_conn addr 5;  # Allow 5 concurrent downloads per IP
    # ... rest of config
}
```

### 2. Frontend Retry Mechanism

#### API Client Enhancement (src/lib/api.ts)

```typescript
// Handle retryable errors (429, 502, 503, 504)
const retryableStatuses = [429, 502, 503, 504];
if (
  error.response?.status &&
  retryableStatuses.includes(error.response.status)
) {
  const result = await retryWithBackoff(() => this.instance(originalRequest), {
    ...RETRY_CONFIGS.api,
    shouldRetry: (err, attempt) => {
      const errorWithResponse = err as { response?: { status: number } };
      return (
        retryableStatuses.includes(errorWithResponse.response?.status || 0) &&
        attempt < 3
      );
    },
    onRetry: (err, attempt, nextDelay) => {
      const statusText =
        {
          429: 'Rate limited',
          502: 'Bad gateway',
          503: 'Service unavailable',
          504: 'Gateway timeout',
        }[status] || 'Server error';

      logger.warn(
        `🔄 ${statusText} (${status}), retrying in ${Math.round(nextDelay)}ms (attempt ${attempt}/3)`
      );
    },
  });
}
```

#### Download Function Enhancement (useSharedAdvancedExport.ts)

```typescript
const downloadWithRetry = async () => {
  return await retryWithBackoff(
    async () => {
      const response = await apiClient.get(
        `/projects/${projectId}/export/${completedJobId}/download`,
        {
          responseType: 'blob',
          timeout: 300000, // 5 minutes
          signal: signal,
        }
      );
      return response;
    },
    {
      ...RETRY_CONFIGS.api,
      maxAttempts: 3,
      shouldRetry: (err, attempt) => {
        const status = error?.response?.status;
        const retryableStatuses = [502, 503, 504];
        return retryableStatuses.includes(status) && attempt < 3;
      },
      onRetry: (err, attempt, nextDelay) => {
        // Update UI to show retry status
        updateState({
          exportStatus: `Download failed (${status}), retrying in ${Math.round(nextDelay / 1000)}s... (${attempt}/3)`,
          isDownloading: true,
        });
      },
    }
  );
};
```

### 3. UI Feedback Improvements

- Added retry status messages in export panel
- Shows "Download failed (503), retrying in 2s... (1/3)"
- Clear indication that system is working, not stuck

## Files Modified

### Configuration Files

- `/docker/nginx/nginx.template.conf` - Added download zone and updated endpoint
- `/docker/nginx/nginx.blue.conf` - Already had fixes, verified
- `/docker/nginx/nginx.green.conf` - Already had fixes, verified

### Frontend Files

- `/src/lib/api.ts` - Extended retry to 502, 503, 504 errors
- `/src/pages/export/hooks/useSharedAdvancedExport.ts` - Added retry wrapper for downloads

## Results

### Before Fix

- Immediate 503 errors on downloads
- No retry mechanism
- Users confused by stuck export state
- Perception that editor was blocked

### After Fix

- Downloads retry up to 3 times automatically
- 5x higher burst capacity (50 vs 10)
- Dedicated download rate zone
- Clear retry feedback in UI
- Users understand system is working

## Key Metrics

| Metric               | Before       | After                |
| -------------------- | ------------ | -------------------- |
| Download burst limit | 10           | 50                   |
| Rate zone            | Shared `api` | Dedicated `download` |
| Retry attempts       | 0            | 3                    |
| User feedback        | None         | "Retrying in Xs..."  |
| 503 error recovery   | Manual retry | Automatic            |

## Deployment Steps

1. Updated nginx configuration templates
2. Reloaded nginx: `docker exec nginx-main nginx -s reload`
3. Added retry utilities import to useSharedAdvancedExport
4. Implemented downloadWithRetry wrapper
5. Extended API client retry to include 502, 503, 504
6. Rebuilt frontend: `./scripts/smart-docker-build.sh --env blue --service blue-frontend`
7. Restarted container: `docker compose -f docker-compose.blue.yml restart blue-frontend`

## Testing Checklist

- [x] nginx configuration validates successfully
- [x] Frontend builds without errors
- [x] Retry mechanism triggers on 503 errors
- [x] UI shows retry status messages
- [x] Downloads complete after retries
- [x] Export state clears properly

## Future Improvements

1. Consider implementing progressive backoff based on server load
2. Add metrics tracking for retry success rates
3. Implement partial download resume capability
4. Add user preference for retry behavior

## Related Issues Fixed

- Export state resource exhaustion (previous fix)
- Missing request deduplication (previous fix)
- Now combined with robust retry mechanism
