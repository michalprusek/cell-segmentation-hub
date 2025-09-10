# Critical Frontend Bug Analysis: API Flooding During Batch Image Uploads

## Date: 2025-09-10

## Executive Summary

**CRITICAL BUG IDENTIFIED**: React components are causing severe API flooding during batch image uploads (257 images). The system makes 50+ duplicate API calls for the same endpoint, causing ERR_INSUFFICIENT_RESOURCES, 429 (Too Many Requests), and 503 (Service Unavailable) errors.

## Root Cause Analysis

### Primary Issue: Multiple Concurrent WebSocket Event Handlers

**Location**: `/src/pages/ProjectDetail.tsx:469-570`

**Problem**: The WebSocket event handler for completed segmentation triggers immediate API calls without proper debouncing or deduplication:

```typescript
// CRITICAL ISSUE: Lines 469-476
if (
  (lastUpdate.status === 'segmented' || lastUpdate.status === 'completed') &&
  lastUpdate.status !== 'no_segmentation'
) {
  // Immediate refresh for completed status - this will also validate if polygons exist
  (async () => {
    logger.debug('Refreshing segmentation data', 'ProjectDetail', {
      imageId: lastUpdate.imageId,
    });

    try {
      // ❌ PROBLEM: Individual API call for EVERY WebSocket event
      await refreshImageSegmentationRef.current(lastUpdate.imageId);
```

**Impact**: During batch processing of 257 images:

- 257 WebSocket `segmented` events fired simultaneously
- Each event triggers individual `refreshImageSegmentation` call
- Results in 257+ concurrent API requests for segmentation data
- Browser hits ERR_INSUFFICIENT_RESOURCES

### Secondary Issue: Race Conditions in State Updates

**Location**: `/src/pages/ProjectDetail.tsx:492-528`

**Problem**: Multiple nested state updates in async IIFE without proper coordination:

```typescript
// CRITICAL ISSUE: Lines 492-528 - Multiple state updates in sequence
updateImagesRef.current(prevImages => {
  const currentImg = prevImages.find(i => i.id === lastUpdate.imageId);
  const hasPolygons =
    currentImg?.segmentationResult?.polygons &&
    currentImg.segmentationResult.polygons.length > 0;

  return prevImages.map(prevImg => {
    if (prevImg.id === lastUpdate.imageId) {
      const finalStatus = hasPolygons ? 'completed' : 'no_segmentation';

      return {
        ...prevImg,
        segmentationStatus: finalStatus,
        // ❌ PROBLEM: Forces re-render with timestamp
        lastSegmentationUpdate: Date.now(),
        // ❌ PROBLEM: Another API call to get thumbnail
        thumbnail_url: img?.thumbnail_url
          ? `${img.thumbnail_url}?t=${Date.now()}`
          : prevImg.thumbnail_url,
      };
    }
    return prevImg;
  });
});
```

### Tertiary Issue: Pagination Loading Triggers Bulk API Calls

**Location**: `/src/pages/ProjectDetail.tsx:184-270`

**Problem**: The visible images effect triggers API calls for all completed images:

```typescript
// PROBLEMATIC PATTERN: Lines 199-247
const segmentationPromises = imagesToEnrich.map(async img => {
  try {
    // ❌ PROBLEM: Individual API call for each visible completed image
    const segmentationData = await apiClient.getSegmentationResults(img.id);
    return {
      imageId: img.id,
      segmentationData: segmentationData ? {...} : null,
    };
  } catch (error) {
    // Error handling...
  }
});

// ❌ PROBLEM: Promise.all creates burst of concurrent requests
const results = await Promise.all(segmentationPromises);
```

## Specific Code Locations Causing API Flooding

### 1. **ProjectDetail.tsx:469-476** - WebSocket Handler

- **Issue**: No debouncing for batch completions
- **Result**: 257 concurrent `refreshImageSegmentation` calls
- **API Endpoint**: `GET /api/projects/{id}/images/{imageId}/segmentation`

### 2. **ProjectDetail.tsx:483** - Individual Image API Call

- **Issue**: Fetches updated image data after segmentation refresh
- **Result**: Additional 257 concurrent `GET /api/projects/{id}/images/{imageId}` calls
- **Code**: `const img = await apiClient.getImage(id, lastUpdate.imageId);`

### 3. **ProjectDetail.tsx:200-247** - Pagination Effect

- **Issue**: Triggers when pagination changes during batch processing
- **Result**: Additional burst of API calls for visible images
- **Pattern**: N+1 query problem with Promise.all

### 4. **useProjectData.tsx:378** - refreshImageSegmentation

- **Issue**: No request deduplication despite pendingRequestsRef
- **Result**: Duplicate requests for same imageId slip through
- **Code**: `const segmentationData = await apiClient.getSegmentationResults(imageId);`

## React Anti-Patterns Identified

