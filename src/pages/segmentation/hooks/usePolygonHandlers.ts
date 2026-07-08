import { useState, useCallback, useEffect, useRef } from 'react';
import { EditMode } from '../types';
import { Polygon, polygonKey, type PolygonKey } from '@/lib/segmentation';
import { logger } from '@/lib/logger';

/**
 * Minimal structural slice of the editor that polygon-handler callbacks read.
 * Declared locally so this hook never pulls the full editor import graph
 * (socket.io/Radix/Axios), keeping it unit-testable with a plain stub.
 */
interface HandlerEditor {
  polygons: Polygon[];
  selectedPolygonId: string | null;
  handleDeletePolygon: (polygonId: string) => void;
  handlePolygonSelection: (polygonId: string | null) => void;
  setSelectedPolygonId: (polygonId: string | null) => void;
  setEditMode: (mode: EditMode) => void;
  handleDeleteVertex: (polygonId: string, vertexIndex: number) => void;
  getPolygons: () => Polygon[];
  updatePolygons: (polygons: Polygon[]) => void;
}

interface UsePolygonHandlersParams {
  editor: HandlerEditor;
  imageId: string | undefined;
}

/**
 * Owns the polygon CRUD handlers lifted verbatim from SegmentationEditor
 * (stages 3 + 4 merged — they share `persistedSelectionTrackId` state).
 *
 * Owns state:
 *   - hiddenPolygonIds  (stable-key Set<PolygonKey>)
 *   - hoveredPolygonId
 *   - persistedSelectionTrackId
 *
 * Owns the MT cross-frame selection-remap effect (stage 4): when polygons
 * load for a new frame, finds the polygon whose trackId matches the persisted
 * selection and re-selects it in the editor.
 */
