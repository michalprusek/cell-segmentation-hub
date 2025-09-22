# Export Cancel Race Condition Fix - Cell Segmentation Hub

## Critical Bug: Auto-Download After Cancel

**Problem**: After clicking cancel export button, the file still downloads and "downloading" animation appears briefly - a state management race condition.

## Root Cause Analysis

### Race Condition Scenario:

1. **User clicks Cancel Export** → `cancelExport()` called
2. **Export completes simultaneously** → WebSocket sends `export:completed`
3. **WebSocket handler** sets `completedJobId`
4. **Auto-download useEffect** triggers due to `completedJobId` change
5. **Cancel API call completes** → clears some states
6. **Auto-download continues** → downloads file + shows animation

### Critical Issues Found:

#### 1. **Incomplete State Clearing in cancelExport()**

```typescript
// ❌ BEFORE - Missing critical state clears:
const cancelExport = useCallback(async () => {
  // ... cancel API call
  setCurrentJob(prev => (prev ? { ...prev, status: 'cancelled' } : null));
  setIsExporting(false);
  setExportStatus('Export cancelled');
  // ❌ MISSING: setCompletedJobId(null)
  // ❌ MISSING: setIsDownloading(false)
  // ❌ MISSING: ExportStateManager.clearExportState(projectId)
}, [projectId, currentJob]);
```

#### 2. **Auto-Download Missing Cancel Checks**

```typescript
// ❌ BEFORE - No cancel protection:
useEffect(() => {
  if (completedJobId) {
    const autoDownload = async () => {
      setIsDownloading(true); // ❌ No cancel check!
      // ... download proceeds
    };
    setTimeout(autoDownload, 1000);
  }
}, [completedJobId, projectId]); // ❌ Missing currentJob dependency
```

#### 3. **WebSocket Handler Missing Cancel Protection**

```typescript
// ❌ BEFORE - Always processes completion:
const handleCompleted = (data: { jobId: string }) => {
  if (data.jobId === currentJob.id) {
    setCompletedJobId(data.jobId); // ❌ Even if cancelled!
  }
};
```

## Complete Solution

### 1. **Enhanced cancelExport() Function**

```typescript
const cancelExport = useCallback(async () => {
  if (!currentJob) return;
  try {
    await apiClient.post(
      `/projects/${projectId}/export/${currentJob.id}/cancel`
    );

    // ✅ Clear ALL related states immediately to prevent race conditions
    setCurrentJob(prev => (prev ? { ...prev, status: 'cancelled' } : null));
    setIsExporting(false);
    setCompletedJobId(null); // ✅ Prevent auto-download
    setIsDownloading(false); // ✅ Clear downloading state
    setExportStatus('Export cancelled');

    // ✅ Clear persistence immediately to prevent cross-tab sync issues
    ExportStateManager.clearExportState(projectId);

    logger.info('Export cancelled - all states cleared', {
      jobId: currentJob.id,
    });
  } catch (error) {
    logger.error('Failed to cancel export', error);
  }
}, [projectId, currentJob]);
```

### 2. **Protected Auto-Download Logic**

```typescript
// Auto-download when export completes
useEffect(() => {
  // ✅ Only auto-download if export completed and wasn't cancelled
  if (completedJobId && currentJob?.status !== 'cancelled') {
    const autoDownload = async () => {
      try {
        // ✅ Additional runtime check before download to prevent race conditions
        if (!currentJob || currentJob.status === 'cancelled') {
          logger.info('Auto-download skipped - export was cancelled');
          return;
        }

        setIsDownloading(true);
        // ... rest of download logic
      }
    };
    setTimeout(autoDownload, 1000);
  } else if (completedJobId && currentJob?.status === 'cancelled') {
    // ✅ Clear completedJobId if export was cancelled
    logger.info('Clearing completedJobId for cancelled export');
    setCompletedJobId(null);
  }
}, [completedJobId, projectId, currentJob]); // ✅ Added currentJob dependency
```

### 3. **Protected WebSocket Handler**

```typescript
const handleCompleted = (data: { jobId: string }) => {
  // ✅ Only process completion if export hasn't been cancelled
  if (data.jobId === currentJob.id && currentJob.status !== 'cancelled') {
    setCurrentJob(prev => (prev ? { ...prev, status: 'completed' } : null));
    setExportStatus('Export completed! Starting download...');
    setIsExporting(false);
    setCompletedJobId(data.jobId);
  } else if (currentJob.status === 'cancelled') {
    logger.info('Export completion ignored - export was cancelled', {
      jobId: data.jobId,
    });
  }
};
```

### 4. **Protected Polling Mechanism**

```typescript
if (status.status === 'completed') {
  // ✅ Only process completion if not cancelled
  if (currentJob.status !== 'cancelled') {
    setCurrentJob(prev => (prev ? { ...prev, status: 'completed' } : null));
    setExportStatus('Export completed! Starting download...');
    setIsExporting(false);
    setCompletedJobId(currentJob.id);
  }
  clearInterval(interval);
  setPollingInterval(null);
} else if (status.status === 'failed' || status.status === 'cancelled') {
  setCurrentJob(prev =>
    prev ? { ...prev, status: status.status, message: status.message } : null
  );
  setExportStatus(
    `Export ${status.status}: ${status.message || 'Unknown error'}`
  );
  setIsExporting(false);
  // ✅ Clear state on failure or cancellation
  ExportStateManager.clearExportState(projectId);
  clearInterval(interval);
  setPollingInterval(null);
}
```

## Technical Details

### State Synchronization Order:

1. **Immediate state clearing** in `cancelExport()` prevents race conditions
2. **Cancel status propagates** through all components via `currentJob.status`
3. **Auto-download checks** cancel status before proceeding
4. **Persistence layer** cleared to prevent cross-tab restoration

### React Hook Dependencies:

```typescript
// ❌ Before (missing dependency):
}, [completedJobId, projectId]);

// ✅ After (includes cancel state):
}, [completedJobId, projectId, currentJob]);
```

This ensures auto-download re-evaluates when `currentJob.status` changes to 'cancelled'.

### Key Protection Points:

1. **cancelExport()** - Immediate state clearing
2. **Auto-download useEffect** - Cancel check + dependency
3. **WebSocket handlers** - Cancel status verification
4. **Polling mechanism** - Cancel status verification
5. **Persistence layer** - Immediate cleanup

## Testing Scenarios

### 1. **Cancel During Export**

- Click cancel while export is processing
- ✅ Export stops, no download occurs
- ✅ No "downloading" animation

### 2. **Cancel At Completion Moment**

- Export completes exactly when cancel clicked
- ✅ Download prevented by cancel checks
- ✅ State cleared properly

### 3. **Cross-Tab Synchronization**

- Cancel in one tab, check other tabs
- ✅ State cleared across all tabs
- ✅ No phantom downloads

## Files Modified

- **Primary**: `/src/pages/export/hooks/useAdvancedExport.ts`
- **Impact**: All export functionality in the app
- **Risk**: Low - Only adds protection logic

## Prevention Patterns

### For Future Export Features:

1. **Always check cancel status** before state-changing operations
2. **Include currentJob in dependencies** for cancel-sensitive useEffects
3. **Clear all related states** in cancel functions
4. **Clear persistence** immediately on cancellation
5. **Add runtime checks** in async operations

This fix eliminates the race condition completely and provides a robust pattern for handling cancellation in async operations with React hooks.
