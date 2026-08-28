import React from 'react';
import { motion } from 'framer-motion';
import { ImageCard } from './ImageCard';
import { ImageListItem } from './ImageListItem';
import { ProjectImage } from '@/types';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

interface ProjectImagesProps {
  images: ProjectImage[];
  /** Resolves when the delete round-trip settles; the card/row uses that to
   *  render a pending state. */
  onDelete: (imageId: string) => void | Promise<void>;
  onOpen: (imageId: string) => void;
  viewMode: 'grid' | 'list';
  currentPage?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
  goToNextPage?: () => void;
  goToPreviousPage?: () => void;
  pageNumbers?: number[];
  selectedImageIds: Set<string>;
  onSelectionChange: (imageId: string, selected: boolean) => void;
}

const ProjectImages = ({
  images,
  onDelete,
  onOpen,
  viewMode,
  currentPage,
  totalPages,
  onPageChange,
  canGoNext,
  canGoPrevious,
  goToNextPage,
  goToPreviousPage,
  pageNumbers,
  selectedImageIds,
  onSelectionChange,
}: ProjectImagesProps) => {
  const renderImages = () => {
    if (viewMode === 'grid') {
      return (
        <motion.div
          // Pure CSS auto-fill. The previous version read `window.innerWidth`
          // during render with no resize listener, so rotating a phone or
          // dragging a window across 640px left the stale template applied
          // (fixed 250px tracks on a 360px screen, or a single column on a
          // desktop) until some unrelated re-render happened to fix it. The
          // inline style also outranked the `grid-cols-1` mobile fallback, so
          // that fallback was dead whenever the page first rendered wide.
          // `minmax(220px, 1fr)` also lets cards absorb the leftover width
          // instead of leaving a ragged gutter on the right at 1440px.
          className={cn(
            'grid gap-4',
            'grid-cols-1',
            'sm:[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]'
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {images.map(image => (
            <ImageCard
              key={image.id}
              image={image}
              onDelete={onDelete}
              onOpen={onOpen}
              isSelected={selectedImageIds.has(image.id)}
              onSelectionChange={onSelectionChange}
            />
          ))}
        </motion.div>
      );
    }

    return (
      <motion.div
        className="space-y-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {images.map(image => (
          <ImageListItem
            key={image.id}
            image={image}
            onDelete={onDelete}
            onOpen={onOpen}
            isSelected={selectedImageIds.has(image.id)}
            onSelectionChange={onSelectionChange}
          />
        ))}
      </motion.div>
    );
  };

  return (
    <div className="space-y-6">
      {renderImages()}

      {/* Pagination controls.
          `overflow-x-auto` keeps a long page list from widening the whole
          document at 360px — the row itself scrolls instead. */}
      {totalPages && totalPages > 1 && pageNumbers && (
        <nav
          className="flex justify-center overflow-x-auto"
          role="navigation"
          aria-label="Pagination"
        >
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={goToPreviousPage}
                  className={cn(
                    'cursor-pointer',
                    !canGoPrevious && 'pointer-events-none opacity-50'
                  )}
                  aria-label="Previous page"
                  aria-disabled={!canGoPrevious}
                />
              </PaginationItem>

              {pageNumbers.map((pageNum, index) => (
                <PaginationItem
                  key={pageNum === -1 ? `ellipsis-${index}` : `page-${pageNum}`}
                >
                  {pageNum === -1 ? (
                    <PaginationEllipsis aria-hidden="true" />
                  ) : (
                    <PaginationLink
                      onClick={() => onPageChange?.(pageNum)}
                      isActive={pageNum === currentPage}
                      className="cursor-pointer"
                      aria-label={`Page ${pageNum}`}
                      aria-current={
                        pageNum === currentPage ? 'page' : undefined
                      }
                    >
                      {pageNum}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}

              <PaginationItem>
                <PaginationNext
                  onClick={goToNextPage}
                  className={cn(
                    'cursor-pointer',
                    !canGoNext && 'pointer-events-none opacity-50'
                  )}
                  aria-label="Next page"
                  aria-disabled={!canGoNext}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </nav>
      )}
    </div>
  );
};

export default ProjectImages;
