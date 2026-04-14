import { describe, expect, it } from 'vitest';
import type { Polygon } from '@/lib/segmentation';
import {
  PolygonVisibilityManager,
  type VisibilityContext,
} from '../PolygonVisibilityManager';

function makeSquarePolygon(
  id: string,
  originX: number,
  originY: number,
  size = 10
): Polygon {
  return {
    id,
    points: [
      { x: originX, y: originY },
      { x: originX + size, y: originY },
      { x: originX + size, y: originY + size },
      { x: originX, y: originY + size },
    ],
    type: 'external',
    geometry: 'polygon',
  } as Polygon;
}

describe('PolygonVisibilityManager.getVisiblePolygons', () => {
  it('renders everything below the small-count fallback (N < 10)', () => {
    const manager = new PolygonVisibilityManager();
    const polygons = Array.from({ length: 5 }, (_, i) =>
      makeSquarePolygon(`p${i}`, 10000 + i * 50, 10000)
    );
    const context: VisibilityContext = {
      zoom: 1,
      offset: { x: 0, y: 0 },
      containerWidth: 100,
      containerHeight: 100,
      forceRenderSelected: true,
    };
    const result = manager.getVisiblePolygons(polygons, context);
    expect(result.visibleCount).toBe(5);
    expect(result.culledCount).toBe(0);
  });

  it('culls off-screen polygons for large counts', () => {
    const manager = new PolygonVisibilityManager();

    // 300 polygons spread on a 20x15 grid at 50px spacing -> 1000x750 image.
    const polygons: Polygon[] = [];
    for (let row = 0; row < 15; row++) {
      for (let col = 0; col < 20; col++) {
        polygons.push(
          makeSquarePolygon(`p-${row}-${col}`, col * 50, row * 50, 20)
        );
      }
    }

    // Viewport shows the top-left 200x150 corner at zoom 1 (translate 0,0).
    const context: VisibilityContext = {
      zoom: 1,
      offset: { x: 0, y: 0 },
      containerWidth: 200,
      containerHeight: 150,
      forceRenderSelected: true,
    };

    const result = manager.getVisiblePolygons(polygons, context);
    expect(result.totalPolygons).toBe(300);
    expect(result.visibleCount).toBeLessThan(300);
    // With a 100px viewport buffer applied by the manager, we expect a
    // small number of polygons to be visible (corner + margin), not all.
    expect(result.visibleCount).toBeGreaterThan(0);
    expect(result.visibleCount).toBeLessThan(100);
    expect(result.culledCount).toBeGreaterThan(200);
  });

  it('keeps the selected polygon visible even if it lies outside the viewport', () => {
    const manager = new PolygonVisibilityManager();

    const polygons: Polygon[] = [];
    for (let i = 0; i < 300; i++) {
      polygons.push(
        makeSquarePolygon(`p${i}`, (i % 20) * 100, Math.floor(i / 20) * 100)
      );
    }

    // Force a selected polygon that's clearly outside the tiny viewport.
    const offScreenId = polygons[299].id; // far corner
    const context: VisibilityContext = {
      zoom: 1,
      offset: { x: 0, y: 0 },
      containerWidth: 50,
      containerHeight: 50,
      selectedPolygonId: offScreenId,
      forceRenderSelected: true,
    };

    const result = manager.getVisiblePolygons(polygons, context);
    expect(result.visiblePolygons.some(p => p.id === offScreenId)).toBe(true);
  });
});
