# Segmentation Editor Polygon Selection and Type Classification Fix

## Issues Fixed

1. **All polygons selected instead of just one when clicking**
2. **All polygons showing as "external" type instead of proper internal/external classification**

## Root Causes

### Issue 1: Polygon Selection

- **File**: `/src/pages/segmentation/SegmentationEditor.tsx`
- **Problem**: Creating new function instances for each polygon's click handler caused React re-renders
- **Original code**: `onSelectPolygon={() => handlePolygonSelection(polygon.id)}`
- **Fixed code**: `onSelectPolygon={handlePolygonSelection}`

### Issue 2: Polygon Type Classification

- **Files**: Backend services
- **Problem**: `detectHoles` parameter defaulted to `false`, preventing hierarchy detection
- **Files fixed**:
  - `/backend/src/services/segmentationService.ts` (lines 195, 201)
  - `/backend/src/services/queueService.ts` (lines 688, 697)
  - `/backend/src/api/controllers/queueController.ts` (line 64)
- **Change**: Default changed from `false` to `true`

## Technical Details

### ML Service Behavior

- `detectHoles=false`: Uses OpenCV RETR_EXTERNAL (only outer contours)
- `detectHoles=true`: Uses OpenCV RETR_TREE (full hierarchy for internal/external classification)

### Additional Fix: Missing Terser

- **Problem**: Vite v3+ requires terser for production builds
- **Solution**: Added `"terser": "^5.36.0"` to package.json devDependencies

## Deployment Steps

1. Restart backend: `docker restart blue-backend`
2. Rebuild frontend: `./scripts/smart-docker-build.sh --env blue --service blue-frontend`
3. Restart frontend: `docker restart blue-frontend`
4. Verify health: `docker ps | grep blue`

## Testing

After fixes, verify in segmentation editor:

1. Clicking a polygon selects only that specific polygon
2. Polygons correctly show as internal (blue) or external (red) based on hierarchy
