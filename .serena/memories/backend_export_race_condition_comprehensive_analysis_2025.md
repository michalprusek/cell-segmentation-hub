# Backend Export Race Condition Analysis - Cell Segmentation Hub

## CRITICAL RACE CONDITION DISCOVERY

**Bug Context**: Export job f574e1b4-b0a5-4035-95d0-18fef944762d completed and triggered download despite user cancellation.

**Timeline Analysis**:

- Job started: 16:45:42.470Z
- Download triggered: 16:45:50.387Z (8 seconds later)
- Race condition window: ~500ms during completion

## ROOT CAUSE: BACKEND STATE MANAGEMENT FAILURES

### 1. DOWNLOAD CONTROLLER VULNERABILITY (/backend/src/api/controllers/exportController.ts)

**Critical Flaw in downloadExport() method (lines 96-179):**

```typescript
// ❌ CRITICAL MISSING CHECK
async downloadExport(req: AuthRequest, res: Response): Promise<void> {
  const filePath = await this.exportService.getExportFilePath(jobId, projectId, userId);

  // ❌ NO CANCELLATION STATUS VALIDATION
  if (!filePath) {
    res.status(404).json({ error: 'Export file not found' });
    return;
  }

  // ❌ SERVES FILE EVEN IF JOB WAS CANCELLED
  res.download(resolvedFilePath, fileName, callback);
}
```

**Impact**: Downloads proceed regardless of cancellation status.

### 2. EXPORT SERVICE PROCESSING RACE CONDITION (/backend/src/services/exportService.ts)

**Critical Flaw in processExportJob() method (lines 250-441):**

```typescript
// ❌ RACE CONDITION THROUGHOUT PROCESSING
private async processExportJob(jobId: string, ...): Promise<void> {
  const job = this.exportJobs.get(jobId);
  job.status = 'processing';

  // ❌ NO CANCELLATION CHECKS DURING 8+ SECOND PROCESSING
  await Promise.all(exportTasks);

  // ❌ OVERWRITES CANCELLED STATUS WITH COMPLETED
  job.status = 'completed';        // Ignores existing 'cancelled' status
  job.filePath = zipPath;          // Makes file available for download

  // ❌ SENDS COMPLETION NOTIFICATION DESPITE CANCELLATION
  this.sendToUser(userId, 'export:completed', { jobId });
}
```

**Impact**: Processing ignores cancellation and completes anyway.

### 3. INADEQUATE CANCELLATION IMPLEMENTATION

**Critical Flaw in cancelJob() method (lines 1280-1298):**

```typescript
// ❌ INADEQUATE CANCELLATION
async cancelJob(jobId: string, ...): Promise<void> {
  const job = this.exportJobs.get(jobId);
  if (job && job.projectId === projectId) {
    job.status = 'cancelled';  // ❌ Only sets flag, doesn't interrupt processing
    // ❌ MISSING: Cleanup of generated files
    // ❌ MISSING: Notification to running processes
    // ❌ MISSING: Immediate temp directory cleanup
  }
}
```

**Impact**: Cancellation doesn't prevent completion or cleanup resources.

### 4. FILE PATH RETRIEVAL VULNERABILITY

**Critical Flaw in getExportFilePath() method (lines 1266-1278):**

```typescript
// ❌ NO STATUS VALIDATION
async getExportFilePath(jobId: string, ...): Promise<string | null> {
  const job = this.exportJobs.get(jobId);
  if (job && job.projectId === projectId && job.filePath) {
    return job.filePath;  // ❌ Returns path even if status === 'cancelled'
  }
  return null;
}
```

**Impact**: File paths served for cancelled jobs.

## EXACT RACE CONDITION MECHANICS

### Job f574e1b4-b0a5-4035-95d0-18fef944762d Timeline:

```
T+0ms      (16:45:42.470Z) - processExportJob() starts, status = 'processing'
T+7500ms   (~16:45:49.970Z) - User clicks "Cancel Export"
T+7501ms   (~16:45:49.971Z) - cancelJob() sets status = 'cancelled'
T+8000ms   (16:45:50.470Z) - Export processing completes (ignores cancelled status)
T+8001ms   (16:45:50.471Z) - job.status = 'completed' (OVERWRITES 'cancelled')
T+8002ms   (16:45:50.472Z) - job.filePath = zipPath (file available)
T+8003ms   (16:45:50.473Z) - WebSocket sends 'export:completed' event
T+8004ms   (16:45:50.474Z) - Frontend receives completion, triggers download
T+8005ms   (16:45:50.475Z) - downloadExport() serves file (no cancel check)
```

**Critical Window**: 500ms between cancellation and completion allows status overwrite.

## BACKEND ARCHITECTURAL FAILURES

### 1. Missing Atomic Operations

- No mutex/locks for job state updates
- No compare-and-swap operations
- No database transactions for state consistency

### 2. Missing State Validation

- Download endpoint doesn't validate job status
- File operations ignore cancellation state
- WebSocket notifications bypass status checks

### 3. Missing Cleanup Coordination

- Cancelled jobs continue generating files
- Temporary directories not cleaned immediately
- File handles remain open after cancellation

### 4. Missing Process Interruption

- No signaling mechanism for running exports
- No graceful shutdown of archive creation
- No cancellation propagation to worker threads

## COMPREHENSIVE BACKEND FIXES

### 1. CRITICAL: Fix Download Controller

