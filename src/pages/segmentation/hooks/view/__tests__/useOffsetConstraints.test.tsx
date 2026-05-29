/**
 * Behavioral tests for useOffsetConstraints
 *
 * The hook exposes a single memoized function `constrainOffset(newOffset, newZoom)`.
 *
 * Covered behaviors:
 *  - Returns newOffset unchanged when refs are not set (early return guard)
 *  - Clamps offset.x to [minVisibleX, maxVisibleX] with a real container + image
 *  - Clamps offset.y to [minVisibleY, maxVisibleY]
 *  - Allows offset that is already within bounds to pass through unchanged
 *  - At zoom=1 the maxX is 0 (image flush against left edge of container)
 *  - minVisibleX allows pulling up to 75% of image off-screen (25% visible guard)
 *  - The hook is stable across re-renders (same function reference)
 *
 * Skipped: testing with an actual browser layout (getBoundingClientRect lives in jsdom
 * which always returns {width:800, height:600} from setup.ts). We override this value
 * per-test via spying.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useOffsetConstraints } from '../useOffsetConstraints';

function makeContainerRef(width: number, height: number) {
  const div = document.createElement('div');
  // Override getBoundingClientRect to return our desired dimensions
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

function makeImageRef(width: number, height: number) {
  const img = { width, height } as HTMLImageElement;
  const ref = { current: img };
  return ref as React.MutableRefObject<HTMLImageElement | null>;
}

describe('useOffsetConstraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns newOffset unchanged when canvasContainerRef has no current', () => {
    const emptyRef = { current: null } as React.RefObject<HTMLDivElement>;
    const imgRef = makeImageRef(500, 400);

    const { result } = renderHook(() => useOffsetConstraints(emptyRef, imgRef));

    const offset = { x: -9999, y: -9999 };
    const out = result.current.constrainOffset(offset, 1);
    expect(out).toBe(offset);
  });

  it('returns newOffset unchanged when imageRef has no current', () => {
    const containerRef = makeContainerRef(800, 600);
    const nullImgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useOffsetConstraints(containerRef, nullImgRef)
    );

    const offset = { x: -9999, y: -9999 };
    const out = result.current.constrainOffset(offset, 1);
    expect(out).toBe(offset);
  });

  it('passes an offset that is already within bounds unchanged', () => {
    // container 800x600, image 400x300, zoom=1
    // minX = 800/1 - 400 = 400; maxX = 0
    // The valid range for x at zoom=1 when image < container is [400, 0]
    // But minVisibleX = min(400, -(400*0.75)) = min(400, -300) = -300
    // maxVisibleX = max(0, 800*0.75) = 600
    // So x=100 is within [-300, 600]
    const containerRef = makeContainerRef(800, 600);
    const imgRef = makeImageRef(400, 300);

    const { result } = renderHook(() =>
      useOffsetConstraints(containerRef, imgRef)
    );

    const out = result.current.constrainOffset({ x: 100, y: 50 }, 1);
    expect(out.x).toBe(100);
    expect(out.y).toBe(50);
  });

  it('clamps x when image is dragged too far left (beyond 25% visible guard)', () => {
    // container 800x600, image 400x300, zoom=1
    // minVisibleX = min(400, -(400*0.75)) = -300
    const containerRef = makeContainerRef(800, 600);
    const imgRef = makeImageRef(400, 300);

    const { result } = renderHook(() =>
      useOffsetConstraints(containerRef, imgRef)
    );

    // Request x = -999 (far beyond the -300 floor)
    const out = result.current.constrainOffset({ x: -999, y: 0 }, 1);
    expect(out.x).toBeCloseTo(-300);
  });

  it('clamps x when image is dragged too far right (beyond maxVisibleX)', () => {
    // container 800x600, image 400x300, zoom=1
    // maxVisibleX = max(0, 800*0.75) = 600
    const containerRef = makeContainerRef(800, 600);
    const imgRef = makeImageRef(400, 300);

    const { result } = renderHook(() =>
      useOffsetConstraints(containerRef, imgRef)
    );

    const out = result.current.constrainOffset({ x: 9999, y: 0 }, 1);
    expect(out.x).toBeCloseTo(600);
  });

  it('clamps y when image is dragged too far up (below minVisibleY)', () => {
    // container 800x600, image 400x300, zoom=1
    // minVisibleY = min(300, -(300*0.75)) = -225
    const containerRef = makeContainerRef(800, 600);
    const imgRef = makeImageRef(400, 300);

    const { result } = renderHook(() =>
      useOffsetConstraints(containerRef, imgRef)
    );

    const out = result.current.constrainOffset({ x: 0, y: -9999 }, 1);
    expect(out.y).toBeCloseTo(-225);
  });

  it('clamps y when image is dragged too far down (beyond maxVisibleY)', () => {
    // container 800x600, image 400x300, zoom=1
    // maxVisibleY = max(0, 600*0.75) = 450
    const containerRef = makeContainerRef(800, 600);
    const imgRef = makeImageRef(400, 300);

    const { result } = renderHook(() =>
      useOffsetConstraints(containerRef, imgRef)
    );

    const out = result.current.constrainOffset({ x: 0, y: 9999 }, 1);
    expect(out.y).toBeCloseTo(450);
  });

  it('accounts for zoom when computing bounds (zoom=2 halves the offset range)', () => {
    // container 800x600, image 400x300, zoom=2
    // At zoom=2: containerWidth/newZoom = 400, containerHeight/newZoom = 300
    // minX = 400 - 400 = 0; maxX = 0
    // minVisibleX = min(0, -(400*0.75)) = -300
    // maxVisibleX = max(0, 400*0.75) = 300
    const containerRef = makeContainerRef(800, 600);
    const imgRef = makeImageRef(400, 300);

    const { result } = renderHook(() =>
      useOffsetConstraints(containerRef, imgRef)
    );

    const atZoom2 = result.current.constrainOffset({ x: 500, y: 0 }, 2);
    expect(atZoom2.x).toBeCloseTo(300); // clamped to maxVisibleX
  });

  it('returns a stable function reference across re-renders', () => {
    const containerRef = makeContainerRef(800, 600);
    const imgRef = makeImageRef(400, 300);

    const { result, rerender } = renderHook(() =>
      useOffsetConstraints(containerRef, imgRef)
    );

    const fn1 = result.current.constrainOffset;
    rerender();
    const fn2 = result.current.constrainOffset;

    expect(fn1).toBe(fn2);
  });
});
