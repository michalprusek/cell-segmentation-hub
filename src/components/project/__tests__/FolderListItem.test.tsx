import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import FolderListItem from '@/components/project/FolderListItem';

vi.mock('@/utils/dashboardDrag', () => ({
  dragSourceProps: vi.fn(() => ({})),
  readDragItem: vi.fn(() => null),
  shouldAcceptOnFolder: vi.fn(() => false),
}));

const baseProps = {
  id: 'folder-xyz',
  name: 'Batch Results',
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onMove: vi.fn(),
  onDelete: vi.fn(),
  onDropItem: vi.fn(),
};

describe('FolderListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Rendering ────────────────────────────────────────────────────────────

  describe('Rendering', () => {
    it('renders the folder name', () => {
      render(<FolderListItem {...baseProps} />);
      expect(screen.getByText('Batch Results')).toBeInTheDocument();
    });

    it('renders the "Folder" i18n label', () => {
      render(<FolderListItem {...baseProps} />);
      expect(screen.getByText('Folder')).toBeInTheDocument();
    });

    it('renders name in a title attribute for truncation', () => {
      render(<FolderListItem {...baseProps} />);
      const heading = screen.getByText('Batch Results');
      expect(heading).toHaveAttribute('title', 'Batch Results');
    });

    it('has cursor-pointer class on the wrapper', () => {
      const { container } = render(<FolderListItem {...baseProps} />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('cursor-pointer');
    });
  });

  // ── Click / open ─────────────────────────────────────────────────────────

  describe('Open interaction', () => {
    it('calls onOpen when the list item wrapper is clicked', async () => {
      const user = userEvent.setup();
      render(<FolderListItem {...baseProps} />);
      // The first text-visible element to click is the folder name
      await user.click(screen.getByText('Batch Results'));
      expect(baseProps.onOpen).toHaveBeenCalledTimes(1);
    });
  });

  // ── FolderActions menu callbacks ─────────────────────────────────────────

  describe('FolderActions menu', () => {
    async function openMenu(user: ReturnType<typeof userEvent.setup>) {
      const trigger = document.querySelector('button') as HTMLElement;
      await user.click(trigger);
    }

    it('calls onRename via menu', async () => {
      const user = userEvent.setup();
      render(<FolderListItem {...baseProps} />);
      await openMenu(user);
      await user.click(await screen.findByText('Rename'));
      expect(baseProps.onRename).toHaveBeenCalledTimes(1);
    });

    it('calls onMove via menu', async () => {
      const user = userEvent.setup();
      render(<FolderListItem {...baseProps} />);
      await openMenu(user);
      await user.click(await screen.findByText('Move to…'));
      expect(baseProps.onMove).toHaveBeenCalledTimes(1);
    });

    it('calls onDelete via menu', async () => {
      const user = userEvent.setup();
      render(<FolderListItem {...baseProps} />);
      await openMenu(user);
      await user.click(await screen.findByText('Delete'));
      expect(baseProps.onDelete).toHaveBeenCalledTimes(1);
    });

    it('opening the menu does NOT trigger onOpen', async () => {
      const user = userEvent.setup();
      render(<FolderListItem {...baseProps} />);
      await openMenu(user);
      expect(baseProps.onOpen).not.toHaveBeenCalled();
    });
  });

  // ── Optional prop ─────────────────────────────────────────────────────────

  it('renders without error when onDropItem is omitted', () => {
    const { onDropItem: _omit, ...propsWithoutDrop } = baseProps;
    expect(() =>
      render(<FolderListItem {...propsWithoutDrop} />)
    ).not.toThrow();
  });
});