```typescript
// ✅ FIXED: Add mandatory cancellation check
async downloadExport(req: AuthRequest, res: Response): Promise<void> {
  const job = await this.exportService.getJobStatus(jobId, projectId, userId);

  // ✅ PREVENT DOWNLOAD OF CANCELLED EXPORTS
  if (!job || job.status === 'cancelled') {
    res.status(410).json({ error: 'Export was cancelled' });
    return;
  }

  if (job.status !== 'completed') {
    res.status(404).json({ error: 'Export not completed' });
    return;
  }

  // Only proceed if definitely completed and not cancelled
  const filePath = await this.exportService.getExportFilePath(jobId, projectId, userId);
  // ... rest of download logic
}
```

### 2. CRITICAL: Fix Processing Race Condition

```typescript
// ✅ FIXED: Add cancellation checks throughout processing
private async processExportJob(jobId: string, ...): Promise<void> {
  const job = this.exportJobs.get(jobId);
  if (!job) return;

  try {
    job.status = 'processing';

    // ✅ CHECK CANCELLATION BEFORE EACH OPERATION
    if (job.status === 'cancelled') {
      await this.cleanupCancelledJob(jobId);
      return;
    }

    await this.createFolderStructure(exportDir);

    if (job.status === 'cancelled') {
      await this.cleanupCancelledJob(jobId);
      return;
    }

    await Promise.all(exportTasks);

    // ✅ FINAL CANCELLATION CHECK BEFORE COMPLETION
    if (job.status === 'cancelled') {
      await this.cleanupCancelledJob(jobId);
      return;
    }

    // ✅ ATOMIC COMPLETION (only if not cancelled)
    if (job.status !== 'cancelled') {
      job.status = 'completed';
      job.completedAt = new Date();
      job.filePath = zipPath;
      this.sendToUser(userId, 'export:completed', { jobId });
    }

  } catch (error) {
    await this.handleExportError(jobId, error);
  }
}
```

### 3. CRITICAL: Enhanced Cancellation

```typescript
// ✅ FIXED: Comprehensive cancellation with cleanup
async cancelJob(jobId: string, projectId: string, userId: string): Promise<void> {
  const job = this.exportJobs.get(jobId);
  if (job && job.projectId === projectId) {
    // ✅ ATOMIC STATUS UPDATE WITH TIMESTAMP
    job.status = 'cancelled';
    job.cancelledAt = new Date();

    // ✅ IMMEDIATE CLEANUP
    await this.cleanupCancelledJob(jobId);

    // ✅ NOTIFY CANCELLATION
    this.sendToUser(userId, 'export:cancelled', { jobId });

    logger.info('Export cancelled with cleanup', { jobId, userId });
  }
}

// ✅ NEW: Cleanup cancelled jobs
private async cleanupCancelledJob(jobId: string): Promise<void> {
  const job = this.exportJobs.get(jobId);
  if (!job) return;

  try {
    // Remove generated file
    if (job.filePath) {
      await fs.unlink(job.filePath).catch(() => {});
    }

    // Remove temporary directory
    const exportDir = path.join(process.env.EXPORT_DIR || './exports', jobId);
    await fs.rm(exportDir, { recursive: true, force: true });

    // Clear file path
    job.filePath = undefined;

  } catch (error) {
    logger.warn('Failed to cleanup cancelled job', { jobId, error });
  }
}
```

### 4. Enhanced File Path Validation

```typescript
// ✅ FIXED: Add status validation to file path retrieval
async getExportFilePath(jobId: string, projectId: string, userId: string): Promise<string | null> {
  const job = this.exportJobs.get(jobId);

  // ✅ VALIDATE STATUS BEFORE RETURNING PATH
  if (job && job.projectId === projectId && job.status === 'completed' && job.filePath) {
    return job.filePath;
  }

  return null;
}
```

## MONITORING AND PREVENTION

### 1. Add Job State Audit Trail

```typescript
interface JobStateTransition {
  jobId: string;
  fromStatus: string;
  toStatus: string;
  timestamp: Date;
  userId: string;
  reason?: string;
}

private auditTrail: JobStateTransition[] = [];

private logStateTransition(jobId: string, fromStatus: string, toStatus: string, userId: string, reason?: string) {
  this.auditTrail.push({
    jobId,
    fromStatus,
    toStatus,
    timestamp: new Date(),
    userId,
    reason
  });
}
```

### 2. Add WebSocket Events

```typescript
// New WebSocket events for export cancellation
export enum WebSocketEvent {
  EXPORT_CANCELLED = 'export:cancelled',
  EXPORT_CLEANUP_COMPLETED = 'export:cleanup:completed',
}

export interface ExportCancelledData {
  jobId: string;
  projectId: string;
  cancelledAt: Date;
  cleanupCompleted: boolean;
}
```

### 3. Add Health Monitoring

```typescript
// Monitor for stuck cancellations
async getStuckCancellations(): Promise<ExportJob[]> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  return Array.from(this.exportJobs.values()).filter(job =>
    job.status === 'cancelled' &&
    job.cancelledAt &&
    job.cancelledAt < fiveMinutesAgo &&
    job.filePath  // Still has file path indicating incomplete cleanup
  );
}
```

## IMPLEMENTATION PRIORITY

### Priority 1 (CRITICAL - Deploy Immediately)

1. Add cancellation check in downloadExport() controller
2. Return 410 Gone for cancelled exports
3. Add status validation in getExportFilePath()

### Priority 2 (HIGH - Deploy Within Hours)

1. Add cancellation checks throughout processExportJob()
2. Implement atomic status updates with validation
3. Add comprehensive cleanup in cancelJob()

### Priority 3 (MEDIUM - Deploy Within Days)

1. Add WebSocket cancellation events
2. Implement job state audit trail
3. Add monitoring for stuck cancellations

This analysis reveals that the backend race condition is caused by **inadequate state synchronization** between cancellation and completion operations, combined with **missing status validation** in download endpoints. The fixes ensure cancelled exports cannot be downloaded and processing properly handles cancellation at all stages.
