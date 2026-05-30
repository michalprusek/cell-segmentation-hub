import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePolygonRenderProps } from '../usePolygonRenderProps';
import { EditMode } from '../../types';
import { Polygon, polygonKey, type PolygonKey } from '@/lib/segmentation';

const transform = { zoom: 1, translateX: 0, translateY: 0 };

const poly = (over: Partial<Polygon> = {}): Polygon =>
  ({
    id: 'p1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    type: 'external',
    ...over,
  }) as Polygon;

const run = (params: {
  polygons: Polygon[];
  hidden?: Set<PolygonKey>;
  editMode?: EditMode;
  selectedPolygonId?: string | null;
  activeInstanceId?: string;
}) =>
  renderHook(() =>
    usePolygonRenderProps({
      editor: {
        polygons: params.polygons,
        editMode: params.editMode ?? EditMode.View,
        selectedPolygonId: params.selectedPolygonId ?? null,
        transform,
      },
      hiddenPolygonIds: params.hidden ?? new Set<PolygonKey>(),
      imageDimensions: { width: 100, height: 100 },
      canvasWidth: 100,
      canvasHeight: 100,
      activeInstanceId: params.activeInstanceId ?? 'sperm_1',
    })
  ).result.current;

describe('usePolygonRenderProps', () => {
  describe('hasPolylines / polylineKind', () => {
    it('hasPolylines is false with only closed polygons', () => {
      expect(run({ polygons: [poly()] }).hasPolylines).toBe(false);
    });

    it('detects a polyline and classifies sperm via class', () => {
      const r = run({
        polygons: [poly({ geometry: 'polyline', class: 'sperm' })],
      });
      expect(r.hasPolylines).toBe(true);
      expect(r.polylineKind).toBe('sperm');
    });

    it('classifies microtubule via class', () => {
      expect(
        run({
          polygons: [poly({ geometry: 'polyline', class: 'microtubule' })],
        }).polylineKind
      ).toBe('microtubule');
    });

    it('falls back to partClass → sperm', () => {
      expect(
        run({
          polygons: [poly({ geometry: 'polyline', partClass: 'head' })],
        }).polylineKind
      ).toBe('sperm');
    });

    it('returns null when there are no polylines', () => {
      expect(run({ polygons: [poly()] }).polylineKind).toBeNull();
    });
  });

  describe('availableInstanceIds', () => {
    it('merges polyline instanceIds with the active id, sorted+unique', () => {
      const r = run({
        polygons: [
          poly({ geometry: 'polyline', instanceId: 'sperm_2' }),
          poly({ geometry: 'polyline', instanceId: 'sperm_2' }),
        ],
        activeInstanceId: 'sperm_1',
      });
      expect(r.availableInstanceIds).toEqual(['sperm_1', 'sperm_2']);
    });

    it('keeps a stable array reference when polygons change but the id set does not', () => {
      const polygons = [poly({ geometry: 'polyline', instanceId: 'sperm_1' })];
      const { result, rerender } = renderHook(
        ({ p }) =>
          usePolygonRenderProps({
            editor: {
              polygons: p,
              editMode: EditMode.View,
              selectedPolygonId: null,
              transform,
            },
            hiddenPolygonIds: new Set<PolygonKey>(),
            imageDimensions: null,
            canvasWidth: 100,
            canvasHeight: 100,
            activeInstanceId: 'sperm_1',
          }),
        { initialProps: { p: polygons } }
      );
      const first = result.current.availableInstanceIds;
      // New array, same instanceId set → reference must be preserved (two-stage memo).
      rerender({ p: [poly({ geometry: 'polyline', instanceId: 'sperm_1' })] });
      expect(result.current.availableInstanceIds).toBe(first);
    });
  });

  describe('legacyModes', () => {
    it('maps the EditMode enum to the four legacy booleans', () => {
      expect(
        run({ polygons: [], editMode: EditMode.Slice }).legacyModes
      ).toEqual({
        editMode: false,
        slicingMode: true,
        pointAddingMode: false,
        deleteMode: false,
      });
    });
  });

  describe('renderablePolygons', () => {
    it('drops hidden polygons (keyed by stable polygonKey) and degenerate shapes', () => {
      const visible = poly({ id: 'visible' });
      const hidden = poly({ id: 'hidden' });
      const degenerate = poly({ id: 'deg', points: [{ x: 0, y: 0 }] });
      const r = run({
        polygons: [visible, hidden, degenerate],
        hidden: new Set<PolygonKey>([polygonKey(hidden)]),
      });
      expect(r.renderablePolygons.map(p => p.id)).toEqual(['visible']);
    });

    it('passes polygons straight through when under the cull threshold (<10)', () => {
      const polygons = [poly({ id: 'a' }), poly({ id: 'b' })];
      const r = run({ polygons });
      // visiblePolygons === renderablePolygons (same ref) when count < 10
      expect(r.visiblePolygons).toBe(r.renderablePolygons);
    });
  });

  describe('frameHiddenIds', () => {
    it('projects the stable-key hidden set down to per-frame polygon ids', () => {
      const a = poly({ id: 'frame-id-1', trackId: 'mt-1' } as Partial<Polygon>);
      const r = run({
        polygons: [a],
        hidden: new Set<PolygonKey>([polygonKey(a)]), // keyed by trackId
      });
      // panel-facing set uses polygon.id, not the trackId key
      expect(r.frameHiddenIds.has('frame-id-1')).toBe(true);
    });
  });
});
