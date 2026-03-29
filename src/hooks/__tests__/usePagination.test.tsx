import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePagination } from '@/hooks/usePagination';

describe('usePagination', () => {
  describe('basic calculations', () => {
    it('calculates totalPages as ceiling division of totalItems / itemsPerPage', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30 })
      );
      expect(result.current.totalPages).toBe(4); // ceil(100/30)
    });

    it('returns totalPages of 1 when totalItems fits exactly in one page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 30, itemsPerPage: 30 })
      );
      expect(result.current.totalPages).toBe(1);
    });

    it('returns totalPages of 0 when totalItems is 0', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 0, itemsPerPage: 30 })
      );
      expect(result.current.totalPages).toBe(0);
    });

    it('uses default itemsPerPage of 30 when not specified', () => {
      const { result } = renderHook(() => usePagination({ totalItems: 31 }));
      expect(result.current.totalPages).toBe(2);
      expect(result.current.itemsPerPage).toBe(30);
    });
  });

  describe('startIndex and endIndex', () => {
    it('returns startIndex=1 and endIndex=30 for first page with 100 items', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30 })
      );
      expect(result.current.startIndex).toBe(1);
      expect(result.current.endIndex).toBe(30);
    });

    it('returns correct indices for middle page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30, initialPage: 2 })
      );
      expect(result.current.startIndex).toBe(31);
      expect(result.current.endIndex).toBe(60);
    });

    it('returns correct endIndex on the last partial page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 95, itemsPerPage: 30, initialPage: 4 })
      );
      // Page 4: items 91-95
      expect(result.current.startIndex).toBe(91);
      expect(result.current.endIndex).toBe(95);
    });

    it('returns startIndex=0 and endIndex=0 when totalItems is 0', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 0, itemsPerPage: 30 })
      );
      expect(result.current.startIndex).toBe(0);
      expect(result.current.endIndex).toBe(0);
    });
  });

  describe('canGoNext and canGoPrevious', () => {
    it('canGoPrevious is false on page 1', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30 })
      );
      expect(result.current.canGoPrevious).toBe(false);
    });

    it('canGoNext is false on the last page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30, initialPage: 4 })
      );
      expect(result.current.canGoNext).toBe(false);
    });

    it('both canGoNext and canGoPrevious are true on a middle page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30, initialPage: 2 })
      );
      expect(result.current.canGoNext).toBe(true);
      expect(result.current.canGoPrevious).toBe(true);
    });

    it('canGoNext is false when there is only one page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 10, itemsPerPage: 30 })
      );
      expect(result.current.canGoNext).toBe(false);
      expect(result.current.canGoPrevious).toBe(false);
    });
  });

  describe('goToNextPage and goToPreviousPage', () => {
    it('goToNextPage increments currentPage', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30 })
      );

      act(() => result.current.goToNextPage());

      expect(result.current.currentPage).toBe(2);
    });

    it('goToNextPage does not go past the last page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30, initialPage: 4 })
      );

      act(() => result.current.goToNextPage());

      expect(result.current.currentPage).toBe(4); // Already on last page
    });

    it('goToPreviousPage decrements currentPage', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30, initialPage: 3 })
      );

      act(() => result.current.goToPreviousPage());

      expect(result.current.currentPage).toBe(2);
    });

    it('goToPreviousPage does not go below page 1', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30 })
      );

      act(() => result.current.goToPreviousPage());

      expect(result.current.currentPage).toBe(1); // Already on first page
    });
  });

  describe('setCurrentPage', () => {
    it('sets currentPage to the specified valid page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30 })
      );

      act(() => result.current.setCurrentPage(3));

      expect(result.current.currentPage).toBe(3);
    });

    it('clamps setCurrentPage to page 1 when given a value below 1', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30 })
      );

      act(() => result.current.setCurrentPage(-5));

      expect(result.current.currentPage).toBe(1);
    });

    it('clamps setCurrentPage to totalPages when given a value above max', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30 })
      );

      act(() => result.current.setCurrentPage(999));

      expect(result.current.currentPage).toBe(4); // totalPages = 4
    });
  });

  describe('reset on totalItems shrink', () => {
    it('resets to page 1 when totalItems shrinks and currentPage exceeds new totalPages', () => {
      let totalItems = 100;

      const { result, rerender } = renderHook(() =>
        usePagination({ totalItems, itemsPerPage: 30 })
      );

      act(() => result.current.setCurrentPage(4));
      expect(result.current.currentPage).toBe(4);

      // Shrink total items so only 1 page remains
      totalItems = 10;
      rerender();

      expect(result.current.currentPage).toBe(1);
    });
  });

  describe('pageNumbers generation', () => {
    it('returns all page numbers when totalPages <= 7', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 210, itemsPerPage: 30 }) // 7 pages
      );
      expect(result.current.pageNumbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it('returns all pages for small dataset', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 3, itemsPerPage: 1 }) // 3 pages
      );
      expect(result.current.pageNumbers).toEqual([1, 2, 3]);
    });

    it('uses ellipsis (-1) for large page count near the beginning', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 300, itemsPerPage: 10, initialPage: 2 }) // 30 pages, near start
      );
      const pages = result.current.pageNumbers;
      // Should contain first 5 pages, an ellipsis marker, and last page
      expect(pages).toContain(-1);
      expect(pages[0]).toBe(1);
      expect(pages[pages.length - 1]).toBe(30);
      expect(pages.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    });

    it('uses ellipsis (-1) for large page count near the end', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 300, itemsPerPage: 10, initialPage: 29 }) // 30 pages, near end
      );
      const pages = result.current.pageNumbers;
      expect(pages).toContain(-1);
      expect(pages[0]).toBe(1);
      expect(pages[pages.length - 1]).toBe(30);
    });

    it('uses two ellipsis markers when in the middle of a large range', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 300, itemsPerPage: 10, initialPage: 15 }) // 30 pages, middle
      );
      const pages = result.current.pageNumbers;
      const ellipsisCount = pages.filter(p => p === -1).length;
      expect(ellipsisCount).toBe(2);
      expect(pages[0]).toBe(1);
      expect(pages[pages.length - 1]).toBe(30);
    });

    it('returns empty array when totalItems is 0', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 0, itemsPerPage: 30 })
      );
      expect(result.current.pageNumbers).toEqual([]);
    });
  });

  describe('paginatedIndices', () => {
    it('provides correct start and end 0-based indices for the current page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 100, itemsPerPage: 30, initialPage: 2 })
      );
      expect(result.current.paginatedIndices).toEqual({ start: 30, end: 60 });
    });

    it('caps end at totalItems on the last page', () => {
      const { result } = renderHook(() =>
        usePagination({ totalItems: 95, itemsPerPage: 30, initialPage: 4 })
      );
      expect(result.current.paginatedIndices).toEqual({ start: 90, end: 95 });
    });
  });
});
