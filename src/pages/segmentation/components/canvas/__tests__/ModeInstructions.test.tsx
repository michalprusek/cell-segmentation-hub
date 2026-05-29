/**
 * ModeInstructions — behavioral unit tests
 *
 * Covered behaviours:
 *  - View mode: renders "View Mode" title and select/navigation instructions
 *  - View mode: auto-hides after 5 seconds (fake timer)
 *  - View mode: dismiss (×) button hides the overlay immediately
 *  - View mode: switching away from View resets visibility
 *  - Slice mode without polygon: shows "select polygon" instruction
 *  - Slice mode with polygon, no temp points: shows "place first point" instruction
 *  - Slice mode with polygon, 1+ temp points: shows "place second point" instruction
 *  - CreatePolygon mode, 0 temp points: shows "start creating a polygon" instruction
 *  - CreatePolygon mode, 1-2 temp points: shows "continue clicking" instruction
 *  - CreatePolygon mode, 3+ temp points: shows "close the polygon" instruction
 *  - AddPoints mode, not adding: shows "click vertex" instruction
 *  - AddPoints mode, isAddingPoints=true: shows "add points" instruction
 *  - EditVertices mode without polygon: shows "select polygon" instruction
 *  - EditVertices mode with polygon: shows "drag vertices" instruction
 *  - DeletePolygon mode: shows "click on a polygon to delete it" instruction
 *  - Shift indicator shown only during CreatePolygon with isShiftPressed=true
 *  - Shift indicator shown during AddPoints + isAddingPoints + isShiftPressed
 *  - Shift indicator NOT shown in View mode with isShiftPressed
 *
 * NOT tested:
 *  - CSS opacity / transition animations (jsdom has no layout engine)
 *  - onMouseEnter/Leave button opacity changes (synthetic hover not reliable)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import ModeInstructions from '../ModeInstructions';
import { EditMode, type InteractionState } from '../../../types';

const defaultInteractionState: InteractionState = {
  isDraggingVertex: false,
  isPanning: false,
  panStart: null,
  draggedVertexInfo: null,
  originalVertexPosition: null,
  sliceStartPoint: null,
  addPointStartVertex: null,
  addPointEndVertex: null,
  isAddingPoints: false,
};

const defaultProps = {
  editMode: EditMode.View,
  interactionState: defaultInteractionState,
  selectedPolygonId: null as string | null,
  tempPoints: [] as { x: number; y: number }[],
  isShiftPressed: false,
};

describe('ModeInstructions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('View mode', () => {
    it('renders View Mode title', () => {
      render(<ModeInstructions {...defaultProps} editMode={EditMode.View} />);
      expect(screen.getByText('View Mode')).toBeInTheDocument();
    });

    it('renders "Click on a polygon to select it" instruction', () => {
      render(<ModeInstructions {...defaultProps} editMode={EditMode.View} />);
      expect(
        screen.getByText('Click on a polygon to select it')
      ).toBeInTheDocument();
    });

    it('renders "Drag to pan" instruction', () => {
      render(<ModeInstructions {...defaultProps} editMode={EditMode.View} />);
      expect(
        screen.getByText('Drag to pan • Scroll to zoom')
      ).toBeInTheDocument();
    });

    it('auto-hides after 5 seconds in View mode', () => {
      render(<ModeInstructions {...defaultProps} editMode={EditMode.View} />);
      expect(screen.getByText('View Mode')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(screen.queryByText('View Mode')).not.toBeInTheDocument();
    });

    it('does not auto-hide before 5 seconds', () => {
      render(<ModeInstructions {...defaultProps} editMode={EditMode.View} />);

      act(() => {
        vi.advanceTimersByTime(4999);
      });

      expect(screen.getByText('View Mode')).toBeInTheDocument();
    });

    it('dismiss button (×) hides the overlay', () => {
      render(<ModeInstructions {...defaultProps} editMode={EditMode.View} />);

      const dismissBtn = screen.getByRole('button');
      fireEvent.click(dismissBtn);

      expect(screen.queryByText('View Mode')).not.toBeInTheDocument();
    });

    it('switching away from View mode resets visibility', () => {
      const { rerender } = render(
        <ModeInstructions {...defaultProps} editMode={EditMode.View} />
      );

      // Auto-hide by timer
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByText('View Mode')).not.toBeInTheDocument();

      // Switch to CreatePolygon
      rerender(
        <ModeInstructions {...defaultProps} editMode={EditMode.CreatePolygon} />
      );
      expect(screen.getByText('Create Polygon Mode')).toBeInTheDocument();
    });
  });

  describe('Slice mode', () => {
    it('without polygon: shows select polygon instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.Slice}
          selectedPolygonId={null}
        />
      );
      expect(
        screen.getByText('1. Click on a polygon to select it for slicing')
      ).toBeInTheDocument();
    });

    it('with polygon, 0 temp points: shows place first point instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.Slice}
          selectedPolygonId="poly-1"
          tempPoints={[]}
        />
      );
      expect(
        screen.getByText('2. Click to place the first slice point')
      ).toBeInTheDocument();
    });

    it('with polygon, 1 temp point: shows place second point instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.Slice}
          selectedPolygonId="poly-1"
          tempPoints={[{ x: 10, y: 20 }]}
        />
      );
      expect(
        screen.getByText(
          '3. Click to place the second slice point and perform slice'
        )
      ).toBeInTheDocument();
    });

    it('Slice mode title is "Slice Mode"', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.Slice}
          selectedPolygonId="poly-1"
        />
      );
      expect(screen.getByText('Slice Mode')).toBeInTheDocument();
    });
  });

  describe('CreatePolygon mode', () => {
    it('0 temp points: shows start creating instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.CreatePolygon}
          tempPoints={[]}
        />
      );
      expect(
        screen.getByText('1. Click to start creating a polygon')
      ).toBeInTheDocument();
    });

    it('1 temp point: shows continue clicking instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.CreatePolygon}
          tempPoints={[{ x: 5, y: 5 }]}
        />
      );
      expect(
        screen.getByText(
          '2. Continue clicking to add more points (at least 3 needed)'
        )
      ).toBeInTheDocument();
    });

    it('3 temp points: shows finish polygon instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.CreatePolygon}
          tempPoints={[
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 10 },
          ]}
        />
      );
      expect(
        screen.getByText(
          /Continue adding points or click near the first point to close the polygon/
        )
      ).toBeInTheDocument();
    });

    it('title is "Create Polygon Mode"', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.CreatePolygon}
          tempPoints={[]}
        />
      );
      expect(screen.getByText('Create Polygon Mode')).toBeInTheDocument();
    });
  });

  describe('AddPoints mode', () => {
    it('not adding: shows click vertex instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.AddPoints}
          interactionState={{
            ...defaultInteractionState,
            isAddingPoints: false,
          }}
        />
      );
      expect(
        screen.getByText('Click on any vertex to start adding points')
      ).toBeInTheDocument();
    });

    it('isAddingPoints=true: shows "Click to add points" instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.AddPoints}
          interactionState={{
            ...defaultInteractionState,
            isAddingPoints: true,
          }}
        />
      );
      expect(
        screen.getByText(/Click to add points, then click on another vertex/)
      ).toBeInTheDocument();
    });

    it('title is "Add Points Mode"', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.AddPoints}
          interactionState={{
            ...defaultInteractionState,
            isAddingPoints: false,
          }}
        />
      );
      expect(screen.getByText('Add Points Mode')).toBeInTheDocument();
    });
  });

  describe('EditVertices mode', () => {
    it('without polygon: shows select polygon instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.EditVertices}
          selectedPolygonId={null}
        />
      );
      expect(
        screen.getByText('Click on a polygon to select it for editing')
      ).toBeInTheDocument();
    });

    it('with polygon: shows drag vertices instruction', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.EditVertices}
          selectedPolygonId="poly-1"
        />
      );
      expect(
        screen.getByText('Click and drag vertices to move them')
      ).toBeInTheDocument();
    });

    it('title is "Edit Vertices Mode"', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.EditVertices}
          selectedPolygonId="poly-1"
        />
      );
      expect(screen.getByText('Edit Vertices Mode')).toBeInTheDocument();
    });
  });

  describe('DeletePolygon mode', () => {
    it('shows "Click on a polygon to delete it" instruction', () => {
      render(
        <ModeInstructions {...defaultProps} editMode={EditMode.DeletePolygon} />
      );
      expect(
        screen.getByText('Click on a polygon to delete it')
      ).toBeInTheDocument();
    });

    it('title is "Delete Polygon Mode"', () => {
      render(
        <ModeInstructions {...defaultProps} editMode={EditMode.DeletePolygon} />
      );
      expect(screen.getByText('Delete Polygon Mode')).toBeInTheDocument();
    });

    it('no dismiss button in DeletePolygon mode (only in View mode)', () => {
      render(
        <ModeInstructions {...defaultProps} editMode={EditMode.DeletePolygon} />
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('Shift indicator', () => {
    it('shown during CreatePolygon with isShiftPressed=true', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.CreatePolygon}
          isShiftPressed={true}
          tempPoints={[{ x: 0, y: 0 }]}
        />
      );
      expect(screen.getByText(/SHIFT: Auto-adding points/)).toBeInTheDocument();
    });

    it('shown during AddPoints with isAddingPoints=true and isShiftPressed=true', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.AddPoints}
          interactionState={{
            ...defaultInteractionState,
            isAddingPoints: true,
          }}
          isShiftPressed={true}
        />
      );
      expect(screen.getByText(/SHIFT: Auto-adding points/)).toBeInTheDocument();
    });

    it('NOT shown in View mode even with isShiftPressed=true', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.View}
          isShiftPressed={true}
        />
      );
      expect(
        screen.queryByText(/SHIFT: Auto-adding points/)
      ).not.toBeInTheDocument();
    });

    it('NOT shown during CreatePolygon when isShiftPressed=false', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.CreatePolygon}
          isShiftPressed={false}
        />
      );
      expect(
        screen.queryByText(/SHIFT: Auto-adding points/)
      ).not.toBeInTheDocument();
    });

    it('NOT shown during AddPoints without isAddingPoints even with shift', () => {
      render(
        <ModeInstructions
          {...defaultProps}
          editMode={EditMode.AddPoints}
          interactionState={{
            ...defaultInteractionState,
            isAddingPoints: false,
          }}
          isShiftPressed={true}
        />
      );
      expect(
        screen.queryByText(/SHIFT: Auto-adding points/)
      ).not.toBeInTheDocument();
    });
  });
});
