import { useMemo } from 'react';
import { EditMode } from '../types';
import { Polygon, polygonKey, type PolygonKey } from '@/lib/segmentation';
import { isMicrotubuleInstance } from '../utils/instanceColors';
import { polygonVisibilityManager } from '@/lib/rendering/PolygonVisibilityManager';

interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Minimal structural slice of the editor that the render pipeline reads.
 * Declared locally (rather than importing `useEnhancedSegmentationEditor`'s
 * return type) so this hook stays dependency-light and unit-testable without
 * the editor's heavy import graph.
 */
interface RenderEditor {
  polygons: Polygon[];
  editMode: EditMode;
  selectedPolygonId: string | null;
  transform: { zoom: number; translateX: number; translateY: number };
}

interface UsePolygonRenderPropsParams {
  editor: RenderEditor;
  hiddenPolygonIds: Set<PolygonKey>;
  imageDimensions: ImageDimensions | null;
  canvasWidth: number;
  canvasHeight: number;
  activeInstanceId: string;
}

/**
 * The pure render-derivation pipeline lifted verbatim from `SegmentationEditor`:
 * polyline/instance discrimination, the legacy edit-mode booleans, and the
 * two-stage polygon render filter (hidden/degenerate → frustum cull). No side
 * effects, no React state — just memoised derivations over the editor + view
 * inputs, so it is independently unit-testable.
 */
export function usePolygonRenderProps({
  editor,
  hiddenPolygonIds,
  imageDimensions,
  canvasWidth,
  canvasHeight,
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

  // Stage 1: filter hidden / degenerate polygons.
  const renderablePolygons = useMemo(
    () =>
      editor.polygons.filter(polygon => {
        if (hiddenPolygonIds.has(polygonKey(polygon)) || !polygon.points)
          return false;
        const minPoints = polygon.geometry === 'polyline' ? 2 : 3;
        return polygon.points.length >= minPoints;
      }),
    [editor.polygons, hiddenPolygonIds]
  );

  // Stage 2: frustum-cull off-viewport polygons via the visibility manager.
  // The manager's internal threshold guards small counts (< 10 polygons
  // → no culling), so MT/single-polyline cases pay zero overhead. Sperm
  // projects with 50+ polylines at high zoom typically halve the SVG
  // node count under this filter. We pass through `selectedPolygonId`
  // so the manager never culls the focused polygon even if it scrolls
  // off-screen briefly during a drag.
  const visiblePolygons = useMemo(() => {
    if (renderablePolygons.length < 10) return renderablePolygons;
    const containerWidth = imageDimensions?.width || canvasWidth;
    const containerHeight = imageDimensions?.height || canvasHeight;
    return polygonVisibilityManager.getVisiblePolygons(renderablePolygons, {
      zoom: editor.transform.zoom,
      offset: {
        x: editor.transform.translateX,
        y: editor.transform.translateY,
      },
      containerWidth,
      containerHeight,
      selectedPolygonId: editor.selectedPolygonId,
      forceRenderSelected: true,
    }).visiblePolygons;
  }, [
    renderablePolygons,
    editor.transform.zoom,
    editor.transform.translateX,
    editor.transform.translateY,
    editor.selectedPolygonId,
    imageDimensions,
    canvasWidth,
    canvasHeight,
  ]);

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
    renderablePolygons,
    visiblePolygons,
    frameHiddenIds,
  };
}
