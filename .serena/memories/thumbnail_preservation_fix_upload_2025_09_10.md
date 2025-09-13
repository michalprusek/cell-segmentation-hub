# Fix: Segmentation Thumbnails Disappearing on Image Upload

## Problem

When uploading new images to a project, existing segmentation thumbnails would disappear and require a page refresh to reappear.

## Root Cause

In `src/pages/ProjectDetail.tsx`, the `handleUploadComplete` function (lines 731-817) was fetching all images from the backend and replacing the entire image list. While it preserved `segmentationResult` data, it didn't preserve the crucial `segmentationThumbnailUrl` and `segmentationThumbnailPath` fields.

## Solution

Modified the merge logic in `handleUploadComplete` to preserve thumbnail URLs:

```typescript
// If this image existed before and had segmentation results, preserve them
if (existingImg && existingImg.segmentationResult) {
  return {
    ...newImg,
    segmentationResult: existingImg.segmentationResult,
    // Preserve segmentation thumbnail URLs
    segmentationThumbnailUrl:
      existingImg.segmentationThumbnailUrl || newImg.segmentationThumbnailUrl,
    segmentationThumbnailPath:
      existingImg.segmentationThumbnailPath || newImg.segmentationThumbnailPath,
    // Also preserve the segmentation status if it was completed
    segmentationStatus:
      existingImg.segmentationStatus === 'completed' ||
      existingImg.segmentationStatus === 'segmented'
        ? existingImg.segmentationStatus
        : newImg.segmentationStatus,
  };
}
```

## Files Modified

- `/src/pages/ProjectDetail.tsx` - Lines 743-757

## Key Insights

1. This was a state management issue where the spread operator `...newImg` was overwriting preserved thumbnail data
2. The logical OR operator ensures we prefer existing thumbnails over new ones from the backend
3. This is a common SSOT (Single Source of Truth) violation pattern where UI state isn't properly preserved during data refreshes

## Testing

After uploading new images:

1. Existing segmentation thumbnails should remain visible
2. No page refresh should be required
3. WebSocket updates should continue working normally

## Date Fixed

2025-09-10
