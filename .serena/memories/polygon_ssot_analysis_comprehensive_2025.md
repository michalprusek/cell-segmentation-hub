# Comprehensive SSOT Analysis: Segmentation Editor Polygon System

## Critical Finding: Dual Event Handler SSOT Violation

### Current Situation (After Recent Fix)

The CanvasPolygon.tsx file now has `onClick={handleClick}` on the path element (line 231), but this creates a **new SSOT violation**:

```typescript
// HANDLER 1: CanvasPolygon direct click
<path onClick={handleClick} /> // Line 231

// HANDLER 2: Canvas-level mouse handling
<CanvasContainer onMouseDown={editor.handleMouseDown} />

// HANDLER 3: Advanced interactions
const handleViewModeClick = useCallback((imagePoint: Point) => {
  setSelectedPolygonId(containingPolygons[0].id);
}, []);
```

## Root Cause Analysis

### Event Flow Conflicts

1. **User clicks polygon path**
2. **CanvasPolygon.handleClick fires** → calls `onSelectPolygon(id)`
3. **Event bubbles to canvas** → `editor.handleMouseDown` fires
4. **useAdvancedInteractions.handleViewModeClick** → also tries to set selection
5. **Result**: Multiple selection attempts, state conflicts

### Selection State Management Issues

**Three different selection mechanisms**:

```typescript
// MECHANISM 1: SegmentationEditor.handlePolygonSelection
const handlePolygonSelection = useCallback(
  (polygonId: string | null) => {
    if (editor.editMode === EditMode.Slice) return; // Mode conflicts
    if (polygonId === null) {
      if (editor.editMode === EditMode.EditVertices) {
        editor.setEditMode(EditMode.View);
      }
    } else {
      editor.setEditMode(EditMode.EditVertices); // Auto-mode switch
    }
    editor.setSelectedPolygonId(polygonId);
  },
  [editor]
);

// MECHANISM 2: useAdvancedInteractions.handleViewModeClick
const handleViewModeClick = useCallback((imagePoint: Point) => {
  const containingPolygons = polygons.filter(polygon =>
    isPointInPolygon(imagePoint, polygon.points)
  );
  if (containingPolygons.length > 0) {
    setSelectedPolygonId(containingPolygons[0].id);
    setEditMode(EditMode.EditVertices); // Direct state change
  }
}, []);

// MECHANISM 3: Direct editor state change
editor.setSelectedPolygonId(polygonId); // From various places
```

## SSOT Violations Summary

### 1. Event Handling Duplication 🔴 CRITICAL

- **CanvasPolygon onClick** vs **Canvas onMouseDown** vs **useAdvancedInteractions**
- **All three can trigger polygon selection**
- **Event propagation causes multiple handlers to fire**

### 2. Mode Transition Logic Scattered 🔴 CRITICAL

- **handlePolygonSelection**: Mode transition with slice mode blocking
- **handleViewModeClick**: Direct mode transition without checks
- **Different logic for same action**

### 3. Vertex Manipulation Conflicts 🔴 HIGH

- **CanvasPolygon click** conflicts with **vertex drag detection**
- **Click events** prevent **drag events** from working properly
- **useAdvancedInteractions vertex handling** competes with path clicks

### 4. Slice Tool Multi-State Issues 🔴 HIGH

- **handlePolygonSelection blocks slice mode** (`if (editMode === Slice) return`)
- **useAdvancedInteractions.handleSliceClick** manages slice workflow
- **usePolygonSlicing** has separate slice logic
- **Three different slice state machines**

## Architecture Recommendations

### Immediate Fix: Choose Single Event Handler

**Option A: Keep CanvasPolygon onClick (Simple)**

```typescript
// Remove canvas-level polygon click detection
// Keep only CanvasPolygon onClick for selection
// Use canvas-level only for panning and empty area clicks
```

**Option B: Keep Canvas-Level Only (Recommended)**

```typescript
// Remove CanvasPolygon onClick handlers
// Use only canvas-level mouse handling
// Let useAdvancedInteractions handle all polygon detection
```

### Long-term: Unified State Machine

```typescript
// Single polygon interaction controller
class PolygonInteractionController {
  handlePolygonClick(polygonId: string) {
    switch (this.currentMode) {
      case EditMode.View:
        this.selectPolygon(polygonId);
        this.setMode(EditMode.EditVertices);
        break;
      case EditMode.Slice:
        this.selectPolygonForSlice(polygonId);
        break;
      case EditMode.DeletePolygon:
        this.deletePolygon(polygonId);
        break;
    }
  }
}
```

## Expected Issues Until Fixed

1. **Polygon selection will be unreliable** - sometimes works, sometimes doesn't
2. **Vertex dragging will conflict** with click events
3. **Slice tool will remain stuck** due to mode blocking
4. **Event propagation issues** will cause unexpected behavior
5. **State inconsistencies** between different selection mechanisms

## Verification Tests

After fixing SSOT violations:

- [ ] Click polygon → selects only that polygon
- [ ] Drag vertex → moves vertex smoothly
- [ ] Slice tool → 3-step workflow works
- [ ] Mode transitions → consistent behavior
- [ ] No double event handling
- [ ] Event.stopPropagation() works correctly

## Files Requiring Changes

1. **CanvasPolygon.tsx** - Remove or coordinate onClick handler
2. **useAdvancedInteractions.tsx** - Centralize polygon interaction logic
3. **SegmentationEditor.tsx** - Simplify handlePolygonSelection wrapper
4. **usePolygonSlicing.tsx** - Coordinate with main interaction system

The core issue is **too many hands in the cookie jar** - multiple systems trying to manage the same interactions without coordination.
