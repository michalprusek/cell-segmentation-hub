# Frontend Upload 420 Files Debug Fix - September 10, 2025

## Critical Problems Identified and Fixed

### Problem 1: "Unknown size" Display Bug

**Location**: `/src/components/upload/FileList.tsx` line 30
**Root Cause**: File objects were losing `size` property during state updates due to improper spread operator usage with `{...f}` on File objects.

**Issues Found**:

- `Object.assign(file, {...})` in ImageUploader.tsx line 212 corrupted File prototype
- Multiple state updates using spread operator `{...f}` lost File native properties
- FileList.tsx `formatFileSize` function only checked `isNaN(sizeInBytes)` but didn't handle File prototype chain

**Fix Applied**:

- Changed to `Object.create(file)` to preserve File prototype chain
- Explicitly preserved critical properties (`size`, `name`, `preview`) in all state updates
- Updated FileList.tsx `formatFileSize` to check multiple sources for file size

### Problem 2: Progress Bar Stuck at 0%

**Location**: `/src/components/ImageUploader.tsx` lines 82-86
**Root Cause**: Mathematical error in progress calculation for chunked uploads.

**Original Broken Formula**:

```typescript
const chunkContribution = Math.floor(
  chunkProgressData.chunkProgress / chunkProgressData.totalChunks
);
```

**Issue**: Divided chunk progress by total chunks instead of calculating contribution correctly.

**Fix Applied**:

```typescript
const currentChunkProgress = Math.floor(
  (chunkProgressData.chunkProgress * chunkProgressData.filesInChunk) /
    filesToUpload.length
);
const fileProgress = Math.min(100, baseProgress + currentChunkProgress);
```

### Problem 3: Potential 400 Bad Request

**Location**: Backend upload validation and frontend chunking config
**Root Cause**: Edge case mismatches between frontend chunking and backend limits.

**Configuration Analysis**:

- Frontend: `DEFAULT_CHUNKING_CONFIG.chunkSize = 100`
- Backend Production: `MAX_FILES_PER_REQUEST = 100`
- For 420 files: 5 chunks (100 files each) + 1 chunk (20 files)

**Potential Issues**:

- File validation errors in `imageController.ts` for invalid mime types
- File buffer corruption during chunked transfer
- Rate limiting hitting for bulk upload requests

## Key Code Changes

### 1. File Object Preservation Pattern

**OLD (Broken)**:

```typescript
return { ...f, status: 'uploading', uploadProgress: 0 };
```

**NEW (Fixed)**:

```typescript
const updatedFile = Object.create(f);
updatedFile.status = 'uploading';
updatedFile.uploadProgress = 0;
updatedFile.size = f.size; // Explicitly preserve
updatedFile.name = f.name;
updatedFile.preview = f.preview;
return updatedFile;
```

### 2. Progress Calculation Fix

**OLD (Broken Math)**:

```typescript
const chunkContribution = Math.floor(chunkProgress / totalChunks);
```

**NEW (Correct Math)**:

```typescript
const currentChunkProgress = Math.floor(
  (chunkProgress * filesInChunk) / totalFiles
);
```

### 3. Robust File Size Detection

**NEW in FileList.tsx**:

```typescript
const formatFileSize = (file: FileWithPreview): string => {
  if (typeof file.size === 'number' && !isNaN(file.size)) {
    sizeInBytes = file.size;
  } else if (file instanceof File && typeof file.size === 'number') {
    sizeInBytes = file.size;
  } else {
    return 'Unknown size';
  }
  // ... formatting logic
};
```

## Files Modified

1. `/src/components/ImageUploader.tsx` - Main upload logic fixes
2. `/src/components/upload/FileList.tsx` - File size display fix

## Testing Scenario

```bash
# Test with exactly 420 files
1. Select 420 image files (mix of different sizes)
2. Verify file sizes show correctly (not "Unknown size")
3. Watch progress bars update from 0% to 100%
4. Confirm no 400 Bad Request errors in browser console
5. Verify all 420 files upload successfully

# Edge cases to test:
- Files with very long names
- Files with special characters
- Mix of different image formats
- Very large files (approaching 100MB limit)
```

## Backend Limits Reference

- Production: 100 files per chunk, 100MB max file size
- Development: 50 files per chunk, 50MB max file size
- Total upload limit: 10,000 files max

## Prevention

- Always use `Object.create()` for File objects, never spread operator
- Explicitly preserve critical File properties in state updates
- Test progress calculations with realistic chunk sizes
- Monitor browser console for 400 errors during upload testing
