
import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { MoreHorizontal, Trash2, ExternalLink, Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProjectImage } from '@/integrations/supabase/types';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  
  const handleExport = () => {
    navigate(`/segmentation/${image.project_id}/${image.id}/export`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      layout
      className={cn(
        'flex items-center p-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-750',
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
      <div className="ml-3 flex-1 min-w-0" onClick={() => onOpen(image.id)}>
        <div className="flex items-center">
          <h4 className="text-sm font-medium truncate cursor-pointer">
            {image.name || 'Untitled Image'}
          </h4>
          {image.status && (
            <Badge
              variant="outline"
              className={cn(
                'ml-2 text-xs',
                image.status === 'processed'
                  ? 'bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/40'
                  : image.status === 'processing'
                  ? 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/40'
                  : 'bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
              )}
            >
              {image.status === 'processed'
                ? 'Zpracováno'
                : image.status === 'processing'
                ? 'Zpracovává se'
                : 'Čeká'}
            </Badge>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {image.created_at &&
            format(new Date(image.created_at), 'PPP')}
        </p>
      </div>

      {/* Actions */}
      <div className="ml-4">
        <Button
          variant="outline"
          size="sm"
          className="mr-2 hidden sm:inline-flex"
          onClick={() => onOpen(image.id)}
        >
          <ExternalLink className="h-4 w-4 mr-1" />
          <span>Editor</span>
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          className="mr-2 hidden md:inline-flex"
          onClick={handleExport}
        >
          <Download className="h-4 w-4 mr-1" />
          <span>Export</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="sm:hidden"
              onClick={() => onOpen(image.id)}
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              <span>Otevřít editor</span>
            </DropdownMenuItem>
            
            <DropdownMenuItem
              className="md:hidden"
              onClick={handleExport}
            >
              <Download className="h-4 w-4 mr-2" />
              <span>Exportovat data</span>
            </DropdownMenuItem>
            
            {(window.innerWidth < 768) && <DropdownMenuSeparator />}
            
            <DropdownMenuItem
              onClick={() => onDelete(image.id)}
              className="text-red-600 dark:text-red-400 focus:text-red-700 dark:focus:text-red-300"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              <span>Smazat</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
};