export function usePolygonHandlers({
  editor,
  imageId,
}: UsePolygonHandlersParams) {
  // `editor` is a fresh object literal every render of
  // useEnhancedSegmentationEditor. Mirror it into a ref so the handlers below
  // are identity-stable (deps: []) yet always read the latest editor state and
  // methods. Stable handler identities let the CanvasPolygon / PolygonVertices
  // React.memo comparators actually hold — previously these recreated on every
  // render and the comparators kept stale closures (wrong-polygon delete/slice).
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Stores STABLE keys (trackId where present, else polygon.id) so a
  // microtubule hidden on one frame stays hidden when the user scrubs.
  // Branded `Set<PolygonKey>` makes accidental key-by-other-string a
  // compile error.
  const [hiddenPolygonIds, setHiddenPolygonIds] = useState<Set<PolygonKey>>(
    new Set()
  );
  // Cross-frame selection persistence: when the user picks an MT
  // polyline, remember its trackId so frame scrubs can re-select the
  // same MT instance on the new frame. null = no persistent selection.
  const [persistedSelectionTrackId, setPersistedSelectionTrackId] = useState<
    string | null
  >(null);
  const [hoveredPolygonId, setHoveredPolygonId] = useState<string | null>(null);
  // Multi-selection (Shift+click) — a parallel set of current-frame polygon ids
  // used for bulk actions (e.g. propagate several microtubules at once). Kept
  // separate from the single `selectedPolygonId` so it doesn't disturb the
  // vertex-edit / cross-frame single-selection flow.
  const [selectedPolygonIds, setSelectedPolygonIds] = useState<Set<string>>(
    new Set()
  );
  const toggleMultiSelect = useCallback((polygonId: string) => {
    setSelectedPolygonIds(prev => {
      const next = new Set(prev);
      if (next.has(polygonId)) {
        next.delete(polygonId);
      } else {
        next.add(polygonId);
      }
      return next;
    });
  }, []);
  const clearMultiSelect = useCallback(() => {
    setSelectedPolygonIds(prev => (prev.size === 0 ? prev : new Set()));
  }, []);
  // Replace the whole multi-select set (used by the sidebar "select all"
  // control — the panel passes its full list of current-frame polygon ids).
  const selectAllMultiSelect = useCallback((ids: string[]) => {
    setSelectedPolygonIds(new Set(ids));
  }, []);

  // Polygon ids are per-frame, so a multi-selection is meaningless after a frame
  // change — clear it when the edited image changes.
  useEffect(() => {
    setSelectedPolygonIds(prev => (prev.size === 0 ? prev : new Set()));
  }, [imageId]);

  // Legacy compatibility handlers
  const handleTogglePolygonVisibility = useCallback((polygonId: string) => {
    // Map current-frame polygon.id → stable key (trackId or id) so the
    // hide state survives frame changes for MTs.
    const target = editorRef.current.polygons.find(p => p.id === polygonId);
    if (!target) return;
    const key = polygonKey(target);
    setHiddenPolygonIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  }, []);

  const handleDeletePolygonFromPanel = useCallback((polygonId: string) => {
    const target = editorRef.current.polygons.find(p => p.id === polygonId);
    editorRef.current.handleDeletePolygon(polygonId);
    if (target) {
      const key = polygonKey(target);
      setHiddenPolygonIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(key);
        return newSet;
      });
    }
  }, []);

  // Capture trackId at click so frame scrubbing re-attaches selection
  // to the same MT instance on the new frame.
  const handleSelectPolygon = useCallback((polygonId: string | null) => {
    if (polygonId === null) {
      setPersistedSelectionTrackId(null);
    } else {
      const p = editorRef.current.polygons.find(x => x.id === polygonId);
      setPersistedSelectionTrackId(p?.trackId ?? null);
    }
    editorRef.current.handlePolygonSelection(polygonId);
  }, []);

  // Cross-frame selection remap. When polygons load for a new frame
  // (initialPolygons replaces editor.polygons), find the polygon that
  // shares the persisted trackId and re-select it. If no sibling exists
  // on this frame (track wasn't matched here), selection is left null
  // by the editor's own image-change reset and we don't fight it — but
  // we log so a missing match is debuggable when a user reports
  // "selection lost".
  useEffect(() => {
    if (!persistedSelectionTrackId) return;
    const match = editor.polygons.find(
      p => p.trackId === persistedSelectionTrackId
    );
    if (match) {
      if (editor.selectedPolygonId !== match.id) {
        editor.setSelectedPolygonId(match.id);
      }
    } else if (editor.polygons.length > 0) {
      // Polygons loaded but no match — track is not present on this
      // frame. Surface via debug log so support can correlate user
      // reports; UI deliberately stays quiet (toast on every scrub past
      // a gap would be obnoxious).
      logger.debug('Selected MT track not present on current frame', {
        trackId: persistedSelectionTrackId,
        frameImageId: imageId,
      });
    }
    // Intentionally narrow deps: passing the whole `editor` object
    // would re-fire on every render of useEnhancedSegmentationEditor
    // (cursor moves, hovers). The destructured fields capture
    // exactly the state this effect needs to react to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editor.polygons,
    persistedSelectionTrackId,
    editor.selectedPolygonId,
    editor.setSelectedPolygonId,
    imageId,
  ]);

  // Context menu handlers for polygon right-click
  const handleDeletePolygonFromContextMenu = useCallback(
    (polygonId: string) => {
      const target = editorRef.current.polygons.find(p => p.id === polygonId);
      editorRef.current.handleDeletePolygon(polygonId);
      if (target) {
        const key = polygonKey(target);
        setHiddenPolygonIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(key);
          return newSet;
        });
      }
    },
    []
  );

  const handleSlicePolygonFromContextMenu = useCallback((polygonId: string) => {
    // Select the polygon and switch to slice mode (skip to step 2)
    editorRef.current.setSelectedPolygonId(polygonId);
    editorRef.current.setEditMode(EditMode.Slice);
  }, []);

  const handleEditPolygonFromContextMenu = useCallback((polygonId: string) => {
    // Select the polygon and switch to edit vertices mode
    editorRef.current.setSelectedPolygonId(polygonId);
    editorRef.current.setEditMode(EditMode.EditVertices);
  }, []);

  // Context menu handlers for vertex right-click
  const handleDeleteVertexFromContextMenu = useCallback(
    (polygonId: string, vertexIndex: number) => {
      editorRef.current.handleDeleteVertex(polygonId, vertexIndex);
    },
    []
  );

  // Generic handler for updating a single field on a polygon by ID
  const handleUpdatePolygonField = useCallback(
    (polygonId: string, updates: Partial<Polygon>) => {
      const currentPolygons = editorRef.current.getPolygons();
      const updatedPolygons = currentPolygons.map(p =>
        p.id === polygonId ? { ...p, ...updates } : p
      );
      editorRef.current.updatePolygons(updatedPolygons);
    },
    []
  );

  const handleRenamePolygon = useCallback(
    (polygonId: string, name: string) =>
      handleUpdatePolygonField(polygonId, { name }),
    [handleUpdatePolygonField]
  );

  const handleChangeInstanceId = useCallback(
    (polygonId: string, instanceId: string) =>
      handleUpdatePolygonField(polygonId, { instanceId }),
    [handleUpdatePolygonField]
  );

  const handleChangePartClass = useCallback(
    (polygonId: string, partClass: 'head' | 'midpiece' | 'tail') =>
      handleUpdatePolygonField(polygonId, { partClass }),
    [handleUpdatePolygonField]
  );

  return {
    hiddenPolygonIds,
    setHiddenPolygonIds,
    hoveredPolygonId,
    setHoveredPolygonId,
    persistedSelectionTrackId,
    selectedPolygonIds,
    toggleMultiSelect,
    clearMultiSelect,
    selectAllMultiSelect,
    handleTogglePolygonVisibility,
    handleDeletePolygonFromPanel,
    handleSelectPolygon,
    handleDeletePolygonFromContextMenu,
    handleSlicePolygonFromContextMenu,
    handleEditPolygonFromContextMenu,
    handleDeleteVertexFromContextMenu,
    handleUpdatePolygonField,
    handleRenamePolygon,
    handleChangeInstanceId,
    handleChangePartClass,
  };
}
