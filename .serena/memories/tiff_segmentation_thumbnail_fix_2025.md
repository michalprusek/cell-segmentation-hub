# TIFF Segmentation Thumbnail Fix - Complete Solution

## Problem Description

Segmentation thumbnails were not being generated for TIFF images. The thumbnails are created by overlaying polygon visualizations on the original image.

## Root Cause

The `VisualizationGenerator` was converting TIFF to a base64 data URL for the node-canvas `loadImage` function, but this approach fails with large TIFF files due to:

1. Base64 encoding increases data size by ~33%
2. Data URLs have size limitations in node-canvas
3. Memory overhead of keeping large base64 strings

## Solution Implementation

### Modified File: `/backend/src/services/visualization/visualizationGenerator.ts`

### Changes Made:

1. **Added imports**: Added `mkdir` and `unlink` from `fs/promises`
2. **Temporary file approach**: Instead of data URLs, convert TIFF to PNG and save to temp file
3. **Proper cleanup**: Added cleanup logic for temp files in both success and error paths

### Key Implementation Details:

```typescript
// Before (problematic):
imageToLoad = `data:image/png;base64,${pngBuffer.toString('base64')}`;

// After (working):
tempPngPath = path.join(
  '/app/uploads/temp',
  `tiff_viz_${Date.now()}_${basename}.png`
);
await writeFile(tempPngPath, pngBuffer);
imageToLoad = tempPngPath;
```

## Technical Flow

1. **Detection**: Check if image has `.tiff` or `.tif` extension
2. **Conversion**: Use Sharp to convert TIFF buffer to PNG buffer
3. **Temp File**: Save PNG to `/app/uploads/temp/` directory
4. **Loading**: Load image from temp file path (not data URL)
5. **Processing**: Generate visualization with polygons overlay
6. **Cleanup**: Delete temp PNG file after processing (or on error)

## Benefits

- ✅ Works with large TIFF files (no size limitations)
- ✅ Lower memory footprint (no base64 encoding)
- ✅ More reliable (file system vs data URLs)
- ✅ Automatic cleanup prevents disk bloat

## Error Handling

- Temp directory creation with `recursive: true`
- Cleanup attempted even on error
- Warnings logged if cleanup fails (non-critical)

## Performance Considerations

- PNG compression: quality 95, compressionLevel 6 (balanced)
- Temp files cleaned immediately after use
- Unique filenames with timestamp to avoid conflicts

## Testing Checklist

✅ Upload TIFF image
✅ Run segmentation on TIFF
✅ Check segmentation thumbnail generation
✅ Verify temp files are cleaned up
✅ Test with large TIFF files (>10MB)
✅ Test error scenarios (corrupted TIFF)

## Related Components

- `SegmentationThumbnailService`: Calls visualization generator
- `ImageService`: Handles browser-compatible display
- `LocalStorageProvider`: Regular thumbnail generation

## Future Improvements

- Consider implementing a temp file cleanup cron job
- Add metrics for TIFF conversion time
- Cache converted TIFF files for reuse
