import React, { useState } from 'react';
import { useLanguage } from '@/contexts/useLanguage';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ProjectImage } from '@/types';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  Circle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import CanvasThumbnailRenderer from './CanvasThumbnailRenderer';

interface ImageCardProps {
  image: ProjectImage & {
    segmentationResult?: {
      polygons?: Array<{
        id: string;
        points: Array<{ x: number; y: number }>;
        type: 'external' | 'internal';
        class?: string;
        originalPointCount?: number;
        compressionRatio?: number;
      }>;
      imageWidth?: number;
      imageHeight?: number;
      levelOfDetail?: 'low' | 'medium' | 'high';
      polygonCount?: number;
      pointCount?: number;
      compressionRatio?: number;
    };
  };
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
  const [imageError, setImageError] = useState(false);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const { t } = useLanguage();

  // Reset fallback state when image changes
  React.useEffect(() => {
    setFallbackIndex(0);
    setImageError(false);
  }, [image.id, image.thumbnail_url, image.url, image.image_url]);

  // Create ordered list of candidate URLs, deduplicating falsy/identical entries
  const candidateUrls = React.useMemo(() => {
    const urls = [image.thumbnail_url, image.url, image.image_url]
      .filter(Boolean) // Remove falsy values
      .filter((url, index, array) => array.indexOf(url) === index); // Deduplicate identical entries
    return urls;
  }, [image.thumbnail_url, image.url, image.image_url]);
  const statusInfo = getStatusInfo(
    image.segmentationStatus || 'no_segmentation',
    t
  );
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
          'hover:shadow-xl hover:scale-[1.02]'
        )}
        style={{
          // Fixed dimensions for stable rendering across viewport changes
          width: '250px',
          height: '167px', // Proportional height (250/280 * 192 = 171, rounded to 167)
          minWidth: '250px',
          minHeight: '167px',
        }}
        onClick={() => onOpen(image.id)}
      >
        {/* Image preview */}
        <div className="absolute inset-0">
          {!imageError && candidateUrls.length > 0 ? (
            <img
              src={
                candidateUrls[
                  Math.min(fallbackIndex, candidateUrls.length - 1)
                ] || ''
              }
              alt={image.name || 'Image'}
              className="w-full h-full object-cover"
              loading="lazy"
              onError={() => {
                const nextIndex = fallbackIndex + 1;
                if (nextIndex < candidateUrls.length) {
                  // Try the next candidate URL
                  setFallbackIndex(nextIndex);
                } else {
                  // All URLs failed, show placeholder
                  setImageError(true);
                }
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700">
              <span className="text-gray-400 dark:text-gray-500 text-sm">
                {t('common.no_preview')}
              </span>
            </div>
          )}
        </div>

        {/* Segmentation overlay */}
        {(() => {
          const shouldShowSegmentation =
            (image.segmentationStatus === 'completed' ||
              image.segmentationStatus === 'segmented') &&
            image.segmentationResult?.polygons &&
            image.segmentationResult.polygons.length > 0 &&
            image.segmentationResult.imageWidth &&
            image.segmentationResult.imageHeight;

          return shouldShowSegmentation ? (
            <CanvasThumbnailRenderer
              thumbnailData={{
                polygons: image.segmentationResult.polygons,
                imageWidth: image.segmentationResult.imageWidth,
                imageHeight: image.segmentationResult.imageHeight,
                levelOfDetail: image.segmentationResult.levelOfDetail || 'low',
                polygonCount:
                  image.segmentationResult.polygonCount ||
                  image.segmentationResult.polygons.length,
                pointCount:
                  image.segmentationResult.pointCount ||
                  image.segmentationResult.polygons.reduce(
                    (sum, p) => sum + p.points.length,
                    0
                  ),
                compressionRatio:
                  image.segmentationResult.compressionRatio || 1,
              }}
            />
          ) : null;
        })()}

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
              'h-5 w-5 border-2 rounded shadow-sm transition-all',
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
            title={image.name || t('common.image')}
          >
            {image.name || t('common.image')}
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
