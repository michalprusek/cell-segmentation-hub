# Add Points Mode and Vertex Scaling Fixes - 2025

## Problems Fixed

### Problem 1: Add Points Mode Required Shift to Complete Sequence

User reported that in Add Points mode, clicking on the ending vertex to complete the sequence only worked when holding Shift. The expected behavior was to allow clicking without Shift to complete the sequence.

### Problem 2: Vertices Too Small at High Zoom

User reported that vertices became too small at high zoom levels, making them difficult to see and interact with. This affected both regular vertices and blue vertices in Add Points mode.

## Root Cause Analysis

### Issue 1: Event Propagation Blocking in Add Points Mode

The `CanvasVertex` component was blocking ALL click events except for Shift+Click. This prevented the Add Points mode from receiving the click event needed to complete the sequence.

### Issue 2: Aggressive Vertex Scaling Formula

The vertex scaling configuration used too aggressive scaling with:

- Small minimum radius (1.5px)
- High scaling exponent (0.75)
- No zoom capping for extreme zoom levels

## Solutions Implemented

### Fix 1: Conditional Event Propagation for Add Points Mode

**Modified Files:**

1. `/src/pages/segmentation/components/canvas/CanvasVertex.tsx`
2. `/src/pages/segmentation/components/canvas/PolygonVertices.tsx`
3. `/src/pages/segmentation/components/canvas/CanvasPolygon.tsx`
4. `/src/pages/segmentation/SegmentationEditor.tsx`

**Changes Made:**

1. **CanvasVertex.tsx** - Added `isInAddPointsMode` prop and conditional event propagation:

```typescript
interface CanvasVertexProps {
  // ... existing props
  isInAddPointsMode?: boolean;
}

const handleMouseDown = React.useCallback(
  (e: React.MouseEvent) => {
    // Allow Shift+Click to bubble up for mode switching
    if (e.shiftKey) {
      return;
    }
    // Allow clicks in AddPoints mode to bubble up for sequence completion
    if (isInAddPointsMode) {
      return;
    }
    // Stop propagation for regular clicks to prevent polygon selection
    e.stopPropagation();
  },
  [isInAddPointsMode]
);
```

2. **PolygonVertices.tsx** - Added `editMode` prop and passed it to CanvasVertex:

```typescript
interface PolygonVerticesProps {
  // ... existing props
  editMode?: EditMode;
}

// In render:
<CanvasVertex
  // ... other props
  isInAddPointsMode={editMode === EditMode.AddPoints}
/>
```

3. **CanvasPolygon.tsx** - Added `editMode` prop and passed it through:

```typescript
interface CanvasPolygonProps {
  // ... existing props
  editMode?: EditMode;
}

// Pass to PolygonVertices:
<PolygonVertices
  // ... other props
  editMode={editMode}
/>
```

4. **SegmentationEditor.tsx** - Passed editMode to CanvasPolygon:

```typescript
<CanvasPolygon
  // ... other props
  editMode={editor.editMode}
/>
```

### Fix 2: Improved Vertex Scaling Configuration

**Modified File:** `/src/pages/segmentation/components/canvas/CanvasVertex.tsx`

**Changes Made:**

1. **Updated default configuration:**

```typescript
const defaultConfig: VertexScalingConfig = {
  baseRadius: 5,
  scalingMode: 'adaptive',
  scalingExponent: 0.5, // Reduced from 0.75 for less aggressive scaling
  minRadius: 3, // Increased from 1.5 to maintain visibility at high zoom
  maxRadius: 10, // Increased from 8 for better visibility at low zoom
  hoverScale: 1.3,
  dragScale: 1.1,
  startPointScale: 1.2,
  baseStrokeWidth: 1.2,
};
```

2. **Improved scaling formula with zoom capping:**

```typescript
case 'adaptive':
default:
  // Use a more balanced scaling formula that maintains visibility at high zoom
  // At zoom 1: baseRadius stays the same
  // At high zoom (>10): vertices remain visible but scale down gradually
  const zoomFactor = Math.max(1, Math.min(zoom, 100)); // Cap zoom effect at 100
  baseRadius = config.baseRadius / Math.pow(zoomFactor, config.scalingExponent);
  break;
```

## Why These Fixes Work

### Add Points Mode Fix:

1. **Preserves mode-specific behavior**: Allows necessary events through based on current editing mode
2. **Maintains existing functionality**: Regular vertex dragging and context menu still work
3. **Clean separation**: Each mode has appropriate event handling without interference

### Vertex Scaling Fix:

1. **Better visibility range**: Minimum radius of 3px ensures vertices remain clickable
2. **Smoother scaling**: Exponent of 0.5 provides more gradual size changes
3. **Zoom capping**: Prevents vertices from becoming invisible at extreme zoom levels
4. **Balanced formula**: Works well across typical zoom ranges (0.1x to 100x)

## Testing Verification

### Add Points Mode:

- ✅ Click on start vertex to begin sequence
- ✅ Add intermediate points by clicking
- ✅ Click on end vertex (without Shift) to complete sequence
- ✅ Mode automatically switches back to EditVertices after completion

### Vertex Scaling:

- ✅ Vertices remain visible at 100x zoom
- ✅ Vertices have appropriate size at 1x zoom
- ✅ Blue vertices in Add Points mode scale consistently
- ✅ Hover and drag states still apply scaling multipliers

## Component Flow

```
SegmentationEditor (editMode)
    ↓
CanvasPolygon (editMode prop)
    ↓
PolygonVertices (editMode prop)
    ↓
CanvasVertex (isInAddPointsMode = editMode === EditMode.AddPoints)
    ↓
Event Handler (conditional stopPropagation)
```

## Key Improvements

1. **Mode-aware event handling**: Components now respect the current editing mode
2. **Better UX**: Users can complete Add Points sequences naturally
3. **Improved visibility**: Vertices remain usable at all zoom levels
4. **Performance**: No unnecessary re-renders or event handler recreations

## Future Considerations

1. Consider making vertex scaling configuration user-adjustable
2. Add visual feedback when hovering over completion vertex in Add Points mode
3. Consider different vertex styles for different modes
4. Add keyboard shortcuts for mode switching

## Conclusion

These fixes address both the interaction issue in Add Points mode and the visibility problem at high zoom levels. The solutions are minimal, targeted, and maintain backward compatibility while improving the user experience.
