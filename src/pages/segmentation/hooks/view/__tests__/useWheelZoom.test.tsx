/**
 * Behavioral tests for useWheelZoom
 *
 * The hook:
 *  1. Attaches a 'wheel' event listener (passive:false) to canvasContainerRef.current
 *  2. On wheel: skips if target is inside .overflow-y-auto / [data-scroll-area]
 *  3. Computes mouseX/mouseY relative to the container's bounding rect
 *  4. Chooses zoomFactor 0.95 (deltaY>0 = scroll down = zoom out) or 1.05 (zoom in)
 *  5. Clamps the resulting zoom to [MIN_ZOOM, MAX_ZOOM]
 *  6. Rounds zoom to 2 decimal places
 *  7. Calls setOffset with constrainOffset result
 *  8. Does NOT call setZoom when clamped zoom equals current zoom (no change)
 *
 * RAF throttle: we stub requestAnimationFrame to call the callback synchronously
 * via fake timers so we can drive zoom calls deterministically.
 *
 * The ProgressiveRenderer uses a 150 ms debounce, so we advance fake timers
 * to let it fire, but the onZoomStart/onZoomEnd callbacks are tested via
 * the progressive rendering callbacks argument.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useWheelZoom } from '../useWheelZoom';

// -------------------------------------------------------------------------
// RAF + timer mocking helpers
// -------------------------------------------------------------------------
function setupFakeRaf() {
  vi.useFakeTimers();

  // Synchronous RAF: call the callback immediately with a fixed timestamp
  let rafTime = 1000; // start above 0 so throttle interval check passes
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      const id = Math.floor(Math.random() * 10000) + 1;
      // Execute synchronously but within a setTimeout(0) so the hook's
      // setup effects run first
      setTimeout(() => {
        rafTime += 20; // advance by 20 ms each frame (> 16 ms throttle interval)
        cb(rafTime);
      }, 0);
      return id;
    })
  );

  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      clearTimeout(id);
    })
  );
}

function teardownFakeRaf() {
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

// -------------------------------------------------------------------------
// Container factory — creates a div with getBoundingClientRect stubbed
// -------------------------------------------------------------------------
function makeContainer(rectOverride?: Partial<DOMRect>) {
  const div = document.createElement('div');
  div.getBoundingClientRect = vi.fn(() => ({
    left: rectOverride?.left ?? 0,
    top: rectOverride?.top ?? 0,
    right: rectOverride?.right ?? 800,
    bottom: rectOverride?.bottom ?? 600,
    width: rectOverride?.width ?? 800,
    height: rectOverride?.height ?? 600,
    x: rectOverride?.x ?? 0,
    y: rectOverride?.y ?? 0,
    toJSON: () => ({}),
  }));
  return div;
}

// -------------------------------------------------------------------------
// Dispatch a WheelEvent to an element
// -------------------------------------------------------------------------
function fireWheel(
  element: HTMLElement,
  opts: {
    clientX?: number;
    clientY?: number;
    deltaY?: number;
    target?: Element;
  } = {}
) {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 400,
    clientY: opts.clientY ?? 300,
    deltaY: opts.deltaY ?? -100, // negative = scroll up = zoom in
  });

  // Override target if requested (to simulate scrollable panel)
  if (opts.target) {
    Object.defineProperty(event, 'target', { value: opts.target });
  }

  element.dispatchEvent(event);
  return event;
}

// -------------------------------------------------------------------------
// Default hook args factory
// -------------------------------------------------------------------------
interface HookArgs {
  zoom?: number;
  offset?: { x: number; y: number };
  container?: HTMLDivElement;
  setZoom?: ReturnType<typeof vi.fn>;
  setOffset?: ReturnType<typeof vi.fn>;
  constrainOffset?: (
    o: { x: number; y: number },
    z: number
  ) => { x: number; y: number };
  MIN_ZOOM?: number;
  MAX_ZOOM?: number;
}

function makeArgs(overrides: HookArgs = {}) {
  const container = overrides.container ?? makeContainer();
  const ref = createRef<HTMLDivElement>();
  // Assign to the read-only .current via Object.defineProperty
  Object.defineProperty(ref, 'current', { value: container, writable: false });

  const setZoom = overrides.setZoom ?? vi.fn();
  const setOffset = overrides.setOffset ?? vi.fn();
  const constrainOffset =
    overrides.constrainOffset ?? ((o: { x: number; y: number }) => o); // identity passthrough

  return {
    zoom: overrides.zoom ?? 1,
    offset: overrides.offset ?? { x: 0, y: 0 },
    ref,
    setZoom,
    setOffset,
    constrainOffset,
    MIN_ZOOM: overrides.MIN_ZOOM ?? 0.1,
    MAX_ZOOM: overrides.MAX_ZOOM ?? 10,
  };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------
describe('useWheelZoom', () => {
  beforeEach(() => {
    setupFakeRaf();
  });

  afterEach(() => {
    teardownFakeRaf();
  });

  // -----------------------------------------------------------------------
  // Event listener registration
  // -----------------------------------------------------------------------
  describe('event listener setup', () => {
    it('registers a wheel listener on the container element', () => {
      const args = makeArgs();
      const addSpy = vi.spyOn(args.ref.current!, 'addEventListener');

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      expect(addSpy).toHaveBeenCalledWith('wheel', expect.any(Function), {
        passive: false,
      });
    });

    it('removes the wheel listener on unmount', () => {
      const args = makeArgs();
      const removeSpy = vi.spyOn(args.ref.current!, 'removeEventListener');

      const { unmount } = renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      unmount();
      expect(removeSpy).toHaveBeenCalledWith('wheel', expect.any(Function));
    });
  });

  // -----------------------------------------------------------------------
  // Zoom direction — zoom in vs zoom out
  // -----------------------------------------------------------------------
  describe('zoom direction', () => {
    it('zoom IN: negative deltaY increases zoom by factor 1.05', () => {
      const args = makeArgs({ zoom: 1 });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(args.ref.current!, { deltaY: -100 });
      vi.runAllTimers(); // flush RAF setTimeout

      expect(args.setZoom).toHaveBeenCalledOnce();
      const newZoom = args.setZoom.mock.calls[0][0] as number;
      expect(newZoom).toBeCloseTo(1.05, 2);
    });

    it('zoom OUT: positive deltaY decreases zoom by factor 0.95', () => {
      const args = makeArgs({ zoom: 1 });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(args.ref.current!, { deltaY: 100 });
      vi.runAllTimers();

      expect(args.setZoom).toHaveBeenCalledOnce();
      const newZoom = args.setZoom.mock.calls[0][0] as number;
      expect(newZoom).toBeCloseTo(0.95, 2);
    });
  });

  // -----------------------------------------------------------------------
  // Clamping — zoom cannot exceed MIN/MAX
  // -----------------------------------------------------------------------
  describe('zoom clamping', () => {
    it('does not exceed MAX_ZOOM when zooming in at the limit', () => {
      // At MAX_ZOOM=2, zooming in (factor 1.05) would give 2.1 — must be clamped to 2.0
      const args = makeArgs({ zoom: 2, MAX_ZOOM: 2 });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(args.ref.current!, { deltaY: -100 }); // zoom in
      vi.runAllTimers();

      // Rounded clamped result equals current zoom (2.0 === 2.0), so
      // setZoom should NOT be called (no actual change)
      expect(args.setZoom).not.toHaveBeenCalled();
    });

    it('does not go below MIN_ZOOM when zooming out at the limit', () => {
      const args = makeArgs({ zoom: 0.1, MIN_ZOOM: 0.1 });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(args.ref.current!, { deltaY: 100 }); // zoom out
      vi.runAllTimers();

      // 0.1 * 0.95 = 0.095 → clamped to 0.1 → rounded = 0.1 === current → no call
      expect(args.setZoom).not.toHaveBeenCalled();
    });

    it('zoom stays within [MIN_ZOOM, MAX_ZOOM] for a large zoom in step', () => {
      const args = makeArgs({ zoom: 9.9, MAX_ZOOM: 10 });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(args.ref.current!, { deltaY: -100 }); // zoom in
      vi.runAllTimers();

      if (args.setZoom.mock.calls.length > 0) {
        const newZoom = args.setZoom.mock.calls[0][0] as number;
        expect(newZoom).toBeLessThanOrEqual(10);
      }
      // Either clamped (no call) or clamped value ≤ MAX_ZOOM — both are correct
    });
  });

  // -----------------------------------------------------------------------
  // No-op when zoom would not change
  // -----------------------------------------------------------------------
  describe('no-op when zoom unchanged', () => {
    it('does not call setZoom or setOffset when rounded zoom equals current', () => {
      // Use a zoom value where rounding to 2 decimal places keeps it the same
      // after applying the factor. We achieve this by having MAX_ZOOM == current zoom.
      const args = makeArgs({ zoom: 5, MAX_ZOOM: 5 });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(args.ref.current!, { deltaY: -100 }); // would zoom in but already at max
      vi.runAllTimers();

      expect(args.setZoom).not.toHaveBeenCalled();
      expect(args.setOffset).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Focal-point math — mouse position under cursor stays fixed
  // -----------------------------------------------------------------------
  describe('focal-point offset calculation', () => {
    it('calls constrainOffset with the newly computed offset (not the old one)', () => {
      const args = makeArgs({
        zoom: 1,
        offset: { x: 0, y: 0 },
      });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      // Mouse at (400, 300), container rect starts at (0,0)
      // so mouseX=400, mouseY=300 in container coords
      const constrainSpy = vi.fn((o: { x: number; y: number }) => o);
      // Re-render with spy so we can inspect call
      const args2 = makeArgs({
        zoom: 1,
        offset: { x: 0, y: 0 },
        constrainOffset: constrainSpy,
      });

      renderHook(() =>
        useWheelZoom(
          args2.zoom,
          args2.offset,
          args2.ref,
          args2.setZoom,
          args2.setOffset,
          constrainSpy,
          args2.MIN_ZOOM,
          args2.MAX_ZOOM
        )
      );

      fireWheel(args2.ref.current!, {
        clientX: 400,
        clientY: 300,
        deltaY: -100,
      });
      vi.runAllTimers();

      expect(constrainSpy).toHaveBeenCalledOnce();
      const [passedOffset, passedZoom] = constrainSpy.mock.calls[0];
      // newZoom = round(1 * 1.05 * 100) / 100 = 1.05
      expect(passedZoom).toBeCloseTo(1.05, 2);
      // Focal math:
      // mouseXInImage = 400/1 - 0 = 400
      // newOffsetX = -400 + 400/1.05 ≈ -19.05
      expect(passedOffset.x).toBeCloseTo(-400 + 400 / 1.05, 1);
      expect(passedOffset.y).toBeCloseTo(-300 + 300 / 1.05, 1);
    });

    it('setOffset receives the value returned by constrainOffset', () => {
      const constrainedValue = { x: -7, y: -3 };
      const args = makeArgs({
        zoom: 1,
        constrainOffset: () => constrainedValue,
      });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(args.ref.current!, { deltaY: -100 });
      vi.runAllTimers();

      expect(args.setOffset).toHaveBeenCalledWith(constrainedValue);
    });
  });

  // -----------------------------------------------------------------------
  // Scrollable panel passthrough — events from scrollable areas are ignored
  // -----------------------------------------------------------------------
  describe('scrollable panel passthrough', () => {
    it('does not zoom when wheel target is inside .overflow-y-auto', () => {
      const args = makeArgs();
      const container = args.ref.current!;

      // Build a scrollable child
      const scrollPanel = document.createElement('div');
      scrollPanel.className = 'overflow-y-auto';
      container.appendChild(scrollPanel);

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(container, { target: scrollPanel, deltaY: -100 });
      vi.runAllTimers();

      expect(args.setZoom).not.toHaveBeenCalled();
    });

    it('does not zoom when wheel target has [data-scroll-area] ancestor', () => {
      const args = makeArgs();
      const container = args.ref.current!;

      const scrollArea = document.createElement('div');
      scrollArea.setAttribute('data-scroll-area', '');
      container.appendChild(scrollArea);

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(container, { target: scrollArea, deltaY: -100 });
      vi.runAllTimers();

      expect(args.setZoom).not.toHaveBeenCalled();
    });

    it('DOES zoom when wheel target is the container itself (no scrollable ancestor)', () => {
      const args = makeArgs();

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      fireWheel(args.ref.current!, { deltaY: -100 });
      vi.runAllTimers();

      expect(args.setZoom).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // preventDefault is called for non-scrollable wheel events
  // -----------------------------------------------------------------------
  describe('event.preventDefault', () => {
    it('calls preventDefault on valid (non-scrollable) wheel events', () => {
      const args = makeArgs();

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: -100,
      });
      const preventSpy = vi.spyOn(event, 'preventDefault');
      args.ref.current!.dispatchEvent(event);

      expect(preventSpy).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Progressive rendering callbacks
  // -----------------------------------------------------------------------
  describe('progressive rendering callbacks', () => {
    it('calls onZoomStart when a zoom change occurs', () => {
      const onZoomStart = vi.fn();
      const onZoomEnd = vi.fn();
      const args = makeArgs({ zoom: 1 });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM,
          { onZoomStart, onZoomEnd }
        )
      );

      fireWheel(args.ref.current!, { deltaY: -100 });
      vi.runAllTimers();

      expect(args.setZoom).toHaveBeenCalledOnce(); // confirms zoom changed
      // onZoomStart fires inside ProgressiveRenderer.startAnimation()
      expect(onZoomStart).toHaveBeenCalled();
    });

    it('calls onZoomEnd after the debounce period following zoom activity', () => {
      const onZoomEnd = vi.fn();
      const args = makeArgs({ zoom: 1 });

      renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM,
          { onZoomEnd }
        )
      );

      fireWheel(args.ref.current!, { deltaY: -100 });
      // Advance past the 150 ms debounce in ProgressiveRenderer
      vi.advanceTimersByTime(200);
      vi.runAllTimers();

      expect(onZoomEnd).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Return value — handleWheel and isZooming
  // -----------------------------------------------------------------------
  describe('return value', () => {
    it('returns a handleWheel function', () => {
      const args = makeArgs();
      const { result } = renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      expect(typeof result.current.handleWheel).toBe('function');
    });

    it('returns isZooming as a boolean', () => {
      const args = makeArgs();
      const { result } = renderHook(() =>
        useWheelZoom(
          args.zoom,
          args.offset,
          args.ref,
          args.setZoom,
          args.setOffset,
          args.constrainOffset,
          args.MIN_ZOOM,
          args.MAX_ZOOM
        )
      );

      expect(typeof result.current.isZooming).toBe('boolean');
    });
  });
});
