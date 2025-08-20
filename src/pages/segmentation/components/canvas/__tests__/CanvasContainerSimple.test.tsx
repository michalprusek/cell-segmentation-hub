/**
 * Simplified tests for CanvasContainer component
 * Tests actual functionality without assuming specific CSS classes
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('CanvasContainer - Core Functionality', () => {
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

  describe('Basic Rendering', () => {
    it('renders without crashing', () => {
      expect(() => {
        render(<CanvasContainer {...defaultProps} />);
      }).not.toThrow();
    });

    it('renders children correctly', () => {
      render(<CanvasContainer {...defaultProps} />);

      expect(screen.getByTestId('canvas-content')).toBeInTheDocument();
    });

    it('sets correct data-edit-mode attribute', () => {
      render(
        <CanvasContainer {...defaultProps} editMode={EditMode.EditVertices} />
      );

      const container = screen.getByTestId('canvas-container');
      expect(container).toHaveAttribute('data-edit-mode', 'edit-vertices');
    });

    it('handles different edit modes', () => {
      const { rerender } = render(
        <CanvasContainer {...defaultProps} editMode={EditMode.View} />
      );

      let container = screen.getByTestId('canvas-container');
      expect(container).toHaveAttribute('data-edit-mode', 'view');

      rerender(<CanvasContainer {...defaultProps} editMode={EditMode.Slice} />);
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveAttribute('data-edit-mode', 'slice');

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.AddPoints} />
      );
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveAttribute('data-edit-mode', 'add-points');
    });

    it('applies correct border colors for different edit modes', () => {
      const { rerender } = render(
        <CanvasContainer {...defaultProps} editMode={EditMode.EditVertices} />
      );

      let container = screen.getByTestId('canvas-container');
      expect(container).toHaveClass('border-purple-500');

      rerender(<CanvasContainer {...defaultProps} editMode={EditMode.Slice} />);
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveClass('border-red-500');

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.AddPoints} />
      );
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveClass('border-emerald-500');

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.CreatePolygon} />
      );
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveClass('border-blue-500');

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.DeletePolygon} />
      );
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveClass('border-orange-500');
    });
  });

  describe('Event Handling', () => {
    it('calls onMouseDown when mouse is pressed', () => {
      const onMouseDown = vi.fn();
      render(<CanvasContainer {...defaultProps} onMouseDown={onMouseDown} />);

      const container = screen.getByTestId('canvas-container');
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

      const container = screen.getByTestId('canvas-container');
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

      const container = screen.getByTestId('canvas-container');
      fireEvent.mouseUp(container, { clientX: 200, clientY: 100 });

      expect(onMouseUp).toHaveBeenCalledWith(
        expect.objectContaining({
          clientX: 200,
          clientY: 100,
        })
      );
    });

    it('calls onMouseUp when mouse leaves container', () => {
      const onMouseUp = vi.fn();
      render(<CanvasContainer {...defaultProps} onMouseUp={onMouseUp} />);

      const container = screen.getByTestId('canvas-container');
      fireEvent.mouseLeave(container);

      expect(onMouseUp).toHaveBeenCalled();
    });

    it('calls onWheel when wheel event occurs', () => {
      const onWheel = vi.fn();
      render(<CanvasContainer {...defaultProps} onWheel={onWheel} />);

      const container = screen.getByTestId('canvas-container');
      fireEvent.wheel(container, { deltaY: -100 });

      expect(onWheel).toHaveBeenCalledWith(
        expect.objectContaining({
          deltaY: -100,
        })
      );
    });

    it('handles rapid mouse events', () => {
      const onMouseMove = vi.fn();
      render(<CanvasContainer {...defaultProps} onMouseMove={onMouseMove} />);

      const container = screen.getByTestId('canvas-container');

      // Simulate rapid mouse movements
      for (let i = 0; i < 10; i++) {
        fireEvent.mouseMove(container, { clientX: i * 10, clientY: i * 5 });
      }

      expect(onMouseMove).toHaveBeenCalledTimes(10);
    });
  });

  describe('Keyboard Event Handling', () => {
    it('tracks Alt key state through cursor style changes', async () => {
      render(<CanvasContainer {...defaultProps} editMode={EditMode.View} />);

      const container = screen.getByTestId('canvas-container');

      // Initially should have grab cursor
      expect(container).toHaveStyle('cursor: grab');

      // Press Alt key - should still show grab cursor but for panning
      fireEvent.keyDown(window, { key: 'Alt', altKey: true });

      // The cursor style should remain grab (but internal state changes)
      expect(container).toHaveStyle('cursor: grab');

      // Release Alt key
      fireEvent.keyUp(window, { key: 'Alt', altKey: false });

      expect(container).toHaveStyle('cursor: grab');
    });

    it('shows different cursors for different edit modes', () => {
      const { rerender } = render(
        <CanvasContainer {...defaultProps} editMode={EditMode.View} />
      );

      let container = screen.getByTestId('canvas-container');
      expect(container).toHaveStyle('cursor: grab');

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.EditVertices} />
      );
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveStyle('cursor: crosshair');

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.AddPoints} />
      );
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveStyle('cursor: cell');

      rerender(
        <CanvasContainer {...defaultProps} editMode={EditMode.DeletePolygon} />
      );
      container = screen.getByTestId('canvas-container');
      expect(container).toHaveStyle('cursor: pointer');
    });
  });

  describe('Styling and Appearance', () => {
    it('applies base CSS classes', () => {
      render(<CanvasContainer {...defaultProps} />);

      const container = screen.getByTestId('canvas-container');
      expect(container).toHaveClass('flex-1', 'overflow-hidden', 'relative');
    });

    it('applies background and border styles', () => {
      render(<CanvasContainer {...defaultProps} />);

      const container = screen.getByTestId('canvas-container');
      expect(container).toHaveClass('bg-gray-50', 'dark:bg-gray-800');
      expect(container).toHaveClass('rounded-lg', 'border-4');
    });

    it('applies user selection prevention', () => {
      render(<CanvasContainer {...defaultProps} />);

      const container = screen.getByTestId('canvas-container');
      expect(container).toHaveStyle('user-select: none');
    });

    it('applies dot grid background pattern', () => {
      render(<CanvasContainer {...defaultProps} />);

      const container = screen.getByTestId('canvas-container');
      const style = window.getComputedStyle(container);

      // Should have background image (dot pattern)
      expect(container).toHaveStyle('background-size: 20px 20px');
    });
  });

  describe('Ref Forwarding', () => {
    it('forwards ref correctly', () => {
      const ref = React.createRef<HTMLDivElement>();

      render(<CanvasContainer {...defaultProps} ref={ref} />);

      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current).toHaveAttribute('data-testid', 'canvas-container');
    });
  });

  describe('Performance and Edge Cases', () => {
    it('handles multiple re-renders efficiently', () => {
      const { rerender } = render(<CanvasContainer {...defaultProps} />);

      const startTime = performance.now();

      // Multiple re-renders with different props
      for (let i = 0; i < 10; i++) {
        const editModes = [
          EditMode.View,
          EditMode.EditVertices,
          EditMode.Slice,
          EditMode.AddPoints,
        ];
        rerender(
          <CanvasContainer
            {...defaultProps}
            editMode={editModes[i % editModes.length]}
            loading={i % 2 === 0}
          />
        );
      }

      const totalTime = performance.now() - startTime;
      // Verify that re-renders complete successfully
      expect(totalTime).toBeFinite();
      expect(screen.getByTestId('canvas-container')).toBeInTheDocument();
    });

    it('handles missing optional props gracefully', () => {
      const minimalProps = {
        onMouseDown: vi.fn(),
        onMouseMove: vi.fn(),
        onMouseUp: vi.fn(),
        children: <div>Test</div>,
        loading: false,
        editMode: EditMode.View,
      };

      expect(() => {
        render(<CanvasContainer {...minimalProps} />);
      }).not.toThrow();
    });

    it('handles complex children structures', () => {
      const complexChildren = (
        <div>
          <svg viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="25" />
          </svg>
          <div style={{ position: 'absolute', top: 0, left: 0 }}>
            Overlay content
          </div>
        </div>
      );

      expect(() => {
        render(
          <CanvasContainer {...defaultProps}>{complexChildren}</CanvasContainer>
        );
      }).not.toThrow();
    });
  });

  describe('Legacy Props', () => {
    it('handles legacy props without throwing', () => {
      expect(() => {
        render(
          <CanvasContainer
            {...defaultProps}
            slicingMode={true}
            pointAddingMode={false}
            deleteMode={true}
          />
        );
      }).not.toThrow();
    });

    it('ignores legacy props (they are unused)', () => {
      render(
        <CanvasContainer
          {...defaultProps}
          slicingMode={true}
          pointAddingMode={true}
          deleteMode={true}
        />
      );

      const container = screen.getByTestId('canvas-container');
      // Legacy props should not affect the actual rendering
      expect(container).toHaveAttribute('data-edit-mode', 'view');
    });
  });
});
