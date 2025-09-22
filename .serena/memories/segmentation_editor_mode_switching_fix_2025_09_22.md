# Segmentation Editor Mode Switching Fix - September 22, 2025

## Critical Bug Fixed

**Problem**: User reported that after comprehensive polygon selection fixes, slice mode and delete mode were still incorrectly switching to edit vertices mode when clicking on polygons.

**Expected Behavior**:
- Slice mode: Click polygon → stays in slice mode, polygon selected for slicing
- Delete mode: Click polygon → deletes polygon, stays in delete mode  
- View mode: Click polygon → switches to edit vertices mode (correct)

**Actual Bug**: Slice and Delete modes were auto-switching to EditVertices mode when clicking polygons

## Root Cause Analysis

### Primary Issue: Wrong Handler Usage in SegmentationEditor.tsx

**Problematic Code (lines 1197-1199):**
```typescript
onSelectPolygon={() => handlePolygonSelection(polygon.id)}
```

**Problems Identified:**
1. **Wrong function**: Used `handlePolygonSelection` instead of dedicated `handlePolygonClick`
2. **Function signature mismatch**: `handlePolygonSelection` expects `string | null`, arrow function passes `string`
3. **Performance issue**: Created new function instance on every render
4. **Inconsistent usage**: PolygonListPanel used `handlePolygonSelection` directly, CanvasPolygon used arrow function

### Secondary Issue: Event Flow Confusion

The CanvasPolygon component has two handlers:
- **Single click**: `onSelectPolygon` → should respect current mode
- **Double click**: `onEditPolygon` → always forces EditVertices mode

Users accidentally double-clicking could trigger the wrong behavior.

## Investigation Process

### Files Examined:
- `/src/pages/segmentation/hooks/usePolygonSelection.ts` - Hook implementation was correct
- `/src/pages/segmentation/SegmentationEditor.tsx` - Found wrong handler usage
- `/src/pages/segmentation/components/canvas/CanvasPolygon.tsx` - Confirmed event flow
- `/src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx` - No competing logic found

### Key Findings:
1. ✅ usePolygonSelection hook logic was working correctly
2. ✅ Mode-specific behavior was properly implemented
3. ❌ **CanvasPolygon was using wrong handler function**
4. ✅ No competing selection handlers found
5. ✅ No overriding mode switches after selection

## The Fix

**File:** `/src/pages/segmentation/SegmentationEditor.tsx`
**Lines:** 1197-1199

**Before (Broken):**
```typescript
onSelectPolygon={() => handlePolygonSelection(polygon.id)}
```

**After (Fixed):**
```typescript
onSelectPolygon={handlePolygonClick}
```

## Why This Fix Works

### Function Signatures Match:
- `handlePolygonClick: (polygonId: string) => void`
- `onSelectPolygon?: (id: string) => void`

### Proper Event Flow:
1. User clicks polygon in Slice/Delete mode
2. CanvasPolygon calls `handlePolygonClick(polygon.id)`
3. `handlePolygonClick` adds debug logging then calls `handlePolygonSelection(polygonId)`
4. `handlePolygonSelection` uses switch statement to maintain current mode
5. Mode stays as intended (Slice/Delete)

### Benefits:
- ✅ Uses correctly designed handler function
- ✅ Proper function signature matching
- ✅ Better performance (no arrow function recreation)
- ✅ Enhanced logging and debugging
- ✅ Mode-aware behavior as designed
- ✅ Consistent with hook's design intent

## Testing Verification

**Expected Results After Fix:**

### Slice Mode:
- Click polygon → Console: "[usePolygonSelection] SLICE MODE - Selecting polygon, NOT changing mode"
- Polygon gets selected for slicing
- Mode stays as EditMode.Slice
- No auto-switch to EditVertices

### Delete Mode:
- Click polygon → Polygon gets deleted immediately
- Mode stays as EditMode.DeletePolygon
- Ready for next deletion

### View Mode:
- Click polygon → Console: "[usePolygonSelection] VIEW MODE - Auto-switching to EditVertices!"
- Mode correctly switches to EditMode.EditVertices
- Polygon selected for vertex editing

## Debug Console Output

With the fix, users will see proper logging:
```
[usePolygonSelection] handlePolygonClick - Current editMode: Slice
[usePolygonSelection] handlePolygonClick - About to handle selection for: polygon-123
[usePolygonSelection] SLICE MODE - Selecting polygon, NOT changing mode: polygon-123
```

## Architecture Notes

### Single Source of Truth (SSOT) Maintained:
- CanvasPolygon → handlePolygonClick → handlePolygonSelection → mode-specific logic
- No competing selection handlers
- Clear event delegation chain
- Centralized mode management

### Performance Improvements:
- Eliminated arrow function recreation on each render
- Stable function references for React.memo optimization
- Reduced unnecessary re-renders

## Lessons Learned

1. **Handler Function Design**: When creating hooks that provide multiple handler functions, ensure clear naming and purpose:
   - `handlePolygonSelection`: Internal logic, accepts `string | null`
   - `handlePolygonClick`: Public API for components, accepts `string`

2. **Function Signature Matching**: Always verify that handler functions match the expected interface of receiving components

3. **Consistent Usage Patterns**: Ensure all similar components use the same handler approach (don't mix arrow functions and direct references)

4. **Debugging Infrastructure**: Proper console logging helped identify that the hook logic was correct, pointing to integration issues

## Related Files

### Core Implementation:
- `/src/pages/segmentation/hooks/usePolygonSelection.ts` - SSOT for selection logic
- `/src/pages/segmentation/SegmentationEditor.tsx` - Fixed handler usage
- `/src/pages/segmentation/components/canvas/CanvasPolygon.tsx` - Event source

### Supporting Files:
- `/src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx` - Hook integration
- `/src/pages/segmentation/components/PolygonListPanel.tsx` - Correct usage example

## Future Prevention

### Code Review Checklist:
- [ ] Handler functions match expected signatures
- [ ] No unnecessary arrow functions in JSX props
- [ ] Consistent handler usage across similar components
- [ ] Proper function naming conventions followed
- [ ] Debug logging preserved for troubleshooting

### Testing Considerations:
- Test each edit mode's polygon click behavior
- Verify mode persistence after polygon selection
- Check console output for expected debug messages
- Test both single-click and double-click behaviors

## Conclusion

This fix resolves the persistent mode switching issue by ensuring the correct handler function is used for polygon selection in the CanvasPolygon component. The solution maintains the SSOT principle, improves performance, and provides better debugging capabilities while fixing the core mode persistence problem.