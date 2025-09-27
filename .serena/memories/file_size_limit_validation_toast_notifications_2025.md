# File Size Limit Validation with Toast Notifications - Implementation

## Date: 2025-09-26

## Problem Statement

When users upload files exceeding the size limit, the system should:

1. Show a toast notification warning about oversized files
2. NOT upload oversized files
3. Continue uploading valid files in the batch
4. Reduce the file size limit from 100MB to 20MB for better performance

## Solution Implementation

### 1. Frontend Changes

#### Updated Upload Configuration (`/src/lib/uploadConfig.ts`)

```typescript
export const UPLOAD_CONFIG = {
  // File limits
  MAX_FILE_SIZE_MB: 20, // Reduced from 100MB to 20MB for performance
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20MB in bytes
  // ... rest of config
};
```

#### Enhanced DropZone Component (`/src/components/upload/DropZone.tsx`)

- Added proper file size validation with separation of valid/invalid files
- Implemented toast notifications for oversized files with multi-language support
- Shows detailed information about rejected files (name and size)
- Continues uploading valid files when some are rejected
- Success notification shows count of files that will be uploaded

Key features:

```typescript
// Handle drop with file limit and size validation
const handleDrop = (acceptedFiles: File[], rejectedFiles: any[]) => {
  // Separate valid and invalid files
  const oversizedFiles: File[] = [];
  const validFiles: File[] = [];

  // Check each file against size limit
  acceptedFiles.forEach(file => {
    if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES) {
      oversizedFiles.push(file);
    } else {
      validFiles.push(file);
    }
  });

  // Show toast for oversized files with file details
  if (oversizedFiles.length > 0) {
    toast.error(
      `${oversizedFiles.length} file(s) exceeded the ${UPLOAD_CONFIG.MAX_FILE_SIZE_MB}MB size limit`,
      {
        description: filesList + moreFiles,
        duration: 5000,
      }
    );
  }

  // Upload only valid files
  if (validFiles.length > 0) {
    onDrop(validFiles);
  }
};
```

### 2. Backend Changes

#### Updated Upload Config (`/backend/src/config/uploadConfig.ts`)

```typescript
development: {
  maxFileSize: 20 * 1024 * 1024, // 20MB per file (was 50MB)
},
staging: {
  maxFileSize: 20 * 1024 * 1024, // 20MB per file (was 50MB)
},
production: {
  maxFileSize: 20 * 1024 * 1024, // 20MB per file (was 100MB)
}
```

#### Updated Upload Limits (`/backend/src/config/uploadLimits.ts`)

```typescript
const PRODUCTION_LIMITS: UploadLimitsConfig = {
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20MB (was 100MB)
};

const DEVELOPMENT_LIMITS: UploadLimitsConfig = {
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20MB (was 50MB)
};
```

### 3. Validation Flow

1. **Client-side validation (react-dropzone)**
   - Files are checked against maxSize property (20MB)
   - Rejected files are tracked separately

2. **Custom validation (DropZone component)**
   - Additional check for file size
   - Separation of valid/invalid files
   - Toast notifications with details

3. **Upload utility validation (uploadUtils.ts)**
   - Uses centralized config (20MB limit)
   - Validates individual files and chunk sizes
   - Returns valid and invalid file arrays with reasons

4. **Backend validation (multer middleware)**
   - Final validation at server level
   - Uses getUploadLimitsForEnvironment() for dynamic limits
   - Returns localized error messages

### 4. User Experience Improvements

- **Immediate feedback**: Toast notifications appear instantly when oversized files are detected
- **Partial batch upload**: Valid files continue uploading even when some are rejected
- **Detailed information**: Shows which files were rejected and their sizes
- **Multi-language support**: Toast messages in 6 languages (CS, EN, ES, DE, FR, ZH)
- **Success confirmation**: Shows count of files that will be uploaded

### 5. Testing

Created test HTML file (`test-upload-limits.html`) to:

- Generate test files of various sizes
- Simulate upload with mixed valid/invalid files
- Verify toast notification behavior
- Test edge cases (exactly 20MB files)

## Files Modified

1. `/src/lib/uploadConfig.ts` - Reduced MAX_FILE_SIZE to 20MB
2. `/src/components/upload/DropZone.tsx` - Enhanced validation and toast notifications
3. `/backend/src/config/uploadConfig.ts` - Updated backend file size limits
4. `/backend/src/config/uploadLimits.ts` - Updated environment-specific limits

## Key Benefits

1. **Better performance**: 20MB limit reduces server load and improves upload speed
2. **User-friendly**: Clear feedback about which files exceed limits
3. **Resilient**: Continues uploading valid files in batch
4. **Consistent**: Validation at multiple layers ensures reliability
5. **Internationalized**: Support for 6 languages
