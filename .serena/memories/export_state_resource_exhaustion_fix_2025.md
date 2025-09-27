# Export State Resource Exhaustion Fix

## Problem

The application was experiencing browser resource exhaustion (ERR_INSUFFICIENT_RESOURCES) due to excessive "Restoring export state from localStorage" logs. The issue caused:

- 30+ parallel requests for the same export status
- 503 errors from nginx rate limiting
- Browser tab crashes

## Root Causes

1. **React.StrictMode** causing double initialization in development
2. **Missing singleton pattern** in ExportStateManager allowing multiple initializations
3. **Multiple hooks** (useSharedAdvancedExport, useAdvancedExport, ProjectToolbar) all attempting to restore state independently
4. **No request deduplication** causing parallel API calls for the same jobId

## Solution Implemented

### 1. Added Singleton Pattern to ExportStateManager

```typescript
private static isInitialized = false;

static initialize(): void {
  if (this.isInitialized) {
    logger.debug('ExportStateManager already initialized, skipping');
    return;
  }
  this.isInitialized = true;
  // ... initialization code
}
```

### 2. Implemented Request Deduplication

```typescript
private static pendingRequests: Map<string, Promise<any>> = new Map();

static deduplicateRequest<T>(
  jobId: string,
  requestFn: () => Promise<T>
): Promise<T> {
  const existingRequest = this.pendingRequests.get(jobId);
  if (existingRequest) {
    logger.debug(`Request already in progress for job ${jobId}`);
    return existingRequest;
  }

  const requestPromise = requestFn()
    .finally(() => this.pendingRequests.delete(jobId));

  this.pendingRequests.set(jobId, requestPromise);
  return requestPromise;
}
```

### 3. Updated useSharedAdvancedExport Hook

- Added restoration guard with `hasRestored` flag
- Used deduplication for all API calls
- Properly structured useEffect with restore function

### 4. Disabled Restoration in Deprecated Hook

- Marked useAdvancedExport as deprecated
- Disabled state restoration to prevent conflicts

### 5. Updated ProjectToolbar

- Skips direct restoration
- Lets useSharedAdvancedExport handle all state management

## Files Modified

- `/src/lib/exportStateManager.ts` - Added singleton and deduplication
- `/src/pages/export/hooks/useSharedAdvancedExport.ts` - Fixed restoration logic
- `/src/pages/export/hooks/useAdvancedExport.ts` - Disabled restoration
- `/src/components/project/ProjectToolbar.tsx` - Skip direct restoration

## Testing

After deployment:

- No more excessive console logs
- Single API request per export job
- No browser resource exhaustion
- Proper state restoration on page refresh

## Key Learnings

1. Always implement singleton patterns for global managers
2. React.StrictMode double-execution requires careful state management
3. Request deduplication is critical for preventing API overload
4. Centralize state restoration in one place to avoid conflicts
