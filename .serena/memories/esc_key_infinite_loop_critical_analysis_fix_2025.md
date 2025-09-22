# ESC Key Infinite Loop - Critical Analysis and Fix (2025)

## CRITICAL BUG DISCOVERED

**User Issue**: "při stisknutí escape chci z edit vertices mode přepnout na view mode"  
Translation: "When pressing escape, I want to switch from edit vertices mode to view mode"

**Actual Behavior**: ESC key press causes infinite loop with repeated console output:

```
[useEnhancedSegmentationEditor] setEditMode called with: edit-vertices
[useEnhancedSegmentationEditor] Current mode before change: edit-vertices
```

## ROOT CAUSE ANALYSIS

### 1. PRIMARY ISSUE: Logic Contradiction in handleEscape

**File**: `src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx`
**Lines**: 722-747

**Current handleEscape Logic**:

```typescript
const handleEscape = useCallback(() => {
  // Reset all temporary state
  setTempPoints([]);
  setInteractionState({...});
  sliceProcessingRef.current = false;

  // PROBLEMATIC LOGIC:
  // If we have a selected polygon, go to EditVertices mode instead of View mode
  // This keeps the polygon selected when exiting other modes
  if (selectedPolygonId) {
    setEditMode(EditMode.EditVertices);  // ← WRONG for user expectation!
  } else {
    setEditMode(EditMode.View);
  }
}, [selectedPolygonId]);
```

**Problem**: When user is in EditVertices mode with a selected polygon and presses ESC:

1. handleEscape executes
2. selectedPolygonId exists, so it calls `setEditMode(EditMode.EditVertices)`
3. Mode is already EditVertices, but this triggers React state update
4. useCallback dependency `[selectedPolygonId]` causes function recreation
5. Creates infinite cycle of same state being set repeatedly

### 2. SECONDARY ISSUE: Circular State Dependency

**Circular Dependency Chain**:

```
handleEscape depends on [selectedPolygonId]
→ selectedPolygonId changes trigger handleEscape recreation
→ handleEscape calls setEditMode(EditVertices)
→ Mode switching logic in usePolygonSelection may affect selectedPolygonId
→ Triggers handleEscape recreation again
```

### 3. EVENT FLOW ANALYSIS

**Complete ESC Key Event Flow**:

1. **Key Press**: User presses ESC key
2. **useKeyboardShortcuts**: Captures ESC keydown event (line 211-219)

   ```typescript
   case 'escape':
     event.preventDefault();
     if (onEscape) {
       onEscape();  // ← Calls handleEscape
     } else {
       setEditMode(EditMode.View);  // ← Default behavior
     }
   ```

3. **handleEscape Execution**: (lines 722-747)
   - Resets temp state
   - Checks if selectedPolygonId exists
   - **CRITICAL FLAW**: Sets mode to EditVertices when already in EditVertices

4. **setEditMode Wrapper**: (lines 89-109)

   ```typescript
   const setEditMode = useCallback((newMode: EditMode) => {
     console.log(
       '[useEnhancedSegmentationEditor] setEditMode called with:',
       newMode
     );
     setEditModeRaw(currentMode => {
       console.log(
         '[useEnhancedSegmentationEditor] Current mode before change:',
         currentMode
       );
       // ... rest of logic
     });
   }, []);
   ```

5. **React State Update**:
   - Even setting the same mode triggers React's update cycle
   - This can cause useCallback recreation if dependencies change
   - Leads to infinite re-execution

## ARCHITECTURAL ISSUES IDENTIFIED

### 1. Contradictory Design Intent

**Current handleEscape comment**:

> "If we have a selected polygon, go to EditVertices mode instead of View mode. This keeps the polygon selected when exiting other modes"

**User Expectation**: ESC should ALWAYS go to View mode as an "escape" mechanism

**Conflict**: The code prioritizes maintaining EditVertices mode over providing consistent ESC behavior

### 2. Stale Closure Prevention vs Dependency Issues

The codebase has extensive stale closure fixes using useRef patterns, but handleEscape still uses direct state dependencies:

```typescript
}, [selectedPolygonId]); // ← This dependency causes recreation cycles
```

### 3. Inconsistent ESC Behavior

**useKeyboardShortcuts default behavior** (line 217):

```typescript
// Default escape behavior - return to view mode
setEditMode(EditMode.View);
```

**handleEscape custom behavior** (line 743):

```typescript
if (selectedPolygonId) {
  setEditMode(EditMode.EditVertices); // ← Contradicts default
}
```

## THE FIX: Multiple Approaches

### APPROACH 1: Fix Logic to Match User Expectations (RECOMMENDED)

**Change handleEscape to always go to View mode**:

```typescript
const handleEscape = useCallback(() => {
  // Reset all temporary state
  setTempPoints([]);
  setInteractionState({
    isDraggingVertex: false,
    isPanning: false,
    panStart: null,
    draggedVertexInfo: null,
    originalVertexPosition: null,
    sliceStartPoint: null,
    addPointStartVertex: null,
    addPointEndVertex: null,
    isAddingPoints: false,
  });
  // Reset slice processing flag
  sliceProcessingRef.current = false;

  // FIXED: Always go to View mode on ESC (user expectation)
  // ESC should be a "cancel/escape" action, not mode preservation
  setEditMode(EditMode.View);

  // Optionally clear selection too for complete "escape"
  // setSelectedPolygonId(null);
}, []); // ← Remove selectedPolygonId dependency to prevent recreation cycles
```

**Benefits**:

