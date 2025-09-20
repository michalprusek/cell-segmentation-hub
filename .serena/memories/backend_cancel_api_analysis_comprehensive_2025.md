# Backend Cancel API Analysis - Cell Segmentation Hub

## EXISTING CANCEL FUNCTIONALITY

### 1. Export Cancel API (IMPLEMENTED)

**Endpoint:** `POST /projects/:projectId/export/:jobId/cancel`

- **File:** `/backend/src/api/routes/exportRoutes.ts` (lines 60-69)
- **Controller:** `/backend/src/api/controllers/exportController.ts` (lines 171-201)
- **Service:** `/backend/src/services/exportService.ts` (cancelJob method, lines 1279-1297)

**Implementation Details:**

- **Authentication:** Required via JWT middleware
- **Validation:** UUID validation for projectId and jobId
- **Access Control:** SharingService.hasProjectAccess() validation
- **Cancellation Logic:**
  - Sets job status to 'cancelled'
  - Removes Bull queue job if in 'waiting' or 'delayed' state
  - Supports both owned and shared projects
- **Response:** JSON success message
- **Error Handling:** Standard error logging and 500 response

### 2. Segmentation Queue Cancel API (IMPLEMENTED)

**Endpoint:** `DELETE /api/queue/items/:queueId`

- **File:** `/backend/src/api/routes/queueRoutes.ts` (lines 94-101)
- **Controller:** `/backend/src/api/controllers/queueController.ts` (lines 408-464)
- **Service:** `/backend/src/services/queueService.ts` (removeFromQueue method, lines 365-398)

**Implementation Details:**

- **Authentication:** Required via JWT middleware
- **Validation:** UUID validation for queueId
- **Access Control:** User ownership validation
- **Cancellation Logic:**
  - Only allows removal of 'queued' status items (not processing)
  - Deletes from segmentationQueue table
  - Updates image status to 'no_segmentation'
  - Emits WebSocket updates
- **WebSocket Events:**
  - `segmentationUpdate` with status 'no_segmentation'
  - `queueStats` update for project
- **Response:** JSON success message

## MISSING CANCEL FUNCTIONALITY

### 1. Upload Cancel API (NOT IMPLEMENTED)

**Missing Endpoint:** No upload cancellation endpoint exists

- **Current Upload Route:** `POST /projects/:id/images` (imageRoutes.ts)
- **Upload Middleware:** Uses multer middleware for file uploads
- **Missing Features:**
  - No endpoint to cancel in-progress uploads
  - No cleanup mechanism for partial uploads
  - No WebSocket events for upload cancellation

### 2. Processing Segmentation Cancel (LIMITATION)

**Current Limitation:** Cannot cancel items with 'processing' status

- **Restriction:** queueService.removeFromQueue only allows 'queued' status
- **Missing Features:**
  - No mechanism to interrupt ML service processing
  - No communication with Python ML service for cancellation
  - Processing items cannot be cancelled until completion

## WEBSOCKET INTEGRATION

### Current WebSocket Events (websocketService.ts)

- `segmentationUpdate` - Used for queue cancellation
- `queueStats` - Updated after cancellation
- `notification` - Used for completion notifications

### WebSocket Types Available (types/websocket.ts)

- `SegmentationUpdateData` - Includes 'cancelled' status (line 443)
- `QueueUpdateData` - Supports 'cancelled' operation (line 204)
- `QueueStatsData` - Updated after operations

### Missing WebSocket Events

- Upload progress cancellation events
- Export job progress cancellation events
- Real-time cancel confirmation events

## QUEUE MANAGEMENT ANALYSIS

### Current Queue Operations

1. **Add to Queue:** `addToQueue()`, `addBatchToQueue()`
2. **Remove from Queue:** `removeFromQueue()` - Only 'queued' items
3. **Reset Stuck Items:** `resetStuckItems()` - For stuck processing items
4. **Cleanup Old Entries:** `cleanupOldEntries()` - Maintenance operation

### Queue Status Flow

- `queued` → `processing` → `completed`/`failed`
- **Cancellation Points:**
  - ✅ Can cancel 'queued' items
  - ❌ Cannot cancel 'processing' items (limitation)

### Redis Queue Support

- Uses Bull queue for export jobs (can remove waiting/delayed jobs)
- Segmentation queue uses PostgreSQL (direct database operations)

## TECHNICAL PATTERNS

### Error Handling Pattern

```typescript
try {
  // Validation
  if (!userId) return unauthorized();

  // Access control
  const hasAccess = await checkAccess();
  if (!hasAccess) return notFound();

  // Business logic
  await service.cancel();

  // WebSocket updates
  websocket.emit(updates);

  // Success response
  return success();
} catch (error) {
  logger.error();
  return internalError();
}
```

### WebSocket Update Pattern

```typescript
// Emit individual update
websocketService.emitSegmentationUpdate(userId, {
  imageId,
  projectId,
  status: 'cancelled',
});

// Emit stats update
websocketService.emitQueueStatsUpdate(projectId, stats);
```

## RECOMMENDATIONS

### 1. Upload Cancel Implementation Needed

- Add `POST /projects/:id/uploads/:uploadId/cancel` endpoint
- Implement upload tracking with unique IDs
- Add multer abort mechanism
- Emit upload cancellation WebSocket events

### 2. Processing Cancel Enhancement

- Add ML service communication for processing cancellation
- Implement graceful interruption of inference
- Update queue status to support 'cancelling' state

### 3. WebSocket Event Standardization

- Add dedicated cancel events for all operations
- Implement cancel confirmation events
- Add progress updates during cancellation
