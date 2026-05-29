import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import FolderCard from '@/components/project/FolderCard';

// DnD utilities — isolate navigation tests from DnD state machine
vi.mock('@/utils/dashboardDrag', () => ({
  dragSourceProps: vi.fn(() => ({})),
  readDragItem: vi.fn(() => null),
  shouldAcceptOnFolder: vi.fn(() => false),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseProps = {
  id: 'folder-abc',
  name: 'My Experiments',
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onMove: vi.fn(),
  onDelete: vi.fn(),
  onDropItem: vi.fn(),
};

describe('FolderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('renders the folder name', () => {
      render(<FolderCard {...baseProps} />);
      expect(screen.getByText('My Experiments')).toBeInTheDocument();
    });

    it('renders the "Folder" label from i18n', () => {
      render(<FolderCard {...baseProps} />);
      expect(screen.getByText('Folder')).toBeInTheDocument();
    });

    it('exposes aria-label equal to the folder name', () => {
      render(<FolderCard {...baseProps} />);
      expect(
        screen.getByRole('button', { name: 'My Experiments' })
      ).toBeInTheDocument();
    });

    it('sets data-folder-id attribute', () => {
      render(<FolderCard {...baseProps} />);
      const el = document.querySelector('[data-folder-id="folder-abc"]');
      expect(el).toBeInTheDocument();
    });

    it('renders folder name in title attribute for truncation hint', () => {
      render(<FolderCard {...baseProps} />);
      const heading = screen.getByText('My Experiments');
      expect(heading).toHaveAttribute('title', 'My Experiments');
    });

    it('renders the FolderActions menu trigger button', () => {
      render(<FolderCard {...baseProps} />);
      // The MoreVertical trigger inside FolderActions
      const trigger = document.querySelector('button');
      expect(trigger).toBeInTheDocument();
    });
  });

  // ── Click / open ─────────────────────────────────────────────────────────

  describe('Open interaction', () => {
    it('calls onOpen when the card wrapper is clicked', async () => {
      const user = userEvent.setup();
      render(<FolderCard {...baseProps} />);
      const btn = screen.getByRole('button', { name: 'My Experiments' });
      await user.click(btn);
      expect(baseProps.onOpen).toHaveBeenCalledTimes(1);
    });
  });

  // ── FolderActions callbacks ───────────────────────────────────────────────

  describe('FolderActions menu callbacks', () => {
    async function openMenu(user: ReturnType<typeof userEvent.setup>) {
      // The MoreVertical trigger is the first button; the menu items appear
      // after click via Radix portal
      const trigger = document.querySelector('button') as HTMLElement;
      await user.click(trigger);
    }

    it('calls onRename when Rename menu item is clicked', async () => {
      const user = userEvent.setup();
      render(<FolderCard {...baseProps} />);
      await openMenu(user);
      const renameItem = await screen.findByText('Rename');
      await user.click(renameItem);
      expect(baseProps.onRename).toHaveBeenCalledTimes(1);
    });

    it('calls onMove when Move to… menu item is clicked', async () => {
      const user = userEvent.setup();
      render(<FolderCard {...baseProps} />);
      await openMenu(user);
      const moveItem = await screen.findByText('Move to…');
      await user.click(moveItem);
      expect(baseProps.onMove).toHaveBeenCalledTimes(1);
    });

    it('calls onDelete when Delete menu item is clicked', async () => {
      const user = userEvent.setup();
      render(<FolderCard {...baseProps} />);
      await openMenu(user);
      const deleteItem = await screen.findByText('Delete');
      await user.click(deleteItem);
      expect(baseProps.onDelete).toHaveBeenCalledTimes(1);
    });

    it('opening the menu does NOT trigger onOpen', async () => {
      const user = userEvent.setup();
      render(<FolderCard {...baseProps} />);
      await openMenu(user);
      // onOpen fires when the wrapping div is clicked — the button inside
      // FolderActions stops propagation, so it should not reach onOpen
      expect(baseProps.onOpen).not.toHaveBeenCalled();
    });
  });

  // ── DnD: prop accepted without error ────────────────────────────────────
  // Full DnD requires trusted events (CDP); we only verify the prop is wired.

  it('renders without errors when onDropItem is omitted', () => {
    const { onDropItem: _omit, ...propsWithoutDrop } = baseProps;
    expect(() => render(<FolderCard {...propsWithoutDrop} />)).not.toThrow();
  });
});
