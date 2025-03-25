
import React from 'react';
import { formatDistanceToNow } from "date-fns";
import { Clock, X, CheckCircle, Clock3, AlertCircle, Loader2, ArrowRight } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';
import type { SegmentationResult } from "@/lib/segmentation";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

interface ImageListItemProps {
  id: string;
  name: string;
  url: string;
  updatedAt: Date;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  segmentationResult?: SegmentationResult;
  onDelete: (id: string) => void;
  onClick: () => void;
}

const ImageListItem = ({ 
  id, 
  name, 
  url, 
  updatedAt, 
  segmentationStatus, 
  onDelete, 
  onClick 
}: ImageListItemProps) => {
  const { t } = useLanguage();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
      case 'pending':
        return <Clock3 className="h-4 w-4 text-yellow-500" />;
      case 'failed':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <motion.div 
      className="flex items-center p-4 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClick}
      whileHover={{ backgroundColor: "rgba(0,0,0,0.03)" }}
    >
      <div className="flex-shrink-0 w-16 h-16 mr-4 overflow-hidden rounded-md">
        <img
          src={url}
          alt={name}
          className="w-full h-full object-cover"
        />
      </div>
      
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-medium truncate dark:text-white">{name}</h3>
        <div className="flex items-center mt-1">
          <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mr-3">
            <Clock className="h-3 w-3 mr-1" />
            <span>{formatDistanceToNow(updatedAt, { addSuffix: true })}</span>
          </div>
          
          <div className="flex items-center space-x-1 bg-white/90 dark:bg-black/70 backdrop-blur-sm px-2 py-0.5 rounded-full text-xs">
            {getStatusIcon(segmentationStatus)}
            <span className="capitalize">{t(`dashboard.${segmentationStatus}`)}</span>
          </div>
        </div>
      </div>
      
      <div className="flex items-center ml-4 space-x-2">
        <Button 
          variant="ghost" 
          size="icon"
          className="text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(id);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
        <Button 
          variant="ghost" 
          size="icon"
          className="text-gray-500 h-8 w-8"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
};

export default ImageListItem;
