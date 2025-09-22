# Internal Polygon Hierarchy Visualization Implementation

## Date: 2025-09-22

## Feature: Display internal polygons in blue and mark them as "internal" in the segmentation editor

## Problem Statement

User requested that internal polygons (those with parent polygons in the hierarchy) be displayed in blue color in the segmentation editor and marked as "internal" in the polygon list.

## Solution Overview

Enhanced the polygon detection logic to identify internal polygons based on either:

1. Having a `parent_id` field (hierarchical relationship)
2. Having `type: 'internal'` (explicit type marking)

This dual approach ensures backward compatibility while supporting proper parent-child relationships.

## Implementation Details

### 1. Modified Files

#### `/src/pages/segmentation/components/PolygonListPanel.tsx`

- Added `isInternalPolygon` helper function to check for parent_id or type='internal'
- Updated `getPolygonColor` to use the new helper function
- Modified the color indicator and type label rendering to use the new logic

```typescript
// Determine if a polygon is internal based on parent_id or type
const isInternalPolygon = (polygon: any) => {
  return polygon.parent_id || polygon.type === 'internal';
};

const getPolygonColor = (polygon: any) => {
  return isInternalPolygon(polygon) ? 'bg-blue-500' : 'bg-red-500';
};
```

#### `/src/pages/segmentation/components/canvas/CanvasPolygon.tsx`

- Added extraction of `parent_id` from polygon object
- Created `isInternal` flag based on parent_id or type
- Updated all color and class assignments to use the isInternal flag

```typescript
const { id, points, type = 'external', parent_id } = polygon;
const isInternal = parent_id || type === 'internal';
```

### 2. Color Scheme

- **Internal Polygons (Blue)**:
  - Selected: `#0b84da`
  - Unselected: `#0ea5e9`
  - Fill: `rgba(14, 165, 233, 0.1)` (10% opacity)
- **External Polygons (Red)**:
  - Selected: `#e11d48`
  - Unselected: `#ef4444`
  - Fill: `rgba(239, 68, 68, 0.1)` (10% opacity)

### 3. Data Structure Support

The Polygon interface already supports:

```typescript
interface Polygon {
  id: string;
  points: Point[];
  type: 'external' | 'internal';
  parent_id?: string; // For internal polygons
  // ... other fields
}
```

### 4. Hierarchy Detection Methods

#### Current Implementation (RegionPanel.tsx)

Uses geometric containment to organize polygons:

```typescript
const organizedPolygons = useMemo(() => {
  const externals = polygons.filter(p => p.type === 'external');
  const internals = polygons.filter(p => p.type === 'internal');

  return externals.map(external => ({
    ...external,
    children: internals.filter(internal => {
      const centroid = getPolygonCentroid(internal.points);
      return isPointInPolygon(centroid, external.points);
    }),
  }));
}, [polygons]);
```

#### Enhanced Detection

The new implementation checks both:

1. Explicit `parent_id` field (direct relationship)
2. Polygon `type` field (backward compatibility)

## Benefits

1. **Dual Detection**: Supports both explicit parent_id and type-based detection
2. **Visual Clarity**: Blue color immediately identifies internal polygons
3. **Backward Compatible**: Works with existing type='internal' polygons
4. **Future Ready**: Supports proper hierarchical relationships via parent_id

## Testing Results

- ✅ TypeScript compilation: No errors
- ✅ ESLint: No errors in modified files
- ✅ Visual rendering: Internal polygons display in blue
- ✅ List labels: Show "Internal" for polygons with parent_id

## Integration Points

1. **Canvas Rendering**: CanvasPolygon.tsx handles visual display
2. **List Display**: PolygonListPanel.tsx shows labels and colors
3. **Hierarchy Organization**: RegionPanel.tsx manages parent-child relationships
4. **Backend API**: Supports parent_id field in polygon data

## Future Enhancements

1. Ensure ML service sets parent_id when detecting nested polygons
2. Consider visual nesting indicators in the polygon list
3. Add hierarchy depth visualization (different blue shades for nested levels)
4. Implement drag-and-drop to change parent-child relationships

## Key Insights

- The system was already partially implemented with color coding infrastructure
- The main gap was in consistently detecting internal polygons
- Using both parent_id and type fields provides maximum flexibility
- The geometric containment check in RegionPanel provides automatic hierarchy detection when parent_id is not set
