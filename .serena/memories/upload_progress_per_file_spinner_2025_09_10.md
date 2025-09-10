# Upload Progress Per-File Updates with Loading Spinner

## Problem

User requested that the upload progress bar updates with each uploaded image (not just completed images) and shows a loading spinner animation next to "Upload Progress" text.

## Solution Implemented

### 1. Frontend Changes

#### Added Loading Spinner to FileList Component

**File**: `/src/components/upload/FileList.tsx`

- Imported `Loader2` from lucide-react (following SSOT pattern)
- Added `isUploading` prop to FileListProps interface
- Added spinner display next to "Upload Progress" text:

```typescript
<div className="flex items-center gap-2">
  {isUploading && (
    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
  )}
  <h3 className="text-sm font-medium dark:text-white">
    {t('images.uploadProgress')}
  </h3>
</div>
```

#### Updated ImageUploader Component

**File**: `/src/components/ImageUploader.tsx`

- Passed `isUploading` prop to FileList component

### 2. Backend Changes

#### Fixed Progress Calculation

**File**: `/backend/src/api/controllers/imageController.ts`

Previous issue: Progress was calculated using `filesCompleted` which only increments AFTER full processing.

Solution: Track `filesUploaded` separately to count files as soon as they're uploaded (50% progress):

```typescript
let filesUploaded = 0;

// In progress callback:
if (status === 'uploading' && progress >= 50) {
  // File has been uploaded to storage
  filesUploaded = Math.max(filesUploaded, filesCompleted + 1);
} else if (status === 'completed') {
  filesUploaded = Math.max(filesUploaded, filesCompleted);
}

// Calculate overall progress based on uploaded files
const overallProgress =
  files.length > 0 ? Math.round((filesUploaded / files.length) * 100) : 0;
```

## Key Insights

1. **Progress Tracking Levels**: The system has multiple progress levels:
   - Individual file progress (0-100% per file)
   - Overall batch progress (calculated from uploaded/total)
   - WebSocket events provide real-time updates

2. **SSOT Pattern**: Used existing `Loader2` component from lucide-react consistently with other loading spinners in the codebase (h-4 w-4 animate-spin text-blue-500).

3. **Responsive Updates**: By tracking `filesUploaded` instead of `filesCompleted`, the progress bar now updates as soon as each file is uploaded to storage, not when fully processed.

## Testing

After implementation:

1. Built frontend with `npm run build`
2. Rebuilt Docker image with `--no-cache`
3. Recreated frontend container
4. Restarted backend container

The upload progress now:

- Shows animated spinner during upload
- Updates progress bar with each file uploaded
- Provides more responsive user feedback
