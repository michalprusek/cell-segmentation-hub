import React, { useState } from 'react';
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
import { Checkbox, checkboxTouchTargetClass } from '@/components/ui/checkbox';
// Canvas renderer removed - using server-generated thumbnails only

interface ImageCardProps {
  image: ProjectImage;
  /** Resolves when the delete round-trip settles, so the card can show a
   *  pending state. Errors are handled by the caller. */
  onDelete: (imageId: string) => void | Promise<void>;
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
  const [isDeleting, setIsDeleting] = useState(false);
  const { t } = useLanguage();

  // Create ordered list of candidate URLs, with TIFF support
  const candidateUrls = React.useMemo(
    () => getImageFallbackUrls(image),
    // Track only the URL/identity fields used by getImageFallbackUrls; depending
    // on the whole image object would re-memoize on unrelated property changes
    // (e.g. segmentationStatus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      image.id,
      image.name,
      image.segmentationThumbnailUrl,
      image.segmentationThumbnailPath,
      image.thumbnail_url,
      image.url,
      image.image_url,
      image.displayUrl,
    ]
  );

  // Use the retry hook for image loading with fallback URLs
  const {
    currentUrl,
    loading: _imageLoading,
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

  // `onDelete` resolves when the DELETE round-trip finishes (it swallows its
  // own errors and toasts). On success this card unmounts; on failure it stays
  // and the button comes back. Either way the control stops reading as dead
  // for the ~300ms it used to sit there fully interactive, and a second click
  // can no longer fire a second DELETE for the same image.
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(image.id);
    } finally {
      setIsDeleting(false);
    }
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
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background',
          // The grid track sizes the card now (see ProjectImages), so it fills
          // the row instead of leaving a dead gutter at wide viewports.
          'w-full',
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

              {/* Video container marker — only renders when the API
                  returns isVideoContainer = true. The play triangle is
                  the visual anchor; the frame count surfaces as a chip
                  for projects with many short and long takes. */}
              {image.isVideoContainer && (
                <>
                  <div className="absolute top-2 left-2 z-10 rounded-full bg-black/60 text-white p-2 backdrop-blur-sm">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                  {typeof image.frameCount === 'number' &&
                    image.frameCount > 0 && (
                      <div className="absolute bottom-2 right-2 z-10 rounded bg-black/60 text-white text-xs px-2 py-0.5 backdrop-blur-sm">
                        {image.frameCount}{' '}
                        {t('common.frames', { defaultValue: 'frames' })}
                      </div>
                    )}
                </>
              )}

              {/* Retry overlay when retrying */}
              {imageRetrying && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
                  <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-lg dark:bg-gray-900">
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
              checkboxTouchTargetClass,
              isSelected
                ? 'border-blue-500 bg-blue-500 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white'
                : 'border-white bg-white/80 backdrop-blur-sm hover:bg-white data-[state=unchecked]:bg-white/80'
            )}
          />
        </div>

        {/* Top action buttons.
            Reveal-on-hover hid this permanently on touch devices, where no
            pointer ever enters the card — deleting an image was simply
            impossible from the grid on a phone. Below `sm` it is always
            visible; from `sm` up the original hover reveal is unchanged, plus
            a `focus-within` escape hatch so it is reachable by keyboard. */}
        <div
          className={cn(
            'absolute top-2 right-2 flex gap-1 transition-all duration-300',
            'opacity-100 translate-y-0',
            'sm:-translate-y-2 sm:opacity-0 sm:focus-within:translate-y-0 sm:focus-within:opacity-100',
            isHovered && 'sm:translate-y-0 sm:opacity-100'
          )}
          style={{ zIndex: 15 }}
        >
          <Button
            size="icon"
            variant="destructive"
            aria-label={String(t('common.delete'))}
            className="h-9 w-9 bg-red-500/90 shadow-sm hover:bg-red-500 sm:h-8 sm:w-8"
            disabled={isDeleting}
            onClick={handleDelete}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
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

          {/* Date and status.
              The card is a fixed ~250px track, so `dd.MM.yyyy HH:mm` plus a
              translated status label ("Bez segmentace", "Keine Segmentierung")
              does not fit on one line. It used to wrap *inside* both elements,
              which broke the timestamp across two lines and turned the badge
              into a lumpy two-line pill overlapping the filename. Wrapping as
              whole units instead keeps each readable, and the badge drops to
              its own line only in the languages that actually need it. */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p className="whitespace-nowrap text-[11px] leading-4 opacity-90">
              {image.updatedAt &&
                format(new Date(image.updatedAt), 'dd.MM.yyyy HH:mm')}
            </p>

            {/* Status badge */}
            <Badge
              className={cn(
                'flex shrink-0 items-center gap-1 whitespace-nowrap px-2 py-0 text-[11px] font-medium leading-5',
                statusInfo.className
              )}
            >
              <StatusIcon
                className={cn(
                  'h-3 w-3 shrink-0',
                  statusInfo.animate && 'animate-spin'
                )}
              />
              {statusInfo.label}
            </Badge>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
