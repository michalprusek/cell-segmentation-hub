# WebSocket Export Debugging - Critical Issues Analysis 2025

## CRITICAL ISSUES IDENTIFIED

### 1. Missing WebSocket Event Emission in cancelJob()

**PROBLEM**: The `cancelJob()` method in `exportService.ts` (lines 1495-1531) does NOT emit a WebSocket event when called via HTTP API.

**Current Implementation**:

```typescript
async cancelJob(jobId: string, projectId: string, userId: string): Promise<void> {
  // ... access checks ...

  const job = this.exportJobs.get(jobId);
  if (job && job.projectId === projectId) {
    job.status = 'cancelled';
    job.completedAt = new Date();

    // ❌ MISSING: WebSocket event emission
    const cancelData = {
      jobId,
      projectId,
      cancelledBy: 'user' as const,
      progress: job.progress,
      cleanupCompleted: true,
      message: 'Export cancelled by user',
      timestamp: new Date(),
    };

    // ❌ THIS NEVER GETS EXECUTED - MISSING sendToUser call
    // this.sendToUser(userId, 'export:cancelled', cancelData);
  }
}
```

**ISSUE**: The cancel data is prepared but `sendToUser()` is never called, so frontend never receives the cancellation confirmation.

### 2. Progress Updates with Large Jumps Instead of Gradual Increments

**PROBLEM**: Progress updates in `updateJobProgress()` (lines 1340-1370) are called at fixed intervals rather than granular updates.

**Current Progress Points**:

- Line 343: `updateJobProgress(jobId, 10)` - After folder creation
- Line 369: `updateJobProgress(jobId, 10 + progressStep * progressIncrement)` - After each major task
- Line 431: `updateJobProgress(jobId, 90)` - After all tasks complete
- Line 438: `updateJobProgress(jobId, 100)` - Final completion

**ISSUE**: Progress jumps in large increments (0% → 10% → 50% → 90% → 100%) instead of smooth progression.

### 3. WebSocket Service Missing export:cancel Event Handler

**PROBLEM**: `websocketService.ts` handles `operation:cancel` events (lines 272-355) but NOT specific `export:cancel` events.

**Current Handler**:

```typescript
// ✅ Has generic operation:cancel handler
socket.on('operation:cancel', async (data: {
  operationId: string;
  operationType: 'upload' | 'segmentation' | 'export';
  projectId?: string;
}) => {
  // ...
  case 'export':
    // ❌ Only emits WebSocket event, doesn't call export service
    this.emitToUser(socket.userId, 'export:cancelled', {
      operationId: data.operationId,
      message: 'Export cancelled by user',
      timestamp: new Date().toISOString()
    });
    break;
});
```

**MISSING**: Direct `export:cancel` event handler that calls exportService.cancelJob().

### 4. Frontend WebSocket Cancel Implementation Issues

**PROBLEM**: `useSharedAdvancedExport.ts` cancelExport function (lines 618-662) has race condition potential.

**Current Implementation**:

```typescript
const cancelExport = useCallback(async () => {
  // ... immediate state update ...

  try {
    // ✅ HTTP API call
    await apiClient.post(
      `/projects/${projectId}/export/${currentJob.id}/cancel`
    );

    // ✅ WebSocket emit
    if (socket && socket.connected) {
      socket.emit('export:cancel', {
        jobId: currentJob.id,
        projectId,
      });
    }

    // ❌ RACE CONDITION: Immediate state clear before server confirmation
    updateState({
      currentJob: null,
      isExporting: false,
      // ...
    });
  } catch (error) {
    // Error handling
  }
}, [projectId, currentJob, updateState, socket]);
```

**ISSUES**:

1. State cleared immediately instead of waiting for server confirmation
2. WebSocket `export:cancel` event not handled by server
3. Export might complete before cancellation takes effect

### 5. Two-Phase Progress System Confusion

**PROBLEM**: `ExportProgressPanel.tsx` implements confusing two-phase progress (lines 164-182).

**Current Logic**:

```typescript
const getProgressPercentage = () => {
  // ...

  // Two-phase progress: Processing (0-50%) + Downloading (50-100%)
  if (phase === 'downloading') {
    return Math.round(50 + exportProgress * 0.5);
  }

  if (isExporting && !isDownloading) {
    return Math.round(exportProgress * 0.5);
  }

  return Math.round(exportProgress);
};
```

**ISSUE**: This artificially caps processing progress at 50%, causing confusion when actual export progress reaches 100% but UI shows 50%.

## ROOT CAUSE ANALYSIS

### Missing WebSocket Event Chain

**Expected Flow**:

1. User clicks cancel → HTTP API call + WebSocket emit
2. Server receives HTTP request → exportService.cancelJob()
3. exportService.cancelJob() → Emits WebSocket event
4. Frontend receives WebSocket event → Updates UI

**Actual Flow**:

1. User clicks cancel → HTTP API call + WebSocket emit ✅
2. Server receives HTTP request → exportService.cancelJob() ✅
3. exportService.cancelJob() → ❌ NO WebSocket event emitted
4. Frontend → ❌ Never receives confirmation, updates UI immediately

### Progress Calculation Problems

**Expected**: Smooth 0-100% progress with frequent updates
**Actual**: Large jumps at fixed milestones (10%, 50%, 90%, 100%)

**Root Cause**: Progress only updated at major task boundaries, not during individual operations.

### Race Condition in Cancel Flow

**Expected**: Cancel request → Server stops processing → Confirmation → UI update
**Actual**: Cancel request → Immediate UI update → Server may still complete export

## IMMEDIATE FIXES REQUIRED

1. **Add WebSocket emission to cancelJob()**:

   ```typescript
   // In exportService.ts cancelJob method, add:
   this.sendToUser(userId, 'export:cancelled', cancelData);
   ```

2. **Add granular progress updates**:
   - Update progress during file copying loops
   - Update progress during visualization generation
   - More frequent progress emissions

3. **Fix WebSocket cancel event handling**:
   - Add `export:cancel` handler to websocketService
   - Connect to exportService.cancelJob()

4. **Fix frontend race condition**:
   - Wait for server confirmation before clearing state
   - Only update UI based on WebSocket events

5. **Simplify progress calculation**:
   - Remove two-phase progress system
   - Use actual server progress directly
