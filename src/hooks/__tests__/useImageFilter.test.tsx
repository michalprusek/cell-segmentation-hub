import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImageFilter } from '@/hooks/useImageFilter';
import type { ProjectImage } from '@/types';

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---- helpers ----------------------------------------------------------------

const makeImage = (
  overrides: Partial<ProjectImage> & { id: string; name: string }
): ProjectImage => ({
  id: overrides.id,
  name: overrides.name,
  url: `http://localhost/images/${overrides.id}.jpg`,
  thumbnailUrl: `http://localhost/thumbs/${overrides.id}.jpg`,
  width: 800,
  height: 600,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: overrides.updatedAt ?? new Date('2024-06-01T00:00:00Z'),
  segmentationStatus: overrides.segmentationStatus ?? 'pending',
  projectId: overrides.projectId ?? 'proj-1',
  ...overrides,
});

const IMAGES: ProjectImage[] = [
  makeImage({
    id: 'img-1',
    name: 'alpha.jpg',
    segmentationStatus: 'completed',
    updatedAt: new Date('2024-06-03T00:00:00Z'),
  }),
  makeImage({
    id: 'img-2',
    name: 'beta.jpg',
    segmentationStatus: 'processing',
    updatedAt: new Date('2024-06-02T00:00:00Z'),
  }),
  makeImage({
    id: 'img-3',
    name: 'gamma.jpg',
    segmentationStatus: 'pending',
    updatedAt: new Date('2024-06-01T00:00:00Z'),
  }),
  makeImage({
    id: 'img-4',
    name: 'delta.jpg',
    segmentationStatus: 'failed',
    updatedAt: new Date('2024-06-04T00:00:00Z'),
  }),
];

// Reset localStorage between tests so stored sort settings don't bleed
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('image-filter-settings');
});

// ---- tests ------------------------------------------------------------------

describe('useImageFilter', () => {
  describe('initial state', () => {
    it('returns all images unsorted (with default stored settings) when no filter applied', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      // All images are present regardless of sort order
      expect(result.current.filteredImages).toHaveLength(IMAGES.length);
      const ids = result.current.filteredImages.map(i => i.id);
      expect(ids).toContain('img-1');
      expect(ids).toContain('img-2');
      expect(ids).toContain('img-3');
      expect(ids).toContain('img-4');
    });

    it('starts with empty searchTerm', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));
      expect(result.current.searchTerm).toBe('');
    });

    it('exposes sortField and sortDirection', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));
      expect(result.current.sortField).toBeDefined();
      expect(result.current.sortDirection).toBeDefined();
    });
  });

  describe('empty images array', () => {
    it('returns empty filteredImages when input is empty', () => {
      const { result } = renderHook(() => useImageFilter([]));
      expect(result.current.filteredImages).toHaveLength(0);
    });

    it('returns empty filteredImages when search term is set but no images exist', () => {
      const { result } = renderHook(() => useImageFilter([]));

      act(() => {
        result.current.handleSearch({
          target: { value: 'alpha' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(result.current.filteredImages).toHaveLength(0);
    });
  });

  describe('search filtering', () => {
    it('filters images by name (case-insensitive)', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      act(() => {
        result.current.handleSearch({
          target: { value: 'ALPHA' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(result.current.filteredImages).toHaveLength(1);
      expect(result.current.filteredImages[0].id).toBe('img-1');
    });

    it('matches partial names', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      act(() => {
        result.current.handleSearch({
          target: { value: 'ta' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      // 'beta' and 'delta' both contain 'ta'
      expect(result.current.filteredImages).toHaveLength(2);
      const ids = result.current.filteredImages.map(i => i.id);
      expect(ids).toContain('img-2');
      expect(ids).toContain('img-4');
    });

    it('returns all images when search term is cleared', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      act(() => {
        result.current.handleSearch({
          target: { value: 'alpha' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(result.current.filteredImages).toHaveLength(1);

      act(() => {
        result.current.handleSearch({
          target: { value: '' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(result.current.filteredImages).toHaveLength(IMAGES.length);
    });

    it('updates searchTerm state on each handleSearch call', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      act(() => {
        result.current.handleSearch({
          target: { value: 'gam' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      expect(result.current.searchTerm).toBe('gam');
    });
  });

  describe('sorting', () => {
    it('sorts by name ascending when handleSort is called with "name"', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      act(() => {
        result.current.handleSort('name');
      });

      const names = result.current.filteredImages.map(i => i.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('toggles sort direction when handleSort is called twice with the same field', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      act(() => {
        result.current.handleSort('name');
      });
      const firstDirection = result.current.sortDirection;

      act(() => {
        result.current.handleSort('name');
      });
      const secondDirection = result.current.sortDirection;

      expect(firstDirection).not.toBe(secondDirection);
    });

    it('resets direction to "asc" when switching to a different sort field', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      // Sort by name first (asc), then toggle to desc
      act(() => result.current.handleSort('name'));
      act(() => result.current.handleSort('name'));
      expect(result.current.sortDirection).toBe('desc');

      // Switch to a different field — direction resets to asc
      act(() => result.current.handleSort('segmentationStatus'));
      expect(result.current.sortField).toBe('segmentationStatus');
      expect(result.current.sortDirection).toBe('asc');
    });

    it('sorts by segmentationStatus with completed first (asc)', () => {
      const { result } = renderHook(() => useImageFilter(IMAGES));

      act(() => {
        result.current.handleSort('segmentationStatus');
      });

      // Status order: completed=1, processing=2, pending=3, failed=4
      expect(result.current.filteredImages[0].segmentationStatus).toBe(
        'completed'
      );
      expect(
        result.current.filteredImages[result.current.filteredImages.length - 1]
          .segmentationStatus
      ).toBe('failed');
    });
  });

  describe('combined search and sort', () => {
    it('applies both search term and sort field simultaneously', () => {
      // Add two more images that match the same prefix but have different status
      const moreImages: ProjectImage[] = [
        ...IMAGES,
        makeImage({
          id: 'img-5',
          name: 'alpha2.jpg',
          segmentationStatus: 'failed',
          updatedAt: new Date('2024-06-05T00:00:00Z'),
        }),
      ];

      const { result } = renderHook(() => useImageFilter(moreImages));

      // Filter to only "alpha" images
      act(() => {
        result.current.handleSearch({
          target: { value: 'alpha' },
        } as React.ChangeEvent<HTMLInputElement>);
      });

      // Sort by name
      act(() => {
        result.current.handleSort('name');
      });

      const filtered = result.current.filteredImages;
      // Only alpha.jpg and alpha2.jpg should be present
      expect(filtered).toHaveLength(2);
      expect(filtered.map(i => i.name)).toEqual(['alpha.jpg', 'alpha2.jpg']);
    });
  });
});
