import { useState, useMemo, useEffect } from 'react';

interface UsePaginationOptions {
  totalItems: number;
  itemsPerPage?: number;
  initialPage?: number;
}

interface UsePaginationReturn {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  startIndex: number;
  endIndex: number;
  canGoNext: boolean;
  canGoPrevious: boolean;
  setCurrentPage: (page: number) => void;
  goToNextPage: () => void;
  goToPreviousPage: () => void;
  pageNumbers: number[];
  paginatedIndices: { start: number; end: number };
}

export const usePagination = ({
  totalItems,
  itemsPerPage = 30,
  initialPage = 1,
}: UsePaginationOptions): UsePaginationReturn => {
  const [currentPage, setCurrentPage] = useState(initialPage);

  // Calculate total pages
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  // Create validated setter that clamps to valid range
  const setCurrentPageValidated = (page: number) => {
    const validPage = Math.max(1, Math.min(page, Math.max(1, totalPages)));
    setCurrentPage(validPage);
  };

  // Reset to page 1 if current page exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  // Calculate pagination indices
  const paginatedIndices = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = Math.min(start + itemsPerPage, totalItems);
    return { start, end };
  }, [currentPage, itemsPerPage, totalItems]);

  // Calculate display indices (1-based for UI)
  // Handle edge case when there are no items
  const startIndex = totalItems === 0 ? 0 : paginatedIndices.start + 1;
  const endIndex = paginatedIndices.end;

  // Navigation helpers
  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const goToPreviousPage = () => {
    if (canGoPrevious) {
      setCurrentPageValidated(currentPage - 1);
    }
  };

  const goToNextPage = () => {
    if (canGoNext) {
      setCurrentPageValidated(currentPage + 1);
    }
  };

  // Generate page numbers for pagination UI
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxPagesToShow = 7;

    if (totalPages <= maxPagesToShow) {
      // Show all pages if total is less than max
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show pages with ellipsis
      if (currentPage <= 3) {
        // Show first 5 pages + ellipsis + last page
        for (let i = 1; i <= 5; i++) {
          pages.push(i);
        }
        pages.push(-1); // Ellipsis marker
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        // Show first page + ellipsis + last 5 pages
        pages.push(1);
        pages.push(-1); // Ellipsis marker
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        // Show first + ellipsis + current-1, current, current+1 + ellipsis + last
        pages.push(1);
        pages.push(-1); // Ellipsis marker
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push(-1); // Ellipsis marker
        pages.push(totalPages);
      }
    }

    return pages;
  }, [currentPage, totalPages]);

  return {
    currentPage,
    totalPages,
    itemsPerPage,
    startIndex,
    endIndex,
    canGoNext,
    canGoPrevious,
    setCurrentPage: setCurrentPageValidated,
    goToNextPage,
    goToPreviousPage,
    pageNumbers,
    paginatedIndices,
  };
};
