/**
 * Tests for useKeyboardShortcuts hook.
 *
 * Consolidated coverage for every keyboard-binding branch of the hook:
 *  - mode-switching single keys + their Ctrl/selection guards
 *  - undo / redo / save with canUndo / canRedo gating
 *  - zoom + reset-view aliases
 *  - delete / backspace across delete-eligible modes
 *  - Enter finalize, Escape fallback, Tab / Shift+Tab mode cycling
 *  - H / ? help routing, input-field guard, onKeyDown callback
 *  - isShift / isCtrl / isAlt / isSpace modifier tracking
 *  - getShortcutForMode() pure helper and listener cleanup on unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';
import {
  useKeyboardShortcuts,
  getShortcutForMode,
} from '../useKeyboardShortcuts';
import { EditMode } from '../../types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const makeProps = (overrides: Record<string, unknown> = {}) => ({
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

// The hook attaches to window; dispatch on document so events bubble to it.
const pressKey = (key: string, extra: Partial<KeyboardEventInit> = {}) => {
  fireEvent.keyDown(document, {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
};

const releaseKey = (key: string, extra: Partial<KeyboardEventInit> = {}) => {
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

  describe('Mode switching', () => {
    it('pressing V sets View mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('v');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('pressing V with Shift (but not Ctrl) still sets View mode', () => {
      // The code checks !isCtrlPressed.current, not !isShiftPressed.
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('v', { shiftKey: true });

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('pressing Ctrl+V does NOT set View mode (ctrl guard)', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('v', { ctrlKey: true });

      expect(props.setEditMode).not.toHaveBeenCalled();
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

    it('pressing Ctrl+D does NOT set DeletePolygon mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('d', { ctrlKey: true });

      expect(props.setEditMode).not.toHaveBeenCalled();
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

    it('pressing A without a selected polygon does NOT set AddPoints mode', () => {
      const props = makeProps({ selectedPolygonId: null });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('a');

      expect(props.setEditMode).not.toHaveBeenCalled();
    });

    it('pressing Ctrl+A does NOT set AddPoints mode even with selection', () => {
      const props = makeProps({ selectedPolygonId: 'polygon-1' });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('a', { ctrlKey: true });

      expect(props.setEditMode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Undo / Redo
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

  describe('Save', () => {
    it('Ctrl+S calls handleSave and does not switch mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('s', { ctrlKey: true });

      expect(props.handleSave).toHaveBeenCalledTimes(1);
      expect(props.setEditMode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Zoom / reset view
  // -------------------------------------------------------------------------

  describe('Zoom / reset view', () => {
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

    it('pressing _ (alias for -) calls handleZoomOut', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('_');

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

    it('pressing Ctrl+R does NOT call handleResetView', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('r', { ctrlKey: true });

      expect(props.handleResetView).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Delete / Backspace
  // -------------------------------------------------------------------------

  describe('Delete / Backspace', () => {
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

    it('Delete in EditVertices mode calls handleDeletePolygon', () => {
      const props = makeProps({
        selectedPolygonId: 'polygon-1',
        editMode: EditMode.EditVertices,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Delete');

      expect(props.handleDeletePolygon).toHaveBeenCalledTimes(1);
    });

    it('Delete in DeletePolygon mode calls handleDeletePolygon', () => {
      const props = makeProps({
        selectedPolygonId: 'polygon-1',
        editMode: EditMode.DeletePolygon,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Delete');

      expect(props.handleDeletePolygon).toHaveBeenCalledTimes(1);
    });

    it('Delete does NOT fire in CreatePolygon mode', () => {
      const props = makeProps({
        selectedPolygonId: 'polygon-1',
        editMode: EditMode.CreatePolygon,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Delete');

      expect(props.handleDeletePolygon).not.toHaveBeenCalled();
    });

    it('Delete does nothing (no throw) when handleDeletePolygon is absent', () => {
      const props = makeProps({
        selectedPolygonId: 'polygon-1',
        editMode: EditMode.View,
        handleDeletePolygon: undefined,
      });
      renderHook(() => useKeyboardShortcuts(props));

      expect(() => pressKey('Delete')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Enter – finalize polyline / commit AddPoints
  // -------------------------------------------------------------------------

  describe('Enter', () => {
    it('Enter in CreatePolyline mode calls onEnter', () => {
      const props = makeProps({ editMode: EditMode.CreatePolyline });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Enter');

      expect(props.onEnter).toHaveBeenCalledTimes(1);
    });

    it('Enter in AddPoints mode calls onEnter', () => {
      const props = makeProps({ editMode: EditMode.AddPoints });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Enter');

      expect(props.onEnter).toHaveBeenCalledTimes(1);
    });

    it('Enter in View mode does NOT call onEnter', () => {
      const props = makeProps({ editMode: EditMode.View });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Enter');

      expect(props.onEnter).not.toHaveBeenCalled();
    });

    it('Enter in CreatePolyline without onEnter does not throw', () => {
      const props = makeProps({
        editMode: EditMode.CreatePolyline,
        onEnter: undefined,
      });
      renderHook(() => useKeyboardShortcuts(props));

      expect(() => pressKey('Enter')).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Escape
  // -------------------------------------------------------------------------

  describe('Escape', () => {
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
  // Tab / Shift+Tab – cycleEditMode
  //
  // No selection → cycle: [View, CreatePolygon, CreatePolyline, Slice, DeletePolygon]
  // With selection → EditVertices + AddPoints are spliced in after View.
  // -------------------------------------------------------------------------

  describe('Tab – cycleEditMode', () => {
    it('Tab from View (no selection) advances to CreatePolygon', () => {
      const props = makeProps({
        selectedPolygonId: null,
        editMode: EditMode.View,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolygon);
    });

    it('Tab from View (with selection) advances to EditVertices (inserted first)', () => {
      const props = makeProps({
        selectedPolygonId: 'poly-1',
        editMode: EditMode.View,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.EditVertices);
    });

    it('Tab from the last mode (no selection) wraps to View', () => {
      const props = makeProps({
        selectedPolygonId: null,
        editMode: EditMode.DeletePolygon,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('Tab from the last mode (with selection) wraps to View', () => {
      // With selection, list ends at DeletePolygon; Tab should wrap to View.
      const props = makeProps({
        selectedPolygonId: 'poly-1',
        editMode: EditMode.DeletePolygon,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('Shift+Tab cycles backwards from CreatePolygon to View (no selection)', () => {
      const props = makeProps({
        selectedPolygonId: null,
        editMode: EditMode.CreatePolygon,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab', { shiftKey: true });

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('Shift+Tab from View (index 0) wraps to the last mode (no selection)', () => {
      const props = makeProps({
        selectedPolygonId: null,
        editMode: EditMode.View,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab', { shiftKey: true });

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.DeletePolygon);
    });

    it('Ctrl+Tab does not cycle modes', () => {
      const props = makeProps({
        selectedPolygonId: null,
        editMode: EditMode.View,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab', { ctrlKey: true });

      expect(props.setEditMode).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Help – H / ?
  // -------------------------------------------------------------------------

  describe('Help shortcut (H / ?)', () => {
    it('pressing H calls onShowHelp when provided', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('h');

      expect(props.onShowHelp).toHaveBeenCalledTimes(1);
    });

    it('pressing ? calls onShowHelp when provided', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('?');

      expect(props.onShowHelp).toHaveBeenCalledTimes(1);
    });

    it('pressing H without onShowHelp falls through to showKeyboardHelp (no crash)', () => {
      const props = makeProps({ onShowHelp: undefined });
      renderHook(() => useKeyboardShortcuts(props));

      expect(() => pressKey('h')).not.toThrow();
    });

    it('pressing Ctrl+H does nothing', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('h', { ctrlKey: true });

      expect(props.onShowHelp).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Input-field guard
  // NOTE: jsdom does not implement isContentEditable (returns undefined), so
  // the contentEditable branch is untestable in a unit-test environment; the
  // guard is exercised here through INPUT / TEXTAREA targets.
  // -------------------------------------------------------------------------

  describe('Input field guard', () => {
    it('ignores shortcuts when key event target is an INPUT element', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      const input = document.createElement('input');
      document.body.appendChild(input);

      fireEvent.keyDown(input, { key: 'v', bubbles: true });

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
  // onKeyDown callback
  // -------------------------------------------------------------------------

  describe('onKeyDown callback', () => {
    it('is called with the lowercased key and the KeyboardEvent', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('N'); // uppercase; handler lowercases it

      expect(props.onKeyDown).toHaveBeenCalledWith(
        'n',
        expect.objectContaining({ type: 'keydown' })
      );
    });

    it('is NOT called when the target is an INPUT', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      const input = document.createElement('input');
      document.body.appendChild(input);
      fireEvent.keyDown(input, { key: 'v', bubbles: true });

      expect(props.onKeyDown).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });

  // -------------------------------------------------------------------------
  // Modifier-key tracking (returned ref getters)
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

    it('isAltPressed reflects current alt key state', () => {
      const props = makeProps();
      const { result } = renderHook(() => useKeyboardShortcuts(props));

      expect(result.current.isAltPressed()).toBe(false);

      fireEvent.keyDown(document, { key: 'Alt', altKey: true, bubbles: true });
      expect(result.current.isAltPressed()).toBe(true);

      fireEvent.keyUp(document, { key: 'Alt', altKey: false, bubbles: true });
      expect(result.current.isAltPressed()).toBe(false);
    });

    it('isSpacePressed becomes true on Space keydown outside input and resets on keyup', () => {
      const props = makeProps();
      const { result } = renderHook(() => useKeyboardShortcuts(props));

      expect(result.current.isSpacePressed()).toBe(false);

      fireEvent.keyDown(document, { code: 'Space', key: ' ', bubbles: true });
      expect(result.current.isSpacePressed()).toBe(true);

      releaseKey(' ', { code: 'Space' });
      expect(result.current.isSpacePressed()).toBe(false);
    });

    it('Space inside an INPUT does not set isSpacePressed', () => {
      const props = makeProps();
      const { result } = renderHook(() => useKeyboardShortcuts(props));

      const input = document.createElement('input');
      document.body.appendChild(input);

      fireEvent.keyDown(input, { code: 'Space', key: ' ', bubbles: true });

      expect(result.current.isSpacePressed()).toBe(false);

      document.body.removeChild(input);
    });

    it('isSpacePressed resets to false on keyup regardless of target', () => {
      const props = makeProps();
      const { result } = renderHook(() => useKeyboardShortcuts(props));

      fireEvent.keyDown(document, { code: 'Space', key: ' ', bubbles: true });
      expect(result.current.isSpacePressed()).toBe(true);

      // Release from inside an input – keyup always clears.
      const input = document.createElement('input');
      document.body.appendChild(input);
      fireEvent.keyUp(input, { code: 'Space', key: ' ', bubbles: true });

      expect(result.current.isSpacePressed()).toBe(false);
      document.body.removeChild(input);
    });
  });

  // -------------------------------------------------------------------------
  // getShortcutForMode – pure helper
  // -------------------------------------------------------------------------

  describe('getShortcutForMode', () => {
    it.each([
      [EditMode.View, 'V'],
      [EditMode.EditVertices, 'E'],
      [EditMode.AddPoints, 'A'],
      [EditMode.CreatePolygon, 'N'],
      [EditMode.CreatePolyline, 'P'],
      [EditMode.Slice, 'S'],
      [EditMode.DeletePolygon, 'D'],
    ])('returns %s for EditMode.%s', (mode, expected) => {
      expect(getShortcutForMode(mode)).toBe(expected);
    });

    it('returns empty string for an unrecognised mode', () => {
      expect(getShortcutForMode('unknown-mode' as EditMode)).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  describe('Cleanup', () => {
    it('removes keydown and keyup listeners when unmounted', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const props = makeProps();
      const { unmount } = renderHook(() => useKeyboardShortcuts(props));

      unmount();

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
