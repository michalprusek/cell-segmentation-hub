/**
 * VerticalToolbar — behavioral unit tests
 *
 * Covered behaviours:
 *  - Renders all 8 mode buttons (View, EditVertices, MoveShape, AddPoints,
 *    CreatePolygon, CreatePolyline, Slice, DeletePolygon)
 *  - Renders zoom-in, zoom-out and reset-view buttons
 *  - Clicking an inactive mode button calls setEditMode with the mode
 *  - Clicking the active mode button calls setEditMode(View) (toggle off)
 *  - EditVertices and AddPoints are disabled when selectedPolygonId=null
 *  - EditVertices and AddPoints are enabled when selectedPolygonId is set
 *  - Orange dot indicator appears on EditVertices/AddPoints when no polygon selected
 *  - All buttons disabled when disabled=true
 *  - Zoom In button calls onZoomIn when clicked
 *  - Zoom Out button calls onZoomOut when clicked
 *  - Reset view button calls onResetView when clicked
 *  - Zoom buttons disabled when disabled=true
 *
 * NOT tested:
 *  - Tooltip opacity (CSS-only hover state, not reliably triggered in jsdom)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import VerticalToolbar from '../VerticalToolbar';
import { EditMode } from '../../types';

// Deliberately NO `projectType`: this file clicks buttons by INDEX, and the
// annotation-geometry gate makes the rail's button count depend on the project
// type. Adding one here would silently shift every index below by one — the
// guard test at the top of the suite exists to make that loud instead. Gate
// behaviour is covered by `VerticalToolbar.geometry.test.tsx`, which asserts on
// accessible names and is neutral to order.
/**
 * The rail's button order, as one map instead of ~15 bare numbers.
 *
 * Every click below is positional (see the note above `defaultProps`), so an
 * inserted button used to mean editing every index by hand — which is how a
 * test ends up quietly clicking its neighbour. Adding a tool is now one line
 * here plus the guard test's expected list.
 */
const IDX = {
  view: 0,
  editVertices: 1,
  moveShape: 2,
  addPoints: 3,
  createPolygon: 4,
  createPolyline: 5,
  slice: 6,
  deletePolygon: 7,
  zoomIn: 8,
  zoomOut: 9,
  resetView: 10,
} as const;

const RAIL_SIZE = Object.keys(IDX).length;

const defaultProps = {
  editMode: EditMode.View,
  selectedPolygonId: null,
  setEditMode: vi.fn(),
  disabled: false,
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onResetView: vi.fn(),
};

