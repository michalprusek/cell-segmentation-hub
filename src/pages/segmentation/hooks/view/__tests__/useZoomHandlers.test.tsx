/**
 * Behavioral tests for useZoomHandlers
 *
 * The hook returns { handleZoomIn, handleZoomOut }.
 *
 * Covered behaviors:
 *  - handleZoomIn: does nothing when canvasContainerRef has no current
 *  - handleZoomIn: multiplies zoom by 1.2 (clamped to MAX_ZOOM)
 *  - handleZoomIn: clamps at MAX_ZOOM when already at or near MAX_ZOOM
 *  - handleZoomIn: computes new offset so the container center maps to the same image point
 *  - handleZoomIn: passes the new offset through constrainOffset
 *  - handleZoomOut: divides zoom by 1.2 (clamped to MIN_ZOOM)
 *  - handleZoomOut: clamps at MIN_ZOOM when already at or near MIN_ZOOM
 *  - handleZoomOut: does nothing when canvasContainerRef has no current
 *  - Both handlers are stable across re-renders
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useZoomHandlers } from '../useZoomHandlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainerRef(width: number, height: number) {
  const div = document.createElement('div');
  vi.spyOn(div, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    x: 0,
    y: 0,
    toJSON: vi.fn(),
  } as DOMRect);
  const ref = createRef<HTMLDivElement>();
  (ref as { current: HTMLDivElement }).current = div;
  return ref;
}

const makeNullRef = () =>
  ({ current: null }) as React.RefObject<HTMLDivElement>;

const makeImageRef = () =>
  ({ current: null }) as React.MutableRefObject<HTMLImageElement | null>;

const identityConstraint = (o: { x: number; y: number }) => o;

describe('useZoomHandlers', () => {
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 10;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // handleZoomIn
  // -------------------------------------------------------------------------

  it('handleZoomIn does nothing when containerRef is null', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();

    const { result } = renderHook(() =>
      useZoomHandlers(
        1,
        { x: 0, y: 0 },
        makeNullRef(),
        makeImageRef(),
        setZoom,
        setOffset,
        identityConstraint,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomIn();
    });

    expect(setZoom).not.toHaveBeenCalled();
    expect(setOffset).not.toHaveBeenCalled();
  });

  it('handleZoomIn multiplies zoom by 1.2', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(800, 600);

    const { result } = renderHook(() =>
      useZoomHandlers(
        2,
        { x: 0, y: 0 },
        containerRef,
        makeImageRef(),
        setZoom,
        setOffset,
        identityConstraint,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomIn();
    });

    expect(setZoom).toHaveBeenCalledWith(2 * 1.2);
  });

  it('handleZoomIn clamps at MAX_ZOOM', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(800, 600);

    // zoom is already at MAX_ZOOM
    const { result } = renderHook(() =>
      useZoomHandlers(
        MAX_ZOOM,
        { x: 0, y: 0 },
        containerRef,
        makeImageRef(),
        setZoom,
        setOffset,
        identityConstraint,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomIn();
    });

    // newZoom = Math.min(MAX_ZOOM * 1.2, MAX_ZOOM) = MAX_ZOOM
    expect(setZoom).toHaveBeenCalledWith(MAX_ZOOM);
  });

  it('handleZoomIn calls setOffset via constrainOffset', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const constrainOffset = vi
      .fn()
      .mockImplementation((o: { x: number; y: number }) => o);
    const containerRef = makeContainerRef(800, 600);

    const { result } = renderHook(() =>
      useZoomHandlers(
        1,
        { x: 0, y: 0 },
        containerRef,
        makeImageRef(),
        setZoom,
        setOffset,
        constrainOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomIn();
    });

    expect(constrainOffset).toHaveBeenCalledTimes(1);
    expect(setOffset).toHaveBeenCalledTimes(1);
  });

  it('handleZoomIn preserves the image point under the container center', () => {
    // container 400x300, zoom=1, offset={x:0,y:0}
    // centerX=200, centerY=150
    // imagePointBefore = {200/1 - 0, 150/1 - 0} = {200, 150}
    // newZoom = 1.2
    // newOffsetX = -200 + 200/1.2 = -200 + 166.67 = -33.33
    // newOffsetY = -150 + 150/1.2 = -150 + 125 = -25
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const constrainOffset = vi
      .fn()
      .mockImplementation((o: { x: number; y: number }) => o);
    const containerRef = makeContainerRef(400, 300);

    const { result } = renderHook(() =>
      useZoomHandlers(
        1,
        { x: 0, y: 0 },
        containerRef,
        makeImageRef(),
        setZoom,
        setOffset,
        constrainOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomIn();
    });

    const constrainArg = constrainOffset.mock.calls[0][0] as {
      x: number;
      y: number;
    };
    expect(constrainArg.x).toBeCloseTo(-200 + 200 / 1.2, 5);
    expect(constrainArg.y).toBeCloseTo(-150 + 150 / 1.2, 5);
  });

  // -------------------------------------------------------------------------
  // handleZoomOut
  // -------------------------------------------------------------------------

  it('handleZoomOut does nothing when containerRef is null', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();

    const { result } = renderHook(() =>
      useZoomHandlers(
        1,
        { x: 0, y: 0 },
        makeNullRef(),
        makeImageRef(),
        setZoom,
        setOffset,
        identityConstraint,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomOut();
    });

    expect(setZoom).not.toHaveBeenCalled();
    expect(setOffset).not.toHaveBeenCalled();
  });

  it('handleZoomOut divides zoom by 1.2', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(800, 600);

    const { result } = renderHook(() =>
      useZoomHandlers(
        2.4,
        { x: 0, y: 0 },
        containerRef,
        makeImageRef(),
        setZoom,
        setOffset,
        identityConstraint,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomOut();
    });

    expect(setZoom).toHaveBeenCalledWith(2.4 / 1.2);
  });

  it('handleZoomOut clamps at MIN_ZOOM', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(800, 600);

    const { result } = renderHook(() =>
      useZoomHandlers(
        MIN_ZOOM,
        { x: 0, y: 0 },
        containerRef,
        makeImageRef(),
        setZoom,
        setOffset,
        identityConstraint,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomOut();
    });

    // newZoom = Math.max(MIN_ZOOM / 1.2, MIN_ZOOM) = MIN_ZOOM
    expect(setZoom).toHaveBeenCalledWith(MIN_ZOOM);
  });

  it('handleZoomOut calls setOffset via constrainOffset', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const constrainOffset = vi
      .fn()
      .mockImplementation((o: { x: number; y: number }) => o);
    const containerRef = makeContainerRef(800, 600);

    const { result } = renderHook(() =>
      useZoomHandlers(
        2,
        { x: 0, y: 0 },
        containerRef,
        makeImageRef(),
        setZoom,
        setOffset,
        constrainOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    act(() => {
      result.current.handleZoomOut();
    });

    expect(constrainOffset).toHaveBeenCalledTimes(1);
    expect(setOffset).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Referential stability
  // -------------------------------------------------------------------------

  it('both handlers are stable across re-renders when all deps are stable', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const constrainOffset = vi
      .fn()
      .mockImplementation((o: { x: number; y: number }) => o);
    const containerRef = makeContainerRef(800, 600);
    const imageRef = makeImageRef();
    // offset must be the SAME object reference across renders; a new {} literal
    // in the render callback would be a different reference and invalidate useCallback
    const stableOffset = { x: 0, y: 0 };

    const { result, rerender } = renderHook(() =>
      useZoomHandlers(
        1,
        stableOffset,
        containerRef,
        imageRef,
        setZoom,
        setOffset,
        constrainOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    const zoomIn1 = result.current.handleZoomIn;
    const zoomOut1 = result.current.handleZoomOut;

    rerender();

    expect(result.current.handleZoomIn).toBe(zoomIn1);
    expect(result.current.handleZoomOut).toBe(zoomOut1);
  });
});
