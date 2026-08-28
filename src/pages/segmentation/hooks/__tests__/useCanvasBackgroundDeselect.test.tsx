/**
 * Empty-canvas click clears the selection; a pan does not.
 *
 * The second half is the whole reason this hook exists. A browser fires `click`
 * whenever mousedown and mouseup land on the same element however far the
 * pointer travelled, and the pan gesture begins and ends on exactly the SVG
 * background the deselect listens to — so a plain `onClick` throws away a
 * Shift-built multi-selection every time the user drags the image.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import {
  useCanvasBackgroundDeselect,
  CLICK_MOVE_TOLERANCE_PX,
} from '../useCanvasBackgroundDeselect';

const onDeselect = vi.fn();

function Harness({ enabled = true }: { enabled?: boolean }) {
  const handlers = useCanvasBackgroundDeselect({ onDeselect, enabled });
  return (
    <div data-testid="background" {...handlers}>
      <button data-testid="polygon" type="button">
        polygon
      </button>
    </div>
  );
}

/** One press-and-release gesture, in page coordinates. */
function gesture(
  target: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  releaseOn: HTMLElement = target
) {
  fireEvent.mouseDown(target, { button: 0, clientX: from.x, clientY: from.y });
  fireEvent.click(releaseOn, { button: 0, clientX: to.x, clientY: to.y });
}

describe('useCanvasBackgroundDeselect', () => {
  beforeEach(() => {
    onDeselect.mockClear();
  });

  it('clears the selection on a click that does not move', () => {
    render(<Harness />);
    const bg = screen.getByTestId('background');
    gesture(bg, { x: 100, y: 100 }, { x: 100, y: 100 });
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('tolerates a few pixels of tremor between press and release', () => {
    render(<Harness />);
    const bg = screen.getByTestId('background');
    gesture(
      bg,
      { x: 100, y: 100 },
      { x: 100 + CLICK_MOVE_TOLERANCE_PX, y: 100 }
    );
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('does NOT clear after a pan drag that ends on the background', () => {
    render(<Harness />);
    const bg = screen.getByTestId('background');
    gesture(bg, { x: 100, y: 100 }, { x: 260, y: 180 });
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('ignores a press that started on a polygon', () => {
    render(<Harness />);
    const bg = screen.getByTestId('background');
    const polygon = screen.getByTestId('polygon');
    // mousedown on the child, release bubbling up to the background.
    fireEvent.mouseDown(polygon, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.click(bg, { button: 0, clientX: 10, clientY: 10 });
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('ignores a release that lands on a polygon', () => {
    render(<Harness />);
    const bg = screen.getByTestId('background');
    const polygon = screen.getByTestId('polygon');
    gesture(bg, { x: 10, y: 10 }, { x: 10, y: 10 }, polygon);
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('ignores a non-primary button press', () => {
    render(<Harness />);
    const bg = screen.getByTestId('background');
    fireEvent.mouseDown(bg, { button: 2, clientX: 10, clientY: 10 });
    fireEvent.click(bg, { button: 0, clientX: 10, clientY: 10 });
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('does nothing while disabled (point-placement modes)', () => {
    render(<Harness enabled={false} />);
    const bg = screen.getByTestId('background');
    gesture(bg, { x: 10, y: 10 }, { x: 10, y: 10 });
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it('does not let one gesture arm the next click', () => {
    // A click with no press of its own (e.g. synthesised, or the release of a
    // gesture that began outside) must not inherit the previous origin.
    render(<Harness />);
    const bg = screen.getByTestId('background');
    gesture(bg, { x: 10, y: 10 }, { x: 10, y: 10 });
    expect(onDeselect).toHaveBeenCalledTimes(1);

    fireEvent.click(bg, { button: 0, clientX: 10, clientY: 10 });
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it('keeps the handler identities stable across re-renders', () => {
    // They sit on the canvas subtree whose children are memoized; a fresh
    // identity every render is how comparators start missing.
    const seen: Array<(e: React.MouseEvent) => void> = [];
    function Probe({ enabled }: { enabled: boolean }) {
      const h = useCanvasBackgroundDeselect({ onDeselect, enabled });
      seen.push(h.onClick);
      return null;
    }
    const { rerender } = render(<Probe enabled />);
    rerender(<Probe enabled={false} />);
    expect(new Set(seen).size).toBe(1);
  });
});
