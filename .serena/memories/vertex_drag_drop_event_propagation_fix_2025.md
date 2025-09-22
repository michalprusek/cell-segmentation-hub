# Vertex Drag-and-Drop Event Propagation Fix

## Problem Description

User reported: "nefunguje mi click and drag na vertex v edit vertices mode" (vertex click and drag doesn't work in edit vertices mode)

## Root Cause Analysis

The vertex drag-and-drop functionality was broken due to an event propagation issue in the `CanvasVertex` component:

1. **Event Blocking**: The `handleMouseDown` handler in `CanvasVertex.tsx` was calling `e.stopPropagation()` on regular left-clicks
2. **Broken Event Delegation**: This prevented the event from bubbling up to the canvas layer where vertex dragging is handled
3. **Lost Context**: The `useAdvancedInteractions` hook's `handleMouseDown` couldn't detect vertex clicks via `dataset.vertexIndex`

## How Vertex Dragging Should Work

### Event Flow Architecture

1. **Vertex Click**: User clicks on a vertex circle element
2. **Event Bubbling**: Event bubbles up from vertex to canvas with data attributes intact
3. **Canvas Detection**: Canvas `handleMouseDown` checks `target.dataset.vertexIndex`
4. **Mode Verification**: Confirms `EditMode.EditVertices` is active
5. **Drag Initiation**: Sets `vertexDragState` with polygon/vertex info
6. **Mouse Move**: Updates drag offset in real-time
7. **Mouse Up**: Commits final vertex position

### Critical Data Attributes

```tsx
// CanvasVertex must expose these for event delegation:
data-polygon-id={polygonId}
data-vertex-index={vertexIndex}
```

## The Fix

### File: `/src/pages/segmentation/components/canvas/CanvasVertex.tsx`

**Before (Broken):**

```typescript
const handleMouseDown = React.useCallback(
  (e: React.MouseEvent) => {
    if (e.shiftKey) {
      return; // Allow Shift+Click to bubble up
    }
    if (isInAddPointsMode) {
      return; // Allow AddPoints mode clicks to bubble up
    }
    // PROBLEM: This blocks ALL regular clicks!
    e.stopPropagation();
  },
  [isInAddPointsMode]
);
```

**After (Fixed):**

```typescript
const handleMouseDown = React.useCallback(
  (e: React.MouseEvent) => {
    if (e.shiftKey) {
      return; // Allow Shift+Click to bubble up
    }
    if (isInAddPointsMode) {
      return; // Allow AddPoints mode clicks to bubble up
    }
    // CRITICAL FIX: Don't stop propagation for regular clicks!
    // The event needs to bubble up to the canvas for vertex dragging.
    // The canvas handler checks dataset attributes to detect vertices.
    // Removing stopPropagation() enables proper event delegation.

    // Let the event bubble up with data attributes intact
  },
  [isInAddPointsMode]
);
```

## How the Fix Works

1. **Event Bubbling Preserved**: Regular clicks now bubble up to canvas
2. **Data Attributes Intact**: `data-polygon-id` and `data-vertex-index` remain accessible
3. **Canvas Handler Detection**: `useAdvancedInteractions.handleMouseDown` can now detect vertex clicks
4. **Drag State Initialization**: `setVertexDragState` properly initializes dragging
5. **Special Cases Preserved**: Shift+Click and AddPoints mode still work correctly

## Interaction Handling Logic

### In `useAdvancedInteractions.tsx`:

```typescript
// Canvas checks for vertex click
if (target && target.dataset) {
  const polygonId = target.dataset.polygonId;
  const vertexIndex = target.dataset.vertexIndex;

  if (
    polygonId &&
    vertexIndex !== undefined &&
    editMode === EditMode.EditVertices
  ) {
    // Initialize vertex dragging
    setVertexDragState({
      isDragging: true,
      polygonId,
      vertexIndex: parseInt(vertexIndex, 10),
      originalPosition: { ...polygon.points[index] },
      dragOffset: { x: 0, y: 0 },
    });
  }
}
```

## Testing Verification

### Steps to Test:

1. Open segmentation editor
2. Load or create a polygon
3. Select the polygon to enter EditVertices mode
4. Click and drag any vertex - should move smoothly
5. Verify Shift+Click still switches to AddPoints mode
6. Verify right-click context menu still works on vertices

### Expected Behavior:

- ✅ Vertex dragging works in EditVertices mode
- ✅ Smooth cursor feedback (grab → grabbing)
- ✅ Real-time vertex position updates
- ✅ Special interactions preserved (Shift+Click, right-click)
- ✅ No polygon selection triggered when dragging vertices

## Key Learnings

1. **Event Delegation Pattern**: When using data attributes for event handling, never stop propagation prematurely
2. **Debugging Event Flow**: Check each level of the event chain when interactions fail
3. **Selective Propagation**: Only stop propagation when absolutely necessary for specific features
4. **Data Attributes**: Powerful pattern for identifying clicked elements in complex SVG structures
5. **Mode-Specific Handling**: Different edit modes may need different event propagation strategies

## Related Components

- `/src/pages/segmentation/components/canvas/CanvasVertex.tsx` - Vertex rendering and initial event handling
- `/src/pages/segmentation/hooks/useAdvancedInteractions.tsx` - Canvas-level interaction logic
- `/src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx` - Editor state management
- `/src/pages/segmentation/components/canvas/PolygonVertices.tsx` - Vertex collection component

## Prevention Strategy

To avoid similar issues in the future:

1. Always document why `stopPropagation()` is needed
2. Test all interaction modes when modifying event handlers
3. Use event delegation consistently for complex UI elements
4. Consider using a centralized event handling strategy
5. Add comments explaining event flow for complex interactions
