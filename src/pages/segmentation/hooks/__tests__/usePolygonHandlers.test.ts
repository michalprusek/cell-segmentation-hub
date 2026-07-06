import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePolygonHandlers } from '../usePolygonHandlers';
import { EditMode } from '../../types';
import { polygonKey, type Polygon, type PolygonKey } from '@/lib/segmentation';

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const makePoly = (over: Partial<Polygon> = {}): Polygon =>
  ({
    id: 'p1',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    type: 'external',
    class: 'spheroid',
    geometry: 'polygon',
    ...over,
  }) as Polygon;

const makeEditor = (polygons: Polygon[] = []) => ({
  polygons,
  selectedPolygonId: null as string | null,
  handleDeletePolygon: vi.fn(),
  handlePolygonSelection: vi.fn(),
  setSelectedPolygonId: vi.fn(),
  setEditMode: vi.fn(),
  handleDeleteVertex: vi.fn(),
  getPolygons: vi.fn(() => polygons),
  updatePolygons: vi.fn(),
});

describe('usePolygonHandlers', () => {
  let editor: ReturnType<typeof makeEditor>;

  beforeEach(() => {
    editor = makeEditor();
    vi.clearAllMocks();
  });

  // ─── initial state ────────────────────────────────────────────────────────

  it('initialises with empty hidden set, null hovered/persisted', () => {
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );
    expect(result.current.hiddenPolygonIds.size).toBe(0);
    expect(result.current.hoveredPolygonId).toBeNull();
    expect(result.current.persistedSelectionTrackId).toBeNull();
  });

  // ─── handleTogglePolygonVisibility ────────────────────────────────────────

  it('toggles a polygon into hidden set (by stable key)', () => {
    const poly = makePoly({ id: 'p1' });
    editor = makeEditor([poly]);
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleTogglePolygonVisibility('p1');
    });

    expect(result.current.hiddenPolygonIds.has(polygonKey(poly))).toBe(true);
  });

  it('toggles a polygon back out of hidden set', () => {
    const poly = makePoly({ id: 'p1' });
    editor = makeEditor([poly]);
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleTogglePolygonVisibility('p1');
    });
    act(() => {
      result.current.handleTogglePolygonVisibility('p1');
    });

    expect(result.current.hiddenPolygonIds.has(polygonKey(poly))).toBe(false);
  });

  it('ignores toggle for an id not in the polygon list', () => {
    editor = makeEditor([]);
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleTogglePolygonVisibility('nonexistent');
    });

    expect(result.current.hiddenPolygonIds.size).toBe(0);
  });

  // ─── handleDeletePolygonFromPanel ─────────────────────────────────────────

  it('calls editor.handleDeletePolygon and removes key from hidden set', () => {
    const poly = makePoly({ id: 'p1' });
    editor = makeEditor([poly]);
    const key = polygonKey(poly) as PolygonKey;
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    // Pre-hide the polygon
    act(() => {
      result.current.setHiddenPolygonIds(new Set([key]));
    });

    act(() => {
      result.current.handleDeletePolygonFromPanel('p1');
    });

    expect(editor.handleDeletePolygon).toHaveBeenCalledWith('p1');
    expect(result.current.hiddenPolygonIds.has(key)).toBe(false);
  });

  // ─── handleSelectPolygon ─────────────────────────────────────────────────

  it('clears persistedSelectionTrackId when selecting null', () => {
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleSelectPolygon(null);
    });

    expect(result.current.persistedSelectionTrackId).toBeNull();
    expect(editor.handlePolygonSelection).toHaveBeenCalledWith(null);
  });

  it('persists trackId when selecting a polygon that has one', () => {
    const poly = makePoly({ id: 'p1', trackId: 'mt-42' } as Partial<Polygon>);
    editor = makeEditor([poly]);
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleSelectPolygon('p1');
    });

    expect(result.current.persistedSelectionTrackId).toBe('mt-42');
    expect(editor.handlePolygonSelection).toHaveBeenCalledWith('p1');
  });

  it('sets persistedSelectionTrackId to null when polygon has no trackId', () => {
    const poly = makePoly({ id: 'p1' });
    editor = makeEditor([poly]);
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleSelectPolygon('p1');
    });

    expect(result.current.persistedSelectionTrackId).toBeNull();
  });

  // ─── MT cross-frame selection remap effect ────────────────────────────────

  it('re-selects the matching polygon when a new frame loads with the same trackId', () => {
    const polyOnFrame1 = makePoly({
      id: 'pA',
      trackId: 'mt-7',
    } as Partial<Polygon>);
    editor = makeEditor([polyOnFrame1]);
    editor.selectedPolygonId = null;

    const { result, rerender } = renderHook(
      ({ ed, imgId }: { ed: typeof editor; imgId: string }) =>
        usePolygonHandlers({ editor: ed, imageId: imgId }),
      { initialProps: { ed: editor, imgId: 'frame-1' } }
    );

    // Select polygon on frame 1, capturing trackId
    act(() => {
      result.current.handleSelectPolygon('pA');
    });

    // Simulate frame change: editor now has a different polygon id for the same MT
    const polyOnFrame2 = makePoly({
      id: 'pB',
      trackId: 'mt-7',
    } as Partial<Polygon>);
    const editor2 = makeEditor([polyOnFrame2]);
    editor2.selectedPolygonId = null;

    rerender({ ed: editor2, imgId: 'frame-2' });

    expect(editor2.setSelectedPolygonId).toHaveBeenCalledWith('pB');
  });

  it('does NOT call setSelectedPolygonId if the same polygon is already selected', () => {
    const poly = makePoly({ id: 'pA', trackId: 'mt-7' } as Partial<Polygon>);
    editor = makeEditor([poly]);
    editor.selectedPolygonId = 'pA'; // already selected

    renderHook(
      ({ ed }: { ed: typeof editor }) =>
        usePolygonHandlers({ editor: ed, imageId: 'frame-1' }),
      { initialProps: { ed: editor } }
    );

    // The effect runs on mount; since selectedPolygonId === match.id,
    // setSelectedPolygonId must NOT be called (would cause an infinite loop).
    expect(editor.setSelectedPolygonId).not.toHaveBeenCalled();
  });

  // ─── handleDeletePolygonFromContextMenu ───────────────────────────────────

  it('deletes polygon and removes its key from the hidden set', () => {
    const poly = makePoly({ id: 'p1' });
    editor = makeEditor([poly]);
    const key = polygonKey(poly) as PolygonKey;
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.setHiddenPolygonIds(new Set([key]));
    });

    act(() => {
      result.current.handleDeletePolygonFromContextMenu('p1');
    });

    expect(editor.handleDeletePolygon).toHaveBeenCalledWith('p1');
    expect(result.current.hiddenPolygonIds.has(key)).toBe(false);
  });

  // ─── handleSlicePolygonFromContextMenu ────────────────────────────────────

  it('selects the polygon and sets Slice edit mode', () => {
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleSlicePolygonFromContextMenu('p1');
    });

    expect(editor.setSelectedPolygonId).toHaveBeenCalledWith('p1');
    expect(editor.setEditMode).toHaveBeenCalledWith(EditMode.Slice);
  });

  // ─── handleEditPolygonFromContextMenu ────────────────────────────────────

  it('selects the polygon and sets EditVertices mode', () => {
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleEditPolygonFromContextMenu('p1');
    });

    expect(editor.setSelectedPolygonId).toHaveBeenCalledWith('p1');
    expect(editor.setEditMode).toHaveBeenCalledWith(EditMode.EditVertices);
  });

  // ─── handleDeleteVertexFromContextMenu ────────────────────────────────────

  it('delegates vertex deletion to editor.handleDeleteVertex', () => {
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleDeleteVertexFromContextMenu('p1', 3);
    });

    expect(editor.handleDeleteVertex).toHaveBeenCalledWith('p1', 3);
  });

  // ─── handleUpdatePolygonField / handleRenamePolygon / etc. ───────────────

  it('handleRenamePolygon updates the polygon name via updatePolygons', () => {
    const poly = makePoly({ id: 'p1', name: 'old' });
    editor = makeEditor([poly]);
    editor.getPolygons.mockReturnValue([poly]);
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleRenamePolygon('p1', 'new-name');
    });

    expect(editor.updatePolygons).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'p1', name: 'new-name' }),
    ]);
  });

  it('handleChangeInstanceId updates the instanceId', () => {
    const poly = makePoly({ id: 'p1', instanceId: 'sperm_1' });
    editor = makeEditor([poly]);
    editor.getPolygons.mockReturnValue([poly]);
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleChangeInstanceId('p1', 'sperm_3');
    });

    expect(editor.updatePolygons).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'p1', instanceId: 'sperm_3' }),
    ]);
  });

  it('handleChangePartClass updates the partClass', () => {
    const poly = makePoly({ id: 'p1', partClass: 'head' } as Partial<Polygon>);
    editor = makeEditor([poly]);
    editor.getPolygons.mockReturnValue([poly]);
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );

    act(() => {
      result.current.handleChangePartClass('p1', 'tail');
    });

    expect(editor.updatePolygons).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'p1', partClass: 'tail' }),
    ]);
  });

  // ─── Shift+click multi-selection ───────────────────────────────────────────

  it('toggles polygons in and out of the multi-selection', () => {
    const { result } = renderHook(() =>
      usePolygonHandlers({ editor, imageId: 'img-1' })
    );
    expect(result.current.selectedPolygonIds.size).toBe(0);

    act(() => result.current.toggleMultiSelect('a'));
    act(() => result.current.toggleMultiSelect('b'));
    expect([...result.current.selectedPolygonIds].sort()).toEqual(['a', 'b']);

    act(() => result.current.toggleMultiSelect('a')); // toggle off
    expect([...result.current.selectedPolygonIds]).toEqual(['b']);

    act(() => result.current.clearMultiSelect());
    expect(result.current.selectedPolygonIds.size).toBe(0);
  });

  it('clears the multi-selection when the edited image changes', () => {
    const { result, rerender } = renderHook(
      ({ imageId }) => usePolygonHandlers({ editor, imageId }),
      { initialProps: { imageId: 'img-1' } }
    );
    act(() => result.current.toggleMultiSelect('a'));
    expect(result.current.selectedPolygonIds.size).toBe(1);

    rerender({ imageId: 'img-2' }); // scrub to another frame
    expect(result.current.selectedPolygonIds.size).toBe(0);
  });
});
