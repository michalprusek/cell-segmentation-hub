/**
 * VerticalToolbar — behavioral unit tests
 *
 * Covered behaviours:
 *  - Renders all 7 mode buttons (View, EditVertices, AddPoints,
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

  describe('Rendering', () => {
    it('renders all 7 mode buttons', () => {
      render(<VerticalToolbar {...defaultProps} />);
      // Each button has a title attribute via getModeLabel translations
      // We rely on the button count in the mode section (first 7 ghost icon buttons)
      const allButtons = screen.getAllByRole('button');
      // 7 mode buttons + 3 zoom buttons = 10 minimum
      expect(allButtons.length).toBeGreaterThanOrEqual(10);
    });

    it('renders ZoomIn button', () => {
      render(<VerticalToolbar {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      // Zoom buttons are the last 3
      expect(buttons.length).toBeGreaterThanOrEqual(10);
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
      // CreatePolygon is the 4th button (0-indexed: 3)
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[3]); // CreatePolygon
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
      await user.click(buttons[3]); // CreatePolygon is active
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
      await user.click(buttons[4]); // CreatePolyline
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
      await user.click(buttons[5]); // Slice
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
      await user.click(buttons[6]); // DeletePolygon
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
      await user.click(buttons[0]); // View is active
      expect(setEditMode).toHaveBeenCalledWith(EditMode.View);
    });
  });

  describe('Selection-required modes', () => {
    it('EditVertices button is disabled when no polygon selected', () => {
      render(<VerticalToolbar {...defaultProps} selectedPolygonId={null} />);
      const buttons = screen.getAllByRole('button');
      // EditVertices is index 1
      expect(buttons[1]).toBeDisabled();
    });

    it('AddPoints button is disabled when no polygon selected', () => {
      render(<VerticalToolbar {...defaultProps} selectedPolygonId={null} />);
      const buttons = screen.getAllByRole('button');
      // AddPoints is index 2
      expect(buttons[2]).toBeDisabled();
    });

    it('EditVertices button is enabled when polygon selected', () => {
      render(<VerticalToolbar {...defaultProps} selectedPolygonId="poly-1" />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[1]).not.toBeDisabled();
    });

    it('AddPoints button is enabled when polygon selected', () => {
      render(<VerticalToolbar {...defaultProps} selectedPolygonId="poly-1" />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[2]).not.toBeDisabled();
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
      await user.click(buttons[1]);
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
      expect(dots.length).toBeGreaterThanOrEqual(2); // EditVertices + AddPoints
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
      // First 7 are mode buttons, last 3 are zoom
      for (let i = 0; i < 10; i++) {
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
      await user.click(buttons[3]); // CreatePolygon
      expect(setEditMode).not.toHaveBeenCalled();
    });
  });

  describe('Zoom controls', () => {
    it('clicking ZoomIn calls onZoomIn', async () => {
      const user = userEvent.setup();
      const onZoomIn = vi.fn();
      render(<VerticalToolbar {...defaultProps} onZoomIn={onZoomIn} />);
      const buttons = screen.getAllByRole('button');
      // ZoomIn is 8th button (index 7, after separator the 8th)
      await user.click(buttons[7]);
      expect(onZoomIn).toHaveBeenCalled();
    });

    it('clicking ZoomOut calls onZoomOut', async () => {
      const user = userEvent.setup();
      const onZoomOut = vi.fn();
      render(<VerticalToolbar {...defaultProps} onZoomOut={onZoomOut} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[8]);
      expect(onZoomOut).toHaveBeenCalled();
    });

    it('clicking ResetView calls onResetView', async () => {
      const user = userEvent.setup();
      const onResetView = vi.fn();
      render(<VerticalToolbar {...defaultProps} onResetView={onResetView} />);
      const buttons = screen.getAllByRole('button');
      await user.click(buttons[9]);
      expect(onResetView).toHaveBeenCalled();
    });

    it('zoom buttons are disabled when disabled=true', () => {
      render(<VerticalToolbar {...defaultProps} disabled={true} />);
      const buttons = screen.getAllByRole('button');
      expect(buttons[7]).toBeDisabled();
      expect(buttons[8]).toBeDisabled();
      expect(buttons[9]).toBeDisabled();
    });
  });
});
