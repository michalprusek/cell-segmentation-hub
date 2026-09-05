/**
 * The keyboard half of the annotation-geometry gate.
 *
 * The toolbar hides the create button a project does not annotate; these tests
 * cover the two ways a keyboard user could otherwise walk around that button —
 * the `N` / `P` shortcuts, and Tab / Shift+Tab cycling through `cycleEditMode`.
 * Tab is the one that shipped broken: the toolbar gate landed without it, so a
 * spheroid user could Tab straight into CreatePolyline.
 *
 * Everything here asserts on `setEditMode`, which is the whole effect of the
 * gate — the hook owns no state of its own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { EditMode } from '../../types';

const makeProps = (overrides: Record<string, unknown> = {}) => ({
  editMode: EditMode.View,
  canUndo: true,
  canRedo: true,
  // No selection: keeps EditVertices/AddPoints out of the cycle so the Tab
  // assertions below name a short, fully-enumerated list.
  selectedPolygonId: null,
  setEditMode: vi.fn(),
  handleUndo: vi.fn(),
  handleRedo: vi.fn(),
  handleSave: vi.fn().mockResolvedValue(undefined),
  handleZoomIn: vi.fn(),
  handleZoomOut: vi.fn(),
  handleResetView: vi.fn(),
  handleDeletePolygon: vi.fn(),
  ...overrides,
});

const pressKey = (key: string, extra: Partial<KeyboardEventInit> = {}) => {
  fireEvent.keyDown(document, {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
};

/** Every mode Tab visits, starting from View, until it returns to View. */
const walkCycle = (
  props: ReturnType<typeof makeProps>,
  reverse = false
): EditMode[] => {
  const visited: EditMode[] = [];
  let mode = EditMode.View;
  const setEditMode = vi.fn((next: EditMode) => {
    mode = next;
  });
  // Re-render with the new editMode each step: the hook reads the CURRENT mode
  // to decide the next one, so a single render would spin on one transition.
  const { rerender } = renderHook(
    p => useKeyboardShortcuts(p as Parameters<typeof useKeyboardShortcuts>[0]),
    { initialProps: { ...props, editMode: mode, setEditMode } }
  );
  for (let step = 0; step < 12; step++) {
    pressKey('Tab', { shiftKey: reverse });
    if (mode === EditMode.View) break;
    visited.push(mode);
    rerender({ ...props, editMode: mode, setEditMode });
  }
  return visited;
};

describe('N / P are gated by the project geometry', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['spheroid', 'wound', 'microcapsule', 'neurite'] as const)(
    '%s: N creates a polygon, P does nothing',
    projectType => {
      const props = makeProps({ projectType });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('n');
      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolygon);

      props.setEditMode.mockClear();
      pressKey('p');
      expect(props.setEditMode).not.toHaveBeenCalled();
    }
  );

  it.each(['sperm', 'microtubules'] as const)(
    '%s: P creates a polyline, N does nothing',
    projectType => {
      const props = makeProps({ projectType });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('p');
      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolyline);

      props.setEditMode.mockClear();
      pressKey('n');
      expect(props.setEditMode).not.toHaveBeenCalled();
    }
  );

  it('allows both while the project type is still loading', () => {
    // `useProjectData` starts undefined, so this is every editor mount, not an
    // exotic caller. Failing closed here would break the shortcut outright on
    // a slow fetch.
    const props = makeProps({ projectType: undefined });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('n');
    pressKey('p');
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolygon);
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolyline);
  });

  it('leaves the ungated mode keys alone', () => {
    const props = makeProps({ projectType: 'spheroid' });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('v');
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    pressKey('s');
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.Slice);
    pressKey('d');
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.DeletePolygon);
  });
});

describe('Tab cycling cannot reach the forbidden create mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips CreatePolyline in a polygon project', () => {
    expect(walkCycle(makeProps({ projectType: 'spheroid' }))).toEqual([
      EditMode.CreatePolygon,
      EditMode.Slice,
      EditMode.DeletePolygon,
    ]);
  });

  it('skips CreatePolygon in a polyline project', () => {
    expect(walkCycle(makeProps({ projectType: 'microtubules' }))).toEqual([
      EditMode.CreatePolyline,
      EditMode.Slice,
      EditMode.DeletePolygon,
    ]);
  });

  it('skips it in reverse too', () => {
    // Shift+Tab walks the same list backwards; a filter applied to only one
    // direction would pass the forward test above.
    expect(walkCycle(makeProps({ projectType: 'spheroid' }), true)).toEqual([
      EditMode.DeletePolygon,
      EditMode.Slice,
      EditMode.CreatePolygon,
    ]);
  });

  it('visits both when the type has not loaded', () => {
    expect(walkCycle(makeProps({ projectType: undefined }))).toEqual([
      EditMode.CreatePolygon,
      EditMode.CreatePolyline,
      EditMode.Slice,
      EditMode.DeletePolygon,
    ]);
  });

  it('escapes a forbidden mode entered before the type loaded', () => {
    // The mode is absent from the filtered list, so indexOf gives -1. Tab must
    // leave it rather than sit there; it can never cycle back in.
    const props = makeProps({
      projectType: 'spheroid',
      editMode: EditMode.CreatePolyline,
    });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('Tab');
    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
  });
});
