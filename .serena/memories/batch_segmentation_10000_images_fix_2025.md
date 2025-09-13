# Batch Segmentation Fix for 10,000 Images - 2025-09-10

## Problem Description

When uploading 400+ images to a project:

1. "Segment All" button showed only (30) instead of actual count
2. After page refresh, count corrected to (400)
3. Clicking "Segment All" resulted in 400 Bad Request error

## Root Causes Identified

### 1. Backend Batch Limit

- **Location**: `/backend/src/types/validation.ts:54` and `/backend/src/api/controllers/queueController.ts:208`
- **Issue**: Hard-coded limit of 100 images per batch request
- **Impact**: 400+ images caused validation failure

### 2. Default Pagination Limit

- **Location**: `/backend/src/types/validation.ts:176`
- **Issue**: Default pagination limit was 30, max was 50
- **Impact**: UI initially showed only first 30 images

### 3. Missing Frontend Chunking

- **Location**: `/src/pages/ProjectDetail.tsx` - `handleSegmentAll` function
- **Issue**: No automatic chunking for large batches
- **Impact**: Single request with 400+ images failed validation

## Solution Implemented

### 1. Increased Backend Limits

```typescript
// /backend/src/types/validation.ts
export const batchQueueSchema = z.object({
  imageIds: z
    .array(uuidSchema)
    .min(1, 'Musíte zadat alespoň jeden obrázek')
    .max(10000, 'Můžete zpracovat maximálně 10000 obrázků najednou'),
  // ... rest of schema
});

// /backend/src/api/controllers/queueController.ts
if (imageIds.length > 10000) {
  ResponseHelper.validationError(
    res,
    'Můžete zpracovat maximálně 10000 obrázků najednou'
  );
  return;
}
```

### 2. Fixed Pagination Defaults

```typescript
// /backend/src/types/validation.ts
limit: z.coerce.number().int().min(1).max(100).optional().default(50),
```

### 3. Added Frontend Chunking

```typescript
// /src/pages/ProjectDetail.tsx - handleSegmentAll function
const processImageChunks = async (
  imageIds: string[],
  forceResegment: boolean
) => {
  const CHUNK_SIZE = 500; // Process 500 images at a time
  let processedCount = 0;

  for (let i = 0; i < imageIds.length; i += CHUNK_SIZE) {
    const chunk = imageIds.slice(i, i + CHUNK_SIZE);

    // Show progress for large batches
    if (imageIds.length > CHUNK_SIZE) {
      const progress = Math.round((i / imageIds.length) * 100);
      toast.info(
        t('projects.processingBatch', {
          processed: i,
          total: imageIds.length,
          percent: progress,
        }) || `Processing: ${i}/${imageIds.length} (${progress}%)`,
        { id: 'batch-progress' }
      );
    }

    const response = await apiClient.addBatchToQueue(
      chunk,
      id,
      selectedModel,
      confidenceThreshold,
      0, // priority
      forceResegment,
      detectHoles
    );
    processedCount += response.queuedCount;
  }

  return processedCount;
};
```

## Key Changes Summary

1. **Backend validation**: Increased from 100 to 10,000 images max
2. **Pagination**: Default 50, max 100 (was: default 30, max 50)
3. **Frontend chunking**: Automatically splits large batches into 500-image chunks
4. **Progress tracking**: Shows progress toast for batches > 500 images
5. **Error handling**: Dismisses progress toast on error

## Performance Considerations

- **Chunk size**: 500 images per request balances speed and reliability
- **Database queries**: May need optimization for 10,000+ image queries
- **Memory usage**: Monitor server memory with large batches
- **Processing time**: 10,000 images = 20 chunks × ~2 seconds = ~40 seconds total

## Testing Recommendations

1. Test with exactly 400 images (original issue)
2. Test with 1000, 5000, and 10000 images
3. Monitor server memory and CPU during large batches
4. Verify WebSocket queue updates work with large batches
5. Test error recovery if one chunk fails

## Future Improvements

1. Consider implementing queue priorities for large batches
2. Add batch cancellation feature
3. Optimize database queries for large image sets
4. Consider background job processing for 5000+ images
5. Add estimated time remaining to progress display

## Related Files Modified

- `/backend/src/types/validation.ts` - Validation schemas
- `/backend/src/api/controllers/queueController.ts` - API endpoint
- `/src/pages/ProjectDetail.tsx` - Frontend batch processing

## Notes

- Frontend already had proper pagination in `handleUploadComplete`
- Upload infrastructure supports 10,000 files (from previous fixes)
- Rate limiting may need adjustment for 20+ chunk requests
