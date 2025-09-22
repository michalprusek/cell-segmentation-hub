# WebGL Polygon Rendering Transform Fix - September 22, 2025

## Problem Summary

User reported: "stále nevidím segmentace" (still don't see segmentations) in the segmentation editor. Polygons were loading from the API (8 polygons confirmed) but not visible on the canvas.

## Root Cause Analysis

### Primary Issue: Transform Matrix Mismatch

**Location**: `/src/pages/segmentation/SegmentationEditor.tsx` lines 1143-1153

The WebGL renderer was receiving an **identity transform matrix** `[1,0,0,1,0,0]` instead of the actual editor transforms, causing polygons to render in the wrong coordinate space.

### Secondary Issue: Undefined Polygon IDs

All polygon IDs from the API were `undefined`, triggering fallback ID generation with warnings like:

```
Fixed polygon with invalid ID to prevent data loss {originalId: undefined, fixedId: 'ml_polygon_1758546416814_d1mcl1b9s'}
```

## Technical Details

### Coordinate System Mismatch

- **CSS Layer**: Applied transforms via `CanvasContent.tsx` using `transform: translate3d() scale()`
- **WebGL Layer**: Received identity matrix, no transforms applied
- **Result**: Polygons rendered at wrong positions, likely outside visible viewport

### Data Flow Verification

1. ✅ API returns 8 polygons with valid point data
2. ✅ Polygon data reaches the editor (console: "totalPolygons: 8, visiblePolygons: 8")
3. ✅ WebGL context initializes properly
4. ❌ Transform matrix was hardcoded to identity
5. ❌ Polygon IDs were undefined from API

## Solution Implemented

### Fix Applied to SegmentationEditor.tsx

```typescript
// BEFORE (BROKEN):
transform={
  new DOMMatrix([
    1, // zoom removed - handled by CanvasContent transform
    0,
    0,
    1, // zoom removed - handled by CanvasContent transform
    0, // translateX removed - handled by CanvasContent transform
    0, // translateY removed - handled by CanvasContent transform
  ])
}
zoom={1} // zoom handled by CanvasContent

// AFTER (FIXED):
transform={
  new DOMMatrix([
    editor.transform.zoom,
    0,
    0,
    editor.transform.zoom,
    editor.transform.translateX,
    editor.transform.translateY,
  ])
}
zoom={editor.transform.zoom}
```

## Integration Points Affected

### Frontend Components

- `SegmentationEditor.tsx` - Transform matrix pass-through
- `WebGLPolygonRenderer.tsx` - Receives and uses transform
- `WebGLVertexRenderer.ts` - Applies transform in shaders
- `CanvasContent.tsx` - CSS transform application

### Transform Data Flow

1. `editor.transform` (TransformState) contains zoom/pan values
2. Convert to DOMMatrix for WebGL renderer
3. WebGL shaders apply transform to vertex positions
4. Polygons render at correct screen coordinates

## Testing Checklist

### Immediate Verification

- [x] Polygons visible on canvas
- [x] Zoom operations scale polygons correctly
- [x] Pan operations move polygons with image
- [x] Vertex positions align with polygon boundaries

### Regression Testing

- [ ] Test zoom levels: 0.5x to 10x
- [ ] Test polygon selection by clicking
- [ ] Test vertex editing mode
- [ ] Test slice mode functionality
- [ ] Test add points mode

## Performance Considerations

### WebGL Capacity

- Supports up to 50,000 vertices
- Current load: 8 polygons × ~50 vertices = ~400 vertices
- Performance overhead: Negligible

### Memory Usage

- Vertex buffer: 1.6MB allocated
- Actual usage: < 10KB for current polygons

## Lessons Learned

### Issue Pattern

When WebGL rendering appears broken but data loads correctly:

1. Check transform matrix consistency between layers
2. Verify coordinate space alignment
3. Ensure transform data flows through all components

### Prevention Strategy

1. Never hardcode identity transforms when actual transforms exist
2. Always pass through editor state transforms to rendering layers
3. Test with different zoom/pan states during development

## Related Issues

- Previous viewport calculation fix in PolygonVisibilityManager.ts
- WebGL canvas reference error fixed earlier
- Transform alignment issues in previous sessions

## API Polygon ID Issue (Pending)

### Problem

Backend API returns polygons without proper `id` field, causing undefined IDs.

### Workaround

Frontend generates fallback IDs to prevent crashes, but this generates console warnings.

### Recommended Fix

Update backend segmentation API to include proper polygon IDs in the response structure.

## Keywords for Future Reference

- WebGL transform matrix
- Polygon rendering blank
- Identity matrix issue
- Coordinate space mismatch
- Transform pass-through
- DOMMatrix conversion
- editor.transform usage
