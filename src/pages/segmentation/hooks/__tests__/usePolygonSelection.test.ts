/**
 * Unit tests for usePolygonSelection.
 *
 * Coverage targets:
 *  - handlePolygonSelection: all EditMode branches
 *  - handlePolygonClick: delegates to handlePolygonSelection
 *  - Deselection (null) switches EditVertices → View
 *  - Selecting non-existent polygon is a no-op
 *  - EditVertices coupling-validation effect:
 *      EditVertices + no selection → forced back to View
 *  - editModeRef always reflects latest mode (avoids stale closure)
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePolygonSelection } from '../usePolygonSelection';
import { EditMode } from '../../types';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makePolygons(ids: string[]) {
  return ids.map(id => ({ id }));
}

interface HookProps {
  editMode: EditMode;
  currentSelectedPolygonId: string | null;
  onModeChange: (mode: EditMode) => void;
  onSelectionChange: (id: string | null) => void;
  onDeletePolygon: (id: string) => void;
  polygons: Array<{ id: string }>;
}

function defaultProps(overrides: Partial<HookProps> = {}): HookProps {
  return {
    editMode: EditMode.View,
    currentSelectedPolygonId: null,
    onModeChange: vi.fn(),
    onSelectionChange: vi.fn(),
    onDeletePolygon: vi.fn(),
    polygons: makePolygons(['p1', 'p2', 'p3']),
    ...overrides,
  };
}

// ------------------------------------------------------------------
// Tests: handlePolygonSelection — mode-specific behaviour
// ------------------------------------------------------------------

describe('usePolygonSelection — View mode', () => {
  it('selects polygon AND switches to EditVertices', () => {
    const props = defaultProps({ editMode: EditMode.View });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection('p1');
    });

    expect(props.onSelectionChange).toHaveBeenCalledWith('p1');
    expect(props.onModeChange).toHaveBeenCalledWith(EditMode.EditVertices);
  });

  it('does nothing when polygon does not exist in the list', () => {
    const props = defaultProps({ editMode: EditMode.View });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection('ghost');
    });

    expect(props.onSelectionChange).not.toHaveBeenCalled();
    expect(props.onModeChange).not.toHaveBeenCalled();
  });
});

describe('usePolygonSelection — EditVertices mode', () => {
  it('selects polygon without changing mode', () => {
    const props = defaultProps({
      editMode: EditMode.EditVertices,
      currentSelectedPolygonId: 'p1',
    });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection('p2');
    });

    expect(props.onSelectionChange).toHaveBeenCalledWith('p2');
    // Should NOT switch mode
    expect(props.onModeChange).not.toHaveBeenCalledWith(EditMode.View);
  });
});

describe('usePolygonSelection — DeletePolygon mode', () => {
  it('calls onDeletePolygon and stays in delete mode (no selection change)', () => {
    const props = defaultProps({ editMode: EditMode.DeletePolygon });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection('p2');
    });

    expect(props.onDeletePolygon).toHaveBeenCalledWith('p2');
    expect(props.onSelectionChange).not.toHaveBeenCalled();
    expect(props.onModeChange).not.toHaveBeenCalled();
  });
});

describe('usePolygonSelection — Slice mode', () => {
  it('selects polygon without changing mode', () => {
    const props = defaultProps({ editMode: EditMode.Slice });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection('p1');
    });

    expect(props.onSelectionChange).toHaveBeenCalledWith('p1');
    expect(props.onModeChange).not.toHaveBeenCalled();
  });
});

describe('usePolygonSelection — AddPoints mode', () => {
  it('selects polygon, stays in AddPoints mode', () => {
    const props = defaultProps({ editMode: EditMode.AddPoints });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection('p3');
    });

    expect(props.onSelectionChange).toHaveBeenCalledWith('p3');
    expect(props.onModeChange).not.toHaveBeenCalled();
  });
});

describe('usePolygonSelection — CreatePolygon mode', () => {
  it('selects polygon, stays in CreatePolygon mode', () => {
    const props = defaultProps({ editMode: EditMode.CreatePolygon });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection('p1');
    });

    expect(props.onSelectionChange).toHaveBeenCalledWith('p1');
    expect(props.onModeChange).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// Tests: deselection (polygonId === null)
// ------------------------------------------------------------------

describe('usePolygonSelection — deselection (null)', () => {
  it('in View mode: calls onSelectionChange(null) without mode change', () => {
    const props = defaultProps({
      editMode: EditMode.View,
      currentSelectedPolygonId: 'p1',
    });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection(null);
    });

    expect(props.onSelectionChange).toHaveBeenCalledWith(null);
    expect(props.onModeChange).not.toHaveBeenCalled();
  });

  it('in EditVertices mode: calls onSelectionChange(null) AND switches to View', () => {
    const props = defaultProps({
      editMode: EditMode.EditVertices,
      currentSelectedPolygonId: 'p1',
    });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection(null);
    });

    expect(props.onSelectionChange).toHaveBeenCalledWith(null);
    expect(props.onModeChange).toHaveBeenCalledWith(EditMode.View);
  });
});

// ------------------------------------------------------------------
// Tests: coupling validation effect
// ------------------------------------------------------------------

describe('usePolygonSelection — EditVertices coupling-validation effect', () => {
  it('forces mode to View when EditVertices has no selected polygon', () => {
    const onModeChange = vi.fn();
    // Render with EditVertices but no selection — a coupling violation
    const props = defaultProps({
      editMode: EditMode.EditVertices,
      currentSelectedPolygonId: null,
      onModeChange,
    });
    renderHook(() => usePolygonSelection(props));

    // The effect runs synchronously on mount and detects the violation
    expect(onModeChange).toHaveBeenCalledWith(EditMode.View);
  });

  it('does NOT fire when EditVertices has a valid selection', () => {
    const onModeChange = vi.fn();
    const props = defaultProps({
      editMode: EditMode.EditVertices,
      currentSelectedPolygonId: 'p1',
      onModeChange,
    });
    renderHook(() => usePolygonSelection(props));

    expect(onModeChange).not.toHaveBeenCalled();
  });

  it('triggers when selection is cleared while in EditVertices', () => {
    const onModeChange = vi.fn();
    const { rerender } = renderHook((p: HookProps) => usePolygonSelection(p), {
      initialProps: defaultProps({
        editMode: EditMode.EditVertices,
        currentSelectedPolygonId: 'p1',
        onModeChange,
      }),
    });

    // No violation yet
    expect(onModeChange).not.toHaveBeenCalled();

    // Selection cleared externally
    rerender(
      defaultProps({
        editMode: EditMode.EditVertices,
        currentSelectedPolygonId: null,
        onModeChange,
      })
    );

    expect(onModeChange).toHaveBeenCalledWith(EditMode.View);
  });
});

// ------------------------------------------------------------------
// Tests: handlePolygonClick
// ------------------------------------------------------------------

describe('usePolygonSelection — handlePolygonClick', () => {
  it('delegates to handlePolygonSelection in View mode', () => {
    const props = defaultProps({ editMode: EditMode.View });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonClick('p1');
    });

    expect(props.onSelectionChange).toHaveBeenCalledWith('p1');
    expect(props.onModeChange).toHaveBeenCalledWith(EditMode.EditVertices);
  });

  it('delegates delete in DeletePolygon mode', () => {
    const props = defaultProps({ editMode: EditMode.DeletePolygon });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonClick('p2');
    });

    expect(props.onDeletePolygon).toHaveBeenCalledWith('p2');
  });
});

// ------------------------------------------------------------------
// Tests: editModeRef tracks latest mode (stale-closure guard)
// ------------------------------------------------------------------

describe('usePolygonSelection — editModeRef keeps latest mode', () => {
  it('reads updated mode from ref after rerender', () => {
    const onModeChange = vi.fn();
    const onSelectionChange = vi.fn();
    const onDeletePolygon = vi.fn();
    const polygons = makePolygons(['p1']);

    const { result, rerender } = renderHook(
      (props: HookProps) => usePolygonSelection(props),
      {
        initialProps: defaultProps({
          editMode: EditMode.View,
          onModeChange,
          onSelectionChange,
          onDeletePolygon,
          polygons,
        }),
      }
    );

    // Switch to DeletePolygon mode via rerender (ref should update)
    rerender(
      defaultProps({
        editMode: EditMode.DeletePolygon,
        onModeChange,
        onSelectionChange,
        onDeletePolygon,
        polygons,
      })
    );

    // The stale closure still holds View; ref holds DeletePolygon.
    // handlePolygonSelection should behave as DeletePolygon.
    act(() => {
      result.current.handlePolygonSelection('p1');
    });

    expect(onDeletePolygon).toHaveBeenCalledWith('p1');
    // onSelectionChange should NOT have been called (delete path returns early)
    expect(onSelectionChange).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------
// Tests: polygon not in list
// ------------------------------------------------------------------

describe('usePolygonSelection — unknown polygon guard', () => {
  it('does not call any callback when polygon id is not in list', () => {
    const props = defaultProps({ editMode: EditMode.View });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonSelection('nonexistent');
    });

    expect(props.onSelectionChange).not.toHaveBeenCalled();
    expect(props.onModeChange).not.toHaveBeenCalled();
    expect(props.onDeletePolygon).not.toHaveBeenCalled();
  });

  it('handlePolygonClick is also a no-op for unknown polygon', () => {
    const props = defaultProps({ editMode: EditMode.DeletePolygon });
    const { result } = renderHook(() => usePolygonSelection(props));

    act(() => {
      result.current.handlePolygonClick('ghost');
    });

    expect(props.onDeletePolygon).not.toHaveBeenCalled();
  });
});
