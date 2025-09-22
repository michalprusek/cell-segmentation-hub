# Polygon Detection Hole Classification Fix - ML Service

## Issue Summary

ML service's polygon detection logic incorrectly classifies all polygons as "external" even when holes should be detected. Log shows: "12 external, 0 internal" when holes exist.

## Root Cause Analysis

### Files Affected

- `/home/cvat/cell-segmentation-hub/backend/segmentation/ml/model_loader.py`
  - Lines 488-542: Single image processing
  - Lines 779-827: Batch processing
- Postprocessing service works per-region, so defaults to "external"

### Three Critical Issues

#### 1. **Wrong Parent-Child Mapping Logic** (Lines 516-520)

```python
# BROKEN: Looks for parent in already-processed polygons list
for j, existing_polygon in enumerate(polygons):
    if existing_polygon.get("contour_index") == parent_idx:
        parent_polygon_id = existing_polygon["id"]
        break
```

**Problem**: Parent contour might not be processed yet (processing order != contour index order)

#### 2. **Aggressive Small Contour Filtering** (Line 490)

```python
if cv2.contourArea(contour) < 50:  # Filters out small holes!
    filtered_count += 1
    continue
```

**Problem**: Small holes inside cells get filtered before hierarchy analysis

#### 3. **OpenCV Hierarchy Misinterpretation**

- `hierarchy[i][3] != -1` means contour i has a parent (is a hole)
- Current logic assumes processed order = contour index order (WRONG)

## Solution: Two-Pass Processing

### Fixed Algorithm

1. **Pass 1**: Build contour index → polygon index mapping
2. **Pass 2**: Create polygons with correct parent lookups

### Key Improvements

- **Smart filtering**: 50px for external, 10px for internal contours
- **Correct hierarchy**: Use mapping to find parents properly
- **Better logging**: Show detected holes with parent relationships

### Implementation Status

- ✅ Root cause identified in model_loader.py
- ✅ Fix algorithm designed (two-pass processing)
- ✅ Patch file created: `/home/cvat/cell-segmentation-hub/polygon_detection_fix.patch`
- 🔄 Code changes need to be applied to both single and batch processing functions

## Expected Results After Fix

- Log will show: "X external, Y internal" instead of "X external, 0 internal"
- Holes properly classified as "type: internal" with parent_id
- Small holes won't be prematurely filtered out
- Parent-child relationships correctly established

## Testing Strategy

1. Use image with known holes in cells
2. Enable detect_holes=True
3. Check logs for "Detected hole: contour X is child of contour Y"
4. Verify API response contains polygons with "type: internal"

## Related Issues

- Performance: Two-pass processing adds minimal overhead
- Memory: Temporary mapping cleared after processing
- Batch processing: Same fix needed in batch function (lines 779-827)

## Files Referenced

- `backend/segmentation/ml/model_loader.py` - Main polygon detection logic
- `backend/segmentation/services/postprocessing.py` - Per-region processing (defaults external)
- Patch file: `polygon_detection_fix.patch` - Complete fix implementation
