# TIFF Image Segmentation 400 Bad Request Fix

## Problem Description

TIFF images were failing during ML service segmentation with "400 Bad Request" error:

- ML service returned "Invalid image file. Supported formats: PNG, JPG, JPEG, TIFF, BMP"
- Images with `.tif` extension (single 'f') were being rejected
- Backend correctly sent TIFF images but ML service validation failed

## Root Cause Analysis

### Backend Analysis (Working Correctly)

1. **FormData preparation** in `SegmentationService.requestSegmentation()` (lines 373-377):

   ```typescript
   formData.append('file', imageBuffer, {
     filename: image.name,
     contentType: image.mimeType || 'image/jpeg', // Correctly sends 'image/tiff'
   });
   ```

2. **Storage handling** in `LocalStorageProvider`:
   - Original TIFF files stored as-is (no conversion)
   - `getBuffer()` returns original TIFF data
   - Thumbnails converted to JPEG for display only

### ML Service Issue (The Problem)

**File**: `/backend/segmentation/api/routes.py` line 41

**Before (Broken)**:

```python
valid_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.bmp'}
```

**Problem**: Missing `.tif` extension (single 'f')

### Validation Logic

```python
def validate_image(file: UploadFile) -> bool:
    filename_parts = file.filename.split('.')
    ext = '.' + filename_parts[-1].lower()
    return ext in valid_extensions  # Failed for .tif files
```

## Solution Implementation

### 1. Updated Valid Extensions

```python
valid_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'}
```

### 2. Updated Error Messages

- Single endpoint: "Supported formats: PNG, JPG, JPEG, TIFF, TIF, BMP"
- Batch endpoint: "Supported formats: PNG, JPG, JPEG, TIFF, TIF, BMP"

### 3. Files Modified

- `/backend/segmentation/api/routes.py` - Lines 41, 144, 255

## Testing Results

### Before Fix

```bash
curl -X POST http://localhost:4008/api/v1/segment -F "file=@image.tif"
# Result: {"detail":"Invalid image file. Supported formats: PNG, JPG, JPEG, TIFF, BMP"}
```

### After Fix

```bash
curl -X POST http://localhost:4008/api/v1/segment -F "file=@image.tif"
# Result: {"success": true, "polygons": [...], ...}
```

## Key Insights

1. **TIFF File Extensions**: Both `.tiff` and `.tif` are valid TIFF extensions
2. **Backend vs ML Service**: The backend handled TIFF correctly; only ML service validation was broken
3. **PIL Compatibility**: Python PIL/Pillow handles both TIFF extensions without issues
4. **No Format Conversion Needed**: TIFF images work directly with the ML pipeline

## Validation Flow

1. **Upload**: User uploads `.tif` image via frontend
2. **Backend Storage**: Stores original `.tif` file (no conversion)
3. **Segmentation Request**: Backend sends original buffer to ML service
4. **ML Validation**: Now accepts both `.tiff` and `.tif` extensions
5. **PIL Processing**: PIL successfully opens TIFF buffer
6. **Inference**: Model processes TIFF image normally
7. **Response**: Returns polygons successfully

## Prevention

### Code Review Checklist

- [ ] Check all file extension validations include both `.tiff` and `.tif`
- [ ] Test with actual files using both extensions
- [ ] Verify error messages reflect all supported formats
- [ ] Ensure consistent validation across all endpoints

### Testing Protocol

```bash
# Test both TIFF extensions
curl -X POST /api/v1/segment -F "file=@test.tif"
curl -X POST /api/v1/segment -F "file=@test.tiff"

# Test batch endpoint
curl -X POST /api/v1/batch-segment -F "files=@test.tif" -F "files=@test.tiff"
```

## Production Deployment

### Immediate Actions Required

1. Deploy fixed ML service to all environments
2. Test TIFF segmentation in production
3. Monitor for any regression issues

### Environment Impact

- **Blue Environment**: ✅ Fixed
- **Green Environment**: Needs deployment
- **Development**: Needs deployment

## Related Issues

This fix resolves the core 400 Bad Request issue. Related TIFF issues that were already resolved:

- TIFF display in browser (uses conversion endpoint)
- TIFF thumbnail generation (uses Sharp conversion)
- TIFF upload preview (shows file type indicator)

## Performance Impact

- **Minimal**: Only adds one additional string comparison (`.tif`)
- **No Runtime Changes**: TIFF processing pipeline unchanged
- **Backward Compatible**: All existing formats still work
