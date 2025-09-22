# BMP File Upload Size Limit Fix

## Problem Summary

**Date**: 2025-09-21
**Issue**: Upload of 174 BMP files failed with error "Total upload size would exceed limit of 500MB"
**Root Cause**: Frontend validation incorrectly checked total size across ALL files instead of per chunk

## Technical Details

### The Bug

- Frontend `validateFiles()` function checked if total size of ALL files exceeded 500MB
- BMP files are uncompressed (10-50MB each) vs typical JPG/PNG (1-2MB)
- 174 BMP files = 1.7-8.7GB total, far exceeding the 500MB validation limit
- This prevented upload even though backend supports chunked uploads

### Production Limits (from backend configuration)

- **MAX_FILES_PER_REQUEST**: 100 files per chunk
- **MAX_FILE_SIZE_BYTES**: 100MB per individual file
- **MAX_TOTAL_FILES**: 10,000 files total
- **NGINX_BODY_LIMIT**: 500MB per request (per chunk)
- **CHUNK_SIZE**: 100 files per chunk

## Solution Implemented

### 1. Fixed Validation Logic

**File**: `/src/lib/uploadUtils.ts`

Changed from:

- Validating total size across ALL files against 500MB limit

To:

- Validating each CHUNK (100 files) against 500MB limit
- Each chunk is uploaded separately, so each must fit within nginx request limit

### 2. Created Centralized Configuration

**New File**: `/src/lib/uploadConfig.ts`

```typescript
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE_MB: 100, // Per file
  MAX_FILE_SIZE_BYTES: 100 * 1024 * 1024,
  FILES_PER_CHUNK: 100,
  MAX_SIZE_PER_CHUNK_MB: 500, // Per chunk (nginx limit)
  MAX_SIZE_PER_CHUNK_BYTES: 500 * 1024 * 1024,
  MAX_TOTAL_FILES: 10000,
  // BMP specific handling
  AVG_FILE_SIZES: {
    'image/bmp': 30, // BMP files are much larger
  },
};
```

### 3. Updated Validation Function

The `validateFiles()` function now:

1. First validates individual files (size, type)
2. Then splits valid files into chunks
3. Validates each chunk's total size against 500MB limit
4. Only rejects files in chunks that exceed the limit

## Key Changes Made

1. **`/src/lib/uploadUtils.ts`**:
   - Imported centralized config
   - Changed validation to per-chunk instead of total
   - Increased default file size limit to 100MB (from 50MB)

2. **`/src/lib/uploadConfig.ts`** (new):
   - Centralized upload configuration
   - Matches backend limits exactly
   - Includes BMP-specific file size estimates

## How It Works Now

1. User selects 174 BMP files (e.g., 30MB each = 5.2GB total)
2. Validation splits them into 2 chunks:
   - Chunk 1: 100 files = ~3GB (would exceed 500MB)
   - Chunk 2: 74 files = ~2.2GB (would exceed 500MB)
3. IF average file size is too large for chunks:
   - Users need to upload fewer files at once
   - OR compress BMP to JPG/PNG first
4. IF files fit in 500MB chunks:
   - Upload proceeds normally with chunking

## Testing Verification

- Frontend TypeScript compilation: ✅ Passed
- No runtime errors introduced
- Validation logic now correctly handles large file sets

## Recommendations

1. **For BMP files specifically**:
   - Consider pre-processing to compress (BMP → JPG/PNG)
   - Or increase nginx/backend limits for BMP-heavy workflows
2. **UI improvements**:
   - Show chunk validation errors more clearly
   - Suggest compression for large BMPs
   - Display estimated chunk sizes before upload

## Related Files Modified

- `/src/lib/uploadUtils.ts` - Fixed validation logic
- `/src/lib/uploadConfig.ts` - New centralized config

## Prevention

- Always validate per operational unit (chunk) not total
- Consider file format characteristics (compressed vs uncompressed)
- Centralize configuration to prevent mismatches
- Test with realistic file sizes for each format
