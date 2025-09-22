# Shift+Click Vertex Mode Switching Fix - 2025

## Problem Description

User reported that Shift+Click on a vertex in EditVertices mode was no longer switching to AddPoints mode. This feature previously worked but had regressed.

## Root Cause Analysis

### The Issue

The `CanvasVertex` component was unconditionally calling `e.stopPropagation()` in its `handleMouseDown` event handler. This prevented ALL click events from bubbling up to the parent canvas handler where the Shift+Click logic resided.

### Event Flow

1. User Shift+Clicks on a vertex
2. CanvasVertex's handleMouseDown fires first
3. Event calls `e.stopPropagation()` unconditionally
4. Event never reaches useAdvancedInteractions hook in parent
5. Shift+Click logic never executes

### Code Location

- **Broken Component**: `/src/pages/segmentation/components/canvas/CanvasVertex.tsx` (line 154-158)
- **Shift+Click Logic**: `/src/pages/segmentation/hooks/useAdvancedInteractions.tsx` (line 538-551)

## The Fix

Modified `CanvasVertex.tsx` handleMouseDown to conditionally stop propagation:

```typescript
// Before (broken):
const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
  // Stop propagation to prevent polygon selection
  e.stopPropagation();
  // Let the event bubble up with data attributes intact
}, []);

// After (fixed):
const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
  // Allow Shift+Click to bubble up for mode switching
  if (e.shiftKey) {
    // Don't stop propagation for Shift+Click
    // This allows the parent handler to switch to AddPoints mode
    return;
  }
  // Stop propagation for regular clicks to prevent polygon selection
  e.stopPropagation();
  // Let the event bubble up with data attributes intact
}, []);
```

## Why This Works

1. **Shift+Click events now bubble up**: When Shift is held, the event propagates to parent handlers
2. **Regular clicks still prevented**: Normal clicks still stop propagation to prevent unwanted polygon selection
3. **Mode switching logic executes**: The useAdvancedInteractions hook can now detect Shift+Click and switch to AddPoints mode
4. **Preserves existing behavior**: Right-click context menu and drag operations remain unaffected

## Component Hierarchy

```
Canvas (mouseDown handler from useAdvancedInteractions)
└── CanvasPolygon
    └── PolygonVertices
        └── VertexContextMenu (wrapper)
            └── CanvasVertex (was blocking events)
```

## Testing Verification

### Expected Behavior After Fix:

1. **EditVertices mode + Shift+Click on vertex** → Switches to AddPoints mode with that vertex as starting point
2. **EditVertices mode + Regular click on vertex** → Starts dragging the vertex (unchanged)
3. **EditVertices mode + Right-click on vertex** → Shows context menu (unchanged)

### Key Test Scenarios:

- ✅ Shift+Click on vertex switches to AddPoints mode
- ✅ Regular vertex dragging still works
- ✅ Context menu on right-click still works
- ✅ Polygon selection prevention still active
- ✅ No event handler conflicts

## Related Components

### Core Files:

- `/src/pages/segmentation/components/canvas/CanvasVertex.tsx` - Fixed component
- `/src/pages/segmentation/hooks/useAdvancedInteractions.tsx` - Contains Shift+Click logic
- `/src/pages/segmentation/components/canvas/PolygonVertices.tsx` - Renders vertices
- `/src/pages/segmentation/components/context-menu/VertexContextMenu.tsx` - Context menu wrapper

## Lessons Learned

1. **Event Propagation**: When stopping propagation, always consider modifier keys that might need special handling
2. **Component Hierarchy**: Understanding the full component tree is crucial for debugging event issues
3. **Conditional Propagation**: Use conditional logic in stopPropagation to allow specific events through
4. **Testing Modifier Keys**: Always test interactions with Shift, Ctrl, Alt keys after event handler changes

## Prevention Guidelines

- Always check for modifier keys before stopping propagation
- Document event flow in complex component hierarchies
- Test all interaction modes after modifying event handlers
- Consider using event delegation for complex interactions
- Maintain clear separation between different click behaviors (left/right/shift+click)

## Code Pattern

For future vertex/point interaction handlers:

```typescript
const handleMouseDown = (e: React.MouseEvent) => {
  // Check modifier keys first
  if (e.shiftKey || e.ctrlKey || e.altKey) {
    // Allow modified clicks to bubble up for special handling
    return;
  }

  // Handle regular clicks
  if (e.button === 0) {
    // Left click
    e.stopPropagation();
    // Regular click logic
  }
  // Right-click typically handled by context menu
};
```

## Conclusion

This fix restores the Shift+Click functionality for switching from EditVertices to AddPoints mode by allowing events with the Shift modifier to bubble up to parent handlers. The solution is minimal, targeted, and preserves all existing functionality while fixing the reported regression.
