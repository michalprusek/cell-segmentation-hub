import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Check, X, ImageIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { ExportImageCard } from './ExportImageCard';
import { useImageSelection, SortOption } from '../hooks/useImageSelection';
import { ProjectImage } from '@/types';
import { useLanguage } from '@/contexts/useLanguage';
import { cn } from '@/lib/utils';

interface ImageSelectionGridProps {
  images: ProjectImage[];
  selectedImageIds: string[];
  onSelectionChange: (selectedIds: string[]) => void;
  className?: string;
}

export const ImageSelectionGrid: React.FC<ImageSelectionGridProps> = ({
  images,
  selectedImageIds,
  onSelectionChange,
  className,
}) => {
  const { t } = useLanguage();
  const {
    selectedIds,
    isAllSelected,
    selectedCount,
    currentPage,
    totalPages,
    paginatedImages,
    searchQuery,
    sortBy,
    filteredImages,
    toggleSelection,
    toggleAll,
    setSearchQuery,
    setSortBy,
    setCurrentPage,
    canGoNext,
    canGoPrevious,
    goToNextPage,
    goToPreviousPage,
    pageNumbers,
    startIndex,
    endIndex,
  } = useImageSelection({
    images,
    initialSelectedIds: selectedImageIds,
    itemsPerPage: 30,
  });

  // Update parent when selection changes
  React.useEffect(() => {
    onSelectionChange(Array.from(selectedIds));
  }, [selectedIds, onSelectionChange]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const handleSortChange = (value: string) => {
    setSortBy(value as SortOption);
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header with search and sort */}
      <div className="space-y-3">
        {/* Selection summary and controls */}
        <div className="flex items-center justify-between">
          <div
            className="flex items-center space-x-3 px-3 py-2 border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            onClick={toggleAll}
          >
            <Checkbox
              id="select-all"
              checked={isAllSelected}
              onCheckedChange={toggleAll}
              className="h-5 w-5"
              onClick={e => e.stopPropagation()}
            />
            <Label
              htmlFor="select-all"
              className="text-sm font-medium cursor-pointer select-none pointer-events-none"
            >
              {isAllSelected ? t('export.selectNone') : t('export.selectAll')}
            </Label>
            <span className="text-sm text-muted-foreground pointer-events-none">
              (
              {t('export.imagesSelected', {
                count: selectedCount,
                total: images.length,
              })}
              )
            </span>
          </div>
        </div>

        {/* Search and sort controls */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('export.searchImages')}
              value={searchQuery}
              onChange={handleSearchChange}
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select value={sortBy} onValueChange={handleSortChange}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder={t('export.sortBy')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">
                {t('export.sortOptions.date')}
              </SelectItem>
              <SelectItem value="name">
                {t('export.sortOptions.name')}
              </SelectItem>
              <SelectItem value="status">
                {t('export.sortOptions.status')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Image grid */}
      <div className="min-h-[400px]">
        {filteredImages.length > 0 ? (
          <>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentPage}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 sm:gap-4"
              >
                {paginatedImages.map(image => (
                  <ExportImageCard
                    key={image.id}
                    image={image}
                    isSelected={selectedIds.has(image.id)}
                    onToggleSelection={toggleSelection}
                  />
                ))}
              </motion.div>
            </AnimatePresence>

            {/* Pagination info */}
            {totalPages > 0 && (
              <div className="mt-4 text-sm text-muted-foreground text-center">
                {t('export.showingImages', {
                  start: startIndex,
                  end: endIndex,
                  total: filteredImages.length,
                })}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-[400px] text-muted-foreground">
            <ImageIcon className="h-12 w-12 mb-3" />
            <p className="text-sm">{t('export.noImagesFound')}</p>
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={goToPreviousPage}
                  className={cn(
                    !canGoPrevious && 'pointer-events-none opacity-50'
                  )}
                />
              </PaginationItem>

              {pageNumbers.map((pageNum, index) => (
                <PaginationItem key={index}>
                  {pageNum === -1 ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationLink
                      onClick={() => setCurrentPage(pageNum)}
                      isActive={pageNum === currentPage}
                    >
                      {pageNum}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}

              <PaginationItem>
                <PaginationNext
                  onClick={goToNextPage}
                  className={cn(!canGoNext && 'pointer-events-none opacity-50')}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
};
