# Infinite Download Loop Fix - Export Functionality

## Problem

Users reported that exports were downloading multiple times in an infinite loop and couldn't be stopped. The console showed repeated "Export auto-downloaded" messages with the same jobId.

## Root Cause

Missing dependency in useEffect hook in `/src/pages/export/hooks/useSharedAdvancedExport.ts` at line 532. The `currentProjectName` variable was used inside the effect but not listed in the dependency array, causing React to not properly track changes and re-run the effect unnecessarily.

## Solution

Added `currentProjectName` to the dependency array of the useEffect hook responsible for auto-downloading completed exports.

### Code Change

**File**: `/src/pages/export/hooks/useSharedAdvancedExport.ts`
**Line**: 532

```typescript
// Before (causing infinite loop):
}, [completedJobId, projectId, updateState, currentJob, getSignal]);

// After (fixed):
}, [completedJobId, projectId, updateState, currentJob, getSignal, currentProjectName]);
```

## Technical Details

- The useEffect was watching for `completedJobId` to trigger auto-download
- Without `currentProjectName` in dependencies, React didn't know the effect depended on it
- This caused the effect to re-run continuously when the component re-rendered
- Each re-run triggered another download, creating an infinite loop

## Related Context

This issue arose after implementing:

1. Shared export state between AdvancedExportDialog and inline ExportProgressPanel
2. Simplified export naming (removing timestamps from filenames)
3. ExportProvider context wrapping the application

## Prevention

Always ensure all variables used inside useEffect are listed in the dependency array, or explicitly exclude them with eslint-disable comments if intentional.

## Testing

- TypeScript compilation: ✅ No errors
- ESLint: ✅ No errors related to this fix
- The infinite download loop should now be prevented
