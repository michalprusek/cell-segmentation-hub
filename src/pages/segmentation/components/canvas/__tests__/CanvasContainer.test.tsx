/**
 * Tests for CanvasContainer component
 * Tests container interactions, keyboard handling, and event propagation
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from '@/test-utils/reactTestUtils';
import CanvasContainer from '../CanvasContainer';
import { EditMode } from '../../../types';

// Mock theme context
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
  }),
}));

describe('CanvasContainer', () => {
  const mockHandlers = {
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    onWheel: vi.fn(),
  };

  const defaultProps = {
    ...mockHandlers,
    children: <div data-testid="canvas-content">Canvas Content</div>,
    loading: false,
    editMode: EditMode.View,
  };

  let originalAddEventListener: typeof document.addEventListener;
  let originalRemoveEventListener: typeof document.removeEventListener;

  beforeEach(() => {
    vi.clearAllMocks();

    // Save original event listeners
    originalAddEventListener = document.addEventListener;
    originalRemoveEventListener = document.removeEventListener;

    // Mock addEventListener and removeEventListener
    Object.defineProperty(document, 'addEventListener', {
      value: vi.fn(),
      writable: true,
    });
    Object.defineProperty(document, 'removeEventListener', {
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    // Restore original event listeners
    Object.defineProperty(document, 'addEventListener', {
      value: originalAddEventListener,
      writable: true,
    });
    Object.defineProperty(document, 'removeEventListener', {
      value: originalRemoveEventListener,
      writable: true,
    });
  });

  describe('Basic Rendering', () => {
    it('renders children correctly', () => {
      render(<CanvasContainer {...defaultProps} />);

      expect(screen.getByTestId('canvas-content')).toBeInTheDocument();
    });

    it('applies loading state correctly', () => {
      const { container } = render(
        <CanvasContainer {...defaultProps} loading={true} />
      );

      const canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveClass('loading');
    });

    it('applies edit mode classes correctly', () => {
      const { container, rerender } = render(
        <CanvasContainer {...defaultProps} editMode={EditMode.View} />
      );

      let canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveClass('view-mode');

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.EditVertices} />
      );
      canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveClass('edit-vertices-mode');
    });

    it('handles different themes correctly', () => {
      const { container } = render(<CanvasContainer {...defaultProps} />);

      const canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveClass('theme-light');
    });
  });

  describe('Mouse Event Handling', () => {
    it('calls onMouseDown when mouse is pressed', () => {
      const onMouseDown = vi.fn();
      render(<CanvasContainer {...defaultProps} onMouseDown={onMouseDown} />);

      const container = screen.getByTestId('canvas-content').parentElement!;
      fireEvent.mouseDown(container, { clientX: 100, clientY: 50 });

      expect(onMouseDown).toHaveBeenCalledWith(
        expect.objectContaining({
          clientX: 100,
          clientY: 50,
        })
      );
    });

    it('calls onMouseMove when mouse moves', () => {
      const onMouseMove = vi.fn();
      render(<CanvasContainer {...defaultProps} onMouseMove={onMouseMove} />);

      const container = screen.getByTestId('canvas-content').parentElement!;
      fireEvent.mouseMove(container, { clientX: 150, clientY: 75 });

      expect(onMouseMove).toHaveBeenCalledWith(
        expect.objectContaining({
          clientX: 150,
          clientY: 75,
        })
      );
    });

    it('calls onMouseUp when mouse is released', () => {
      const onMouseUp = vi.fn();
      render(<CanvasContainer {...defaultProps} onMouseUp={onMouseUp} />);

      const container = screen.getByTestId('canvas-content').parentElement!;
      fireEvent.mouseUp(container, { clientX: 200, clientY: 100 });

      expect(onMouseUp).toHaveBeenCalledWith(
        expect.objectContaining({
          clientX: 200,
          clientY: 100,
        })
      );
    });

    it('calls onWheel when wheel event occurs', () => {
      const onWheel = vi.fn();
      render(<CanvasContainer {...defaultProps} onWheel={onWheel} />);

      const container = screen.getByTestId('canvas-content').parentElement!;
      fireEvent.wheel(container, { deltaY: -100 });

      expect(onWheel).toHaveBeenCalledWith(
        expect.objectContaining({
          deltaY: -100,
        })
      );
    });

    it('handles mouse event sequence correctly', () => {
      const handlers = {
        onMouseDown: vi.fn(),
        onMouseMove: vi.fn(),
        onMouseUp: vi.fn(),
      };

      render(<CanvasContainer {...defaultProps} {...handlers} />);

      const container = screen.getByTestId('canvas-content').parentElement!;

      // Simulate a drag sequence
      fireEvent.mouseDown(container, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(container, { clientX: 20, clientY: 20 });
      fireEvent.mouseMove(container, { clientX: 30, clientY: 30 });
      fireEvent.mouseUp(container, { clientX: 30, clientY: 30 });

      expect(handlers.onMouseDown).toHaveBeenCalledTimes(1);
      expect(handlers.onMouseMove).toHaveBeenCalledTimes(2);
      expect(handlers.onMouseUp).toHaveBeenCalledTimes(1);
    });
  });

  describe('Keyboard Event Handling', () => {
    it('sets up document event listeners on mount', () => {
      render(<CanvasContainer {...defaultProps} />);

      expect(document.addEventListener).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
      expect(document.addEventListener).toHaveBeenCalledWith(
        'keyup',
        expect.any(Function)
      );
    });

    it('tracks Alt key press state', async () => {
      const { container } = render(<CanvasContainer {...defaultProps} />);

      const canvasContainer = container.firstChild as HTMLElement;

      // Initially should not have alt-pressed class
      expect(canvasContainer).not.toHaveClass('alt-pressed');

      // Press Alt key
      fireEvent.keyDown(document, { key: 'Alt', altKey: true });

      await waitFor(() => {
        expect(canvasContainer).toHaveClass('alt-pressed');
      });

      // Release Alt key
      fireEvent.keyUp(document, { key: 'Alt', altKey: false });

      await waitFor(() => {
        expect(canvasContainer).not.toHaveClass('alt-pressed');
      });
    });

    it('handles Alt key state changes correctly', async () => {
      const { container } = render(<CanvasContainer {...defaultProps} />);

      const canvasContainer = container.firstChild as HTMLElement;

      // Multiple Alt key presses should work correctly
      fireEvent.keyDown(document, { key: 'Alt', altKey: true });
      await waitFor(() => {
        expect(canvasContainer).toHaveClass('alt-pressed');
      });

      fireEvent.keyDown(document, { key: 'Alt', altKey: true }); // Second press
      await waitFor(() => {
        expect(canvasContainer).toHaveClass('alt-pressed'); // Should still be pressed
      });

      fireEvent.keyUp(document, { key: 'Alt', altKey: false });
      await waitFor(() => {
        expect(canvasContainer).not.toHaveClass('alt-pressed');
      });
    });

    it('ignores non-Alt key events', async () => {
      const { container } = render(<CanvasContainer {...defaultProps} />);

      const canvasContainer = container.firstChild as HTMLElement;

      // Press other keys should not affect Alt state
      fireEvent.keyDown(document, { key: 'Control', ctrlKey: true });
      fireEvent.keyDown(document, { key: 'Shift', shiftKey: true });
      fireEvent.keyDown(document, { key: 'Enter' });

      expect(canvasContainer).not.toHaveClass('alt-pressed');
    });
  });

  describe('Legacy Props Compatibility', () => {
    it('handles legacy slicingMode prop', () => {
      const { container } = render(
        <CanvasContainer {...defaultProps} slicingMode={true} />
      );

      const canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveClass('slicing-mode');
    });

    it('handles legacy pointAddingMode prop', () => {
      const { container } = render(
        <CanvasContainer {...defaultProps} pointAddingMode={true} />
      );

      const canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveClass('point-adding-mode');
    });

    it('handles legacy deleteMode prop', () => {
      const { container } = render(
        <CanvasContainer {...defaultProps} deleteMode={true} />
      );

      const canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveClass('delete-mode');
    });

    it('handles multiple legacy props together', () => {
      const { container } = render(
        <CanvasContainer
          {...defaultProps}
          slicingMode={true}
          pointAddingMode={true}
          deleteMode={true}
        />
      );

      const canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveClass('slicing-mode');
      expect(canvasContainer).toHaveClass('point-adding-mode');
      expect(canvasContainer).toHaveClass('delete-mode');
    });
  });

  describe('Event Propagation', () => {
    it('prevents event propagation when appropriate', () => {
      const parentClickHandler = vi.fn();
      const onMouseDown = vi.fn();

      render(
        <div onClick={parentClickHandler}>
          <CanvasContainer {...defaultProps} onMouseDown={onMouseDown} />
        </div>
      );

      const container = screen.getByTestId('canvas-content').parentElement!;
      fireEvent.mouseDown(container);

      expect(onMouseDown).toHaveBeenCalled();
      // Parent handler should not be called due to event handling
      expect(parentClickHandler).not.toHaveBeenCalled();
    });

    it('handles rapid event sequences without issues', () => {
      const onMouseMove = vi.fn();
      render(<CanvasContainer {...defaultProps} onMouseMove={onMouseMove} />);

      const container = screen.getByTestId('canvas-content').parentElement!;

      // Simulate rapid mouse movements
      for (let i = 0; i < 50; i++) {
        fireEvent.mouseMove(container, { clientX: i, clientY: i });
      }

      expect(onMouseMove).toHaveBeenCalledTimes(50);
    });
  });

  describe('Ref Forwarding', () => {
    it('forwards ref correctly', () => {
      const ref = React.createRef<HTMLDivElement>();

      render(<CanvasContainer {...defaultProps} ref={ref} />);

      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current).toHaveClass('canvas-container');
    });

    it('ref points to the correct element', () => {
      const ref = React.createRef<HTMLDivElement>();

      render(<CanvasContainer {...defaultProps} ref={ref} />);

      const container = screen.getByTestId('canvas-content').parentElement!;
      expect(ref.current).toBe(container);
    });
  });

  describe('Performance', () => {
    it('handles rapid re-renders efficiently', () => {
      const { rerender } = render(<CanvasContainer {...defaultProps} />);

      const startTime = performance.now();
      for (let i = 0; i < 20; i++) {
        rerender(
          <CanvasContainer
            {...defaultProps}
            editMode={i % 2 === 0 ? EditMode.View : EditMode.EditVertices}
          />
        );
      }
      const totalTime = performance.now() - startTime;

      expect(totalTime).toBeLessThan(100); // Should handle re-renders efficiently
    });

    it('handles many child elements efficiently', () => {
      const manyChildren = Array.from({ length: 100 }, (_, i) => (
        <div key={i} data-testid={`child-${i}`}>
          Child {i}
        </div>
      ));

      const startTime = performance.now();
      render(
        <CanvasContainer {...defaultProps}>{manyChildren}</CanvasContainer>
      );
      const renderTime = performance.now() - startTime;

      expect(renderTime).toBeLessThan(100);
      expect(screen.getByTestId('child-0')).toBeInTheDocument();
      expect(screen.getByTestId('child-99')).toBeInTheDocument();
    });
  });

  describe('Cleanup', () => {
    it('cleans up event listeners on unmount', () => {
      const { unmount } = render(<CanvasContainer {...defaultProps} />);

      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'keyup',
        expect.any(Function)
      );
    });

    it('handles multiple mount/unmount cycles correctly', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      for (let i = 0; i < 3; i++) {
        const { unmount } = render(<CanvasContainer {...defaultProps} />);
        unmount();
      }

      // Verify event listeners were properly managed
      expect(addEventListenerSpy).toHaveBeenCalledTimes(6); // keydown + keyup for 3 mounts
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(6); // keydown + keyup for 3 unmounts
    });
  });
});
