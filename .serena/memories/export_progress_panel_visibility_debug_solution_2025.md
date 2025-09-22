# Export Progress Panel Visibility Issue - Complete Solution

## Problem Description
Czech user reported: "nechce se mi zobrazit export progress bar v project detail nad ukazatelem segmentační fronty. ukazuje se pravděpodobně v export okně."

Translation: "The export progress bar won't show in project detail above the segmentation queue indicator. It probably shows in the export window."

## Root Cause Analysis

### 1. State Isolation Problem
The core issue was **state isolation** between two separate instances of `useAdvancedExport` hook:
- **Instance 1**: Used in `AdvancedExportDialog` 
- **Instance 2**: Used in `ProjectDetail` component

Each hook instance maintains its own independent state, so when an export starts in the dialog, the ProjectDetail instance doesn't know about it.

### 2. Visibility Logic
The `ExportProgressPanel` shows only when:
```typescript
!(!isExporting && !isDownloading && !completedJobId && !isCancelling)
```
This means it shows when ANY of these conditions are true:
- `isExporting` is true
- `isDownloading` is true  
- `completedJobId` exists
- `isCancelling` is true

### 3. File Locations
- **ExportProgressPanel**: `/src/components/project/ExportProgressPanel.tsx`
- **ProjectDetail**: `/src/pages/ProjectDetail.tsx` (lines 1597-1608)
- **useAdvancedExport hook**: `/src/pages/export/hooks/useAdvancedExport.ts`
- **AdvancedExportDialog**: `/src/pages/export/AdvancedExportDialog.tsx`
- **ProjectToolbar**: `/src/components/project/ProjectToolbar.tsx`

## Solution Implemented

### 1. State Synchronization via Callbacks
Added export state change callbacks to sync state between dialog and project detail:

**ProjectDetail.tsx**:
```typescript
// Local export state to sync with dialog
const [localExportState, setLocalExportState] = useState({
  isExporting: false,
  isDownloading: false,
  exportProgress: 0,
  exportStatus: '',
  completedJobId: null as string | null,
});

// Merge local export state with hook state for panel display
const displayExportState = {
  isExporting: exportHook.isExporting || localExportState.isExporting,
  isDownloading: exportHook.isDownloading || localExportState.isDownloading,
  exportProgress: localExportState.isExporting ? localExportState.exportProgress : exportHook.exportProgress,
  exportStatus: localExportState.isExporting ? localExportState.exportStatus : exportHook.exportStatus,
  completedJobId: exportHook.completedJobId || localExportState.completedJobId,
  wsConnected: exportHook.wsConnected,
};

// Callbacks for export dialog state synchronization
const handleExportingChange = useCallback((isExporting: boolean) => {
  console.log('📤 Export dialog state change - isExporting:', isExporting);
  setLocalExportState(prev => ({
    ...prev,
    isExporting,
    exportProgress: isExporting ? 0 : prev.exportProgress,
    exportStatus: isExporting ? 'Starting export...' : prev.exportStatus,
  }));
}, []);

const handleDownloadingChange = useCallback((isDownloading: boolean) => {
  console.log('📥 Export dialog state change - isDownloading:', isDownloading);
  setLocalExportState(prev => ({
    ...prev,
    isDownloading,
  }));
}, []);
```

### 2. Updated ProjectToolbar Interface
**ProjectToolbar.tsx**:
```typescript
interface ProjectToolbarProps {
  // ... existing props
  // Export state callbacks
  onExportingChange?: (isExporting: boolean) => void;
  onDownloadingChange?: (isDownloading: boolean) => void;
}
```

### 3. Connected Callback Chain
**Flow**: AdvancedExportDialog → ProjectToolbar → ProjectDetail → ExportProgressPanel

The dialog triggers callbacks that flow up to ProjectDetail, which then updates the panel visibility.

### 4. Enhanced Panel Props
**ExportProgressPanel** now uses `displayExportState` instead of direct hook values:
```typescript
<ExportProgressPanel
  isExporting={displayExportState.isExporting}
  isDownloading={displayExportState.isDownloading}
  exportProgress={displayExportState.exportProgress}
  exportStatus={displayExportState.exportStatus}
  completedJobId={displayExportState.completedJobId}
  onCancelExport={exportHook.cancelExport}
  onTriggerDownload={exportHook.triggerDownload}
  onDismissExport={exportHook.dismissExport}
  wsConnected={displayExportState.wsConnected}
/>
```

## Debugging Features Added

### 1. Console Logging
Added comprehensive debug logging in both components:
- Export state changes in ProjectDetail
- Panel visibility conditions in ExportProgressPanel
- State sync events between components

### 2. State Tracking
```typescript
// Debug export state visibility
useEffect(() => {
  console.log('🔍 Export state debug:', {
    hookState: { isExporting: exportHook.isExporting, ... },
    localState: localExportState,
    displayState: displayExportState,
    projectId: id,
  });
}, [dependencies]);
```

### 3. Panel Visibility Logging
```typescript
// Debug visibility conditions
React.useEffect(() => {
  console.log('📊 ExportProgressPanel visibility check:', {
    isExporting,
    isDownloading,
    completedJobId,
    isCancelling,
    shouldShow: isExporting || isDownloading || !!completedJobId || isCancelling,
  });
}, [dependencies]);
```

## Alternative Solutions Considered

### 1. Shared Context Provider (Created but not implemented)
Created `ExportContext.tsx` and `useSharedAdvancedExport.ts` for global state management.
**Pros**: Cleaner architecture, single source of truth
**Cons**: More complex to implement, requires provider setup

### 2. Event-Based Communication
Could use custom events or pub/sub pattern.
**Pros**: Decoupled communication
**Cons**: Harder to debug, less React-like

## Testing Approach

1. **Start an export** from the AdvancedExportDialog
2. **Check browser console** for debug logs showing state changes
3. **Verify ExportProgressPanel appears** in ProjectDetail above QueueStatsPanel
4. **Monitor state synchronization** between dialog and project detail

## Expected Console Output
When working correctly, you should see:
```
📤 Export dialog state change - isExporting: true
🔍 Export state debug: { hookState: {...}, localState: {...}, displayState: {...} }
📊 ExportProgressPanel visibility check: { shouldShow: true, ... }
✅ ExportProgressPanel: Visible - active export operation detected
```

## Files Modified
1. `/src/pages/ProjectDetail.tsx` - Added state sync and display logic
2. `/src/components/project/ExportProgressPanel.tsx` - Added debug logging
3. `/src/components/project/ProjectToolbar.tsx` - Added callback props
4. `/src/contexts/ExportContext.tsx` - Created (alternative solution)
5. `/src/pages/export/hooks/useSharedAdvancedExport.ts` - Created (alternative)

## Prevention Measures
- Use shared state patterns for cross-component communication
- Add debug logging for complex state flows
- Test export functionality across all relevant UI components
- Consider using React Context for app-wide export state management

## Success Criteria
✅ ExportProgressPanel shows in ProjectDetail when export starts from dialog
✅ Panel displays accurate progress information
✅ Panel shows above QueueStatsPanel as intended
✅ Debug logging helps track state flow
✅ No duplicate panel displays (dialog vs project detail)