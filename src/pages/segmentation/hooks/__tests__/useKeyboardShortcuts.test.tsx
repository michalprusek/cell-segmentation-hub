/**
 * Tests for useKeyboardShortcuts hook
 * Covers mode switching, undo/redo, save, zoom, delete, escape, and input-field guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { EditMode } from '../../types';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const makeProps = (overrides: Record<string, any> = {}) => ({
  editMode: EditMode.View,
  canUndo: true,
  canRedo: true,
  selectedPolygonId: 'polygon-1',
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

// Dispatch a keydown event on the document body (the hook attaches to window)
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Mode switching
  // -------------------------------------------------------------------------

  describe('Mode shortcuts', () => {
    it('pressing V sets View mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('v');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('pressing E sets EditVertices mode when a polygon is selected', () => {
      const props = makeProps({ selectedPolygonId: 'polygon-1' });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('e');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.EditVertices);
    });

    it('pressing E does nothing when no polygon is selected', () => {
      const props = makeProps({ selectedPolygonId: null });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('e');

      expect(props.setEditMode).not.toHaveBeenCalled();
    });

    it('pressing D sets DeletePolygon mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('d');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.DeletePolygon);
    });

    it('pressing S without Ctrl sets Slice mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('s');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.Slice);
    });

    it('pressing N sets CreatePolygon mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('n');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolygon);
    });

    it('pressing P sets CreatePolyline mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('p');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolyline);
    });
  });

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  describe('Undo / Redo', () => {
    it('Ctrl+Z triggers undo when canUndo is true', () => {
      const props = makeProps({ canUndo: true });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('z', { ctrlKey: true });

      expect(props.handleUndo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Z does nothing when canUndo is false', () => {
      const props = makeProps({ canUndo: false });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('z', { ctrlKey: true });

      expect(props.handleUndo).not.toHaveBeenCalled();
    });

    it('Ctrl+Shift+Z triggers redo when canRedo is true', () => {
      const props = makeProps({ canRedo: true });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('z', { ctrlKey: true, shiftKey: true });

      expect(props.handleRedo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Y triggers redo when canRedo is true', () => {
      const props = makeProps({ canRedo: true });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('y', { ctrlKey: true });

      expect(props.handleRedo).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Y does nothing when canRedo is false', () => {
      const props = makeProps({ canRedo: false });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('y', { ctrlKey: true });

      expect(props.handleRedo).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  describe('Save shortcut', () => {
    it('Ctrl+S calls handleSave and does not switch mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('s', { ctrlKey: true });

      expect(props.handleSave).toHaveBeenCalledTimes(1);
      expect(props.setEditMode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------------

  describe('Zoom shortcuts', () => {
    it('pressing + calls handleZoomIn', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('+');

      expect(props.handleZoomIn).toHaveBeenCalledTimes(1);
    });

    it('pressing = also calls handleZoomIn', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('=');

      expect(props.handleZoomIn).toHaveBeenCalledTimes(1);
    });

    it('pressing - calls handleZoomOut', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('-');

      expect(props.handleZoomOut).toHaveBeenCalledTimes(1);
    });

    it('pressing 0 calls handleResetView', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('0');

      expect(props.handleResetView).toHaveBeenCalledTimes(1);
    });

    it('pressing R calls handleResetView', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('r');

      expect(props.handleResetView).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Delete / Backspace
  // -------------------------------------------------------------------------

  describe('Delete shortcuts', () => {
    it('Delete triggers handleDeletePolygon when a polygon is selected in View mode', () => {
      const props = makeProps({
        selectedPolygonId: 'polygon-1',
        editMode: EditMode.View,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Delete');

      expect(props.handleDeletePolygon).toHaveBeenCalledTimes(1);
    });

    it('Backspace triggers handleDeletePolygon when a polygon is selected in View mode', () => {
      const props = makeProps({
        selectedPolygonId: 'polygon-1',
        editMode: EditMode.View,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Backspace');

      expect(props.handleDeletePolygon).toHaveBeenCalledTimes(1);
    });

    it('Delete does nothing when no polygon is selected', () => {
      const props = makeProps({ selectedPolygonId: null });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Delete');

      expect(props.handleDeletePolygon).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Escape
  // -------------------------------------------------------------------------

  describe('Escape shortcut', () => {
    it('Escape calls onEscape callback when provided', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Escape');

      expect(props.onEscape).toHaveBeenCalledTimes(1);
    });

    it('Escape sets View mode when no onEscape is provided', () => {
      const props = makeProps({ onEscape: undefined });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Escape');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });
  });

  // -------------------------------------------------------------------------
  // Input-field guard
  // -------------------------------------------------------------------------

  describe('Input field guard', () => {
    it('ignores shortcuts when key event target is an INPUT element', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      const input = document.createElement('input');
      document.body.appendChild(input);

      fireEvent.keyDown(input, { key: 'v', bubbles: true });

      // setEditMode must NOT be called because the target is an input
      expect(props.setEditMode).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('ignores shortcuts when key event target is a TEXTAREA element', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      fireEvent.keyDown(textarea, { key: 'v', bubbles: true });

      expect(props.setEditMode).not.toHaveBeenCalled();

      document.body.removeChild(textarea);
    });
  });

  // -------------------------------------------------------------------------
  // Modifier-key tracking (return values)
  // -------------------------------------------------------------------------

  describe('Modifier key tracking', () => {
    it('isShiftPressed reflects current shift key state', () => {
      const props = makeProps();
      const { result } = renderHook(() => useKeyboardShortcuts(props));

      expect(result.current.isShiftPressed()).toBe(false);

      fireEvent.keyDown(document, {
        key: 'Shift',
        shiftKey: true,
        bubbles: true,
      });

      expect(result.current.isShiftPressed()).toBe(true);

      fireEvent.keyUp(document, {
        key: 'Shift',
        shiftKey: false,
        bubbles: true,
      });

      expect(result.current.isShiftPressed()).toBe(false);
    });

    it('isCtrlPressed reflects current ctrl key state', () => {
      const props = makeProps();
      const { result } = renderHook(() => useKeyboardShortcuts(props));

      expect(result.current.isCtrlPressed()).toBe(false);

      // Press Ctrl (use a neutral key to avoid triggering undo etc.)
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
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  describe('Cleanup', () => {
    it('removes event listeners when unmounted', () => {
      const _addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const props = makeProps();
      const { unmount } = renderHook(() => useKeyboardShortcuts(props));

      unmount();

      // After unmount the remove calls must exist for keydown and keyup
      const removedKeydown = removeSpy.mock.calls.some(
        ([event]) => event === 'keydown'
      );
      const removedKeyup = removeSpy.mock.calls.some(
        ([event]) => event === 'keyup'
      );

      expect(removedKeydown).toBe(true);
      expect(removedKeyup).toBe(true);
    });
  });
});
