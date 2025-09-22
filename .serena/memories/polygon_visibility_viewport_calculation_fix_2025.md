# Polygon Visibility Viewport Calculation Fix

## Problem Description
**Date**: 2025-09-22
**Issue**: Polygons were loaded successfully but not visually rendered in the segmentation editor
**Symptoms**: 
- Console showed "Loaded 2 polygons" with correct point counts (531 and 13 points)
- Rendering state showed "visiblePolygons: 2"
- But no polygons were visible on the canvas

## Root Cause Analysis

### The Bug Location
**File**: `/src/lib/rendering/PolygonVisibilityManager.ts`
**Method**: `calculateViewport()` (lines 192-199 originally)

### The Problem
The viewport calculation was incorrect, causing all polygons to be culled as "not visible":

```typescript
// INCORRECT (original code):
private calculateViewport(context: VisibilityContext): ViewportBounds {
  const { zoom, offset, containerWidth, containerHeight } = context;
  
  return {
    x: -offset.x,        // ❌ Missing zoom division
    y: -offset.y,        // ❌ Missing zoom division
    width: containerWidth / zoom,
    height: containerHeight / zoom,
  };
}
```

This caused the viewport bounds to be in the wrong coordinate space, making the visibility manager think all polygons were outside the visible area.

## The Fix

### Corrected Viewport Calculation
```typescript
// CORRECT (fixed code):
private calculateViewport(context: VisibilityContext): ViewportBounds {
  const { zoom, offset, containerWidth, containerHeight } = context;
  
  return {
    x: -offset.x / zoom,    // ✅ Properly scaled to image space
    y: -offset.y / zoom,    // ✅ Properly scaled to image space
    width: containerWidth / zoom,
    height: containerHeight / zoom,
  };
}
```

### Additional Safety Mechanisms Added

1. **Fallback for Small Polygon Counts** (lines 141-145):
```typescript
// Always render all polygons when count is very low to prevent false negatives
if (polygons.length < 10) {
  visiblePolygons = polygons.slice();
  if (process.env.NODE_ENV === 'development') {
    console.debug(`[PolygonVisibility] Rendering all ${polygons.length} polygons (small count fallback)`);
  }
}
```

2. **Debug Logging** for development troubleshooting:
- Logs when using fallback mechanisms
- Shows viewport boundaries during frustum culling
- Helps diagnose future visibility issues

## Technical Details

### Why The Fix Works
1. **Coordinate Space Alignment**: The offset values are in screen space (pixels), but need to be converted to image space for comparison with polygon coordinates
2. **Zoom Scaling**: Dividing by zoom ensures the viewport bounds match the polygon coordinate system
3. **Frustum Culling**: With correct viewport bounds, the bounding box intersection tests now work properly

### Performance Impact
- No negative performance impact
- Actually improves performance by correctly culling off-screen polygons
- Fallback mechanism ensures small datasets render immediately

## Verification
After applying the fix:
1. Polygons within the viewport are correctly identified as visible
2. Off-screen polygons are properly culled for performance
3. Small polygon sets (< 10) bypass culling entirely
4. Debug logging provides visibility into culling decisions

## Related Components
- `/src/pages/segmentation/components/canvas/CanvasPolygonLayer.tsx` - Uses visibility manager
- `/src/pages/segmentation/components/canvas/OptimizedPolygonRenderer.tsx` - Renders visible polygons
- `/src/lib/rendering/RenderBatchManager.ts` - Creates render batches from visible polygons

## Lessons Learned
1. **Coordinate Space Consistency**: Always ensure calculations use consistent coordinate spaces
2. **Defensive Programming**: Add fallbacks for edge cases (like very few polygons)
3. **Debug Logging**: Strategic logging in development mode helps diagnose rendering issues
4. **Testing Viewport Math**: Viewport calculations should be unit tested with various zoom/offset combinations

## Keywords for Search
polygon not visible, viewport calculation, frustum culling, visibility manager, coordinate space, zoom offset, segmentation editor rendering, polygons loaded but not shown