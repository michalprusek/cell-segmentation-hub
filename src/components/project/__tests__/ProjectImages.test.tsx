import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectImages from '@/components/project/ProjectImages';
import type { ProjectImage } from '@/types';

// ── Mock heavy sub-components ────────────────────────────────────────────

vi.mock('@/components/project/ImageCard', () => ({
  ImageCard: ({
    image,
    onDelete,
    onOpen,
    isSelected,
    onSelectionChange,
  }: {
    image: ProjectImage;
    onDelete: (id: string) => void;
    onOpen: (id: string) => void;
    isSelected: boolean;
    onSelectionChange: (id: string, sel: boolean) => void;
  }) => (
    <div data-testid={`image-card-${image.id}`} data-selected={isSelected}>
      <span>{image.name}</span>
      <button onClick={() => onDelete(image.id)}>Delete</button>
      <button onClick={() => onOpen(image.id)}>Open</button>
      <button onClick={() => onSelectionChange(image.id, !isSelected)}>
        Toggle
      </button>
    </div>
  ),
}));

vi.mock('@/components/project/ImageListItem', () => ({
  ImageListItem: ({
    image,
    onDelete,
    onOpen,
    isSelected,
    onSelectionChange,
  }: {
    image: ProjectImage;
    onDelete: (id: string) => void;
    onOpen: (id: string) => void;
    isSelected: boolean;
    onSelectionChange: (id: string, sel: boolean) => void;
  }) => (
    <div data-testid={`image-list-${image.id}`} data-selected={isSelected}>
      <span>{image.name}</span>
      <button onClick={() => onDelete(image.id)}>Delete</button>
      <button onClick={() => onOpen(image.id)}>Open</button>
      <button onClick={() => onSelectionChange(image.id, !isSelected)}>
        Toggle
      </button>
    </div>
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────────

function makeImage(id: string, name: string): ProjectImage {
  return {
    id,
    name,
    url: `/images/${id}.jpg`,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    segmentationStatus: 'pending',
    width: 800,
    height: 600,
  } as ProjectImage;
}

const IMAGES = [
  makeImage('img-1', 'Alpha'),
  makeImage('img-2', 'Beta'),
  makeImage('img-3', 'Gamma'),
];

const BASE_PROPS = {
  onDelete: vi.fn(),
  onOpen: vi.fn(),
  selectedImageIds: new Set<string>(),
  onSelectionChange: vi.fn(),
};

describe('ProjectImages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Grid view ────────────────────────────────────────────────────────────

  describe('Grid view', () => {
    it('renders an ImageCard for each image', () => {
      render(<ProjectImages {...BASE_PROPS} images={IMAGES} viewMode="grid" />);

      for (const img of IMAGES) {
        expect(screen.getByTestId(`image-card-${img.id}`)).toBeInTheDocument();
      }
    });

    it('passes isSelected=true for images in selectedImageIds', () => {
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          selectedImageIds={new Set(['img-2'])}
        />
      );

      expect(screen.getByTestId('image-card-img-2')).toHaveAttribute(
        'data-selected',
        'true'
      );
      expect(screen.getByTestId('image-card-img-1')).toHaveAttribute(
        'data-selected',
        'false'
      );
    });

    it('fires onDelete with the correct image id', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          onDelete={onDelete}
        />
      );

      // Each card renders a "Delete" button; click the first one
      const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
      await user.click(deleteButtons[0]);
      expect(onDelete).toHaveBeenCalledWith('img-1');
    });

    it('fires onOpen with the correct image id', async () => {
      const user = userEvent.setup();
      const onOpen = vi.fn();
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          onOpen={onOpen}
        />
      );

      const openButtons = screen.getAllByRole('button', { name: /open/i });
      await user.click(openButtons[1]); // second image (img-2)
      expect(onOpen).toHaveBeenCalledWith('img-2');
    });

    it('fires onSelectionChange with id and toggled state', async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          onSelectionChange={onSelectionChange}
        />
      );

      const toggleButtons = screen.getAllByRole('button', { name: /toggle/i });
      await user.click(toggleButtons[0]);
      expect(onSelectionChange).toHaveBeenCalledWith('img-1', true);
    });
  });

  // ── List view ────────────────────────────────────────────────────────────

  describe('List view', () => {
    it('renders an ImageListItem for each image', () => {
      render(<ProjectImages {...BASE_PROPS} images={IMAGES} viewMode="list" />);

      for (const img of IMAGES) {
        expect(screen.getByTestId(`image-list-${img.id}`)).toBeInTheDocument();
      }
    });

    it('does NOT render grid cards in list mode', () => {
      render(<ProjectImages {...BASE_PROPS} images={IMAGES} viewMode="list" />);
      expect(screen.queryByTestId('image-card-img-1')).not.toBeInTheDocument();
    });
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  describe('Pagination', () => {
    it('renders pagination nav when totalPages > 1', () => {
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          totalPages={3}
          currentPage={1}
          pageNumbers={[1, 2, 3]}
          canGoNext={true}
          canGoPrevious={false}
        />
      );
      // The outer <nav aria-label="Pagination"> is one of multiple navigation
      // elements; use getAllByRole and assert at least one matches.
      const navs = screen.getAllByRole('navigation');
      const paginationNav = navs.find(
        n => (n as HTMLElement).getAttribute('aria-label') === 'Pagination'
      );
      expect(paginationNav).toBeDefined();
    });

    it('does NOT render pagination when totalPages is 1', () => {
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          totalPages={1}
          currentPage={1}
          pageNumbers={[1]}
        />
      );
      // No outer nav with aria-label="Pagination" should exist
      const navs = screen.queryAllByRole('navigation');
      const paginationNav = navs.find(
        n => (n as HTMLElement).getAttribute('aria-label') === 'Pagination'
      );
      expect(paginationNav).toBeUndefined();
    });

    it('does NOT render pagination when totalPages is undefined', () => {
      render(<ProjectImages {...BASE_PROPS} images={IMAGES} viewMode="grid" />);
      const navs = screen.queryAllByRole('navigation');
      const paginationNav = navs.find(
        n => (n as HTMLElement).getAttribute('aria-label') === 'Pagination'
      );
      expect(paginationNav).toBeUndefined();
    });

    it('calls onPageChange when a page number is clicked', async () => {
      const user = userEvent.setup();
      const onPageChange = vi.fn();
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          totalPages={3}
          currentPage={1}
          pageNumbers={[1, 2, 3]}
          onPageChange={onPageChange}
          canGoNext={true}
          canGoPrevious={false}
        />
      );

      await user.click(screen.getByLabelText('Page 2'));
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('calls goToNextPage when Next is clicked', async () => {
      const user = userEvent.setup();
      const goToNextPage = vi.fn();
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          totalPages={3}
          currentPage={1}
          pageNumbers={[1, 2, 3]}
          goToNextPage={goToNextPage}
          canGoNext={true}
          canGoPrevious={false}
        />
      );

      await user.click(screen.getByLabelText('Next page'));
      expect(goToNextPage).toHaveBeenCalled();
    });

    it('marks the current page link as active', () => {
      render(
        <ProjectImages
          {...BASE_PROPS}
          images={IMAGES}
          viewMode="grid"
          totalPages={3}
          currentPage={2}
          pageNumbers={[1, 2, 3]}
        />
      );

      const page2 = screen.getByLabelText('Page 2');
      expect(page2).toHaveAttribute('aria-current', 'page');
    });
  });

  // ── Empty images array ───────────────────────────────────────────────────

  it('renders nothing (no cards, no pagination) for an empty image list', () => {
    render(<ProjectImages {...BASE_PROPS} images={[]} viewMode="grid" />);
    expect(screen.queryByTestId(/image-card-/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: /pagination/i })
    ).not.toBeInTheDocument();
  });
});
