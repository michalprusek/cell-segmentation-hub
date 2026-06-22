import { useMemo } from 'react';
import { EditMode } from '../types';
import { Polygon, polygonKey, type PolygonKey } from '@/lib/segmentation';
import { isMicrotubuleInstance } from '../utils/instanceColors';

/**
 * Minimal structural slice of the editor that the render pipeline reads.
 * Declared locally (rather than importing `useEnhancedSegmentationEditor`'s
 * return type) so this hook stays dependency-light and unit-testable without
 * the editor's heavy import graph.
 */
interface RenderEditor {
  polygons: Polygon[];
  editMode: EditMode;
}

interface UsePolygonRenderPropsParams {
  editor: RenderEditor;
  hiddenPolygonIds: Set<PolygonKey>;
  activeInstanceId: string;
}

/**
 * The pure render-derivation pipeline lifted from `SegmentationEditor`:
 * polyline/instance discrimination, the legacy edit-mode booleans, and the
 * render filter that drops hidden / degenerate polygons. No side effects, no
 * React state — just memoised derivations over the editor input, so it is
 * independently unit-testable.
 *
 * There is intentionally NO viewport culling: every renderable polygon is
 * drawn. A fragmented ("decay") spheroid segments into many small polygons,
 * and the previous frustum-cull pass dropped on-screen pieces because its
 * viewport math conflated image dimensions with the canvas size. Rendering
 * the full set is both correct and cheap — pan/zoom runs through a GPU CSS
 * transform on the parent layer, so the memoised polygons never re-render.
 */
export function usePolygonRenderProps({
  editor,
  hiddenPolygonIds,
  activeInstanceId,
}: UsePolygonRenderPropsParams) {
  const hasPolylines = useMemo(
    () => editor.polygons.some(p => p.geometry === 'polyline'),
    [editor.polygons]
  );

  // Discriminate sperm vs microtubule projects so the sidebar shows the
  // right panel. Authoritative signal: `polygon.class` ('sperm' or
  // 'microtubule') is stamped by the ML model when it produces the
  // polygon. Each project uses one model, so the first polyline whose
  // class we recognise is sufficient — no majority-counting needed.
  // Legacy/manually-drawn polylines without `class` fall back to
  // `partClass` (sperm head/midpiece/tail) or `mt_` instanceId prefix.
  const polylineKind = useMemo<'sperm' | 'microtubule' | null>(() => {
    for (const p of editor.polygons) {
      if (p.geometry !== 'polyline') continue;
      if (p.class === 'microtubule') return 'microtubule';
      if (p.class === 'sperm') return 'sperm';
      if (p.partClass) return 'sperm';
      if (isMicrotubuleInstance(p.instanceId)) return 'microtubule';
    }
    return null;
  }, [editor.polygons]);

  // Compute available sperm instance IDs for context menu (from existing polylines + active).
  // Two-stage memo: first derive a stable string key, then split into array only when key changes.
  // This prevents new array references on unrelated polygon edits (e.g. vertex drags).
  const availableInstanceKey = useMemo(() => {
    const ids = new Set<string>();
    for (const p of editor.polygons) {
      if (p.geometry === 'polyline' && p.instanceId) ids.add(p.instanceId);
    }
    ids.add(activeInstanceId);
    return Array.from(ids).sort().join(',');
  }, [editor.polygons, activeInstanceId]);

  const availableInstanceIds = useMemo(
    () => availableInstanceKey.split(',').filter(Boolean),
    [availableInstanceKey]
  );

  // Convert new EditMode to legacy booleans for compatibility
  const legacyModes = useMemo(
    () => ({
      editMode: editor.editMode === EditMode.EditVertices,
      slicingMode: editor.editMode === EditMode.Slice,
      pointAddingMode: editor.editMode === EditMode.AddPoints,
      deleteMode: editor.editMode === EditMode.DeletePolygon,
    }),
    [editor.editMode]
  );

  // Render filter: drop hidden polygons (keyed by the stable `polygonKey` so
  // the hide survives frame scrubs) and degenerate shapes (closed polygons
  // need ≥3 points, polylines ≥2). Everything that survives is rendered.
  const visiblePolygons = useMemo(
    () =>
      editor.polygons.filter(polygon => {
        if (hiddenPolygonIds.has(polygonKey(polygon)) || !polygon.points)
          return false;
        const minPoints = polygon.geometry === 'polyline' ? 2 : 3;
        return polygon.points.length >= minPoints;
      }),
    [editor.polygons, hiddenPolygonIds]
  );

  // Panels still consume polygon.id, so project the stable-key set
  // down per frame.
  const frameHiddenIds = useMemo(
    () =>
      new Set(
        editor.polygons
          .filter(p => hiddenPolygonIds.has(polygonKey(p)))
          .map(p => p.id)
      ),
    [editor.polygons, hiddenPolygonIds]
  );

  return {
    hasPolylines,
    polylineKind,
    availableInstanceIds,
    legacyModes,
    visiblePolygons,
    frameHiddenIds,
  };
}