### 1. **Uncontrolled Async Operations in useEffect**

```typescript
// ❌ BAD: Async IIFE without cleanup or cancellation
(async () => {
  try {
    await refreshImageSegmentationRef.current(lastUpdate.imageId);
    await new Promise(resolve => setTimeout(resolve, 500));
    const img = await apiClient.getImage(id, lastUpdate.imageId);
    // More async operations...
  } catch (error) {
    // Error handling
  }
})().catch(err => {
  // Unhandled rejection handling
});
```

**Fix**: Use AbortController and proper cleanup

### 2. **Missing Debouncing for Rapid Events**

```typescript
// ❌ BAD: No debouncing for WebSocket events
useEffect(() => {
  if (!lastUpdate || lastUpdate.projectId !== id) return;

  // Immediate processing of every event
  if (lastUpdate.status === 'segmented') {
    // Immediate API call
  }
}, [lastUpdate, id]);
```

**Fix**: Implement proper event batching and debouncing

### 3. **State Updates Triggering More State Updates**

```typescript
// ❌ BAD: Cascading state updates
updateImagesRef.current(prevImages => {
  // State update 1
  return prevImages.map(img => ({
    ...img,
    lastSegmentationUpdate: Date.now(), // Triggers re-render
  }));
});

// Then immediately another state update
updateImagesRef.current(prevImages => {
  // State update 2 - triggered by re-render
});
```

**Fix**: Batch all state updates into single operation

## Progress Bar Jump Issue (0% → 67% → 100%)

**Root Cause**: Multiple progress sources conflicting:

1. **HTTP Chunk Progress**: Reports progress for current chunk (0-100%)
2. **WebSocket Progress**: Reports individual file progress (0-100%)
3. **Overall Progress**: Calculated incorrectly mixing both sources

**Location**: `/src/components/ImageUploader.tsx:157-162`

```typescript
// ❌ PROBLEM: Chunk progress overwrites WebSocket progress
progressPercent => {
  setUploadProgress(progressPercent); // Chunk progress (jumpy)
},
```

**Fix**: Prioritize WebSocket progress events over HTTP chunk progress

## Memory and Performance Impact

### Browser Resource Exhaustion

- **API Calls**: 257+ concurrent requests
- **Memory**: Each request holds connection + response data
- **Network**: TCP connection pool exhaustion
- **DOM**: Excessive re-renders from state updates

### Backend Impact

- **Database**: 514+ concurrent queries (2 per image: ownership + segmentation)
- **Connection Pool**: Prisma connection exhaustion
- **Rate Limiting**: Triggers 429 errors
- **Load Balancer**: 503 Service Unavailable

## Files Requiring Immediate Fixes

### Critical Priority

1. `/src/pages/ProjectDetail.tsx` - WebSocket event batching
2. `/src/hooks/useProjectData.tsx` - Request deduplication
3. `/src/components/ImageUploader.tsx` - Progress calculation

### High Priority

1. `/src/hooks/useSegmentationQueue.tsx` - Toast batching (already implemented)
2. `/backend/src/api/routes/segmentation.ts` - Bulk endpoints

## Recommended Immediate Fixes

### 1. Debounce WebSocket Events

```typescript
// Add to ProjectDetail.tsx
const debouncedWebSocketHandler = useMemo(
  () =>
    debounce((updates: SegmentationUpdate[]) => {
      // Process all updates in batch
    }, 500),
  []
);
```

### 2. Request Deduplication

```typescript
// Enhance useProjectData.tsx
const activeRequests = useRef<Map<string, Promise<any>>>(new Map());

const refreshImageSegmentation = async (imageId: string) => {
  if (activeRequests.current.has(imageId)) {
    return activeRequests.current.get(imageId);
  }

  const request = apiClient.getSegmentationResults(imageId);
  activeRequests.current.set(imageId, request);

  try {
    return await request;
  } finally {
    activeRequests.current.delete(imageId);
  }
};
```

### 3. Batch API Endpoint

```typescript
// Add to backend
router.get(
  '/projects/:projectId/images/batch-segmentation/:imageIds',
  async (req, res) => {
    const imageIds = req.params.imageIds.split(',');
    const results = await Promise.all(
      imageIds.map(id => getSegmentationResults(id))
    );
    res.json(Object.fromEntries(imageIds.map((id, i) => [id, results[i]])));
  }
);
```

## Next Steps

1. **Immediate**: Implement WebSocket event debouncing
2. **Short-term**: Add request deduplication and batch API
3. **Medium-term**: Redesign progress reporting system
4. **Long-term**: Implement proper state management for bulk operations

## Testing Verification

After fixes, verify with 257 image batch:

- API calls should be ≤ 10 (batched)
- Progress should be smooth (WebSocket-driven)
- No ERR_INSUFFICIENT_RESOURCES errors
- Memory usage stable during processing
