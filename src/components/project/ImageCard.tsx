import React, { useState, useCallback } from 'react';
import { useLanguage } from '@/contexts/useLanguage';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ProjectImage } from '@/types';
import { Badge } from '@/components/ui/badge';
import { getImageFallbackUrls } from '@/lib/tiffUtils';
import { useRetryImage } from '@/hooks/shared/useRetry';
import {
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  Circle,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
// Canvas renderer removed - using server-generated thumbnails only

interface ImageCardProps {
  image: ProjectImage;
  onDelete: (imageId: string) => void;
  onOpen: (imageId: string) => void;
  isSelected: boolean;
  onSelectionChange: (imageId: string, selected: boolean) => void;
  className?: string;
}

// Helper function to get status display information
const getStatusInfo = (status: string, t: (key: string) => string) => {
  switch (status) {
    case 'segmented':
    case 'completed':
      return {
        label: t('status.segmented'),
        icon: CheckCircle,
        className:
          'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
        animate: false,
      };
    case 'processing':
      return {
        label: t('status.processing'),
        icon: Loader2,
        className:
          'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100',
        animate: true,
      };
    case 'queued':
      return {
        label: t('status.queued'),
        icon: Clock,
        className:
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100',
        animate: false,
      };
    case 'failed':
      return {
        label: t('status.failed'),
        icon: XCircle,
        className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
        animate: false,
      };
    case 'pending':
    case 'no_segmentation':
    default:
      return {
        label: t('status.no_segmentation'),
        icon: Circle,
        className:
          'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
        animate: false,
      };
  }
};

export const ImageCard = ({
  image,
  onDelete,
  onOpen,
  isSelected,
  onSelectionChange,
  className,
}: ImageCardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const { t } = useLanguage();

  // Create ordered list of candidate URLs, with TIFF support
  const candidateUrls = React.useMemo(() => {
    return getImageFallbackUrls(image);
  }, [
    image.id,
    image.name,
    image.segmentationThumbnailUrl,
    image.segmentationThumbnailPath,
    image.thumbnail_url,
    image.url,
    image.image_url,
    image.displayUrl,
  ]);

  // Use the retry hook for image loading with fallback URLs
  const {
    currentUrl,
    loading: imageLoading,
    retrying: imageRetrying,
    attempt: retryAttempt,
    nextRetryIn,
    imageError,
    retry: retryImageLoad,
  } = useRetryImage(candidateUrls);
  // Use the actual status from the image, don't default to 'no_segmentation' if it's missing
  const actualStatus =
    image.segmentationStatus ||
    (image as any).segmentation_status ||
    (image as any).status ||
    'pending';

  const statusInfo = getStatusInfo(actualStatus, t);
  const StatusIcon = statusInfo.icon;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(image.id);
  };

  const handleSelectionChange = (checked: boolean | 'indeterminate') => {
    onSelectionChange(image.id, checked === true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      layout
      className={className}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-lg cursor-pointer',
          'bg-gray-100 dark:bg-gray-800 group transition-all duration-300',
          'hover:shadow-xl hover:scale-[1.02]',
          // Responsive width: full width on mobile, fixed 250px on tablet+
          'w-full sm:w-[250px]',
          // Maintain aspect ratio (3:2) instead of fixed height
          'aspect-[3/2]',
          // Minimum height to prevent too small cards
          'min-h-[167px]'
        )}
        onClick={() => onOpen(image.id)}
      >
        {/* Image preview with retry mechanism */}
        <div className="absolute inset-0">
          {!imageError && currentUrl ? (
            <>
              <img
                src={currentUrl}
                alt={image.name ? image.name.normalize('NFC') : 'Image'}
                className="w-full h-full object-cover"
                loading="lazy"
              />

              {/* Retry overlay when retrying */}
              {imageRetrying && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-lg">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      <span className="text-sm">
                        {t('common.retrying')} ({retryAttempt}/3)
                      </span>
                    </div>
                    {nextRetryIn && (
                      <div className="text-xs text-gray-500 mt-1">
                        {t('common.nextRetryIn', { seconds: nextRetryIn })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-200 dark:bg-gray-700 gap-2">
              <span className="text-gray-400 dark:text-gray-500 text-sm">
                {t('common.no_preview')}
              </span>
              {imageError && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={e => {
                    e.stopPropagation();
                    retryImageLoad();
                  }}
                  className="flex items-center gap-1"
                >
                  <RefreshCw className="h-3 w-3" />
                  {t('common.retry')}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Server-generated thumbnails are included in the image URLs above */}

        {/* Gradient overlay */}
        <div
          className={cn(
            'absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent',
            'transition-opacity duration-300'
          )}
          style={{ zIndex: 5 }}
        />

        {/* Checkbox - top left */}
        <div
          className="absolute top-2 left-2 z-20"
          onClick={e => e.stopPropagation()}
        >
          <Checkbox
            checked={isSelected}
            onCheckedChange={handleSelectionChange}
            className={cn(
              // Larger touch target on mobile (24px), standard on desktop (20px)
              'h-6 w-6 sm:h-5 sm:w-5 border-2 rounded shadow-sm transition-all',
              isSelected
                ? 'border-blue-500 bg-blue-500 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white'
                : 'border-white bg-white/80 backdrop-blur-sm hover:bg-white data-[state=unchecked]:bg-white/80'
            )}
          />
        </div>

        {/* Top action buttons */}
        <div
          className={cn(
            'absolute top-2 right-2 flex gap-1 transition-all duration-300',
            isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
          )}
          style={{ zIndex: 15 }}
        >
          <Button
            size="icon"
            variant="destructive"
            className="h-8 w-8 bg-red-500/90 hover:bg-red-500"
            onClick={handleDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Bottom info overlay */}
        <div
          className="absolute bottom-0 left-0 right-0 p-3 text-white"
          style={{ zIndex: 15 }}
        >
          {/* File name */}
          <h3
            className="font-semibold text-sm truncate mb-1"
            title={image.name ? image.name.normalize('NFC') : t('common.image')}
          >
            {image.name ? image.name.normalize('NFC') : t('common.image')}
          </h3>

          {/* Date and status */}
          <div className="flex items-center justify-between">
            <p className="text-xs opacity-90">
              {image.updatedAt &&
                format(new Date(image.updatedAt), 'dd.MM.yyyy HH:mm')}
            </p>

            {/* Status badge */}
            <Badge
              className={cn(
                'flex items-center gap-1 text-xs',
                statusInfo.className
              )}
            >
              <StatusIcon
                className={cn('h-3 w-3', statusInfo.animate && 'animate-spin')}
              />
              {statusInfo.label}
            </Badge>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
