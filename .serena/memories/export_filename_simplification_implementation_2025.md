# Export Filename Simplification Implementation

## Date: 2025-09-22

## User Requirement
All export ZIP files should be named simply as `{projectName}.zip` regardless of whether exporting the full project or a partial selection of images.

## Implementation Summary
Removed timestamps and additional suffixes from export filenames across the entire application to provide consistent, predictable export naming.

## Changes Made

### Backend Changes

1. **`/backend/src/services/exportService.ts` (Line 1381-1384)**
   - **Before**: `${sanitizedProjectName}_export_${timestamp}.zip`
   - **After**: `${sanitizedProjectName}.zip`
   - Removed timestamp generation and "_export_" suffix

2. **`/backend/src/api/controllers/exportController.ts` (Lines 167-171)**
   - **Before**: `${sanitizeFilename(projectName)}_${timestamp}.zip`
   - **After**: `${sanitizeFilename(projectName)}.zip`
   - Removed timestamp from download filename

### Frontend Changes

3. **`/src/pages/export/hooks/useAdvancedExport.ts` (Lines 391-394)**
   - Auto-download filename simplified
   - **Before**: `${sanitizeFilename(projectName)}_${timestamp}.zip`
   - **After**: `${sanitizeFilename(projectName)}.zip`

4. **`/src/pages/export/hooks/useAdvancedExport.ts` (Lines 521-524)**
   - Manual download filename simplified
   - **Before**: `${sanitizeFilename(projectName)}_${timestamp}.zip`
   - **After**: `${sanitizeFilename(projectName)}.zip`

5. **`/src/pages/export/hooks/useSharedAdvancedExport.ts` (Lines 484-487)**
   - Auto-download filename simplified
   - **Before**: `${sanitizeFilename(projectName)}_${timestamp}.zip`
   - **After**: `${sanitizeFilename(projectName)}.zip`

6. **`/src/pages/export/hooks/useSharedAdvancedExport.ts` (Lines 630-633)**
   - Manual download filename simplified
   - **Before**: `${sanitizeFilename(projectName)}_${timestamp}.zip`
   - **After**: `${sanitizeFilename(projectName)}.zip`

## Key Benefits

1. **Consistency**: All exports from the same project have identical filenames
2. **Predictability**: Users always know what filename to expect
3. **Simplicity**: No need to parse timestamps or rename files manually
4. **User Experience**: Cleaner, more professional export filenames

## Trade-offs

1. **File Overwrites**: Multiple exports will overwrite previous files unless manually renamed
2. **No Timestamp**: Loss of temporal information in filename (when export was created)
3. **No Differentiation**: Cannot distinguish between full and partial exports by filename alone

## Testing Verification

- ✅ Frontend builds successfully with no TypeScript errors
- ✅ Backend TypeScript compilation passes
- ✅ All export filename generation locations updated consistently

## Important Notes

- The system already treated full and partial exports identically - there was no existing logic that added "partial" or image count information to filenames
- The `sanitizeFilename()` function is still applied to ensure filesystem safety (removes special characters)
- Fallback naming still exists when project name is unavailable: `export_{jobId}.zip`

## Files Modified
- `/backend/src/services/exportService.ts`
- `/backend/src/api/controllers/exportController.ts`
- `/src/pages/export/hooks/useAdvancedExport.ts` (2 locations)
- `/src/pages/export/hooks/useSharedAdvancedExport.ts` (2 locations)

Total: 3 files, 6 code locations