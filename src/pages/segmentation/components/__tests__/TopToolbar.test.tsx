/**
 * TopToolbar — behavioral unit tests
 *
 * Covered behaviours:
 *  - Undo button renders and is disabled when canUndo=false
 *  - Undo button is enabled and calls handleUndo on click
 *  - Redo button renders and is disabled when canRedo=false
 *  - Redo button is enabled and calls handleRedo on click
 *  - Resegment button absent when onResegment not provided
 *  - Resegment button present when onResegment provided
 *  - Resegment calls onResegment on click
 *  - Resegment disabled + spinner shown while isResegmenting=true
 *  - Save button disabled when hasUnsavedChanges=false
 *  - Save button enabled when hasUnsavedChanges=true and calls handleSave on click
 *  - "Nothing to save" label shown when hasUnsavedChanges=false
 *  - Unsaved-changes badge shown when hasUnsavedChanges=true
 *  - "Saving…" label shown while isSaving=true and save button is disabled
 *  - All buttons disabled when disabled=true
 *
 * NOT tested:
 *  - sm:inline responsive label visibility (CSS breakpoint, not testable in jsdom)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import TopToolbar from '../TopToolbar';

// ---------------------------------------------------------------------------
// Default props factory
// ---------------------------------------------------------------------------
function makeProps(
  overrides: Partial<React.ComponentProps<typeof TopToolbar>> = {}
) {
  return {
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
    handleSave: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('TopToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Undo button
  // -------------------------------------------------------------------------

  describe('Undo button', () => {
    it('is disabled when canUndo=false', () => {
      render(<TopToolbar {...makeProps({ canUndo: false })} />);
      const undoBtn = screen.getByTitle(/undo/i);
      expect(undoBtn).toBeDisabled();
    });

    it('is enabled when canUndo=true', () => {
      render(<TopToolbar {...makeProps({ canUndo: true })} />);
      const undoBtn = screen.getByTitle(/undo/i);
      expect(undoBtn).not.toBeDisabled();
    });

    it('calls handleUndo when clicked', async () => {
      const user = userEvent.setup();
      const handleUndo = vi.fn();
      render(<TopToolbar {...makeProps({ canUndo: true, handleUndo })} />);
      await user.click(screen.getByTitle(/undo/i));
      expect(handleUndo).toHaveBeenCalledTimes(1);
    });

    it('does not call handleUndo when disabled', async () => {
      const user = userEvent.setup();
      const handleUndo = vi.fn();
      render(<TopToolbar {...makeProps({ canUndo: false, handleUndo })} />);
      await user.click(screen.getByTitle(/undo/i));
      expect(handleUndo).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Redo button
  // -------------------------------------------------------------------------

  describe('Redo button', () => {
    it('is disabled when canRedo=false', () => {
      render(<TopToolbar {...makeProps({ canRedo: false })} />);
      const redoBtn = screen.getByTitle(/redo/i);
      expect(redoBtn).toBeDisabled();
    });

    it('is enabled when canRedo=true', () => {
      render(<TopToolbar {...makeProps({ canRedo: true })} />);
      const redoBtn = screen.getByTitle(/redo/i);
      expect(redoBtn).not.toBeDisabled();
    });

    it('calls handleRedo when clicked', async () => {
      const user = userEvent.setup();
      const handleRedo = vi.fn();
      render(<TopToolbar {...makeProps({ canRedo: true, handleRedo })} />);
      await user.click(screen.getByTitle(/redo/i));
      expect(handleRedo).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Resegment button (optional)
  // -------------------------------------------------------------------------

  describe('Resegment button', () => {
    it('is absent when onResegment is not provided', () => {
      render(<TopToolbar {...makeProps()} />);
      // No button with resegment title should exist
      const btn = screen.queryByTitle(/resegment/i);
      expect(btn).toBeNull();
    });

    it('is present when onResegment is provided', () => {
      render(<TopToolbar {...makeProps({ onResegment: vi.fn() })} />);
      expect(screen.getByTitle(/resegment/i)).toBeInTheDocument();
    });

    it('calls onResegment when clicked', async () => {
      const user = userEvent.setup();
      const onResegment = vi.fn();
      render(<TopToolbar {...makeProps({ onResegment })} />);
      await user.click(screen.getByTitle(/resegment/i));
      expect(onResegment).toHaveBeenCalledTimes(1);
    });

    it('is disabled while isResegmenting=true', () => {
      render(
        <TopToolbar
          {...makeProps({ onResegment: vi.fn(), isResegmenting: true })}
        />
      );
      expect(screen.getByTitle(/resegment/i)).toBeDisabled();
    });

    it('does not call onResegment while isResegmenting=true', async () => {
      const user = userEvent.setup();
      const onResegment = vi.fn();
      render(
        <TopToolbar {...makeProps({ onResegment, isResegmenting: true })} />
      );
      await user.click(screen.getByTitle(/resegment/i));
      expect(onResegment).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Save button
  // -------------------------------------------------------------------------

  describe('Save button', () => {
    it('is disabled when hasUnsavedChanges=false', () => {
      render(<TopToolbar {...makeProps({ hasUnsavedChanges: false })} />);
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });

    it('is enabled when hasUnsavedChanges=true', () => {
      render(<TopToolbar {...makeProps({ hasUnsavedChanges: true })} />);
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    });

    it('calls handleSave when clicked with unsaved changes', async () => {
      const user = userEvent.setup();
      const handleSave = vi.fn().mockResolvedValue(undefined);
      render(
        <TopToolbar {...makeProps({ hasUnsavedChanges: true, handleSave })} />
      );
      await user.click(screen.getByRole('button', { name: /save/i }));
      expect(handleSave).toHaveBeenCalledTimes(1);
    });

    it('shows "Saving…" label while isSaving=true', () => {
      render(
        <TopToolbar
          {...makeProps({ hasUnsavedChanges: true, isSaving: true })}
        />
      );
      // The save button text should switch to the saving key
      const saveBtn = screen.getByRole('button', { name: /saving/i });
      expect(saveBtn).toBeInTheDocument();
      expect(saveBtn).toBeDisabled();
    });

    it('shows nothing-to-save label when hasUnsavedChanges=false', () => {
      render(<TopToolbar {...makeProps({ hasUnsavedChanges: false })} />);
      // English translation: 'All changes saved'
      expect(screen.getByText('All changes saved')).toBeInTheDocument();
    });

    it('shows unsaved-changes badge when hasUnsavedChanges=true', () => {
      render(<TopToolbar {...makeProps({ hasUnsavedChanges: true })} />);
      // English translation: 'Unsaved changes'
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // global disabled prop
  // -------------------------------------------------------------------------

  describe('disabled prop', () => {
    it('disables undo even when canUndo=true', () => {
      render(<TopToolbar {...makeProps({ canUndo: true, disabled: true })} />);
      expect(screen.getByTitle(/undo/i)).toBeDisabled();
    });

    it('disables redo even when canRedo=true', () => {
      render(<TopToolbar {...makeProps({ canRedo: true, disabled: true })} />);
      expect(screen.getByTitle(/redo/i)).toBeDisabled();
    });

    it('disables resegment when disabled=true', () => {
      render(
        <TopToolbar {...makeProps({ onResegment: vi.fn(), disabled: true })} />
      );
      expect(screen.getByTitle(/resegment/i)).toBeDisabled();
    });

    it('disables save even when hasUnsavedChanges=true', () => {
      render(
        <TopToolbar
          {...makeProps({ hasUnsavedChanges: true, disabled: true })}
        />
      );
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    });
  });
});
