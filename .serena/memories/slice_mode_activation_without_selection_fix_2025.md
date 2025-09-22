# Slice Mode Activation Without Selection - Fix

**Date**: 2025-09-22
**Issue**: Slice mode couldn't be activated without a polygon selected, causing it to remain in View mode and switch to EditVertices when clicking polygons

## Problem Analysis

### User Report

When user pressed 'S' to enter slice mode and clicked on a polygon, it incorrectly switched to edit mode instead of selecting the polygon for slicing.

### Root Cause Discovery

#### Log Evidence

```
[DEBUG] usePolygonSelection: View mode - selecting polygon and switching to EditVertices: ml_polygon_1758536266756_ffnplagke
```

The log showed the system was in **View mode** when the user thought they were in **Slice mode**.

#### Code Investigation

**Location**: `/src/pages/segmentation/hooks/useKeyboardShortcuts.tsx` lines 124-133

**Original Problem Code**:

```typescript
case 's':
  if (isCtrlPressed.current) {
    // Ctrl+S: Save
    event.preventDefault();
    handleSave();
  } else if (selectedPolygonId) {  // ← PROBLEM: Required selection!
    // S: Slice mode
    event.preventDefault();
    setEditMode(EditMode.Slice);
  }
  break;
```

**Issue**: The keyboard shortcut for 'S' only activated slice mode if `selectedPolygonId` existed. Without a selection, pressing 'S' did nothing.

### Workflow Impact

**Expected workflow**:

1. Press 'S' → Enter slice mode
2. Click polygon → Select it for slicing
3. Click canvas → Place first slice point
4. Click again → Place second point and slice

**Actual broken workflow**:

1. Press 'S' → Nothing happens (stays in View mode)
2. Click polygon → View mode logic activates EditVertices
3. User is now in wrong mode

## Solution Implementation

### Fix 1: Keyboard Shortcut

**File**: `/src/pages/segmentation/hooks/useKeyboardShortcuts.tsx` lines 124-133

```typescript
// AFTER FIX:
case 's':
  if (isCtrlPressed.current) {
    // Ctrl+S: Save
    event.preventDefault();
    handleSave();
  } else {  // ← FIXED: No selection required!
    // S: Slice mode (can be activated without selection)
    event.preventDefault();
    setEditMode(EditMode.Slice);
  }
  break;
```

### Fix 2: Mode Cycling

**File**: `/src/pages/segmentation/hooks/useKeyboardShortcuts.tsx` lines 304-318

**Original**:

```typescript
const allModes = [
  EditMode.View,
  EditMode.CreatePolygon,
  EditMode.DeletePolygon,
];

// Add selection-dependent modes if polygon is selected
if (selectedPolygonId) {
  allModes.splice(
    1,
    0,
    EditMode.EditVertices,
    EditMode.AddPoints,
    EditMode.Slice // ← Was selection-dependent
  );
}
```

**Fixed**:

```typescript
const allModes = [
  EditMode.View,
  EditMode.CreatePolygon,
  EditMode.Slice, // ← Now always available
  EditMode.DeletePolygon,
];

// Add selection-dependent modes if polygon is selected
if (selectedPolygonId) {
  allModes.splice(1, 0, EditMode.EditVertices, EditMode.AddPoints);
}
```

## Related Fixes

### Previous Canvas Deselection Fix

In the same session, we also fixed canvas deselection in slice mode:

- **File**: `/src/pages/segmentation/SegmentationEditor.tsx` line 1158
- **Change**: Added `editor.editMode !== EditMode.Slice` to prevent deselection

## Testing Verification

### Slice Mode Without Pre-selection

1. No polygon selected
2. Press 'S' → Enters slice mode ✅
3. Click polygon → Selects it (stays in slice mode) ✅
4. Click canvas → Places first slice point ✅
5. Click again → Completes slice ✅

### Slice Mode With Pre-selection

1. Select polygon first
2. Press 'S' → Enters slice mode ✅
3. Click canvas → Places first slice point ✅
4. Click again → Completes slice ✅

### Tab Cycling

1. Press Tab repeatedly → Slice mode appears in cycle ✅
2. Works both with and without selection ✅

## Key Insights

1. **Selection-dependent modes** should be carefully considered - slice mode needs to work both ways:
   - Without selection: Select polygon first, then slice
   - With selection: Immediately start slicing

2. **Mode activation consistency** - All modes that can function without selection should be accessible via:
   - Direct keyboard shortcuts
   - Tab cycling
   - UI buttons

3. **User workflow assumptions** - Users expect to activate a tool mode first, then select what to operate on

## Files Modified

- `/src/pages/segmentation/hooks/useKeyboardShortcuts.tsx` (lines 124-133, 304-318)
- `/src/pages/segmentation/SegmentationEditor.tsx` (line 1158) - from earlier fix

## Success Metrics

- ✅ Slice mode activates without polygon selection
- ✅ Polygon selection in slice mode doesn't switch to EditVertices
- ✅ Canvas clicks in slice mode place slice points (don't deselect)
- ✅ Tab cycling includes slice mode regardless of selection
- ✅ TypeScript compilation successful
- ✅ HMR applied changes without errors
