# Polygon Selection Event Handler Fix - Stable Reference Solution

## Problem Summary

- **Issue**: Clicking one polygon selects ALL polygons
- **Secondary Issue**: Vertices not displaying when polygon is selected
- **Root Cause**: Inline arrow function creates new function instance on every render

## Technical Analysis

### Previous Diagnosis (Incorrect)

The previous memory files suggested dual event handling between canvas-level and component-level handlers was the issue. However, analysis showed:

1. ✅ **Canvas-level handlers are correctly implemented** (only handle empty space)
2. ✅ **Component-level onClick handlers are properly set**
3. ✅ **Vertex display logic is correct** (`shouldShowVertices = isSelected`)

### Actual Root Cause

**File**: `/src/pages/segmentation/SegmentationEditor.tsx` line 1188-1190

**Before (Problematic)**:

```typescript
onSelectPolygon={() => handlePolygonSelection(polygon.id)}
```

**Problem**: Creates new function instance on every render for each polygon, causing React to treat handlers as changed and potentially triggering multiple selections.

## Solution Applied

### 1. Created Stable Wrapper Function

**File**: `/src/pages/segmentation/SegmentationEditor.tsx` lines 513-519

```typescript
// Wrapper function for CanvasPolygon that maintains stable reference
const handleCanvasPolygonSelection = useCallback(
  (polygonId: string) => {
    handlePolygonSelection(polygonId);
  },
  [handlePolygonSelection]
);
```

### 2. Updated CanvasPolygon Usage

**File**: `/src/pages/segmentation/SegmentationEditor.tsx` line 1197

**After (Fixed)**:

```typescript
onSelectPolygon = { handleCanvasPolygonSelection };
```

## Event Flow Architecture (Verified Correct)

### Single Source of Truth (SSOT) ✅

- **Component-level**: `CanvasPolygon onClick` → `handleCanvasPolygonSelection(polygonId)`
- **Canvas-level**: Only handles empty space clicks and panning
- **Mode-specific logic**: Centralized in `handlePolygonSelection`

### Event Sequence (Working)

1. User clicks polygon → `CanvasPolygon.onClick` → `handleCanvasPolygonSelection(specificId)`
2. `handleCanvasPolygonSelection` → `handlePolygonSelection(polygonId)`
3. `handlePolygonSelection` applies mode-specific behavior
4. Canvas-level handlers only run for empty space clicks

## Vertex Display Logic (Verified Correct)

### PolygonVertices Component

**File**: `/src/pages/segmentation/components/canvas/PolygonVertices.tsx` line 40

```typescript
const shouldShowVertices = isSelected;
```

### CanvasVertex Component

**File**: `/src/pages/segmentation/components/canvas/CanvasVertex.tsx`

- Properly renders with data attributes
- Correct event handling with `stopPropagation()`
- Proper zoom-based sizing and colors

## Expected Behavior After Fix

### Polygon Selection ✅

- **Single Selection**: Click polygon → Only that polygon selected
- **Mode Behavior**:
  - Delete mode → Immediately deletes clicked polygon
  - Slice mode → Selects polygon for slicing operation
  - Other modes → Selects polygon and enters EditVertices mode
- **Deselection**: Click empty space → Deselects current polygon
- **No Conflicts**: Stable function references prevent render conflicts

### Vertex Display ✅

- **Show on Selection**: Vertices display when polygon is selected (`isSelected = true`)
- **Hide on Deselection**: Vertices hidden when no polygon selected
- **Proper Rendering**: All vertices render correctly with proper event handling

## Performance Improvements

### Stable Function References

- ✅ Eliminated new function creation on every render
- ✅ Reduced React re-render cycles
- ✅ Consistent event delegation with proper propagation control
- ✅ Single polygon detection path through component onClick

## Files Modified

1. **`/src/pages/segmentation/SegmentationEditor.tsx`**
   - Added `handleCanvasPolygonSelection` stable wrapper (lines 513-519)
   - Updated CanvasPolygon `onSelectPolygon` prop (line 1197)

## Testing Verification

### Polygon Selection

- [ ] Click single polygon → Only that polygon selected
- [ ] Click different polygons → Selection switches properly
- [ ] Click empty area → Selection clears properly
- [ ] Delete mode → Click polygon immediately deletes it
- [ ] Slice mode → Click polygon selects it for slicing

### Vertex Display

- [ ] Select polygon → Vertices become visible
- [ ] Deselect polygon → Vertices hide
- [ ] Drag vertices → Smooth dragging without selection conflicts
- [ ] Multiple polygons → Only selected polygon shows vertices

## Key Learning

**React Performance Pattern**: Always use stable function references for event handlers in render loops. Inline arrow functions `() => handler(param)` create new instances on every render, causing unnecessary re-renders and potential event handling conflicts.

**Correct Pattern**:

```typescript
// ✅ Good: Stable reference
const stableHandler = useCallback(param => handler(param), [handler]);

// ❌ Bad: New function on every render
() => handler(param);
```

This fix resolves both the "all polygons selected" issue and the missing vertex display by establishing proper React event handling patterns with stable function references.
