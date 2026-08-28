import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ProjectImage } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, checkboxTouchTargetClass } from '@/components/ui/checkbox';
import { Loader2, Trash2 } from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';

interface ImageListItemProps {
  image: ProjectImage;
  /** Resolves when the delete round-trip settles, so the row can show a
   *  pending state. Errors are handled by the caller. */
  onDelete: (imageId: string) => void | Promise<void>;
  onOpen: (imageId: string) => void;
  isSelected: boolean;
  onSelectionChange: (imageId: string, selected: boolean) => void;
  className?: string;
}

export const ImageListItem = ({
  image,
  onDelete,
  onOpen,
  isSelected,
  onSelectionChange,
  className,
}: ImageListItemProps) => {
  const { t } = useLanguage();
  const [isDeleting, setIsDeleting] = React.useState(false);

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      layout
      className={cn(
        // `dark:hover:bg-gray-750` was a no-op — Tailwind has no 750 step, so
        // the row had no hover feedback at all in dark mode.
        'flex items-center p-3 rounded-lg border border-gray-200 bg-white transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 group',
        className
      )}
      onClick={() => onOpen(image.id)}
    >
      {/* Checkbox — the only way to select an image in list view, and a 16px
          target on a phone. `checkboxTouchTargetClass` grows the hit area to
          44px below `sm` without changing what is drawn. */}
      <div className="mr-3" onClick={e => e.stopPropagation()}>
        <Checkbox
          className={checkboxTouchTargetClass}
          checked={isSelected}
          onCheckedChange={checked =>
            onSelectionChange(image.id, checked as boolean)
          }
        />
      </div>

      {/* Thumbnail */}
      <div className="h-10 w-10 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0 cursor-pointer dark:bg-gray-800">
        {image.thumbnail_url ? (
          <img
            src={image.thumbnail_url}
            alt={image.name ? image.name.normalize('NFC') : 'Image'}
            className="h-full w-full object-cover"
          />
        ) : image.url ? (
          <img
            src={image.url}
            alt={image.name ? image.name.normalize('NFC') : 'Image'}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <span className="text-xs text-gray-400">{t('common.noImage')}</span>
          </div>
        )}
      </div>

      {/* Image details */}
      <div className="ml-3 flex-1 min-w-0 cursor-pointer">
        <div className="flex min-w-0 items-center">
          <h4 className="min-w-0 truncate text-sm font-medium">
            {image.name
              ? image.name.normalize('NFC')
              : t('common.untitledImage')}
          </h4>
          {image.segmentationStatus && (
            <Badge
              variant="outline"
              className={cn(
                // `shrink-0` keeps the status readable instead of letting the
                // filename squeeze it into an ellipsis on a narrow row.
                'ml-2 shrink-0 whitespace-nowrap text-xs',
                image.segmentationStatus === 'completed'
                  ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/40'
                  : image.segmentationStatus === 'processing'
                    ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/40'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              )}
            >
              {image.segmentationStatus === 'completed'
                ? t('status.segmented')
                : image.segmentationStatus === 'processing'
                  ? t('status.processing')
                  : t('status.queued')}
            </Badge>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {image.createdAt && format(image.createdAt, 'PPP')}
        </p>
      </div>

      {/* Action buttons.
          BUG FIX: this was `opacity-0` with no `pointer-events-none`, so on a
          touch device the delete button was invisible but still hit-testable —
          a tap anywhere in the right-hand strip of a row silently deleted the
          image with no affordance at all. It is now always visible below `sm`
          (touch) and genuinely inert while hidden above it. */}
      <div className="ml-auto pl-3 transition-opacity sm:opacity-0 sm:pointer-events-none group-hover:sm:opacity-100 group-hover:sm:pointer-events-auto focus-within:sm:opacity-100 focus-within:sm:pointer-events-auto">
        <Button
          variant="destructive"
          size="icon"
          className="h-9 w-9 sm:h-8 sm:w-8"
          disabled={isDeleting}
          aria-label={`${t('common.delete')} ${image.name ? image.name.normalize('NFC') : t('common.image')}`}
          onClick={handleDelete}
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </motion.div>
  );
};
