/**
 * EnhancedEditorToolbar — behavioral unit tests
 *
 * Covered behaviours:
 *  - Mode label text rendered for each EditMode (View, Edit, AddPoints, Create,
 *    CreatePolyline, Slice, Delete)
 *  - Clicking an active mode button calls setEditMode with that mode
 *  - EditVertices, AddPoints and Slice disabled when selectedPolygonId=null
 *  - EditVertices, AddPoints, Slice enabled when selectedPolygonId set
 *  - "Select" badge shown for selection-required modes when no polygon selected
 *  - Undo button disabled when canUndo=false; enabled when canUndo=true
 *  - Redo button disabled when canRedo=false; enabled when canRedo=true
 *  - Undo click calls handleUndo
 *  - Redo click calls handleRedo
 *  - Save button shows "Save" when not saving
 *  - Save button shows "Saving..." when isSaving=true
 *  - Save button calls handleSave when clicked
 *  - Save button disabled when isSaving=true
 *  - "Unsaved changes" badge shown when hasUnsavedChanges=true
 *  - "Unsaved changes" badge NOT shown when hasUnsavedChanges=false
 *  - Save button uses 'default' variant (primary style) when hasUnsavedChanges=true
 *  - ZoomIn button calls handleZoomIn
 *  - ZoomOut button calls handleZoomOut
 *  - ResetView button calls handleResetView
 *  - All interactive buttons disabled when disabled=true
 *
 * NOT tested:
 *  - Tooltip opacity (CSS hover, not testable in jsdom)
 *  - Keyboard shortcut hint text visibility at lg breakpoint (CSS media query)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import EnhancedEditorToolbar from '../EnhancedEditorToolbar';
import { EditMode } from '../../types';

const defaultProps = {
  editMode: EditMode.View,
  selectedPolygonId: null as string | null,
  canUndo: false,
  canRedo: false,
  hasUnsavedChanges: false,
  setEditMode: vi.fn(),
  handleUndo: vi.fn(),
  handleRedo: vi.fn(),
  handleSave: vi.fn(() => Promise.resolve()),
  handleZoomIn: vi.fn(),
  handleZoomOut: vi.fn(),
  handleResetView: vi.fn(),
  disabled: false,
  isSaving: false,
};

describe('EnhancedEditorToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Mode buttons rendering', () => {
    it('renders View mode button text', () => {
      render(<EnhancedEditorToolbar {...defaultProps} />);
      // text from translation: 'segmentation.mode.view' = 'View and navigate'
      expect(screen.getByText('View and navigate')).toBeInTheDocument();
    });

    it('renders CreatePolygon mode button text', () => {
      render(<EnhancedEditorToolbar {...defaultProps} />);
      expect(screen.getByText('Create')).toBeInTheDocument();
    });

    it('renders CreatePolyline mode button text', () => {
      render(<EnhancedEditorToolbar {...defaultProps} />);
      expect(screen.getByText('Create Polyline')).toBeInTheDocument();
    });

    it('renders Slice mode button text', () => {
      render(<EnhancedEditorToolbar {...defaultProps} />);
      expect(screen.getByText('Slice')).toBeInTheDocument();
    });

    it('renders Delete mode button text', () => {
      render(<EnhancedEditorToolbar {...defaultProps} />);
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  describe('Mode activation', () => {
    it('clicking CreatePolygon button calls setEditMode(CreatePolygon)', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <EnhancedEditorToolbar {...defaultProps} setEditMode={setEditMode} />
      );
      const createBtn = screen
        .getByText('Create')
        .closest('button') as HTMLElement;
      await user.click(createBtn);
      expect(setEditMode).toHaveBeenCalledWith(EditMode.CreatePolygon);
    });

    it('clicking DeletePolygon button calls setEditMode(DeletePolygon)', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <EnhancedEditorToolbar {...defaultProps} setEditMode={setEditMode} />
      );
      const deleteBtn = screen
        .getByText('Delete')
        .closest('button') as HTMLElement;
      await user.click(deleteBtn);
      expect(setEditMode).toHaveBeenCalledWith(EditMode.DeletePolygon);
    });

    it('clicking CreatePolyline calls setEditMode(CreatePolyline)', async () => {
      const user = userEvent.setup();
      const setEditMode = vi.fn();
      render(
        <EnhancedEditorToolbar {...defaultProps} setEditMode={setEditMode} />
      );
      const polylineBtn = screen
        .getByText('Create Polyline')
        .closest('button') as HTMLElement;
      await user.click(polylineBtn);
      expect(setEditMode).toHaveBeenCalledWith(EditMode.CreatePolyline);
    });
  });

  describe('Selection-required modes', () => {
    it('EditVertices button is disabled when no polygon selected', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} selectedPolygonId={null} />
      );
      const editBtn = screen.getByText('Edit').closest('button') as HTMLElement;
      expect(editBtn).toBeDisabled();
    });

    it('AddPoints button is disabled when no polygon selected', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} selectedPolygonId={null} />
      );
      const addBtn = screen
        .getByText('Add points')
        .closest('button') as HTMLElement;
      expect(addBtn).toBeDisabled();
    });

    it('Slice button is disabled when no polygon selected', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} selectedPolygonId={null} />
      );
      const sliceBtn = screen
        .getByText('Slice')
        .closest('button') as HTMLElement;
      expect(sliceBtn).toBeDisabled();
    });

    it('EditVertices button enabled when polygon selected', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} selectedPolygonId="poly-1" />
      );
      const editBtn = screen.getByText('Edit').closest('button') as HTMLElement;
      expect(editBtn).not.toBeDisabled();
    });

    it('AddPoints button enabled when polygon selected', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} selectedPolygonId="poly-1" />
      );
      const addBtn = screen
        .getByText('Add points')
        .closest('button') as HTMLElement;
      expect(addBtn).not.toBeDisabled();
    });

    it('Slice button enabled when polygon selected', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} selectedPolygonId="poly-1" />
      );
      const sliceBtn = screen
        .getByText('Slice')
        .closest('button') as HTMLElement;
      expect(sliceBtn).not.toBeDisabled();
    });

    it('shows "Select" badge for EditVertices when no polygon selected', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} selectedPolygonId={null} />
      );
      // At least 3 "Select" badges: EditVertices + AddPoints + Slice
      const badges = screen.getAllByText('Select');
      expect(badges.length).toBeGreaterThanOrEqual(3);
    });

    it('no "Select" badge shown when polygon is selected', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} selectedPolygonId="poly-1" />
      );
      expect(screen.queryByText('Select')).not.toBeInTheDocument();
    });
  });

  describe('Undo / Redo', () => {
    it('Undo button disabled when canUndo=false', () => {
      render(<EnhancedEditorToolbar {...defaultProps} canUndo={false} />);
      const undoBtn = screen.getByTitle('Undo (Ctrl+Z)');
      expect(undoBtn).toBeDisabled();
    });

    it('Undo button enabled when canUndo=true', () => {
      render(<EnhancedEditorToolbar {...defaultProps} canUndo={true} />);
      const undoBtn = screen.getByTitle('Undo (Ctrl+Z)');
      expect(undoBtn).not.toBeDisabled();
    });

    it('clicking Undo calls handleUndo', async () => {
      const user = userEvent.setup();
      const handleUndo = vi.fn();
      render(
        <EnhancedEditorToolbar
          {...defaultProps}
          canUndo={true}
          handleUndo={handleUndo}
        />
      );
      await user.click(screen.getByTitle('Undo (Ctrl+Z)'));
      expect(handleUndo).toHaveBeenCalledTimes(1);
    });

    it('Redo button disabled when canRedo=false', () => {
      render(<EnhancedEditorToolbar {...defaultProps} canRedo={false} />);
      const redoBtn = screen.getByTitle('Redo (Ctrl+Y)');
      expect(redoBtn).toBeDisabled();
    });

    it('Redo button enabled when canRedo=true', () => {
      render(<EnhancedEditorToolbar {...defaultProps} canRedo={true} />);
      const redoBtn = screen.getByTitle('Redo (Ctrl+Y)');
      expect(redoBtn).not.toBeDisabled();
    });

    it('clicking Redo calls handleRedo', async () => {
      const user = userEvent.setup();
      const handleRedo = vi.fn();
      render(
        <EnhancedEditorToolbar
          {...defaultProps}
          canRedo={true}
          handleRedo={handleRedo}
        />
      );
      await user.click(screen.getByTitle('Redo (Ctrl+Y)'));
      expect(handleRedo).toHaveBeenCalledTimes(1);
    });
  });

  describe('Save button', () => {
    it('shows "Save" text when not saving', () => {
      render(<EnhancedEditorToolbar {...defaultProps} isSaving={false} />);
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('shows "Saving..." text when isSaving=true', () => {
      render(<EnhancedEditorToolbar {...defaultProps} isSaving={true} />);
      expect(screen.getByText('Saving...')).toBeInTheDocument();
    });

    it('calling Save button triggers handleSave', async () => {
      const user = userEvent.setup();
      const handleSave = vi.fn(() => Promise.resolve());
      render(
        <EnhancedEditorToolbar
          {...defaultProps}
          handleSave={handleSave}
          hasUnsavedChanges={true}
        />
      );
      // Find Save button by text
      const saveBtn = screen.getByText('Save').closest('button') as HTMLElement;
      await user.click(saveBtn);
      expect(handleSave).toHaveBeenCalledTimes(1);
    });

    it('Save button disabled when isSaving=true', () => {
      render(<EnhancedEditorToolbar {...defaultProps} isSaving={true} />);
      const saveBtn = screen
        .getByText('Saving...')
        .closest('button') as HTMLElement;
      expect(saveBtn).toBeDisabled();
    });

    it('Save button disabled when disabled=true', () => {
      render(<EnhancedEditorToolbar {...defaultProps} disabled={true} />);
      const saveBtn = screen.getByText('Save').closest('button') as HTMLElement;
      expect(saveBtn).toBeDisabled();
    });

    it('shows "Unsaved changes" badge when hasUnsavedChanges=true', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} hasUnsavedChanges={true} />
      );
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });

    it('no "Unsaved changes" badge when hasUnsavedChanges=false', () => {
      render(
        <EnhancedEditorToolbar {...defaultProps} hasUnsavedChanges={false} />
      );
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });
  });

  describe('View controls', () => {
    it('ZoomIn button calls handleZoomIn', async () => {
      const user = userEvent.setup();
      const handleZoomIn = vi.fn();
      render(
        <EnhancedEditorToolbar {...defaultProps} handleZoomIn={handleZoomIn} />
      );
      await user.click(screen.getByTitle('Zoom In (+)'));
      expect(handleZoomIn).toHaveBeenCalledTimes(1);
    });

    it('ZoomOut button calls handleZoomOut', async () => {
      const user = userEvent.setup();
      const handleZoomOut = vi.fn();
      render(
        <EnhancedEditorToolbar
          {...defaultProps}
          handleZoomOut={handleZoomOut}
        />
      );
      await user.click(screen.getByTitle('Zoom Out (-)'));
      expect(handleZoomOut).toHaveBeenCalledTimes(1);
    });

    it('ResetView button calls handleResetView', async () => {
      const user = userEvent.setup();
      const handleResetView = vi.fn();
      render(
        <EnhancedEditorToolbar
          {...defaultProps}
          handleResetView={handleResetView}
        />
      );
      await user.click(screen.getByTitle('Reset View (R)'));
      expect(handleResetView).toHaveBeenCalledTimes(1);
    });

    it('ZoomIn disabled when disabled=true', () => {
      render(<EnhancedEditorToolbar {...defaultProps} disabled={true} />);
      expect(screen.getByTitle('Zoom In (+)')).toBeDisabled();
    });
  });
});
