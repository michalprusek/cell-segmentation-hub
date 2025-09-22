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
  onDelete: (imageId: string) => void;
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
          className="grid justify-items-start"
          style={{
            // Use auto-fill for constant gaps - doesn't stretch items to fill width
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 250px))',
            maxWidth: '100%',
            gap: '16px', // Constant gap between all items
          }}
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

      {/* Pagination controls */}
      {totalPages && totalPages > 1 && pageNumbers && (
        <nav
          className="flex justify-center"
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
