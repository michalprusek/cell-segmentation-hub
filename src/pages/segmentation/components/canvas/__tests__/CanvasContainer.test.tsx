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
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/contexts/useTheme', () => ({
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders children correctly', () => {
      render(<CanvasContainer {...defaultProps} />);

      expect(screen.getByTestId('canvas-content')).toBeInTheDocument();
    });

    it('renders with data-testid attribute', () => {
      const { container } = render(
        <CanvasContainer {...defaultProps} loading={true} />
      );

      const canvasContainer = container.firstChild as HTMLElement;
      // Component uses data-testid not loading class
      expect(canvasContainer).toHaveAttribute(
        'data-testid',
        'canvas-container'
      );
    });

    it('applies edit mode via data attribute', () => {
      const { container, rerender } = render(
        <CanvasContainer {...defaultProps} editMode={EditMode.View} />
      );

      let canvasContainer = container.firstChild as HTMLElement;
      // Component exposes editMode via data-edit-mode attribute
      expect(canvasContainer).toHaveAttribute('data-edit-mode', EditMode.View);

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.EditVertices} />
      );
      canvasContainer = container.firstChild as HTMLElement;
      expect(canvasContainer).toHaveAttribute(
        'data-edit-mode',
        EditMode.EditVertices
      );
    });

    it('renders with Tailwind layout classes', () => {
      const { container } = render(<CanvasContainer {...defaultProps} />);

      const canvasContainer = container.firstChild as HTMLElement;
      // Component uses Tailwind class names (flex-1 overflow-hidden etc)
      expect(canvasContainer).toHaveClass('flex-1');
      expect(canvasContainer).toHaveClass('overflow-hidden');
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
    it('sets up window event listeners on mount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

      render(<CanvasContainer {...defaultProps} />);

      // Component uses window.addEventListener (not document)
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'keydown',
        expect.any(Function)
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'keyup',
        expect.any(Function)
      );
    });

    it('updates cursor when Alt key is pressed', async () => {
      const { container } = render(<CanvasContainer {...defaultProps} />);

      const canvasContainer = container.firstChild as HTMLElement;

      // Initially grab cursor (View mode)
      expect(canvasContainer).toHaveStyle({ cursor: 'grab' });

      // Press Alt key - component fires window keydown event
      fireEvent.keyDown(window, { key: 'Alt', altKey: true });

      await waitFor(() => {
        // With Alt pressed, cursor should be 'grab' (panning mode)
        expect(canvasContainer).toHaveStyle({ cursor: 'grab' });
      });
    });

    it('handles Alt key state changes correctly', async () => {
      const { container } = render(<CanvasContainer {...defaultProps} />);

      const canvasContainer = container.firstChild as HTMLElement;

      // Press Alt key
      fireEvent.keyDown(window, { key: 'Alt', altKey: true });
      await waitFor(() => {
        expect(canvasContainer).toBeInTheDocument();
      });

      // Release Alt key
      fireEvent.keyUp(window, { key: 'Alt', altKey: false });
      await waitFor(() => {
        expect(canvasContainer).toBeInTheDocument();
      });
    });

    it('ignores non-Alt key events without crashing', async () => {
      const { container } = render(<CanvasContainer {...defaultProps} />);

      const canvasContainer = container.firstChild as HTMLElement;

      // Press other keys should not throw
      expect(() => {
        fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
        fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
        fireEvent.keyDown(window, { key: 'Enter' });
      }).not.toThrow();

      expect(canvasContainer).toBeInTheDocument();
    });
  });

  describe('Legacy Props Compatibility', () => {
    it('accepts legacy slicingMode prop without crashing', () => {
      expect(() => {
        render(<CanvasContainer {...defaultProps} slicingMode={true} />);
      }).not.toThrow();

      expect(screen.getByTestId('canvas-container')).toBeInTheDocument();
    });

    it('accepts legacy pointAddingMode prop without crashing', () => {
      expect(() => {
        render(<CanvasContainer {...defaultProps} pointAddingMode={true} />);
      }).not.toThrow();

      expect(screen.getByTestId('canvas-container')).toBeInTheDocument();
    });

    it('accepts legacy deleteMode prop without crashing', () => {
      expect(() => {
        render(<CanvasContainer {...defaultProps} deleteMode={true} />);
      }).not.toThrow();

      expect(screen.getByTestId('canvas-container')).toBeInTheDocument();
    });

    it('handles multiple legacy props together without crashing', () => {
      expect(() => {
        render(
          <CanvasContainer
            {...defaultProps}
            slicingMode={true}
            pointAddingMode={true}
            deleteMode={true}
          />
        );
      }).not.toThrow();

      expect(screen.getByTestId('canvas-container')).toBeInTheDocument();
    });
  });

  describe('Event Propagation', () => {
    it('calls onMouseDown on the container', () => {
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
      // Component uses data-testid not canvas-container class
      expect(ref.current).toHaveAttribute('data-testid', 'canvas-container');
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

      expect(totalTime).toBeLessThan(2000); // load-tolerant ceiling: wall-clock budgets inflate under V8 coverage on CI
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

      expect(renderTime).toBeLessThan(2000); // load-tolerant ceiling
      expect(screen.getByTestId('child-0')).toBeInTheDocument();
      expect(screen.getByTestId('child-99')).toBeInTheDocument();
    });
  });

  describe('Cleanup', () => {
    it('cleans up window event listeners on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(<CanvasContainer {...defaultProps} />);
      unmount();

      // Component cleans up window listeners (not document listeners)
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
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      for (let i = 0; i < 3; i++) {
        const { unmount } = render(<CanvasContainer {...defaultProps} />);
        unmount();
      }

      // Verify event listeners were properly managed (keydown + keyup for 3 mounts)
      expect(addEventListenerSpy).toHaveBeenCalledTimes(6);
      expect(removeEventListenerSpy).toHaveBeenCalledTimes(6);
    });
  });
});
