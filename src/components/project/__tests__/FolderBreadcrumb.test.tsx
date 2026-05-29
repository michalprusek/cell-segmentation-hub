import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import FolderBreadcrumb from '@/components/project/FolderBreadcrumb';
import type { ProjectFolder } from '@/types';

// ── dashboardDrag is used only for DnD; we mock it to isolate nav tests ──

vi.mock('@/utils/dashboardDrag', () => ({
  readDragItem: vi.fn(() => null),
  shouldAcceptOnBreadcrumb: vi.fn(() => false),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeFolder(id: string, name: string): ProjectFolder {
  return {
    id,
    name,
    parentId: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

const FOLDER_A = makeFolder('folder-a', 'Experiments');
const FOLDER_B = makeFolder('folder-b', 'Sub-Batch');

describe('FolderBreadcrumb', () => {
  const onNavigate = vi.fn();
  const onDropToTarget = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Root-only (empty path) ────────────────────────────────────────────────

  describe('Empty path (at root)', () => {
    it('renders the Home segment', () => {
      render(<FolderBreadcrumb path={[]} onNavigate={onNavigate} />);
      expect(screen.getByText('Home')).toBeInTheDocument();
    });

    it('does NOT render any folder segment beyond Home', () => {
      render(<FolderBreadcrumb path={[]} onNavigate={onNavigate} />);
      expect(screen.queryByText('Experiments')).not.toBeInTheDocument();
    });

    it('Home is the current page when path is empty', () => {
      render(<FolderBreadcrumb path={[]} onNavigate={onNavigate} />);
      // BreadcrumbPage wraps the current segment; aria-current is added by
      // shadcn's BreadcrumbPage under the hood — check the parent span's role
      // instead: it should NOT be a link (no onClick forwarding)
      const homeSpan = screen.getByLabelText('Home');
      // Current page spans don't have cursor-pointer; links do
      expect(homeSpan.className).not.toMatch(/cursor-pointer/);
    });
  });

  // ── One-level deep path ───────────────────────────────────────────────────

  describe('Single folder in path', () => {
    it('renders Home and the folder name', () => {
      render(<FolderBreadcrumb path={[FOLDER_A]} onNavigate={onNavigate} />);
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Experiments')).toBeInTheDocument();
    });

    it('clicking the Home link calls onNavigate(null)', async () => {
      const user = userEvent.setup();
      render(<FolderBreadcrumb path={[FOLDER_A]} onNavigate={onNavigate} />);

      // Home is rendered as a BreadcrumbLink in this state
      const homeSpan = screen.getByLabelText('Home');
      await user.click(homeSpan);
      expect(onNavigate).toHaveBeenCalledWith(null);
    });

    it('the last folder segment is the current page (not a link)', () => {
      render(<FolderBreadcrumb path={[FOLDER_A]} onNavigate={onNavigate} />);
      // The last segment is wrapped in BreadcrumbPage, so its aria-label
      // matches folder.name and clicking it should NOT trigger onNavigate
      const folderSpan = screen.getByLabelText('Experiments');
      expect(folderSpan.className).not.toMatch(/cursor-pointer/);
    });
  });

  // ── Two-level deep path ───────────────────────────────────────────────────

  describe('Two folders in path', () => {
    it('renders Home, first folder, and second folder', () => {
      render(
        <FolderBreadcrumb path={[FOLDER_A, FOLDER_B]} onNavigate={onNavigate} />
      );
      expect(screen.getByText('Home')).toBeInTheDocument();
      expect(screen.getByText('Experiments')).toBeInTheDocument();
      expect(screen.getByText('Sub-Batch')).toBeInTheDocument();
    });

    it('clicking the first (non-last) folder calls onNavigate with its id', async () => {
      const user = userEvent.setup();
      render(
        <FolderBreadcrumb path={[FOLDER_A, FOLDER_B]} onNavigate={onNavigate} />
      );

      // FOLDER_A is not the last → rendered as a link
      const folderASpan = screen.getByLabelText('Experiments');
      await user.click(folderASpan);
      expect(onNavigate).toHaveBeenCalledWith('folder-a');
    });

    it('the second (last) folder is the current page', () => {
      render(
        <FolderBreadcrumb path={[FOLDER_A, FOLDER_B]} onNavigate={onNavigate} />
      );
      const folderBSpan = screen.getByLabelText('Sub-Batch');
      expect(folderBSpan.className).not.toMatch(/cursor-pointer/);
    });
  });

  // ── Separator rendering ───────────────────────────────────────────────────

  it('renders a separator between Home and a folder', () => {
    const { container } = render(
      <FolderBreadcrumb path={[FOLDER_A]} onNavigate={onNavigate} />
    );
    // BreadcrumbSeparator renders an <li> with aria-hidden="true"
    const separators = container.querySelectorAll('[aria-hidden="true"]');
    expect(separators.length).toBeGreaterThanOrEqual(1);
  });

  // ── Drag-and-drop (onDropToTarget wired) ────────────────────────────────
  // DnD in JSDOM is unreliable without trusted events; we just assert the
  // prop is accepted without throwing. Full DnD behaviour is an E2E concern.

  it('accepts onDropToTarget prop without errors', () => {
    expect(() =>
      render(
        <FolderBreadcrumb
          path={[FOLDER_A]}
          onNavigate={onNavigate}
          onDropToTarget={onDropToTarget}
        />
      )
    ).not.toThrow();
  });
});
