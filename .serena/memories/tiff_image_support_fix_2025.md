# TIFF Image Support Fix - Complete Solution

## Problem Description

TIFF images were not displaying properly in the application:

1. Upload preview showed no thumbnails for TIFF files
2. Segmentation editor showed only polygons without the actual TIFF image

## Root Cause Analysis

### Backend Status (WORKING)

- TIFF support fully implemented in backend (`image/tiff`, `image/tif` in SUPPORTED_MIME_TYPES)
- Sharp library correctly converts TIFF to JPEG for thumbnails
- `/api/images/{id}/display` endpoint converts TIFF to PNG for browser display
- Caching system in place for converted images

### Frontend Issues (FIXED)

1. **Upload Preview**: TIFF files cannot be displayed via blob URLs in browsers
2. **Segmentation Editor**: Needed explicit TIFF detection to ensure display endpoint usage

## Solution Implementation

### 1. Created TIFF Utility Module (`src/lib/tiffUtils.ts`)

```typescript
- isTiffFile(): Detects TIFF files by MIME type or extension
- ensureBrowserCompatibleUrl(): Forces display endpoint for TIFF files
- getImageFallbackUrls(): Provides ordered fallback URLs with TIFF prioritization
```

### 2. Updated Upload Preview (`src/components/upload/UploadFileCard.tsx`)

- Added TIFF label indicator when preview not available
- Graceful fallback to placeholder icon for TIFF files

### 3. Fixed Segmentation Editor (`src/pages/segmentation/SegmentationEditor.tsx`)

- Uses ensureBrowserCompatibleUrl() to guarantee TIFF compatibility
- Ensures TIFF images always use `/api/images/{id}/display` endpoint

### 4. Enhanced Image Cards (`src/components/project/ImageCard.tsx`)

- Uses getImageFallbackUrls() for intelligent URL selection
- Prioritizes display endpoint for TIFF files

## Technical Details

### Browser Limitations

- Browsers cannot natively display TIFF format
- TIFF requires server-side conversion to PNG/JPEG
- Blob URLs (createObjectURL) don't work for TIFF

### Conversion Flow

1. Upload: TIFF → Store original + Generate JPEG thumbnail
2. Display: Request → Check format → Convert to PNG if TIFF → Serve PNG
3. Caching: Converted PNGs cached in `uploads/converted/` directory

### Performance Optimizations

- Converted images cached to avoid repeated processing
- Background cleanup of old cached conversions
- Compression settings: PNG quality 90, compression level 6

## Files Modified

- `/src/lib/tiffUtils.ts` (new)
- `/src/components/upload/UploadFileCard.tsx`
- `/src/pages/segmentation/SegmentationEditor.tsx`
- `/src/components/project/ImageCard.tsx`

## Testing Checklist

✅ Upload TIFF file - shows TIFF label in preview
✅ View TIFF in project gallery - thumbnail displays
✅ Open TIFF in segmentation editor - image displays
✅ Polygons overlay correctly on TIFF images
✅ Other formats (JPG, PNG) still work correctly

## Future Improvements

- Consider client-side TIFF.js library for preview generation
- Add progress indicator for TIFF conversion
- Support multi-page TIFF files
- Optimize caching strategy for large TIFF files
