# Fix: Segmentation Thumbnails Disappearing on Single Image Operations

## Problem

When segmenting or re-segmenting a single image, ALL segmentation thumbnails were disappearing for all images in the gallery, not just the image being processed.

## Root Cause

The `mapImageFields` function in `src/lib/api.ts` was not including the `segmentationThumbnailPath` and `segmentationThumbnailUrl` fields when mapping API responses. When functions like `fetchImages`, `handleBatchCompleted`, and `handleBulkSegmentationCancelled` fetched fresh data from the API, these fields were being set to `undefined`, which cleared all thumbnails.

## Solution

### 1. Update API Client (src/lib/api.ts)

- Added `segmentationThumbnailPath` and `segmentationThumbnailUrl` fields to the `ProjectImage` interface
- Modified `mapImageFields` function to include these fields when mapping API responses

### 2. Preserve Existing Thumbnails in State Updates

Modified three key functions in `src/pages/ProjectDetail.tsx` to preserve existing thumbnails when they're not provided by the API:

- **fetchImages**: Finds existing images and preserves their thumbnail fields if not provided
- **handleBatchCompleted**: Preserves existing thumbnails when refreshing after batch completion
- **handleBulkSegmentationCancelled**: Only clears thumbnails for actually cancelled images

## Key Code Changes

```typescript
// In mapImageFields (api.ts)
const segmentationThumbnailPath = image.segmentationThumbnailPath as
  | string
  | undefined;
const segmentationThumbnailUrl = segmentationThumbnailPath
  ? ensureAbsoluteUrl(segmentationThumbnailPath)
  : (image.segmentationThumbnailUrl as string | undefined);

// In fetchImages and similar functions (ProjectDetail.tsx)
const existingImage = images.find(existing => existing.id === img.id);
return {
  // ... other fields
  segmentationThumbnailPath:
    img.segmentationThumbnailPath || existingImage?.segmentationThumbnailPath,
  segmentationThumbnailUrl:
    img.segmentationThumbnailUrl || existingImage?.segmentationThumbnailUrl,
};
```

## Testing

- Linting passes with no errors
- TypeScript compilation successful
- The fix ensures thumbnails are preserved unless explicitly cleared (e.g., during re-segmentation)

## Related Files

- `/src/lib/api.ts` - API client with field mapping
- `/src/pages/ProjectDetail.tsx` - Main component with state management
- `/src/hooks/useProjectData.tsx` - Hook that correctly updates single images
