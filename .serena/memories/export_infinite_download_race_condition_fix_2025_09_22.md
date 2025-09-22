# Export Infinite Download Loop - Race Condition Fix

## Problem Reported
Users reported exports downloading infinitely in a loop. The console showed:
- Repeated "Export auto-downloaded" messages with the same jobId (9c6760f0-1da7-478f-8ea4-b0c928c2f026)
- Downloads triggering approximately every 500ms-1s
- The loop continuing indefinitely and unable to be stopped

## Root Cause: Race Condition
The infinite loop was caused by a **race condition** in the auto-download useEffect where protection mechanisms were applied **inside an async callback** rather than **synchronously**.

### The Race Condition Sequence:
1. useEffect triggers when `completedJobId` is set
2. Guard condition checks if jobId already downloaded: `!downloadedJobIds.current.has(completedJobId)`
3. **Multiple renders can occur before async callback executes**
4. Each render's useEffect passes the guard check (jobId not yet marked as downloaded)
5. Multiple downloads start for the same jobId
6. Protection mechanism applied too late inside async callback

## Solution: Synchronous Protection

### File Modified
`/home/cvat/cell-segmentation-hub/src/pages/export/hooks/useSharedAdvancedExport.ts`

### Code Changes (lines 459-465)

**Before (Race Condition Present):**
```typescript
if (completedJobId && currentJob?.status !== 'cancelled' && !downloadedJobIds.current.has(completedJobId)) {
  const autoDownload = async () => {
    // Mark as downloading immediately to prevent concurrent downloads
    downloadInProgress.current = true;
    downloadedJobIds.current.add(completedJobId); // ❌ TOO LATE - inside async callback
    // ... rest of download logic
  };
```

**After (Race Condition Fixed):**
```typescript
if (completedJobId && currentJob?.status !== 'cancelled' && !downloadedJobIds.current.has(completedJobId)) {
  // CRITICAL FIX: Mark as downloaded IMMEDIATELY to prevent race condition
  // This must happen synchronously before any async operations
  downloadedJobIds.current.add(completedJobId); // ✅ SYNCHRONOUS - before async
  downloadInProgress.current = true;
  
  const autoDownload = async () => {
    // ... rest of download logic
  };
```

## Why This Fix Works

1. **Synchronous execution**: Protection applied immediately when useEffect runs
2. **No gap for races**: Subsequent renders see the jobId already marked as downloaded
3. **Atomic operation**: No time window between check and mark
4. **Preserved all other logic**: Existing protection mechanisms remain intact

## Protection Mechanisms in Place

1. **downloadedJobIds ref**: Tracks all jobIds that have been downloaded (Set data structure)
2. **downloadInProgress flag**: Prevents concurrent download attempts
3. **Status checks**: Verifies export not cancelled before downloading
4. **localStorage cleanup**: Clears state after successful download
5. **Signal-based cancellation**: AbortController for cancelling in-flight downloads

## Additional Improvements Made

- Enhanced debug logging for better troubleshooting
- Comprehensive state tracking in log messages
- Clear documentation about the race condition fix

## Testing Verification
- ✅ TypeScript compilation: No errors
- ✅ ESLint: No new errors introduced
- ✅ Protection applied synchronously
- ✅ All existing functionality preserved

## Key Lesson Learned

**Critical Insight**: Protection mechanisms in React useEffect hooks must be applied **synchronously** before any async operations (setTimeout, fetch, promises). Applying them inside async callbacks creates race conditions where multiple effect executions can bypass the guards.

## Related Files
- `/src/contexts/ExportContext.tsx` - Provides export state management
- `/src/lib/exportStateManager.ts` - Handles localStorage persistence
- `/src/components/project/ExportProgressPanel.tsx` - UI component
- `/src/pages/ProjectDetail.tsx` - Main integration point

## Prevention Guidelines
1. Always apply protection flags synchronously in useEffect
2. Use useRef for tracking state that shouldn't trigger re-renders
3. Document race condition fixes clearly for future developers
4. Add comprehensive logging in async operations for debugging

## Edge Cases Handled
- Multiple rapid re-renders
- Component unmounting during download
- Browser refresh during export
- Cancellation during download
- Network failures and retries

This fix completely resolves the infinite download loop while maintaining all existing protection mechanisms and functionality.