- ✅ Matches user expectation: ESC = escape to View mode
- ✅ Eliminates infinite loop (no circular dependencies)
- ✅ Consistent with keyboard shortcuts default behavior
- ✅ Simple and predictable

### APPROACH 2: Conditional Logic Based on Current Mode

```typescript
const handleEscape = useCallback(() => {
  // Reset temporary state first
  setTempPoints([]);
  setInteractionState({...});
  sliceProcessingRef.current = false;

  // Use ref to get current mode to avoid stale closures
  const currentMode = editModeRef.current;

  // Smart mode switching logic
  switch (currentMode) {
    case EditMode.EditVertices:
      // User wants to escape from EditVertices to View
      setEditMode(EditMode.View);
      break;
    case EditMode.Slice:
    case EditMode.DeletePolygon:
    case EditMode.AddPoints:
    case EditMode.CreatePolygon:
      // From special modes, go to View (unless polygon selected)
      setEditMode(selectedPolygonId ? EditMode.EditVertices : EditMode.View);
      break;
    default:
      setEditMode(EditMode.View);
  }
}, []); // No dependencies - use refs for current values
```

### APPROACH 3: Remove handleEscape, Use Default Behavior

Simply remove the custom `onEscape: handleEscape` and let useKeyboardShortcuts handle ESC with its default logic:

```typescript
// In useKeyboardShortcuts initialization, remove:
// onEscape: handleEscape,

// The default behavior will execute:
case 'escape':
  event.preventDefault();
  // Default escape behavior - return to view mode
  setEditMode(EditMode.View);
```

## RECOMMENDED SOLUTION: APPROACH 1

**Why Approach 1 is best**:

1. **Matches User Expectation**: ESC key universally means "escape/cancel"
2. **Eliminates Infinite Loop**: No circular dependencies
3. **Simplest Implementation**: Clear, predictable logic
4. **Consistent Behavior**: Same as keyboard shortcuts default
5. **Performance**: No unnecessary state dependencies

## IMPLEMENTATION

### File to Modify:

`src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx`

### Change Required:

Replace lines 722-747 with:

```typescript
// Escape handler - always return to View mode
const handleEscape = useCallback(() => {
  // Reset all temporary state
  setTempPoints([]);
  setInteractionState({
    isDraggingVertex: false,
    isPanning: false,
    panStart: null,
    draggedVertexInfo: null,
    originalVertexPosition: null,
    sliceStartPoint: null,
    addPointStartVertex: null,
    addPointEndVertex: null,
    isAddingPoints: false,
  });
  // Reset slice processing flag
  sliceProcessingRef.current = false;

  // FIXED: Always return to View mode on ESC
  // This matches user expectation and prevents infinite loops
  setEditMode(EditMode.View);
}, []); // No dependencies to prevent recreation cycles
```

## TESTING VERIFICATION

### Test Cases:

1. **EditVertices Mode + Selected Polygon + ESC**: Should go to View mode
2. **Slice Mode + ESC**: Should go to View mode
3. **Delete Mode + ESC**: Should go to View mode
4. **View Mode + ESC**: Should stay in View mode (no-op)

### Expected Console Output After Fix:

```
[useEnhancedSegmentationEditor] setEditMode called with: view
[useEnhancedSegmentationEditor] Current mode before change: edit-vertices
```

### Should NOT See:

```
[useEnhancedSegmentationEditor] setEditMode called with: edit-vertices
[useEnhancedSegmentationEditor] Current mode before change: edit-vertices
(repeating infinitely)
```

## ARCHITECTURAL IMPROVEMENTS

### 1. Consistent ESC Behavior Pattern

All ESC handlers should follow the same principle: ESC = escape to base state (View mode)

### 2. Dependency Management

- Avoid state dependencies in useCallback when possible
- Use refs for immediate state access
- Be cautious of circular dependency chains

### 3. User Experience

- ESC should be predictable escape mechanism
- Don't override user expectations for "smart" behavior
- Consistency across the application is key

## RELATED FILES CHECKED

### No Changes Needed:

- `src/pages/segmentation/hooks/useKeyboardShortcuts.tsx` - Default ESC behavior is correct
- `src/pages/segmentation/hooks/usePolygonSelection.ts` - No ESC handling here
- `src/pages/segmentation/hooks/useAdvancedInteractions.tsx` - No ESC handling here

### Verification Points:

- ✅ No competing ESC handlers found
- ✅ No circular dependencies in polygon selection logic
- ✅ useKeyboardShortcuts provides correct fallback behavior
- ✅ setEditMode wrapper logs help identify the issue

## CONCLUSION

The ESC key infinite loop is caused by:

1. **Logic contradiction**: handleEscape tries to maintain EditVertices mode when user expects View mode
2. **Circular dependency**: selectedPolygonId dependency causes useCallback recreation cycles
3. **State update cycles**: Setting the same mode repeatedly triggers React update loops

The fix is simple: Change handleEscape to always set View mode and remove the selectedPolygonId dependency. This matches user expectations and eliminates the infinite loop while maintaining clean state management.

## PREVENTION STRATEGIES

### Code Review Checklist:

- [ ] ESC handlers should always "escape" to base state
- [ ] Avoid circular dependencies in useCallback
- [ ] Test rapid state changes that might trigger update cycles
- [ ] Verify user expectations match implementation logic
- [ ] Check for competing event handlers

### User Testing:

- Test ESC behavior from all modes
- Verify no console spam during normal operation
- Check that ESC feels "predictable" to users
- Test rapid ESC key presses

This analysis provides a complete understanding of the issue and a clear path to resolution.
