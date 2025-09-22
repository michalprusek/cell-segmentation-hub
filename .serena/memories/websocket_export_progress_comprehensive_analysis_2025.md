# WebSocket Export Progress Communication - Comprehensive Analysis

## Current Implementation Overview

The export progress system uses a combination of WebSocket events and HTTP polling as fallback, with persistent state management for cross-session continuity.

## 1. Export Progress WebSocket Events

### Current Event Schema

```typescript
// Backend ExportService Events
'export:started' - { jobId: string };
'export:progress' - { jobId: string, progress: number };
'export:completed' - { jobId: string };
'export:failed' - { jobId: string, error: string };
'export:cancelled' -
  { operationId: string, message: string, timestamp: string };
```

### Missing Events (Critical Gaps)

- **No two-phase progress tracking** (processing vs downloading phases)
- **No detailed progress metadata** (current/total items, stage info)
- **No progress interpolation data** for template rendering
- **No phase-specific status messages**
- **No cancellation acknowledgment events**

### Data Transmission Issues

- Progress is a simple number (0-100) without context
- No indication of current export stage (visualization, annotations, metrics, etc.)
- Missing estimated time remaining
- No file size information for download preparation

## 2. WebSocket Client Integration

### Frontend Event Handlers (useAdvancedExport.ts)

```typescript
// Current WebSocket listeners
socket.on('export:progress', handleProgress);
socket.on('export:completed', handleCompleted);
socket.on('export:failed', handleFailed);

// Missing handlers for:
// - export:started acknowledgment
// - export:cancelled acknowledgment
// - export:phase-changed events
// - export:download-ready events
```

### Event Processing Problems

- **Simple progress handling**: Only updates percentage, no stage info
- **No template interpolation**: Progress messages are static
- **Limited error context**: Failed events lack actionable information
- **No cancellation feedback**: Users don't get immediate cancel confirmation

### State Synchronization Issues

- WebSocket events don't always sync with localStorage state
- Cross-tab synchronization relies only on localStorage events
- No WebSocket room management for export-specific events

## 3. Real-time Progress Updates

### Current Implementation

```typescript
// Backend: ExportService.updateJobProgress()
private updateJobProgress(jobId: string, progress: number): void {
  const job = this.exportJobs.get(jobId);
  if (job) {
    job.progress = progress;
    this.sendToUser(job.userId, 'export:progress', { jobId, progress });
  }
}
```

### Critical Issues

- **Single progress value**: No distinction between processing phases
- **No granular updates**: Progress jumps in large increments (10% chunks)
- **Missing stage information**: Users don't know what's being processed
- **No contextual messages**: Generic "Processing..." without specifics

### Event Frequency Problems

- **Inconsistent timing**: Progress updates depend on export task completion
- **Large gaps**: No updates during long-running operations (file compression)
- **No heartbeat**: Users may think export is stuck

## 4. Export Cancellation via WebSocket

### Current Cancellation Flow

```typescript
// Frontend: Universal cancel operation
socket.emit('operation:cancel', {
  operationId: string,
  operationType: 'export',
  projectId?: string
});

// Backend: Generic cancellation response
socket.emit('operation:cancel-ack', {
  operationId: string,
  operationType: 'export',
  success: boolean
});
```

### Cancellation Issues

- **No export-specific handling**: Uses generic operation cancellation
- **Missing cleanup events**: No notification of file cleanup completion
- **Delayed feedback**: Users don't see immediate cancel acknowledgment
- **State inconsistency**: Export state may persist after cancellation

## 5. WebSocket Connection Management

### Connection Reliability Issues

- **Auto-reconnection**: Works but progress may be lost during disconnection
- **Room management**: No export-specific rooms for isolated event handling
- **Fallback mechanism**: Polling works but users lose real-time feedback

### Export Progress Recovery Problems

```typescript
// Current recovery in useAdvancedExport
const checkResumedExportStatus = useCallback(
  async (jobId: string) => {
    const response = await apiClient.get(
      `/projects/${projectId}/export/${jobId}/status`
    );
    // Only gets basic status, no real-time reconnection
  },
  [projectId]
);
```

- **Limited recovery**: Only basic status, no real-time event re-subscription
- **No progress interpolation**: Users see stale progress after reconnection
- **Missing context**: Resumed exports don't show current stage

## 6. Current Event Data Structure

### Backend Event Format

```typescript
// ExportService.sendToUser() - Generic structure
this.wsService.emitToUser(userId, event, data);

// No standardized event envelope
// No correlation IDs for tracking
// No timestamp information
// No retry mechanisms
```

### Frontend Event Handling

```typescript
// Simple event data extraction
const handleProgress = (data: { jobId: string; progress: number }) => {
  if (data.jobId === currentJob.id) {
    setExportProgress(data.progress);
    setExportStatus(`Processing... ${Math.round(data.progress)}%`);
  }
};
```

## 7. Identified Issues and Problems

