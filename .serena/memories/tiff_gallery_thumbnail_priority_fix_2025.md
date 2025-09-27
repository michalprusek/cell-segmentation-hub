# TIFF Gallery Thumbnail Priority Fix

## Problem Description

TIFF thumbnails were not displaying correctly in the project image gallery. While the backend was generating JPEG thumbnails from TIFF files, the frontend was prioritizing the display endpoint over the actual thumbnail URLs.

## Root Cause

The `getImageFallbackUrls` function in `tiffUtils.ts` was prioritizing the `/api/images/{id}/display` endpoint for TIFF files. This endpoint converts the full-size original TIFF to PNG, which is:

1. Slower to load (full-size conversion)
2. More resource-intensive
3. Not optimal for gallery thumbnails

## Solution

Updated the URL priority logic for TIFF files to prefer actual thumbnails:

### Modified: `/src/lib/tiffUtils.ts`

```typescript
// For TIFF files, new priority order:
1. Segmentation thumbnail (if available) - best for gallery
2. Regular thumbnail (JPEG converted from TIFF) - good for gallery
3. Display endpoint (converts TIFF to PNG) - fallback
4. Other URLs as final fallbacks
```

## Technical Details

### Before (problematic priority):

```typescript
if (isTiff) {
  urls.push(displayEndpoint); // Display endpoint first
  // ... other URLs after
}
```

### After (optimized priority):

```typescript
if (isTiff) {
  if (image.segmentationThumbnailUrl) urls.push(image.segmentationThumbnailUrl);
  if (image.thumbnail_url) urls.push(image.thumbnail_url); // JPEG thumbnail
  urls.push(displayEndpoint); // Display endpoint as fallback
  // ... other URLs
}
```

## Benefits

- ✅ Faster loading in gallery (small JPEG thumbnails vs full PNG conversion)
- ✅ Better performance (thumbnails are pre-generated)
- ✅ Reduced server load (no on-the-fly conversion for gallery)
- ✅ Display endpoint still available as fallback

## Complete TIFF Support Summary

### Three-Layer TIFF Support:

1. **Upload Preview**: Shows "TIFF" label placeholder (browsers can't preview TIFF)
2. **Gallery Thumbnails**: Uses JPEG thumbnails generated during upload
3. **Segmentation Editor**: Uses display endpoint for full-quality PNG conversion
4. **Segmentation Thumbnails**: Temporary file approach for visualization overlay

### Backend Processing:

- Upload: TIFF → Store original + Generate JPEG thumbnail
- Display: TIFF → Convert to PNG on-demand (cached)
- Segmentation: TIFF → Temp PNG → Overlay → Thumbnail

## Testing Checklist

✅ TIFF upload shows "TIFF" label in preview
✅ TIFF thumbnails display in project gallery
✅ TIFF images display in segmentation editor
✅ Segmentation thumbnails generate for TIFF
✅ Other formats (JPEG, PNG) still work
