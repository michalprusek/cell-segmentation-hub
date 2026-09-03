/**
 * Resizable width of the editor's right-hand panel — pointer drag + keyboard,
 * persisted per browser.
 *
 * View-local state on purpose: it lives in the layout rather than being
 * threaded from `SegmentationEditor`, because nothing about the segmentation
 * domain depends on how wide the user likes their panel.
 *
 * The arithmetic and the bounds are in `../utils/panelWidth`, tested there; this
 * hook is the DOM half — pointer capture, the cursor, and the persistence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  MAX_PANEL_WIDTH,
  PANEL_WIDTH_STORAGE_KEY,
  clampPanelWidth,
  readStoredPanelWidth,
  widthFromDrag,
} from '../utils/panelWidth';

/** One arrow-key press. Coarse enough to cross the panel in a few seconds,
 *  fine enough to land on a width that just fits a long type label. */
const KEYBOARD_STEP = 16;

export function useSidebarWidth() {
  // Read storage lazily inside the initialiser: on the server (and in a test
  // without a DOM) `window` is absent, and `readStoredPanelWidth(null)` is the
  // documented fallback rather than a crash.
  const [width, setWidth] = useState<number>(() =>
    readStoredPanelWidth(
      typeof window === 'undefined' ? null : window.localStorage
    )
  );

  // Persist on settle rather than on every pointermove — a drag fires dozens of
  // events and localStorage writes are synchronous.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(width));
      } catch {
        // A private window can refuse the write. The panel still resizes for
        // this session; only the memory of it is lost, which is not worth a
        // toast.
      }
    }, 300);
    return () => clearTimeout(id);
  }, [width]);

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only the primary button, and never a two-finger/secondary gesture.
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };
      // Pointer capture keeps the move/up events coming to this element even
      // when the pointer crosses the canvas, which otherwise swallows them
      // (it has its own pointer handlers for panning).
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [width]
  );

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setWidth(widthFromDrag(drag.startWidth, drag.startX, e.clientX));
  }, []);

  const onResizeEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // Keyboard resize, so the handle is not mouse-only: it is a focusable
  // separator, and left/right must move it.
  const onResizeKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setWidth(w => clampPanelWidth(w + KEYBOARD_STEP));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setWidth(w => clampPanelWidth(w - KEYBOARD_STEP));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setWidth(MAX_PANEL_WIDTH);
    } else if (e.key === 'End') {
      e.preventDefault();
      setWidth(MIN_PANEL_WIDTH);
    } else if (e.key === 'Enter' || e.key === ' ') {
      // Double-click-equivalent: back to the width the panel had before it
      // was resizable, so a user who dragged it somewhere unusable can recover
      // without hunting for the edge.
      e.preventDefault();
      setWidth(DEFAULT_PANEL_WIDTH);
    }
  }, []);

  return { width, onResizeStart, onResizeMove, onResizeEnd, onResizeKey };
}
