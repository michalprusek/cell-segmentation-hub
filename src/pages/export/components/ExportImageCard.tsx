import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ProjectImage } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Loader2,
  Clock,
  CheckCircle,
  XCircle,
  Circle,
  Image as ImageIcon,
} from 'lucide-react';
import { useLanguage } from '@/contexts/useLanguage';

interface ExportImageCardProps {
  image: ProjectImage;
  isSelected: boolean;
  onToggleSelection: (imageId: string) => void;
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
        className: 'bg-green-500/90 text-white',
        animate: false,
      };
    case 'processing':
      return {
        label: t('status.processing'),
        icon: Loader2,
        className: 'bg-blue-500/90 text-white',
        animate: true,
      };
    case 'queued':
      return {
        label: t('status.queued'),
        icon: Clock,
        className: 'bg-yellow-500/90 text-white',
        animate: false,
      };
    case 'failed':
      return {
        label: t('status.failed'),
        icon: XCircle,
        className: 'bg-red-500/90 text-white',
        animate: false,
      };
    case 'pending':
    case 'no_segmentation':
    default:
      return {
        label: t('status.no_segmentation'),
        icon: Circle,
        className: 'bg-gray-500/90 text-white',
        animate: false,
      };
  }
};

export const ExportImageCard: React.FC<ExportImageCardProps> = ({
  image,
  isSelected,
  onToggleSelection,
  className,
}) => {
  const [imageError, setImageError] = useState(false);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const { t } = useLanguage();

  // Reset fallback state when image changes
  React.useEffect(() => {
    setFallbackIndex(0);
    setImageError(false);
  }, [image.id, image.thumbnail_url, image.url, image.image_url]);

  // Create ordered list of candidate URLs
  const candidateUrls = React.useMemo(() => {
    const urls = [image.thumbnail_url, image.url, image.image_url]
      .filter(Boolean)
      .filter((url, index, array) => array.indexOf(url) === index);
    return urls;
  }, [image.thumbnail_url, image.url, image.image_url]);

  const statusInfo = getStatusInfo(
    image.segmentationStatus || 'no_segmentation',
    t
  );
  const StatusIcon = statusInfo.icon;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleSelection(image.id);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className={className}
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-lg cursor-pointer',
          'bg-gray-100 dark:bg-gray-800 transition-all duration-200',
          'hover:shadow-lg border-2',
          isSelected
            ? 'border-blue-500 shadow-md'
            : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
        )}
        style={{
          width: '180px',
          height: '135px',
        }}
        onClick={handleClick}
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
              className={cn(
                'w-full h-full object-cover transition-opacity duration-200',
                isSelected ? 'opacity-90' : 'opacity-100'
              )}
              loading="lazy"
              onError={() => {
                const nextIndex = fallbackIndex + 1;
                if (nextIndex < candidateUrls.length) {
                  setFallbackIndex(nextIndex);
                } else {
                  setImageError(true);
                }
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700">
              <ImageIcon className="h-12 w-12 text-gray-400 dark:text-gray-500" />
            </div>
          )}
        </div>

        {/* Selection overlay */}
        {isSelected && (
          <div className="absolute inset-0 bg-blue-500/10 pointer-events-none" />
        )}

        {/* Gradient overlay for better text visibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

        {/* Checkbox - clean design without background */}
        <div className="absolute top-2 left-2 z-20">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelection(image.id)}
            className={cn(
              'h-5 w-5 border-2 rounded shadow-sm transition-all',
              isSelected
                ? 'border-blue-500 bg-blue-500 data-[state=checked]:bg-blue-500 data-[state=checked]:text-white'
                : 'border-white bg-white/80 backdrop-blur-sm hover:bg-white data-[state=unchecked]:bg-white/80'
            )}
            onClick={e => {
              e.stopPropagation();
            }}
          />
        </div>

        {/* Status badge - moved to top right */}
        <div className="absolute top-2 right-2 z-20">
          <Badge
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 text-xs',
              statusInfo.className
            )}
          >
            <StatusIcon
              className={cn('h-3 w-3', statusInfo.animate && 'animate-spin')}
            />
          </Badge>
        </div>

        {/* Bottom info */}
        <div className="absolute bottom-0 left-0 right-0 p-2 text-white z-10">
          <h4
            className="font-medium text-xs truncate mb-0.5"
            title={image.name || 'Image'}
          >
            {image.name || 'Image'}
          </h4>
          <p className="text-xs opacity-80">
            {image.updatedAt && format(new Date(image.updatedAt), 'dd.MM.yyyy')}
          </p>
        </div>
      </div>
    </motion.div>
  );
};
