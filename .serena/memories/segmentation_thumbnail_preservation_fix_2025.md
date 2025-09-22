# Segmentation Thumbnail Preservation Fix 2025

## Problem Description

User reported: "když segmentuji obrázky, tak se mi na konci refreshne image gallery, ale zmizí mi segmentační thumbnails (server side)" - When segmenting images, at the end the image gallery refreshes but the segmentation thumbnails (server-side) disappear.

## Root Cause Analysis

### Issue Identified

The `fetchImages` function in `ProjectDetail.tsx` was explicitly setting segmentation thumbnail fields to `undefined`, destroying the thumbnail data that the backend correctly provides.

### SSOT Violation

Multiple functions in ProjectDetail.tsx were performing similar image fetching and formatting operations with inconsistent implementations:

- `handleBatchCompleted` - **CORRECT** implementation that preserves thumbnails
- `fetchImages` - **BROKEN** implementation that destroys thumbnails
- `handleBulkSegmentationCancelled` - Intentionally clears thumbnails (expected behavior)

## Solution Implemented

### Fixed Code Location

**File**: `/home/cvat/cell-segmentation-hub/src/pages/ProjectDetail.tsx`
**Function**: `fetchImages` (lines 509-562)

### Changes Made

Changed lines 553-554 from:

```typescript
segmentationThumbnailPath: undefined,
segmentationThumbnailUrl: undefined,
```

To:

```typescript
segmentationThumbnailPath: img.segmentationThumbnailPath,
segmentationThumbnailUrl: img.segmentationThumbnailUrl,
```

### Complete Fixed Function

```typescript
const fetchImages = useCallback(async () => {
  if (!id || !user?.id) return;

  try {
    // Fetch all images with pagination
    let allImages: any[] = [];
    let page = 1;
    let hasMore = true;
    const limit = 50;

    while (hasMore) {
      const imagesResponse = await apiClient.getProjectImages(id, {
        limit,
        page,
      });

      if (!imagesResponse.images || !Array.isArray(imagesResponse.images)) {
        break;
      }

      allImages = [...allImages, ...imagesResponse.images];
      hasMore = page * limit < imagesResponse.total;
      page++;

      if (page > 40) break; // Safety limit
    }

    const formattedImages = (allImages || []).map(img => {
      let segmentationStatus =
        img.segmentationStatus || img.segmentation_status;
      if (segmentationStatus === 'segmented') {
        segmentationStatus = 'completed';
      }

      return {
        id: img.id,
        name: img.name,
        url: img.url || img.image_url,
        thumbnail_url: img.thumbnail_url,
        createdAt: new Date(img.created_at || img.createdAt),
        updatedAt: new Date(img.updated_at || img.updatedAt),
        segmentationStatus: segmentationStatus,
        segmentationResult: img.segmentationResult,
        segmentationThumbnailPath: img.segmentationThumbnailPath, // ✅ PRESERVED
        segmentationThumbnailUrl: img.segmentationThumbnailUrl, // ✅ PRESERVED
      };
    });

    updateImages(formattedImages);
  } catch (error) {
    logger.error('Failed to fetch images after cancellation', error);
  }
}, [id, user?.id, updateImages]);
```

## Technical Details

### Backend API Response Structure

The backend correctly returns these fields:

- `segmentationThumbnailPath`: Database field containing file path
- `segmentationThumbnailUrl`: Generated URL from storage provider

### Frontend Image Card Thumbnail Priority

The ImageCard component looks for thumbnails in this order:

1. `segmentationThumbnailUrl` or `segmentationThumbnailPath`
2. `thumbnail_url`
3. `url`
4. `image_url`

## Future Improvements Recommended

### 1. Create SSOT Utility Function

Create a single `formatImageResponse` utility to handle all backend-to-frontend image mapping:

```typescript
export function formatImageResponse(
  img: any,
  options?: { clearSegmentation?: boolean }
) {
  let segmentationStatus = img.segmentationStatus || img.segmentation_status;
  if (segmentationStatus === 'segmented') {
    segmentationStatus = 'completed';
  }

  return {
    id: img.id,
    name: img.name,
    url: img.url || img.image_url,
    thumbnail_url: img.thumbnail_url,
    createdAt: new Date(img.created_at || img.createdAt),
    updatedAt: new Date(img.updated_at || img.updatedAt),
    segmentationStatus: segmentationStatus,
    segmentationResult: options?.clearSegmentation
      ? undefined
      : img.segmentationResult,
    segmentationThumbnailPath: options?.clearSegmentation
      ? undefined
      : img.segmentationThumbnailPath,
    segmentationThumbnailUrl: options?.clearSegmentation
      ? undefined
      : img.segmentationThumbnailUrl,
  };
}
```

### 2. Replace All Duplicate Logic

Use the utility function in all places:

- `fetchImages`
- `handleBatchCompleted`
- `handleBulkSegmentationCancelled` (with `clearSegmentation: true`)
- `handleUploadComplete`

## Testing Verification

### Test Scenarios

1. **Batch Segmentation Completion**: Thumbnails should persist after batch completes
2. **Manual Gallery Refresh**: Thumbnails should remain visible
3. **Bulk Cancellation**: Thumbnails should be cleared (intentional)
4. **Navigation Between Projects**: Thumbnails should load correctly

### Verification Status

- ✅ TypeScript compilation passes
- ✅ ESLint passes (no new issues)
- ✅ No breaking changes
- ✅ Backward compatible

## Impact

This fix ensures that segmentation thumbnails are properly preserved when the gallery refreshes after batch segmentation completion. Users will no longer experience disappearing thumbnails, improving the visual feedback and user experience when working with segmented images.
