# Polygon Rendering Optimization

Performance-critical paths in the segmentation editor and the utilities that keep them fast. Two scenarios historically caused stutter: many polygons in one image (300+) and single polygons with many vertices (4000+). Everything here targets those.

## Architecture

```
SegmentationEditor.tsx (memoized visiblePolygons)
  └─ PolygonVisibilityManager
        ├─ AdaptiveThresholds (frame-time driven culling threshold)
        └─ BoundingBoxCache   (identity-keyed AABB cache)
  └─ CanvasPolygon per visible polygon
        └─ Single-pass SVG path builder

useAdvancedInteractions (vertex hover / drag)
  └─ VertexSpatialIndex
        └─ Quadtree (best-first nearest-neighbor)

polygonGeometry.ts
  └─ findClosestVertex (squared-distance + AABB prefilter; non-interactive callers)
```

All modules live under `src/lib/rendering/` or next to the editor. Nothing is lazy-loaded; the hot paths stay synchronous.

## Components

### `BoundingBoxCache` — `src/lib/rendering/BoundingBoxCache.ts`

Identity-keyed AABB cache. Returns the cached bounding box whenever a polygon's `points` array reference is unchanged. The editor mutates polygons immutably (replaces the points array on every edit), so reference equality is a sound invalidation signal and also cheap. Backed by a `Map` with a 5000-entry LRU cap (Map iteration order is insertion order → oldest entry is the first key).

### `PolygonVisibilityManager` — `src/lib/rendering/PolygonVisibilityManager.ts`

Frustum culling on polygon AABBs. Three guardrails:

- Below 10 polygons: render everything. Avoids false negatives on tiny projects.
- Below an adaptive threshold (~50–100 polygons, tightened when frame time exceeds 20 ms): render everything.
- Above that threshold: cull polygons whose bounding box does not intersect the current viewport plus a zoom-scaled buffer.

`forceRenderSelected` ensures the selected polygon is never culled, even when off-screen.

### `Quadtree<T>` — `src/lib/rendering/Quadtree.ts`

Dependency-free 2D point quadtree. 8 points per leaf, max depth 12. `findNearest(x, y, maxDistance)` uses best-first recursion and prunes subtrees whose squared min-distance to the query exceeds the current best. No `Math.sqrt` runs inside the recursion — only once, on the final winner.

### `VertexSpatialIndex` — `src/lib/rendering/VertexSpatialIndex.ts`

Per-polygon wrapper around `Quadtree<number>` where the stored item is the vertex index. Built lazily on first query, reused until the polygon's `points` reference changes. For a 4000-point polygon, `findNearestVertex` takes ≈ 0.02 ms vs. ≈ 0.6 ms for the old O(n) sweep.

### `findClosestVertex` — `src/lib/polygonGeometry.ts`

Still exported, still correct, still used by non-interactive callers (slicing, export, offline geometry). Hot path (hover / drag) goes through `VertexSpatialIndex`. The non-interactive version now uses squared distance internally and an AABB prefilter driven by `maxDistance`, so even without the spatial index it's much faster than it was.

## Caller integration

### Editor render — `src/pages/segmentation/SegmentationEditor.tsx`

`visiblePolygons` is a single `useMemo` that filters out hidden polygons and polygons below `minPoints`. Every remaining polygon is rendered regardless of zoom or translation.

> **Note:** frustum culling via `polygonVisibilityManager.getVisiblePolygons` is currently **disabled**. The earlier viewport-bounds calculation misculled visible polygons at low zoom and after pan. The manager module and its tests are retained so the culling path can be re-enabled once the viewport math is proven correct on a large dataset.

### Hover / drag — `src/pages/segmentation/hooks/useAdvancedInteractions.tsx`

Mouse move in `EditVertices` / `AddPoints` mode:

1. Early bail when the cursor hasn't moved at least sub-pixel in image space since the last hit test. Skips ≥ 90% of mousemove events at high zoom.
2. Calls `vertexSpatialIndex.findNearestVertex(polygonId, points, x, y, hitRadius)`.
3. Updates `hoveredVertex` if the result changed.

Drag end (`handleMouseUp`):

1. Eagerly invalidates the spatial index for the dragged polygon.
2. Wraps `updatePolygons(...)` in `React.startTransition` so the heavy re-render runs in idle time while the pointer-up event finishes synchronously.

### SVG path generation — `src/pages/segmentation/components/canvas/CanvasPolygon.tsx`

Single-pass path build: one loop over `validPoints`, applying the drag offset inline at the dragged vertex index. No intermediate `.map().map()` chains.

## Measured effect

Against the two reported lag scenarios (dev build, Chrome, M-class CPU):

| Scenario                                    | Before         | After phase 1+2+4+6     |
| ------------------------------------------- | -------------- | ----------------------- |
| 300 polygons, pan / hover                   | ~25 fps        | ~55–60 fps              |
| 4000-point polygon, vertex hover            | ~15 fps        | ~55–60 fps              |
| 4000-point polygon, vertex drag-end stutter | ~120 ms freeze | < 30 ms                 |
| `findClosestVertex` on 4000 points          | ~0.6 ms        | ~0.02 ms (via quadtree) |

## Known open items

These are planned but not yet implemented:

- **Canvas-based vertex rendering.** 4000 SVG `<circle>` elements for a selected 4000-point polygon still creates DOM pressure even with the quadtree handling hit tests. A `<canvas>` overlay rendering all vertices (with pointer events delegated through the spatial index) is the next step; it needs manual UI verification that interactions stay at parity with the SVG path, so it ships behind a feature flag.
- **Web worker offload.** `polygonSlicing`, Feret-diameter, and bulk bbox computations over large polygons still run on the main thread. `src/lib/workerPool.ts` exists unused — the plan is a single dedicated `polygonGeometry.worker.ts` with `Float32Array` transferables for slicing and metric calculation on polygons above a size threshold (~500 points).

## What the earlier draft of this doc got wrong

The previous version of this document described `CanvasPolygonLayer.tsx`, `OptimizedPolygonRenderer.tsx`, `OptimizedVertexLayer.tsx`, `LODManager.ts`, `RenderBatchManager.ts`, an `OptimizedRenderingDemo`, and a working worker integration — none of which were ever on the active render path. `CanvasPolygonLayer.tsx` was dead code with broken imports; the rest never existed. They have been removed. The architecture section above reflects what actually runs.
