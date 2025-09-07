# Fixed Polygon Coordinate Misalignment When Switching Between Images with Different Resolutions

## Problem Statement

When users switch between images with different resolutions in the segmentation editor, polygons were being saved with incorrect coordinates - appearing shifted or displaced. This occurred because the auto-save function was using the NEW image's dimensions but saving to the OLD image's ID.

## Root Cause Analysis

The issue had three contributing factors:

1. **State Update Timing**: When switching images, the `imageDimensions` state was immediately updated to the new image's dimensions
2. **Auto-Save Logic**: The auto-save function `autosaveBeforeReset()` was correctly saving to the previous image ID
3. **Dimension Context Mismatch**: The auto-save was using the current (already updated) `imageDimensions` state, causing coordinate transformation to use wrong dimension reference

This created a race condition where polygons were saved with coordinates calculated using the wrong image dimensions as reference.

## Solution Implementation

### 1. Dimension Tracking in useEnhancedSegmentationEditor Hook

Added dimension tracking to preserve previous image context:

```typescript
// Track previous dimensions
const previousImageDimensionsRef = useRef<
  { width: number; height: number } | undefined
>();

// Update tracking when switching images
useEffect(() => {
  if (imageDimensions) {
    previousImageDimensionsRef.current = imageDimensions;
  }
}, [imageId]); // Only track on image ID change

// Pass dimensions during auto-save
await onSave(
  polygonsToSave,
  previousImageId,
  previousImageDimensionsRef.current
);
```

### 2. Enhanced onSave Callback in SegmentationEditor

Modified the save callback to accept optional dimension parameters:

```typescript
const handleSave = useCallback(
  async (
    polygons: PolygonAnnotation[],
    targetImageId?: string,
    targetDimensions?: { width: number; height: number }
  ) => {
    let saveWidth = imageDimensions?.width;
    let saveHeight = imageDimensions?.height;

    // Dimension resolution logic
    if (targetDimensions) {
      // Auto-save case: use provided previous dimensions
      saveWidth = targetDimensions.width;
      saveHeight = targetDimensions.height;
    } else if (targetImageId && targetImageId !== imageId) {
      // Saving to different image: lookup dimensions
      const targetImage = projectImages.find(img => img.id === targetImageId);
      saveWidth = targetImage?.width;
      saveHeight = targetImage?.height;
    }
    // Default: use current dimensions for manual save

    // Save with correct dimensions
    await savePolygons(
      polygons,
      targetImageId || imageId,
      saveWidth,
      saveHeight
    );
  },
  [imageDimensions, imageId, projectImages, savePolygons]
);
```

### 3. Auto-Center Behavior Improvement

Implemented intelligent auto-centering that only triggers on initial load:

```typescript
// Track if coming from Project Detail page
const isInitialLoadRef = useRef(location.state?.fromProjectDetail === true);

useEffect(() => {
  if (imageDimensions && isInitialLoadRef.current) {
    // Auto-center only on first load
    centerAndFitCanvas();
    isInitialLoadRef.current = false;
  }
}, [imageDimensions]);
```

## Files Modified

- **`/src/pages/segmentation/SegmentationEditor.tsx`**:
  - Added dimension lookup logic in save callback
  - Implemented initial load tracking for auto-center behavior
- **`/src/pages/segmentation/hooks/useEnhancedSegmentationEditor.tsx`**:
  - Added `previousImageDimensionsRef` for dimension tracking
  - Enhanced auto-save to pass previous dimensions

## Technical Details

### Coordinate Transformation Context

The segmentation editor uses canvas coordinates that need to be transformed to image coordinates when saving. The transformation requires the correct image dimensions as reference:

```typescript
// Coordinate transformation formula
const imageX = (canvasX / canvasWidth) * imageWidth;
const imageY = (canvasY / canvasHeight) * imageHeight;
```

Using wrong dimensions in this transformation causes polygon displacement proportional to the dimension difference.

### State Management Pattern

The solution follows React best practices:

- Uses `useRef` for dimension tracking (doesn't trigger re-renders)
- Implements proper cleanup in `useEffect` dependencies
- Maintains callback stability with `useCallback`

## Testing Strategy

### Test Cases

1. **Multi-Resolution Image Switching**:
   - Create project with images of different resolutions (e.g., 1024x768 vs 2048x1536)
   - Add polygons to first image
   - Switch to second image quickly (trigger auto-save)
   - Return to first image and verify polygon positions

2. **Auto-Center Behavior**:
   - Navigate from Project Detail to Segmentation Editor
   - Verify canvas auto-centers on first image
   - Switch between images and verify no auto-centering occurs

3. **Manual Save Verification**:
   - Ensure manual save (Ctrl+S) still works correctly
   - Verify coordinates are saved with current image dimensions

### Edge Cases

- Images with extreme aspect ratio differences
- Very small or very large image dimensions
- Rapid image switching before auto-save completes
- Switching to image without existing polygons

## Related Components

This fix affects the broader segmentation workflow:

- **Auto-Save System**: Timing and context preservation
- **Canvas Management**: Coordinate transformations
- **Image Navigation**: State transitions between images
- **Polygon Persistence**: Database storage accuracy

## Performance Impact

Minimal performance impact:

- Added one `useRef` for dimension tracking
- Enhanced save callback with dimension lookup
- No additional network requests or computations

## Prevention Strategies

To prevent similar issues:

1. **Always pass context explicitly** rather than relying on current state during async operations
2. **Use refs for values that need to persist** across state updates
3. **Implement dimension validation** in save operations
4. **Add logging** for coordinate transformations during development

## Dependencies

This solution relies on existing infrastructure:

- React hooks (`useRef`, `useEffect`, `useCallback`)
- Existing polygon save mechanism
- Project image metadata structure
- Canvas coordinate transformation utilities
