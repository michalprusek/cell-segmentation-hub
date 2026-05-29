/**
 * Behavioral tests for useImageCentering
 *
 * The hook exposes `centerImage()` which:
 *  1. Does nothing when containerRef or imageSrc is falsy
 *  2. Creates a new Image, assigns src, sets imageRef.current
 *  3. On img.onload: computes zoom = fit-to-80%-of-container (landscape vs portrait)
 *  4. Clamps zoom to [MIN_ZOOM, MAX_ZOOM]
 *  5. Computes centered offset = (containerSize/zoom - imgSize) / 2 per axis
 *  6. Calls setZoom and setOffset with the computed values
 *
 * The global Image mock in setup.ts returns a synchronous stub without
 * calling onload. We override it per test to fire onload synchronously so
 * we can observe setZoom / setOffset synchronously.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useImageCentering } from '../useImageCentering';

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

/** Stub global Image so onload fires synchronously with given dimensions. */
function stubImage(imgWidth: number, imgHeight: number) {
  return vi.stubGlobal(
    'Image',
    vi.fn().mockImplementation(() => {
      const obj: Record<string, unknown> = {
        width: imgWidth,
        height: imgHeight,
        src: '',
        onload: null as (() => void) | null,
      };
      // Use a setter so that when `src` is assigned the onload fires
      Object.defineProperty(obj, 'src', {
        set(_val: string) {
          // Fire onload synchronously on next microtask
          Promise.resolve().then(() => {
            if (typeof obj.onload === 'function') obj.onload();
          });
        },
        get() {
          return '';
        },
        configurable: true,
      });
      return obj;
    })
  );
}

describe('useImageCentering', () => {
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 20;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when containerRef is null', async () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const nullRef = { current: null } as React.RefObject<HTMLDivElement>;
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useImageCentering(
        nullRef,
        '/img.png',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    await act(async () => {
      result.current.centerImage();
      await Promise.resolve();
    });

    expect(setZoom).not.toHaveBeenCalled();
    expect(setOffset).not.toHaveBeenCalled();
  });

  it('does nothing when imageSrc is empty', async () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(800, 600);
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useImageCentering(
        containerRef,
        '',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    await act(async () => {
      result.current.centerImage();
      await Promise.resolve();
    });

    expect(setZoom).not.toHaveBeenCalled();
    expect(setOffset).not.toHaveBeenCalled();
  });

  it('uses width-constrained zoom for a landscape image wider than container ratio', async () => {
    // container 400x300 (ratio 1.33), image 1000x200 (ratio 5)
    // imgRatio > containerRatio → width-constrained
    // zoom = (400 * 0.8) / 1000 = 0.32
    stubImage(1000, 200);
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(400, 300);
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useImageCentering(
        containerRef,
        '/img.png',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    await act(async () => {
      result.current.centerImage();
      await Promise.resolve();
      await Promise.resolve(); // two microtask ticks for the Image src setter
    });

    expect(setZoom).toHaveBeenCalledWith(expect.closeTo(0.32, 5));
  });

  it('uses height-constrained zoom for a portrait image taller than container ratio', async () => {
    // container 400x300 (ratio 1.33), image 200x800 (ratio 0.25)
    // imgRatio < containerRatio → height-constrained
    // zoom = (300 * 0.8) / 800 = 0.3
    stubImage(200, 800);
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(400, 300);
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useImageCentering(
        containerRef,
        '/img.png',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    await act(async () => {
      result.current.centerImage();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setZoom).toHaveBeenCalledWith(expect.closeTo(0.3, 5));
  });

  it('clamps zoom to MAX_ZOOM for a very small image', async () => {
    // container 800x600, image 1x1 → raw zoom = 640 → clamped to MAX_ZOOM (20)
    stubImage(1, 1);
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(800, 600);
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useImageCentering(
        containerRef,
        '/img.png',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    await act(async () => {
      result.current.centerImage();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setZoom).toHaveBeenCalledWith(MAX_ZOOM);
  });

  it('clamps zoom to MIN_ZOOM for a very large image', async () => {
    // container 400x300, image 100000x100000 → raw zoom ≈ 0.0024 → clamped to MIN_ZOOM (0.05)
    stubImage(100000, 100000);
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(400, 300);
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useImageCentering(
        containerRef,
        '/img.png',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    await act(async () => {
      result.current.centerImage();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setZoom).toHaveBeenCalledWith(MIN_ZOOM);
  });

  it('computes centered offset so the image is centered within the container', async () => {
    // container 400x300, image 200x150, zoom = (400*0.8)/200 = 1.6
    // (imgRatio = 200/150 ≈ 1.33 == containerRatio 400/300 ≈ 1.33 — use width-constrained branch)
    // centerX = (400/1.6 - 200) / 2 = (250 - 200) / 2 = 25
    // centerY = (300/1.6 - 150) / 2 = (187.5 - 150) / 2 = 18.75
    stubImage(200, 150);
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(400, 300);
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useImageCentering(
        containerRef,
        '/img.png',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    await act(async () => {
      result.current.centerImage();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setOffset).toHaveBeenCalledTimes(1);
    const { x, y } = setOffset.mock.calls[0][0] as { x: number; y: number };
    expect(x).toBeCloseTo(25, 4);
    expect(y).toBeCloseTo(18.75, 4);
  });

  it('sets imageRef.current to the created Image', async () => {
    stubImage(800, 600);
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(800, 600);
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result } = renderHook(() =>
      useImageCentering(
        containerRef,
        '/img.png',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    await act(async () => {
      result.current.centerImage();
      // After synchronous centerImage call, imageRef should already be set
    });

    expect(imgRef.current).not.toBeNull();
  });

  it('returns a stable centerImage reference across re-renders', () => {
    const setZoom = vi.fn();
    const setOffset = vi.fn();
    const containerRef = makeContainerRef(800, 600);
    const imgRef = {
      current: null,
    } as React.MutableRefObject<HTMLImageElement | null>;

    const { result, rerender } = renderHook(() =>
      useImageCentering(
        containerRef,
        '/img.png',
        imgRef,
        setZoom,
        setOffset,
        MIN_ZOOM,
        MAX_ZOOM
      )
    );

    const fn1 = result.current.centerImage;
    rerender();
    expect(result.current.centerImage).toBe(fn1);
  });
});
