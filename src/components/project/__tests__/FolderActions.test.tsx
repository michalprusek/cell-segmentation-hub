/**
 * Tests for FolderActions component.
 *
 * Covers: trigger button renders, dropdown menu items appear on open,
 * each callback fires when the corresponding item is clicked, and stop-
 * propagation behaviour (no event leak to wrapping container).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import FolderActions from '../FolderActions';

// -----------------------------------------------------------------------
// Mock useLanguage — the global setup seeds English translations, but
// the component imports the hook directly so we stub it here to avoid
// any async chunk loading.
// -----------------------------------------------------------------------
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'folders.rename': 'Rename',
        'folders.moveTo': 'Move to…',
        'common.delete': 'Delete',
      };
      return map[key] ?? key;
    },
  }),
}));

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeProps() {
  return {
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDelete: vi.fn(),
  };
}

describe('FolderActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  describe('Rendering', () => {
    it('renders a trigger button', () => {
      render(<FolderActions {...makeProps()} />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('does NOT show menu items before the trigger is clicked', () => {
      render(<FolderActions {...makeProps()} />);
      expect(screen.queryByText('Rename')).not.toBeInTheDocument();
      expect(screen.queryByText('Move to…')).not.toBeInTheDocument();
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Dropdown items
  // -----------------------------------------------------------------------

  describe('Dropdown menu items', () => {
    it('shows Rename, Move to…, and Delete after trigger click', async () => {
      const user = userEvent.setup();
      render(<FolderActions {...makeProps()} />);

      await user.click(screen.getByRole('button'));

      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Move to…')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('items are rendered as menuitems', async () => {
      const user = userEvent.setup();
      render(<FolderActions {...makeProps()} />);

      await user.click(screen.getByRole('button'));

      const items = screen.getAllByRole('menuitem');
      expect(items.length).toBeGreaterThanOrEqual(3);
    });
  });

  // -----------------------------------------------------------------------
  // Callbacks
  // -----------------------------------------------------------------------

  describe('Callbacks', () => {
    it('calls onRename when the Rename item is clicked', async () => {
      const user = userEvent.setup();
      const props = makeProps();
      render(<FolderActions {...props} />);

      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Rename'));

      expect(props.onRename).toHaveBeenCalledOnce();
      expect(props.onMove).not.toHaveBeenCalled();
      expect(props.onDelete).not.toHaveBeenCalled();
    });

    it('calls onMove when the Move to… item is clicked', async () => {
      const user = userEvent.setup();
      const props = makeProps();
      render(<FolderActions {...props} />);

      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Move to…'));

      expect(props.onMove).toHaveBeenCalledOnce();
      expect(props.onRename).not.toHaveBeenCalled();
      expect(props.onDelete).not.toHaveBeenCalled();
    });

    it('calls onDelete when the Delete item is clicked', async () => {
      const user = userEvent.setup();
      const props = makeProps();
      render(<FolderActions {...props} />);

      await user.click(screen.getByRole('button'));
      await user.click(screen.getByText('Delete'));

      expect(props.onDelete).toHaveBeenCalledOnce();
      expect(props.onRename).not.toHaveBeenCalled();
      expect(props.onMove).not.toHaveBeenCalled();
    });

    it('does not call any callback when only the trigger is clicked', async () => {
      const user = userEvent.setup();
      const props = makeProps();
      render(<FolderActions {...props} />);

      await user.click(screen.getByRole('button'));

      expect(props.onRename).not.toHaveBeenCalled();
      expect(props.onMove).not.toHaveBeenCalled();
      expect(props.onDelete).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Stop-propagation guard
  // -----------------------------------------------------------------------

  describe('Stop-propagation', () => {
    it('clicking the trigger does not bubble to a parent handler', async () => {
      const user = userEvent.setup();
      const parentClick = vi.fn();
      render(
        <div onClick={parentClick}>
          <FolderActions {...makeProps()} />
        </div>
      );

      await user.click(screen.getByRole('button'));

      expect(parentClick).not.toHaveBeenCalled();
    });
  });
});
