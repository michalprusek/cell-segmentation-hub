# TIFF Single Extension (.tif) ML Service Segmentation Fix

## Problem Description

Date: 2025-09-26
Issue: TIFF images with `.tif` extension (single 'f') were failing during segmentation with 400 Bad Request errors from ML service.

### Symptoms

- Upload appeared successful but showed "Upload failed" message
- ML service returned 400 Bad Request for `.tif` files
- Segmentation status changed from queued → processing → failed
- Only affected `.tif` files, while `.tiff` files worked fine

### Error Logs

```
INFO: 172.18.0.6:58120 - "POST /api/v1/segment HTTP/1.1" 400 Bad Request
[WARN] 🔴 SEGMENTATION UPDATE RECEIVED: {imageId: '...', status: 'failed', ...}
```

## Root Cause Analysis

### The Bug

Location: `/backend/segmentation/api/routes.py` line 41

**Before (BROKEN):**

```python
valid_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.bmp'}  # Missing .tif
```

**After (FIXED):**

```python
valid_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'}  # Added .tif
```

### Why It Happened

1. The ML service validation function only accepted `.tiff` (double 'f') extension
2. Many TIFF files use `.tif` (single 'f') following 3-letter extension convention
3. Validation rejected `.tif` files before they reached the image processing pipeline
4. Ironically, the underlying PIL/PyTorch processing would handle both formats correctly

### Validation Chain

```
Backend (Node.js) → Accepts both .tif and .tiff
    ↓
ML Service Validation → REJECTED .tif files (400 Bad Request)
    ↓ (never reached for .tif)
PIL Image Processing → Would work for both formats
```

## Solution Implementation

### Files Modified

1. `/backend/segmentation/api/routes.py`
   - Line 41: Added `.tif` to valid_extensions set
   - Line 131: Updated error message to include TIF format
   - Line 242: Updated batch error message to include TIF format

### Changes Applied

```python
# Line 41
valid_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'}

# Line 131 & 242
"Supported formats: PNG, JPG, JPEG, TIFF, TIF, BMP"
```

## Testing & Verification

### Test Results

```
📤 Testing: file.tif
   Extension: .tif
✅ SUCCESS! File accepted and processed

📤 Testing: file.tiff
   Extension: .tiff
✅ SUCCESS! File accepted and processed
```

### Verification Steps

1. Restart ML service: `docker restart blue-ml`
2. Test with both `.tif` and `.tiff` files
3. Confirm segmentation completes successfully
4. Check polygons are detected and returned

## Related Components

### Working Correctly (No Changes Needed)

- Backend image controller - Already accepts both formats
- Storage service - Handles both extensions properly
- Thumbnail generation - Converts TIFF to JPEG correctly
- Display endpoint - Converts TIFF to PNG for browser viewing
- Frontend TIFF utilities - Handle both extensions

### ML Service Components

- `/backend/segmentation/services/inference.py` - Already supported both formats
- `/backend/segmentation/utils/model_loader.py` - PIL handles both correctly
- Only the validation layer was blocking `.tif` files

## Lessons Learned

1. **Validation Consistency**: Ensure file extension validation matches across all services
2. **Common Conventions**: Support both common variants (.tif/.tiff, .jpg/.jpeg, etc.)
3. **Error Messages**: 400 Bad Request at validation layer prevented deeper debugging
4. **Testing Coverage**: Need tests for all file extension variants

## Prevention Strategies

1. **Centralize Format Definitions**: Create single source of truth for supported formats
2. **Comprehensive Testing**: Test all common file extension variants
3. **Validation Alignment**: Ensure frontend, backend, and ML service accept same formats
4. **Better Error Logging**: Log specific validation failures with details

## Quick Reference

### Issue

- `.tif` files → 400 Bad Request from ML service

### Fix

- Add `.tif` to `valid_extensions` in `/backend/segmentation/api/routes.py`

### Commands

```bash
# Restart ML service after fix
docker restart blue-ml

# Check logs
docker logs blue-ml --tail 50

# Test endpoint
curl -X POST http://localhost:4008/api/v1/segment \
  -F "file=@test.tif" \
  -F "model=hrnet"
```

## Related Memory Files

- `tiff_image_support_fix_2025` - Original TIFF display support implementation
- `tiff_segmentation_thumbnail_fix_2025` - TIFF thumbnail generation fixes
- `tiff_gallery_thumbnail_priority_fix_2025` - Gallery thumbnail handling
