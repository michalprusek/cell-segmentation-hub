/**
 * "Clicked the empty canvas" — told apart from "panned across it".
 *
 * WHY IT IS NOT JUST `onClick`. The SVG overlay already had a plain `onClick`
 * that cleared the SINGLE selection, and it fired after a pan too: a browser
 * dispatches `click` whenever mousedown and mouseup land on the same element,
 * however far the pointer travelled in between, and the pan gesture starts and
 * ends on exactly that background. Clearing a single selection that way was
 * survivable — one more click puts it back. Clearing a Shift-built
 * multi-selection would not be: the user picked those polygons one at a time,
 * and a stray drag while inspecting them would throw the lot away.
 *
 * So a press is remembered only when it STARTS on the background with the
 * primary button, and the release only counts as a click when it lands on the
 * background again within `CLICK_MOVE_TOLERANCE_PX` of where it began.
 *
 * The returned handlers are identity-stable — they read the caller's callback
 * and enablement through refs — so they can sit on a memoized subtree without
 * defeating its comparator.
 */

import { useCallback, useRef, type MouseEvent } from 'react';

/** Pointer travel a press may have and still count as a click.
 *
 *  A few pixels of hand tremor between press and release is a click by anyone's
 *  reckoning; a pan is tens of pixels at least. Nothing between 4 px and a real
 *  drag is a gesture the editor has a meaning for, so the exact value only has
 *  to separate a shaky finger from an intended movement. */
export const CLICK_MOVE_TOLERANCE_PX = 4;

export interface UseCanvasBackgroundDeselectOptions {
  /** Runs on a genuine background click. */
  onDeselect: () => void;
  /** False in the point-placement modes, where a background click PLACES a
   *  point and must not also drop the selection (see
   *  `shouldPreventCanvasDeselection`). */
  enabled: boolean;
}

export interface CanvasBackgroundDeselectHandlers {
  onMouseDown: (event: MouseEvent) => void;
  onClick: (event: MouseEvent) => void;
}

export function useCanvasBackgroundDeselect({
  onDeselect,
  enabled,
}: UseCanvasBackgroundDeselectOptions): CanvasBackgroundDeselectHandlers {
  const onDeselectRef = useRef(onDeselect);
  onDeselectRef.current = onDeselect;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  /** Where the current background press began, or null when the press did not
   *  start on the background (it started on a polygon or a vertex). */
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null);

  const onMouseDown = useCallback((event: MouseEvent) => {
    pressOriginRef.current =
      event.button === 0 && event.target === event.currentTarget
        ? { x: event.clientX, y: event.clientY }
        : null;
  }, []);

  const onClick = useCallback((event: MouseEvent) => {
    const origin = pressOriginRef.current;
    // Consume it either way: a press is one gesture, and leaving it behind
    // would let the NEXT click inherit this one's origin.
    pressOriginRef.current = null;
    if (!origin || !enabledRef.current) return;
    // The release has to land on the background too — a pan can slide a
    // polygon under the cursor.
    if (event.target !== event.currentTarget) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (Math.hypot(dx, dy) > CLICK_MOVE_TOLERANCE_PX) return;
    onDeselectRef.current();
  }, []);

  return { onMouseDown, onClick };
}
