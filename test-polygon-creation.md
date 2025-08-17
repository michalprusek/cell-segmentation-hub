# Test Plan: Polygon Creation Visibility Fix

## Problem

When in "Create New Polygon" mode, users couldn't see the temporary points they were adding because `cursorPosition` was null.

## Fix Applied

1. Added `cursorPosition` state tracking in `useEnhancedSegmentationEditor`
2. Updated cursor position tracking in `enhancedHandleMouseMove`
3. Passed `cursorPosition` to `useAdvancedInteractions` hook
4. Updated both `SegmentationEditor.tsx` and `EnhancedSegmentationEditor.tsx` to pass cursor position to `CanvasTemporaryGeometryLayer`

## Test Steps

1. Navigate to http://localhost:3000
2. Sign in or create account
3. Create a new project or open existing project
4. Upload an image or select existing image
5. Open segmentation editor
6. Switch to "Create New Polygon" mode (blue button with pen tool icon)
7. Click on the image to add points
8. Verify:
   - Each clicked point appears as a green circle
   - Lines connect the points with dashed lines
   - A preview line follows the cursor from the last point
   - When close to the first point, a closing line appears
   - The polygon can be completed by clicking near the first point

## Expected Visual Feedback

- ✅ Temporary points: Green circles with white borders
- ✅ Connecting lines: Green dashed lines between points
- ✅ Preview line: Light green dashed line from last point to cursor
- ✅ Closing indicator: Solid green line when hovering near first point
- ✅ First point highlight: Green circle outline when ready to close

## Files Modified

- `src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx`
- `src/pages/segmentation/hooks/useAdvancedInteractions.tsx`
- `src/pages/segmentation/SegmentationEditor.tsx`
- `src/pages/segmentation/components/EnhancedSegmentationEditor.tsx`
