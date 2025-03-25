
import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { MoreHorizontal, Trash2, ExternalLink, Download } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ProjectImage } from '@/integrations/supabase/types';
import { useNavigate } from 'react-router-dom';

interface ImageCardProps {
  image: ProjectImage;
  onDelete: (imageId: string) => void;
  onOpen: (imageId: string) => void;
  className?: string;
}

export const ImageCard = ({ image, onDelete, onOpen, className }: ImageCardProps) => {
  const navigate = useNavigate();
  
  const handleExport = () => {
    navigate(`/segmentation/${image.project_id}/${image.id}/export`);
  };
  
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
          "overflow-hidden border-gray-200 dark:border-gray-700 transition-all group hover:shadow-md", 
          className
        )}
      >
        {/* Image preview */}
        <div 
          className="aspect-square bg-gray-100 dark:bg-gray-800 relative overflow-hidden"
          onClick={() => onOpen(image.id)}
        >
          {image.thumbnail_url ? (
            <img 
              src={image.thumbnail_url} 
              alt={image.name || 'Image'} 
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 cursor-pointer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-200 dark:bg-gray-700">
              <span className="text-gray-400 dark:text-gray-500">No preview</span>
            </div>
          )}
          
          {/* Status badge */}
          {image.status && (
            <div className={cn(
              "absolute top-2 left-2 px-2 py-1 rounded-md text-xs font-medium",
              image.status === 'processed' 
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                : image.status === 'processing'
                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100"
            )}>
              {image.status === 'processed' ? 'Zpracováno' : 
               image.status === 'processing' ? 'Zpracovává se' : 'Čeká'}
            </div>
          )}
        </div>
        
        <CardContent className="p-3">
          <div className="flex justify-between items-center">
            <div className="truncate flex-1">
              <h3 className="font-medium text-sm truncate" title={image.name || 'Image'}>
                {image.name || 'Image'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {image.created_at && format(new Date(image.created_at), 'PPP')}
              </p>
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => onOpen(image.id)}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  <span>Otevřít editor</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleExport}>
                  <Download className="h-4 w-4 mr-2" />
                  <span>Exportovat data</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
        </CardContent>
      </Card>
    </motion.div>
  );
};
