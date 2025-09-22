# Polygon Selection Event Conflict Fix

## Problem Summary

The segmentation editor had multiple critical issues:

1. **All polygons selected simultaneously** when clicking on any single polygon
2. **Vertex manipulation broken** - couldn't drag vertices
3. **Add points mode non-functional**
4. **Slice tool stuck** on step 1
5. **Holes not rendering in blue** (though this was already working)

## Root Cause

**Triple event handling conflict** between:

1. `CanvasPolygon` direct onClick handler
2. Canvas-level mouse event handling
3. Advanced interactions polygon detection

The `onClick={handleClick}` on the polygon path element was interfering with vertex manipulation and creating race conditions.

## Solution

### 1. Remove Conflicting Event Handler

**File**: `src/pages/segmentation/components/canvas/CanvasPolygon.tsx`

- **Remove**: `onClick={handleClick}` from `<path>` element (line ~220)
- Keep only double-click and context menu handlers

### 2. Enhance Canvas-Level Selection

**File**: `src/pages/segmentation/hooks/useAdvancedInteractions.tsx`

- **Update `handleEditVerticesClick`** to detect polygon clicks:

```typescript
// Check for polygon clicks and handle selection
const clickedPolygons = polygons.filter(polygon =>
  isPointInPolygon(imagePoint, polygon.points)
);
// Sort by area to select smallest (topmost) when overlapping
const sortedPolygons = clickedPolygons.sort((a, b) => {
  const areaA = Math.abs(calculatePolygonArea(a.points));
  const areaB = Math.abs(calculatePolygonArea(b.points));
  return areaA - areaB;
});
```

### 3. Event Flow After Fix

1. User clicks → Canvas onMouseDown → handleMouseDown
2. Check for vertex clicks first (priority)
3. Fall through to mode-specific handlers
4. In EditVertices mode → detect polygon under cursor
5. Select polygon or start vertex drag
6. Single, clean event path

## Key Files Modified

- `src/pages/segmentation/components/canvas/CanvasPolygon.tsx`
- `src/pages/segmentation/hooks/useAdvancedInteractions.tsx`

## Testing Checklist

- ✅ Single polygon selection (not all)
- ✅ Vertex dragging works
- ✅ Add points mode functional
- ✅ Slice tool progresses through all steps
- ✅ Holes render in blue, external polygons in red

## Important Notes

- The hole detection was already working (`detectHoles: true` by default)
- Color assignment: internal = blue (#0ea5e9), external = red (#ef4444)
- Always remove competing event handlers to maintain SSOT
- Prioritize vertex interactions over polygon selection
