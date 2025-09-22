# Segmentation Editor - Slice Mode Canvas Deselection Fix

**Date**: 2025-09-22
**Issue Reporter**: User reported in Czech that clicking on polygon in slice/delete modes incorrectly switches to edit mode, and clicking outside polygon in slice mode deselects the polygon.

## Problem Analysis

### Reported Issues

1. **Slice mode issue**: Clicking on polygon switches to edit mode instead of selecting for slicing
2. **Delete mode issue**: Clicking on polygon switches to edit mode instead of deleting
3. **Canvas click issue**: In slice mode with selected polygon, clicking canvas to place slice point deselects polygon

### Root Cause Discovery

#### Issues 1 & 2: Already Fixed

Analysis revealed these were previously fixed in `usePolygonSelection.ts` (lines 100-165):

- Delete mode correctly deletes on click and stays in delete mode
- Slice mode correctly selects polygon and stays in slice mode
- The hook properly handles mode-specific behaviors

#### Issue 3: Canvas Deselection Bug

**Location**: `/src/pages/segmentation/SegmentationEditor.tsx` lines 1152-1162

**Problem**: SVG onClick handler deselects polygons on canvas click in ALL modes except AddPoints:

```typescript
// BEFORE (BUG):
if (
  e.target === e.currentTarget &&
  editor.editMode !== EditMode.AddPoints // Only excludes AddPoints!
) {
  editor.handlePolygonSelection(null);
}
```

This caused slice mode workflow disruption:

1. User enters slice mode
2. User clicks polygon to select it
3. User clicks canvas to place first slice point
4. **BUG**: Canvas click deselects polygon instead of placing slice point

## Solution Implementation

### Immediate Fix Applied

Added slice mode to the deselection exclusion list:

```typescript
// AFTER (FIXED):
if (
  e.target === e.currentTarget &&
  editor.editMode !== EditMode.AddPoints &&
  editor.editMode !== EditMode.Slice // Now excludes Slice mode too!
) {
  editor.handlePolygonSelection(null);
}
```

### Why This Works

- **AddPoints mode**: Needs canvas clicks for adding vertices to polygons
- **Slice mode**: Needs canvas clicks for placing slice points
- **Other modes**: Canvas clicks should deselect for better UX

## SSOT Violation Identified

### Current Problem

Mode behaviors are hardcoded throughout the codebase instead of being centralized.

### Recommended Future Refactor

Create centralized mode configuration:

```typescript
// /src/pages/segmentation/utils/modeConfig.ts
export const MODE_CONFIG: Record<EditMode, ModeConfig> = {
  [EditMode.AddPoints]: {
    allowsCanvasDeselection: false, // Prevents deselection
    allowsPointPlacement: true,
    requiresPolygonSelection: true,
  },
  [EditMode.Slice]: {
    allowsCanvasDeselection: false, // Prevents deselection
    allowsPointPlacement: true,
    requiresPolygonSelection: true,
  },
  // ... other modes
};

// Then use utility function:
if (
  e.target === e.currentTarget &&
  shouldAllowCanvasDeselection(editor.editMode)
) {
  editor.handlePolygonSelection(null);
}
```

## Testing Verification

### Slice Mode Workflow

1. Enter slice mode (keyboard: S)
2. Click polygon → Should select and stay in slice mode ✅
3. Click canvas → Should place first slice point (not deselect) ✅
4. Click canvas again → Should execute slice ✅

### Delete Mode Workflow

1. Enter delete mode (keyboard: D)
2. Click polygon → Should delete immediately ✅

### Other Modes

- View/EditVertices modes still allow canvas deselection ✅
- AddPoints mode continues to work for vertex addition ✅

## Files Modified

- `/src/pages/segmentation/SegmentationEditor.tsx` (lines 1152-1162)

## Related Components

- `/src/pages/segmentation/hooks/usePolygonSelection.ts` - Centralized selection logic
- `/src/pages/segmentation/hooks/useAdvancedInteractions.tsx` - Slice point handling
- `/src/pages/segmentation/components/canvas/CanvasPolygon.tsx` - Polygon click events

## Key Insights

1. The segmentation editor has proper event delegation hierarchy
2. Mode-specific behaviors work correctly in isolation
3. The bug was an integration issue between canvas and mode handlers
4. SSOT pattern should be applied to mode configurations in future

## Success Metrics

- ✅ Slice mode allows polygon selection and slice point placement
- ✅ Delete mode deletes polygons immediately
- ✅ No mode incorrectly switches to edit mode
- ✅ Canvas deselection still works in appropriate modes
- ✅ TypeScript compilation successful
- ✅ HMR applied changes without errors
