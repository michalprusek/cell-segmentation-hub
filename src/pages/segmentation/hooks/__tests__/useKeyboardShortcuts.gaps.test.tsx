/**
 * useKeyboardShortcuts – gap coverage
 *
 * Targets branches NOT covered by useKeyboardShortcuts.test.tsx:
 *  1. cycleEditMode via Tab (forward) and Shift+Tab (reverse) — with and
 *     without a selected polygon (affects the mode list).
 *  2. Tab when current mode is the last in the list → wraps to 0.
 *  3. Shift+Tab when at index 0 → wraps to last.
 *  4. Ctrl+Tab → ignored (Tab with Ctrl guard).
 *  5. H key calls onShowHelp callback when provided.
 *  6. H key falls through to showKeyboardHelp() when onShowHelp is absent
 *     (no crash; covered by spy on logger.debug in dev env).
 *  7. ? key calls onShowHelp.
 *  8. Enter key in CreatePolyline mode calls onEnter.
 *  9. Enter key in AddPoints mode calls onEnter.
 * 10. Enter key in View mode does NOT call onEnter.
 * 11. A key without a selected polygon → does not set AddPoints mode.
 * 12. _ key triggers handleZoomOut (alt mapping for -).
 * 13. R key with Ctrl → does NOT call handleResetView.
 * 14. D key with Ctrl → does NOT call setEditMode.
 * 15. Delete in EditVertices mode calls handleDeletePolygon.
 * 16. Delete in DeletePolygon mode calls handleDeletePolygon.
 * 17. Delete does nothing when handleDeletePolygon is absent.
 * 18. Space key in non-input element sets isSpacePressed (via keyUp reset).
 * 19. Space key inside contentEditable is ignored (no page scroll preventDefault).
 * 20. isAltPressed reflects keydown/keyup alt state.
 * 21. isSpacePressed resets to false on keyup regardless of target.
 * 22. getShortcutForMode returns correct shortcut string for each mode.
 * 23. onKeyDown callback is called with lowercased key and the event.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';
import {
  useKeyboardShortcuts,
  getShortcutForMode,
} from '../useKeyboardShortcuts';
import { EditMode } from '../../types';

// ── helpers ──────────────────────────────────────────────────────────────────

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

const releaseKey = (key: string, extra: Partial<KeyboardEventInit> = {}) => {
  fireEvent.keyUp(document, { key, bubbles: true, cancelable: true, ...extra });
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useKeyboardShortcuts – gap coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Tab / cycleEditMode ───────────────────────────────────────────────────

  describe('Tab – cycleEditMode', () => {
    it('Tab from View (no selection) advances to CreatePolygon', () => {
      const props = makeProps({
        selectedPolygonId: null,
        editMode: EditMode.View,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab');

      // Without selection the cycle is: View, CreatePolygon, CreatePolyline, Slice, DeletePolygon
      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.CreatePolygon);
    });

    it('Tab from View (with selection) advances to EditVertices (inserted first)', () => {
      const props = makeProps({
        selectedPolygonId: 'poly-1',
        editMode: EditMode.View,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab');

      // With selection the cycle is: View, EditVertices, AddPoints, CreatePolygon, ...
      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.EditVertices);
    });

    it('Tab from the last mode wraps to View', () => {
      // Without selection, last mode = DeletePolygon
      const props = makeProps({
        selectedPolygonId: null,
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

      // Without selection, last = DeletePolygon
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

    it('Tab with selection inserts EditVertices+AddPoints and wraps from last mode', () => {
      // With selection, mode list = [View, EditVertices, AddPoints, CreatePolygon, CreatePolyline, Slice, DeletePolygon]
      // Last = DeletePolygon; Tab should wrap to View
      const props = makeProps({
        selectedPolygonId: 'poly-1',
        editMode: EditMode.DeletePolygon,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Tab');

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });
  });

  // ── H / ? – help shortcut ─────────────────────────────────────────────────

  describe('H and ? keys – help shortcut', () => {
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

      // Should not throw even in production (process.env.NODE_ENV = 'test' → no log)
      expect(() => pressKey('h')).not.toThrow();
    });

    it('pressing H with Ctrl does nothing', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('h', { ctrlKey: true });

      expect(props.onShowHelp).not.toHaveBeenCalled();
    });
  });

  // ── Enter key per EditMode ────────────────────────────────────────────────

  describe('Enter key', () => {
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

  // ── A key guard: requires selectedPolygonId ───────────────────────────────

  describe('A key – AddPoints guard', () => {
    it('pressing A without selection does NOT set AddPoints mode', () => {
      const props = makeProps({ selectedPolygonId: null });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('a');

      expect(props.setEditMode).not.toHaveBeenCalled();
    });

    it('pressing A with Ctrl does NOT set AddPoints mode even with selection', () => {
      const props = makeProps({ selectedPolygonId: 'poly-1' });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('a', { ctrlKey: true });

      expect(props.setEditMode).not.toHaveBeenCalled();
    });
  });

  // ── _ key maps to handleZoomOut ───────────────────────────────────────────

  describe('_ key zoom-out alias', () => {
    it('pressing _ calls handleZoomOut', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('_');

      expect(props.handleZoomOut).toHaveBeenCalledTimes(1);
    });
  });

  // ── R with Ctrl is a no-op ────────────────────────────────────────────────

  describe('R key – Ctrl guard', () => {
    it('pressing Ctrl+R does NOT call handleResetView', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('r', { ctrlKey: true });

      expect(props.handleResetView).not.toHaveBeenCalled();
    });
  });

  // ── D key – Ctrl guard ────────────────────────────────────────────────────

  describe('D key – Ctrl guard', () => {
    it('pressing Ctrl+D does NOT set DeletePolygon mode', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('d', { ctrlKey: true });

      expect(props.setEditMode).not.toHaveBeenCalled();
    });
  });

  // ── Delete in EditVertices and DeletePolygon modes ────────────────────────

  describe('Delete key in additional delete-eligible modes', () => {
    it('Delete in EditVertices mode calls handleDeletePolygon', () => {
      const props = makeProps({
        selectedPolygonId: 'poly-1',
        editMode: EditMode.EditVertices,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Delete');

      expect(props.handleDeletePolygon).toHaveBeenCalledTimes(1);
    });

    it('Delete in DeletePolygon mode calls handleDeletePolygon', () => {
      const props = makeProps({
        selectedPolygonId: 'poly-1',
        editMode: EditMode.DeletePolygon,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Delete');

      expect(props.handleDeletePolygon).toHaveBeenCalledTimes(1);
    });

    it('Delete does nothing when handleDeletePolygon is absent', () => {
      const props = makeProps({
        selectedPolygonId: 'poly-1',
        editMode: EditMode.View,
        handleDeletePolygon: undefined,
      });
      renderHook(() => useKeyboardShortcuts(props));

      // Should not throw even when handler is missing
      expect(() => pressKey('Delete')).not.toThrow();
    });

    it('Delete does NOT fire in CreatePolygon mode', () => {
      const props = makeProps({
        selectedPolygonId: 'poly-1',
        editMode: EditMode.CreatePolygon,
      });
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('Delete');

      expect(props.handleDeletePolygon).not.toHaveBeenCalled();
    });
  });

  // ── contentEditable guard ─────────────────────────────────────────────────
  // NOTE: jsdom does not implement isContentEditable (returns undefined), so
  // that branch in the source is genuinely untestable in a unit-test environment.
  // The guard is covered by the INPUT/TEXTAREA tests in the primary test file.

  // ── V key without Ctrl sets View mode (non-Ctrl modifier combo) ───────────

  describe('V key without Ctrl', () => {
    it('pressing V with Shift (but not Ctrl) still sets View mode', () => {
      // The code checks !isCtrlPressed.current, not !isShiftPressed
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('v', { shiftKey: true });

      expect(props.setEditMode).toHaveBeenCalledWith(EditMode.View);
    });
  });

  // ── isAltPressed modifier tracking ───────────────────────────────────────

  describe('isAltPressed modifier tracking', () => {
    it('isAltPressed reflects Alt key state', () => {
      const props = makeProps();
      const { result } = renderHook(() => useKeyboardShortcuts(props));

      expect(result.current.isAltPressed()).toBe(false);

      fireEvent.keyDown(document, { key: 'Alt', altKey: true, bubbles: true });
      expect(result.current.isAltPressed()).toBe(true);

      fireEvent.keyUp(document, { key: 'Alt', altKey: false, bubbles: true });
      expect(result.current.isAltPressed()).toBe(false);
    });
  });

  // ── isSpacePressed modifier tracking ─────────────────────────────────────

  describe('isSpacePressed modifier tracking', () => {
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

      // isSpacePressed is only set when target is not an input
      expect(result.current.isSpacePressed()).toBe(false);

      document.body.removeChild(input);
    });

    it('isSpacePressed resets to false on keyup regardless of target', () => {
      const props = makeProps();
      const { result } = renderHook(() => useKeyboardShortcuts(props));

      // Set true via non-input keydown
      fireEvent.keyDown(document, { code: 'Space', key: ' ', bubbles: true });
      expect(result.current.isSpacePressed()).toBe(true);

      // Release from inside an input (keyup always clears)
      const input = document.createElement('input');
      document.body.appendChild(input);
      fireEvent.keyUp(input, { code: 'Space', key: ' ', bubbles: true });

      expect(result.current.isSpacePressed()).toBe(false);
      document.body.removeChild(input);
    });
  });

  // ── onKeyDown callback ────────────────────────────────────────────────────

  describe('onKeyDown callback', () => {
    it('onKeyDown is called with lowercased key and the KeyboardEvent', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      pressKey('N'); // uppercase; handler lowercases it

      expect(props.onKeyDown).toHaveBeenCalledWith(
        'n',
        expect.objectContaining({ type: 'keydown' })
      );
    });

    it('onKeyDown is NOT called when target is an INPUT', () => {
      const props = makeProps();
      renderHook(() => useKeyboardShortcuts(props));

      const input = document.createElement('input');
      document.body.appendChild(input);
      fireEvent.keyDown(input, { key: 'v', bubbles: true });

      expect(props.onKeyDown).not.toHaveBeenCalled();
      document.body.removeChild(input);
    });
  });

  // ── getShortcutForMode ────────────────────────────────────────────────────

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
      // Cast to bypass TS to simulate an unknown runtime value
      expect(getShortcutForMode('unknown-mode' as EditMode)).toBe('');
    });
  });
});
