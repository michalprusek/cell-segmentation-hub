import { useMemo } from 'react';
import { EditMode } from '../types';
import { Polygon, polygonKey, type PolygonKey } from '@/lib/segmentation';
import { polylinePanelKind } from '@/lib/polylineSemantics';

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
  /** Raw `project.type`. Drives which polyline panel (sperm vs microtubule)
   *  the sidebar shows — the single authoritative signal, replacing the old
   *  per-polygon `class`/`partClass`/`mt_`-prefix guess. */
  projectType: string | undefined | null;
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
  projectType,
}: UsePolygonRenderPropsParams) {
  const hasPolylines = useMemo(
    () => editor.polygons.some(p => p.geometry === 'polyline'),
    [editor.polygons]
  );

  // Which polyline panel the sidebar shows is a property of the PROJECT type,
  // not of any individual polyline. Every polyline in a sperm project is a
  // sperm annotation; every one in a microtubule project is a microtubule.
  // Deriving the kind from `project.type` (the same signal the layout already
  // uses via `isMicrotubuleProject`) removes the old per-polygon guess, which
  // sniffed `class`/`partClass`/`mt_` and let one mis-stamped hand-drawn
  // polyline flip the whole project to the sperm panel.
  const polylineKind = useMemo(
    () => polylinePanelKind(projectType),
    [projectType]
  );

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
