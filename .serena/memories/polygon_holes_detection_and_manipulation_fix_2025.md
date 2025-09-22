# Polygon Holes Detection and Manipulation Fix

## Problem Description

Users reported two critical issues with polygon handling in the segmentation editor:

1. **Holes not detected**: All polygons from ML models were rendered as external polygons, even those with holes
2. **Manipulation broken**: Couldn't drag points or use slice tool - polygons weren't being selected internally even though edit mode UI was shown

## Root Causes Identified

### 1. ML Service (Python) - Incorrect Parent Lookup

**File**: `/backend/segmentation/ml/model_loader.py`
**Issue**: Lines 519-523 tried to find parent polygons in the already-processed list, but parents might not have been processed yet due to contour ordering
**Solution**: Implemented two-pass approach:

- Pass 1: Create all polygons and build index mapping
- Pass 2: Assign types and parent relationships using the mapping

### 2. Backend PolygonValidator - Missing Type Fields

**File**: `/backend/src/utils/polygonValidation.ts`
**Issue**: The `Polygon` interface didn't include `type` or `parent_id` fields, causing them to be stripped during validation
**Solution**: Added fields to interface and validation logic:

```typescript
export interface Polygon {
  id?: string;
  points: PolygonPoint[];
  type?: 'external' | 'internal'; // Added
  parent_id?: string; // Added
}
```

### 3. Backend Service - Hardcoded Type

**File**: `/backend/src/services/segmentationService.ts`
**Issue**: Line 870 hardcoded all polygons to `type: 'external'`
**Solution**: Use preserved type from validated polygons:

```typescript
type: (polygon.type || 'external') as 'external' | 'internal',
parent_id: polygon.parent_id
```

### 4. Frontend Event Conflicts

**File**: `/src/pages/segmentation/components/canvas/CanvasPolygon.tsx`
**Issue**: Path elements had onClick handlers that conflicted with canvas-level interaction handlers
**Solution**: Removed onClick/onDoubleClick from path elements, added data attributes for identification

## Implementation Details

### ML Service Fix (Two-Pass Approach)

```python
# Pass 1: Create all polygons with index mapping
for i, contour in enumerate(contours):
    min_area = 50 if (hierarchy is None or hierarchy[i][3] == -1) else 10
    if cv2.contourArea(contour) < min_area:
        continue
    # Create polygon without type
    contour_index_to_polygon_index[i] = polygon_id_counter

# Pass 2: Assign types using mapping
for polygon in valid_polygons:
    parent_idx = hierarchy[contour_idx][3]
    if parent_idx != -1 and parent_idx in contour_index_to_polygon_index:
        polygon_type = "internal"
        parent_id = f"polygon_{contour_index_to_polygon_index[parent_idx]}"
```

### Key Improvements

1. **Different thresholds**: 50px for external contours, 10px for holes (prevents filtering out small holes)
2. **Correct hierarchy interpretation**: Parent polygons always available when processing children
3. **Better logging**: Shows detected holes with parent relationships
4. **Unified event handling**: Single source of truth for polygon interaction at canvas level

## Testing Checklist

- [ ] Polygons with holes display correctly (blue for internal, red for external)
- [ ] ML service logs show "Detected hole: contour X is child of contour Y"
- [ ] Polygon selection works by clicking on them
- [ ] Vertex dragging works in edit mode
- [ ] Slice tool can select and slice polygons
- [ ] No event conflicts or double-handling

## Files Modified

1. `/backend/segmentation/ml/model_loader.py` - Two-pass polygon detection
2. `/backend/src/utils/polygonValidation.ts` - Added type and parent_id to interface
3. `/backend/src/services/segmentationService.ts` - Use preserved polygon types
4. `/src/pages/segmentation/components/canvas/CanvasPolygon.tsx` - Removed conflicting handlers

## Expected Results

- ML logs: "Polygon detection: X external, Y internal, filtered Z small contours"
- API response includes `"type": "internal"` with `"parent_id"` references
- Frontend renders holes in blue, external polygons in red
- All manipulation tools work correctly
