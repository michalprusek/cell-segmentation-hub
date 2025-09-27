import { useState, useMemo, useCallback, useEffect } from 'react';
import { ProjectImage } from '@/types';
import { normalizeText } from '@/lib/textUtils';

export type SortOption = 'date' | 'name' | 'status';

interface UseImageSelectionProps {
  images: ProjectImage[];
  initialSelectedIds?: string[];
  itemsPerPage?: number;
}

interface UseImageSelectionReturn {
  // Selection state
  selectedIds: Set<string>;
  isAllSelected: boolean;
  selectedCount: number;

  // Pagination
  currentPage: number;
  totalPages: number;
  paginatedImages: ProjectImage[];

  // Search and sort
  searchQuery: string;
  sortBy: SortOption;
  filteredImages: ProjectImage[];

  // Actions
  toggleSelection: (imageId: string) => void;
  selectAll: () => void;
  selectNone: () => void;
  toggleAll: () => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (option: SortOption) => void;
  setCurrentPage: (page: number) => void;

  // Pagination helpers
  canGoNext: boolean;
  canGoPrevious: boolean;
  goToNextPage: () => void;
  goToPreviousPage: () => void;
  pageNumbers: number[];
  startIndex: number;
  endIndex: number;
}

export const useImageSelection = ({
  images,
  initialSelectedIds,
  itemsPerPage = 30,
}: UseImageSelectionProps): UseImageSelectionReturn => {
  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(initialSelectedIds || images.map(img => img.id))
  );

  // Search and sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('date');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Reset selected IDs when initial IDs change
  useEffect(() => {
    if (initialSelectedIds) {
      setSelectedIds(new Set(initialSelectedIds));
    }
  }, [initialSelectedIds]);

  // Filter images based on search query
  const filteredImages = useMemo(() => {
    let filtered = [...images];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        img =>
          normalizeText(img.name)?.toLowerCase().includes(query) ||
          img.segmentationStatus?.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return normalizeText(a.name).localeCompare(normalizeText(b.name));
        case 'status':
          return (a.segmentationStatus || '').localeCompare(
            b.segmentationStatus || ''
          );
        case 'date':
        default: {
          // Sort by updatedAt or createdAt, newest first
          const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return dateB - dateA;
        }
      }
    });

    return filtered;
  }, [images, searchQuery, sortBy]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredImages.length / itemsPerPage);

  // Ensure current page is valid when filtered results change
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  // Get paginated images
  const paginatedImages = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredImages.slice(startIndex, endIndex);
  }, [filteredImages, currentPage, itemsPerPage]);

  // Calculate page numbers to display
  const pageNumbers = useMemo(() => {
    const pages: number[] = [];
    const maxPagesToShow = 7;

    if (totalPages <= maxPagesToShow) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Show first, last, and pages around current
      if (currentPage <= 3) {
        for (let i = 1; i <= 5; i++) {
          pages.push(i);
        }
        pages.push(-1); // Ellipsis marker
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push(-1); // Ellipsis marker
        for (let i = totalPages - 4; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
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

  // Selection actions
  const toggleSelection = useCallback((imageId: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageId)) {
        newSet.delete(imageId);
      } else {
        newSet.add(imageId);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(images.map(img => img.id)));
  }, [images]);

  const selectNone = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleAll = useCallback(() => {
    const filteredImageIds = new Set(filteredImages.map(img => img.id));
    const selectedFilteredCount = Array.from(selectedIds).filter(id =>
      filteredImageIds.has(id)
    ).length;

    if (
      selectedFilteredCount === filteredImages.length &&
      filteredImages.length > 0
    ) {
      // Deselect all filtered images
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        filteredImages.forEach(img => newSet.delete(img.id));
        return newSet;
      });
    } else {
      // Select all filtered images
      setSelectedIds(
        prev => new Set([...prev, ...filteredImages.map(img => img.id)])
      );
    }
  }, [selectedIds, filteredImages]);

  // Pagination actions
  const goToNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
    }
  }, [currentPage, totalPages]);

  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
    }
  }, [currentPage]);

  // Calculate display indices
  const startIndex = (currentPage - 1) * itemsPerPage + 1;
  const endIndex = Math.min(currentPage * itemsPerPage, filteredImages.length);

  return {
    // Selection state
    selectedIds,
    isAllSelected: (() => {
      if (filteredImages.length === 0) return false;
      const filteredImageIds = new Set(filteredImages.map(img => img.id));
      const selectedFilteredCount = Array.from(selectedIds).filter(id =>
        filteredImageIds.has(id)
      ).length;
      return selectedFilteredCount === filteredImages.length;
    })(),
    selectedCount: selectedIds.size,

    // Pagination
    currentPage,
    totalPages,
    paginatedImages,

    // Search and sort
    searchQuery,
    sortBy,
    filteredImages,

    // Actions
    toggleSelection,
    selectAll,
    selectNone,
    toggleAll,
    setSearchQuery,
    setSortBy,
    setCurrentPage,

    // Pagination helpers
    canGoNext: currentPage < totalPages,
    canGoPrevious: currentPage > 1,
    goToNextPage,
    goToPreviousPage,
    pageNumbers,
    startIndex: filteredImages.length > 0 ? startIndex : 0,
    endIndex,
  };
};
