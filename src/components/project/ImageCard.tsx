
import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProjectImage } from '@/types';
import { Badge } from '@/components/ui/badge';

interface ImageCardProps {
  image: ProjectImage;
  onDelete: (imageId: string) => void;
  onOpen: (imageId: string) => void;
  className?: string;
}

export const ImageCard = ({ image, onDelete, onOpen, className }: ImageCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      layout
    >
      <Card 
        className={cn(
          "overflow-hidden border-gray-200 dark:border-gray-700 transition-all group hover:shadow-md relative", 
          className
        )}
      >
        {/* Delete button */}
        <Button
          variant="destructive"
          size="icon"
          className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(image.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        
        {/* Image preview - clickable to open segmentation editor */}
        <div 
          className="aspect-square bg-gray-100 dark:bg-gray-800 relative overflow-hidden cursor-pointer"
          onClick={() => onOpen(image.id)}
        >
          {image.thumbnail_url ? (
            <img 
              src={image.thumbnail_url} 
              alt={image.name || 'Image'} 
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : image.url ? (
            <img 
              src={image.url} 
              alt={image.name || 'Image'} 
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700">
              <span className="text-gray-400 dark:text-gray-500">No preview</span>
            </div>
          )}
          
          {/* Status badge */}
          {image.segmentationStatus && (
            <Badge className={cn(
              "absolute bottom-2 left-2",
              image.segmentationStatus === 'completed' 
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                : image.segmentationStatus === 'processing'
                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100"
            )}>
              {image.segmentationStatus === 'completed' ? 'Zpracováno' : 
               image.segmentationStatus === 'processing' ? 'Zpracovává se' : 'Čeká'}
            </Badge>
          )}
        </div>
        
        <CardContent className="p-3">
          <div className="truncate">
            <h3 className="font-medium text-sm truncate" title={image.name || 'Image'}>
              {image.name || 'Image'}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {image.createdAt && format(image.createdAt, 'PPP')}
            </p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};
