/**
 * useKeyboardShortcuts – extra2: branches not covered by test.tsx or gaps.test.tsx.
 *
 * Targets:
 *  1. Ctrl+Z (undo): when canUndo=false → no handleUndo call
 *  2. Ctrl+Y (redo): when canRedo=false → no handleRedo call
 *  3. Ctrl+Shift+Z (redo): when canRedo=true → handleRedo called
 *  4. Ctrl+S (save) → handleSave called
 *  5. N key → setEditMode(CreatePolygon)
 *  6. P key → setEditMode(CreatePolyline)
 *  7. S key (without Ctrl) → setEditMode(Slice)
 *  8. D key (without Ctrl) → setEditMode(DeletePolygon)
 *  9. E key with selectedPolygonId → setEditMode(EditVertices)
 * 10. E key without selectedPolygonId → no setEditMode call
 * 11. Ctrl+A does NOT set AddPoints (A key is blocked by Ctrl guard)
 * 12. = key (alternative zoom-in) → handleZoomIn
 * 13. 0 key → handleResetView
 * 14. Backspace key with selection in View → handleDeletePolygon
 * 15. Escape with no onEscape → falls back to setEditMode(View)
 * 16. isCtrlPressed reflects keydown/keyup ctrl state
 * 17. V key with Ctrl → does NOT set View mode (ctrl guard)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { EditMode } from '../../types';

// ── helpers ───────────────────────────────────────────────────────────────────

const makeProps = (overrides: Record<string, unknown> = {}) => ({
  editMode: EditMode.View,
  canUndo: true,
  canRedo: true,
  selectedPolygonId: 'poly-1',
  setEditMode: vi.fn(),
  handleUndo: vi.fn(),
  handleRedo: vi.fn(),
  handleSave: vi.fn().mockResolvedValue(undefined),
  handleZoomIn: vi.fn(),
  handleZoomOut: vi.fn(),
  handleResetView: vi.fn(),
  handleDeletePolygon: vi.fn(),
  onEscape: vi.fn(),
  onEnter: vi.fn(),
  onKeyDown: vi.fn(),
  onShowHelp: vi.fn(),
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

const _releaseKey = (key: string, extra: Partial<KeyboardEventInit> = {}) => {
  fireEvent.keyUp(document, { key, bubbles: true, cancelable: true, ...extra });
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useKeyboardShortcuts – extra2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1. Ctrl+Z when canUndo=false ──────────────────────────────────────────

  it('Ctrl+Z when canUndo=false does NOT call handleUndo', () => {
    const props = makeProps({ canUndo: false });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('z', { ctrlKey: true });

    expect(props.handleUndo).not.toHaveBeenCalled();
  });

  it('Ctrl+Z when canUndo=true calls handleUndo', () => {
    const props = makeProps({ canUndo: true });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('z', { ctrlKey: true });

    expect(props.handleUndo).toHaveBeenCalledTimes(1);
  });

  // ── 2. Ctrl+Y when canRedo=false ──────────────────────────────────────────

  it('Ctrl+Y when canRedo=false does NOT call handleRedo', () => {
    const props = makeProps({ canRedo: false });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('y', { ctrlKey: true });

    expect(props.handleRedo).not.toHaveBeenCalled();
  });

  // ── 3. Ctrl+Shift+Z (redo) ────────────────────────────────────────────────

  it('Ctrl+Shift+Z calls handleRedo when canRedo=true', () => {
    const props = makeProps({ canRedo: true });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('z', { ctrlKey: true, shiftKey: true });

    expect(props.handleRedo).toHaveBeenCalledTimes(1);
  });

  // ── 4. Ctrl+S calls handleSave ────────────────────────────────────────────

  it('Ctrl+S calls handleSave', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('s', { ctrlKey: true });

    expect(props.handleSave).toHaveBeenCalledTimes(1);
  });

  // ── 5. N key → CreatePolygon ──────────────────────────────────────────────

  it('pressing N sets CreatePolygon mode', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('n');

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolygon);
  });

  // ── 6. P key → CreatePolyline ─────────────────────────────────────────────

  it('pressing P sets CreatePolyline mode', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('p');

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolyline);
  });

  // ── 7. S key (without Ctrl) → Slice ──────────────────────────────────────

  it('pressing S without Ctrl sets Slice mode', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('s');

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.Slice);
  });

  // ── 8. D key → DeletePolygon ──────────────────────────────────────────────

  it('pressing D sets DeletePolygon mode', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('d');

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.DeletePolygon);
  });

  // ── 9. E key with selection → EditVertices ────────────────────────────────

  it('pressing E with selectedPolygonId sets EditVertices mode', () => {
    const props = makeProps({ selectedPolygonId: 'poly-1' });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('e');

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.EditVertices);
  });

  // ── 10. E key without selection → no-op ──────────────────────────────────

  it('pressing E without selectedPolygonId does NOT set EditVertices', () => {
    const props = makeProps({ selectedPolygonId: null });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('e');

    expect(props.setEditMode).not.toHaveBeenCalled();
  });

  // ── 11. Ctrl+A does NOT set AddPoints ────────────────────────────────────

  it('Ctrl+A does NOT set AddPoints mode', () => {
    const props = makeProps({ selectedPolygonId: 'poly-1' });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('a', { ctrlKey: true });

    expect(props.setEditMode).not.toHaveBeenCalled();
  });

  // ── 12. = key → handleZoomIn ──────────────────────────────────────────────

  it('pressing = calls handleZoomIn', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('=');

    expect(props.handleZoomIn).toHaveBeenCalledTimes(1);
  });

  // ── 12b. + key → handleZoomIn ─────────────────────────────────────────────

  it('pressing + calls handleZoomIn', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('+');

    expect(props.handleZoomIn).toHaveBeenCalledTimes(1);
  });

  // ── 13. 0 key → handleResetView ──────────────────────────────────────────

  it('pressing 0 calls handleResetView', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('0');

    expect(props.handleResetView).toHaveBeenCalledTimes(1);
  });

  // ── 14. Backspace in View with selection → handleDeletePolygon ────────────

  it('pressing Backspace in View mode with selection calls handleDeletePolygon', () => {
    const props = makeProps({
      selectedPolygonId: 'poly-1',
      editMode: EditMode.View,
    });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('Backspace');

    expect(props.handleDeletePolygon).toHaveBeenCalledTimes(1);
  });

  // ── 15. Escape with no onEscape → falls back to setEditMode(View) ─────────

  it('pressing Escape without onEscape calls setEditMode(View)', () => {
    const props = makeProps({ onEscape: undefined });
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('Escape');

    expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
  });

  // ── 16. isCtrlPressed reflects ctrl state ────────────────────────────────

  it('isCtrlPressed reflects Ctrl key keydown/keyup state', () => {
    const props = makeProps();
    const { result } = renderHook(() => useKeyboardShortcuts(props));

    expect(result.current.isCtrlPressed()).toBe(false);

    fireEvent.keyDown(document, {
      key: 'Control',
      ctrlKey: true,
      bubbles: true,
    });
    expect(result.current.isCtrlPressed()).toBe(true);

    fireEvent.keyUp(document, {
      key: 'Control',
      ctrlKey: false,
      bubbles: true,
    });
    expect(result.current.isCtrlPressed()).toBe(false);
  });

  // ── 17. V key with Ctrl → NOT View mode ──────────────────────────────────

  it('pressing Ctrl+V does NOT call setEditMode', () => {
    const props = makeProps();
    renderHook(() => useKeyboardShortcuts(props));

    pressKey('v', { ctrlKey: true });

    expect(props.setEditMode).not.toHaveBeenCalled();
  });

  // ── Shift key tracking ────────────────────────────────────────────────────

  it('isShiftPressed reflects Shift key state', () => {
    const props = makeProps();
    const { result } = renderHook(() => useKeyboardShortcuts(props));

    expect(result.current.isShiftPressed()).toBe(false);

    fireEvent.keyDown(document, {
      key: 'Shift',
      shiftKey: true,
      bubbles: true,
    });
    expect(result.current.isShiftPressed()).toBe(true);

    fireEvent.keyUp(document, { key: 'Shift', shiftKey: false, bubbles: true });
    expect(result.current.isShiftPressed()).toBe(false);
  });
});
