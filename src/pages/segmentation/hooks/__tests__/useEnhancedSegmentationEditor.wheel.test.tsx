/**
 * useEnhancedSegmentationEditor — the wheel-zoom WIRING.
 *
 * `utils/wheelZoom.ts` is unit-tested on its own. What can still be wrong is
 * what reaches it and what comes back: whether the listener is attached,
 * which point is the anchor, whether two events of one frame are folded, and
 * whether the hook's real `calculateFixedPointZoom` keeps the cursor fixed.
 * So `@/lib/coordinateUtils` is NOT mocked here (the main suite mocks it).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { useEnhancedSegmentationEditor } from '../useEnhancedSegmentationEditor';
import { canvasToImageCoordinates } from '@/lib/coordinateUtils';
import type { TransformState } from '../../types';

vi.mock('../useAdvancedInteractions', () => ({
  useAdvancedInteractions: vi.fn(() => ({
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    handleCreatePolylineDoubleClick: vi.fn(),
  })),
}));
vi.mock('../usePolygonSlicing', () => ({
  usePolygonSlicing: vi.fn(() => ({
    startSlicing: vi.fn(),
    completeSlicing: vi.fn(),
    handleSliceAction: vi.fn().mockResolvedValue(true),
  })),
}));
vi.mock('../useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: vi.fn(() => ({
    isShiftPressed: false,
    isCtrlPressed: false,
    isAltPressed: false,
    isSpacePressed: false,
  })),
}));
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'id'),
    dismiss: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The canvas container on screen: 800 x 600 at (100, 50).
const RECT = { left: 100, top: 50, width: 800, height: 600 };
const PROPS = {
  initialPolygons: [],
  imageWidth: 1024,
  imageHeight: 1024,
  canvasWidth: RECT.width,
  canvasHeight: RECT.height,
};

let current: TransformState;
let commits: number;

function Harness() {
  const editor = useEnhancedSegmentationEditor(PROPS);
  current = editor.transform;
  commits++;
  return <div ref={editor.canvasRef} data-testid="canvas" />;
}

/** The image point under a viewport position, for the current transform. */
const imagePointAt = (clientX: number, clientY: number, t: TransformState) =>
  canvasToImageCoordinates(
    {
      x: clientX - RECT.left - RECT.width / 2,
      y: clientY - RECT.top - RECT.height / 2,
    },
    t
  );

describe('wheel zoom wiring', () => {
  let frames: FrameRequestCallback[];
  const frame = () =>
    act(() => {
      frames.splice(0).forEach(cb => cb(0));
    });
  const originalGBCR = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    frames = [];
    commits = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        ...RECT,
        x: RECT.left,
        y: RECT.top,
        right: RECT.left + RECT.width,
        bottom: RECT.top + RECT.height,
        toJSON: () => ({}),
      } as DOMRect;
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalGBCR;
    vi.unstubAllGlobals();
  });

  const mount = () => {
    const utils = render(<Harness />);
    // Past the fit zoom (< 1 for a 1024 px image in 800 x 600), where
    // `constrainTransform` leaves the translation alone — so a moved anchor
    // below can only come from the zoom maths.
    const canvas = utils.getByTestId('canvas');
    for (let i = 0; i < 6; i++) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 350 });
      frame();
    }
    expect(current.zoom).toBeGreaterThan(1);
    return canvas;
  };

  it('zooms one notch by exactly 1.2x, anchored at the cursor', () => {
    const canvas = mount();
    const before = current;
    const cursor = { clientX: 731, clientY: 212 };
    const anchored = imagePointAt(cursor.clientX, cursor.clientY, before);

    fireEvent.wheel(canvas, { deltaY: -100, ...cursor });
    // Nothing until the frame.
    expect(current).toBe(before);
    frame();

    expect(current.zoom / before.zoom).toBeCloseTo(1.2, 10);
    const after = imagePointAt(cursor.clientX, cursor.clientY, current);
    expect(after.x).toBeCloseTo(anchored.x, 8);
    expect(after.y).toBeCloseTo(anchored.y, 8);
    // The stored transform is NOT snapped to device pixels: that happens at
    // render, in CanvasContent, or slow pans would be rounded away.
    expect(Number.isInteger(current.translateX)).toBe(false);
  });

  it('folds two notches of one frame into 1.44x and one state update', () => {
    const canvas = mount();
    const before = current;
    const commitsBefore = commits;

    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 350 });
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 350 });
    expect(frames).toHaveLength(1);
    frame();

    // The old handler kept only the last event of a frame: 1.2x.
    expect(current.zoom / before.zoom).toBeCloseTo(1.44, 10);
    expect(commits - commitsBefore).toBe(1);
  });

  it('applies the trailing event of a burst, one frame each', () => {
    const canvas = mount();
    const before = current;
    for (let i = 0; i < 3; i++) {
      fireEvent.wheel(canvas, { deltaY: 100, clientX: 500, clientY: 350 });
      frame();
    }
    expect(current.zoom / before.zoom).toBeCloseTo(1.2 ** -3, 10);
    expect(frames).toHaveLength(0);
  });

  it('gives a trackpad-sized delta a proportionally small step', () => {
    const canvas = mount();
    const before = current;
    fireEvent.wheel(canvas, { deltaY: -4, clientX: 500, clientY: 350 });
    frame();
    // By the sign alone this was a full 1.2x per frame.
    expect(current.zoom / before.zoom).toBeCloseTo(1.2 ** 0.04, 10);
  });

  it('stops at the maximum zoom of 10', () => {
    const canvas = mount();
    for (let i = 0; i < 40; i++) {
      fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 350 });
      frame();
    }
    expect(current.zoom).toBe(10);
  });

  it('prevents the page from scrolling', () => {
    const canvas = mount();
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
