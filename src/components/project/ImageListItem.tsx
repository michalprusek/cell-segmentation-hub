
import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProjectImage } from '@/types';
import { Badge } from '@/components/ui/badge';

interface ImageListItemProps {
  image: ProjectImage;
  onDelete: (imageId: string) => void;
  onOpen: (imageId: string) => void;
  className?: string;
}

export const ImageListItem = ({
  image,
  onDelete,
  onOpen,
  className,
}: ImageListItemProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      layout
      className={cn(
        'flex items-center p-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-750 group',
        className
      )}
    >
      {/* Thumbnail */}
      <div 
        className="h-10 w-10 rounded overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0 cursor-pointer"
        onClick={() => onOpen(image.id)}
      >
        {image.thumbnail_url ? (
          <img
            src={image.thumbnail_url}
            alt={image.name || 'Image'}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <span className="text-xs text-gray-400">No Image</span>
          </div>
        )}
      </div>

      {/* Image details */}
      <div className="ml-3 flex-1 min-w-0 cursor-pointer" onClick={() => onOpen(image.id)}>
        <div className="flex items-center">
          <h4 className="text-sm font-medium truncate">
            {image.name || 'Untitled Image'}
          </h4>
          {image.segmentationStatus && (
            <Badge
              variant="outline"
              className={cn(
                'ml-2 text-xs',
                image.segmentationStatus === 'completed'
                  ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/40'
                  : image.segmentationStatus === 'processing'
                  ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/40'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              )}
            >
              {image.segmentationStatus === 'completed'
                ? 'Zpracováno'
                : image.segmentationStatus === 'processing'
                ? 'Zpracovává se'
                : 'Čeká'}
            </Badge>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {image.createdAt && format(image.createdAt, 'PPP')}
        </p>
      </div>

      {/* Delete button */}
      <Button
        variant="destructive"
        size="icon"
        className="ml-4 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(image.id);
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </motion.div>
  );
};