### A. Two-Phase Progress Tracking Missing

- **No processing vs downloading distinction**
- **Export panel shows single progress bar for both phases**
- **Users can't distinguish between export generation and download**

### B. Template Interpolation Problems

```typescript
// Current: Static messages
setExportStatus(`Processing... ${Math.round(data.progress)}%`);

// Missing: Dynamic template data
// "Processing visualizations (5/50 images)..."
// "Generating annotations (3/4 formats)..."
// "Compressing archive (85% complete)..."
```

### C. Real-time Communication Gaps

- **No stage-specific events**: Users don't know export is generating visualizations vs metrics
- **Missing progress granularity**: 10% jumps feel unresponsive
- **No time estimates**: Users can't plan around export completion
- **Limited error context**: Failed exports lack actionable error messages

### D. Connection Recovery Issues

- **Progress context loss**: Reconnected users see stale progress
- **Event replay missing**: No mechanism to catch up on missed events
- **State drift**: WebSocket and localStorage state can diverge

### E. Cancellation System Problems

- **Generic cancellation**: Export-specific cancellation logic is missing
- **No immediate feedback**: Users don't see cancel acknowledgment
- **Incomplete cleanup**: Cancelled exports may leave temporary files
- **State persistence**: Export state may remain after cancellation

## 8. Recommended Improvements

### A. Enhanced Event Schema

```typescript
interface ExportProgressEvent {
  jobId: string;
  phase: 'processing' | 'downloading';
  stage?:
    | 'images'
    | 'visualizations'
    | 'annotations'
    | 'metrics'
    | 'compression';
  progress: number;
  stageProgress?: {
    current: number;
    total: number;
    item?: string; // current file/task being processed
  };
  message: string;
  estimatedTimeRemaining?: number;
  timestamp: Date;
}

interface ExportPhaseChangeEvent {
  jobId: string;
  fromPhase: string;
  toPhase: string;
  message: string;
  progress: number;
}
```

### B. Template Interpolation System

```typescript
// Backend: Rich progress data
const progressData = {
  current: 5,
  total: 50,
  stage: 'visualizations',
  fileName: 'cell_image_001.jpg',
};

this.wsService.emitToUser(userId, 'export:progress', {
  jobId,
  progress: 15,
  template: 'export.stage.visualizations',
  data: progressData,
});

// Frontend: Template rendering
const message = t('export.stage.visualizations', {
  current: data.current,
  total: data.total,
  fileName: data.fileName,
});
// Result: "Generating visualizations (5/50): cell_image_001.jpg"
```

### C. Export-Specific WebSocket Rooms

```typescript
// Backend: Join export-specific room
socket.join(`export:${jobId}`);

// Send events to specific export job subscribers
this.io.to(`export:${jobId}`).emit('export:progress', progressData);
```

### D. Enhanced Cancellation System

```typescript
// Frontend: Export-specific cancellation
socket.emit('export:cancel', { jobId, reason: 'user_request' });

// Backend: Export-specific cancel handling
socket.on('export:cancel', async data => {
  await exportService.cancelJob(data.jobId);
  socket.emit('export:cancelled', {
    jobId: data.jobId,
    message: 'Export cancelled successfully',
    cleanupCompleted: true,
  });
});
```

### E. Connection Recovery Improvements

```typescript
// Backend: Export event replay for reconnections
const replayExportEvents = (socket, userId) => {
  const activeExports = getActiveExportsForUser(userId);
  activeExports.forEach(exportJob => {
    socket.emit('export:status-sync', {
      jobId: exportJob.id,
      progress: exportJob.progress,
      phase: exportJob.phase,
      stage: exportJob.stage,
      message: exportJob.currentMessage,
    });
  });
};
```

## 9. Implementation Priority

### High Priority

1. **Two-phase progress tracking** - Essential for user experience
2. **Template interpolation system** - Improves progress messaging
3. **Enhanced cancellation feedback** - Critical for responsive UX
4. **Connection recovery with event replay** - Prevents progress loss

### Medium Priority

5. **Export-specific WebSocket rooms** - Better event isolation
6. **Granular stage tracking** - More detailed progress information
7. **Time estimation** - Helps users plan workflow

### Low Priority

8. **Cross-tab synchronization improvements** - Edge case optimization
9. **Event compression** - Performance optimization for large exports
10. **Export history via WebSocket** - Real-time history updates

## 10. Testing Requirements

### WebSocket Event Testing

- Event delivery verification for all export phases
- Connection drop and recovery during export
- Multiple concurrent export handling
- Cancellation event timing and acknowledgment

### Progress Accuracy Testing

- Two-phase progress calculation verification
- Template interpolation with various data sets
- Edge cases (empty exports, single file exports)
- Long-running export behavior (large projects)

### Integration Testing

- WebSocket + localStorage state synchronization
- Cross-browser WebSocket support
- Mobile device connection handling
- Production WebSocket configuration validation