describe('VerticalToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the 11-button rail the positional clicks below assume', () => {
    // One named failure here beats a dozen tests quietly clicking the wrong
    // button because the rail gained, lost, or reordered an entry. Only the
    // buttons whose English label is distinctive are named — the two create
    // tools (the pair the annotation-geometry gate can remove) and Move;
    // pinning all eleven English labels would make this fail on any
    // translation edit.
    render(<VerticalToolbar {...defaultProps} />);
    const labels = screen
      .getAllByRole('button')
      .map(b => b.getAttribute('aria-label') ?? '');

    expect(labels).toHaveLength(RAIL_SIZE);
    expect(labels[IDX.moveShape]).toMatch(/move/i);
    expect(labels[IDX.createPolygon]).toMatch(/polygon/i);
    expect(labels[IDX.createPolyline]).toMatch(/polyline/i);
  });

  describe('Rendering', () => {
    it('renders all 8 mode buttons', () => {
      render(<VerticalToolbar {...defaultProps} />);
      // Each button has a title attribute via getModeLabel translations
      // We rely on the button count in the mode section (first 8 ghost icon buttons)
      const allButtons = screen.getAllByRole('button');
      // 8 mode buttons + 3 zoom buttons = 11 minimum
      expect(allButtons.length).toBeGreaterThanOrEqual(RAIL_SIZE);
    });

    it('renders ZoomIn button', () => {
      render(<VerticalToolbar {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      // Zoom buttons are the last 3
      expect(buttons.length).toBeGreaterThanOrEqual(RAIL_SIZE);
    });
  });

  describe('Mode activation', () => {
    it('clicking CreatePolygon button calls setEditMode(CreatePolygon)', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          editMode={EditMode.View}
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.createPolygon]);
      expect(setEditMode).toHaveBeenCalledWith(EditMode.CreatePolygon);
    });

    it('clicking the active mode button calls setEditMode(View) to toggle off', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          editMode={EditMode.CreatePolygon}
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.createPolygon]); // CreatePolygon is active
      expect(setEditMode).toHaveBeenCalledWith(EditMode.View);
    });

    it('clicking CreatePolyline button calls setEditMode(CreatePolyline)', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          editMode={EditMode.View}
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.createPolyline]);
      expect(setEditMode).toHaveBeenCalledWith(EditMode.CreatePolyline);
    });

    it('clicking Slice button calls setEditMode(Slice)', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          editMode={EditMode.View}
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.slice]);
      expect(setEditMode).toHaveBeenCalledWith(EditMode.Slice);
    });

    it('clicking DeletePolygon button calls setEditMode(DeletePolygon)', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          editMode={EditMode.View}
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.deletePolygon]);
      expect(setEditMode).toHaveBeenCalledWith(EditMode.DeletePolygon);
    });

    it('clicking View button when already in View calls setEditMode(View) toggle', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          editMode={EditMode.View}
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.view]); // View is active
      expect(setEditMode).toHaveBeenCalledWith(EditMode.View);
    });
  });

  describe('Selection-required modes', () => {
    it('EditVertices button is disabled when no polygon selected', () => {
      render(<VerticalToolbar {...defaultProps} selectedPolygonId={null} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[IDX.editVertices]).toBeDisabled();
    });

    it('AddPoints button is disabled when no polygon selected', () => {
      render(<VerticalToolbar {...defaultProps} selectedPolygonId={null} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[IDX.addPoints]).toBeDisabled();
    });

    it('EditVertices button is enabled when polygon selected', () => {
      render(<VerticalToolbar {...defaultProps} selectedPolygonId="poly-1" />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[IDX.editVertices]).not.toBeDisabled();
    });

    it('AddPoints button is enabled when polygon selected', () => {
      render(<VerticalToolbar {...defaultProps} selectedPolygonId="poly-1" />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[IDX.addPoints]).not.toBeDisabled();
    });

    it('MoveShape is NOT selection-gated — its drag selects what it grabs', async () => {
      // The mousedown that starts a translate calls onPolygonSelection, so
      // requiring a prior selection would leave the tool greyed out with no
      // way to arm it. This is the pair to the two assertions above.
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          selectedPolygonId={null}
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      expect(buttons[IDX.moveShape]).not.toBeDisabled();
      await user.click(buttons[IDX.moveShape]);
      expect(setEditMode).toHaveBeenCalledWith(EditMode.MoveShape);
    });

    it('clicking disabled EditVertices does NOT call setEditMode', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          selectedPolygonId={null}
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.editVertices]);
      expect(setEditMode).not.toHaveBeenCalled();
    });
  });

  describe('Orange dot indicator', () => {
    it('renders orange dot on EditVertices when no polygon selected', () => {
      const { container } = render(
        <VerticalToolbar {...defaultProps} selectedPolygonId={null} />
      );
      // The dot is a div with bg-orange-500 class inside the EditVertices button wrapper
      const dots = container.querySelectorAll('.bg-orange-500');
      // EditVertices + AddPoints, and exactly those: MoveShape needs no
      // selection, so an "awaiting selection" dot on it would be a lie.
      expect(dots.length).toBe(2);
    });

    it('no orange dot on EditVertices when polygon selected', () => {
      const { container } = render(
        <VerticalToolbar {...defaultProps} selectedPolygonId="poly-1" />
      );
      const dots = container.querySelectorAll('.bg-orange-500');
      expect(dots.length).toBe(0);
    });
  });

  describe('Global disabled prop', () => {
    it('all mode buttons disabled when disabled=true', () => {
      render(<VerticalToolbar {...defaultProps} disabled={true} />);
      const buttons = screen.getAllByRole('button');
      // First 8 are mode buttons, last 3 are zoom
      for (let i = 0; i < RAIL_SIZE; i++) {
        expect(buttons[i]).toBeDisabled();
      }
    });

    it('setEditMode not called when disabled=true even for normally-enabled modes', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <VerticalToolbar
          {...defaultProps}
          disabled={true}
          selectedPolygonId="poly-1"
          setEditMode={setEditMode}
        />
      );
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.createPolygon]);
      expect(setEditMode).not.toHaveBeenCalled();
    });
  });

  describe('Zoom controls', () => {
    it('clicking ZoomIn calls onZoomIn', async () => {
      const user = userEvent.setup();
      const onZoomIn = vi.fn();
      render(<VerticalToolbar {...defaultProps} onZoomIn={onZoomIn} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.zoomIn]);
      expect(onZoomIn).toHaveBeenCalled();
    });

    it('clicking ZoomOut calls onZoomOut', async () => {
      const user = userEvent.setup();
      const onZoomOut = vi.fn();
      render(<VerticalToolbar {...defaultProps} onZoomOut={onZoomOut} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.zoomOut]);
      expect(onZoomOut).toHaveBeenCalled();
    });

    it('clicking ResetView calls onResetView', async () => {
      const user = userEvent.setup();
      const onResetView = vi.fn();
      render(<VerticalToolbar {...defaultProps} onResetView={onResetView} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[IDX.resetView]);
      expect(onResetView).toHaveBeenCalled();
    });

    it('zoom buttons are disabled when disabled=true', () => {
      render(<VerticalToolbar {...defaultProps} disabled={true} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[IDX.zoomIn]).toBeDisabled();
      expect(buttons[IDX.zoomOut]).toBeDisabled();
      expect(buttons[IDX.resetView]).toBeDisabled();
    });
  });
});
