
import React from 'react';
import { Card } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { Clock, X, CheckCircle, Clock3, AlertCircle, Loader2 } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';
import type { SegmentationResult } from "@/lib/segmentation";

interface ImageCardProps {
  id: string;
  name: string;
  url: string;
  updatedAt: Date;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  segmentationResult?: SegmentationResult;
  onDelete: (id: string) => void;
  onClick: () => void;
}

const ImageCard = ({ 
  id, 
  name, 
  url, 
  updatedAt, 
  segmentationStatus, 
  onDelete, 
  onClick 
}: ImageCardProps) => {
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
    <Card 
      key={id} 
      className="overflow-hidden cursor-pointer group hover:ring-2 hover:ring-blue-200 transition-all duration-200 dark:bg-gray-800 dark:border-gray-700"
      onClick={onClick}
    >
      <div className="relative">
        <div className="aspect-[16/9]">
          <img 
            src={url} 
            alt={name} 
            className="h-full w-full object-cover"
          />
        </div>
        
        <div className="absolute top-2 left-2 flex items-center space-x-1 bg-white/90 dark:bg-black/70 backdrop-blur-sm px-2 py-1 rounded-full text-xs">
          {getStatusIcon(segmentationStatus)}
          <span className="capitalize">{t(`dashboard.${segmentationStatus}`)}</span>
        </div>
        
        <button
          className="absolute top-2 right-2 bg-white/90 dark:bg-black/70 p-1 rounded-full text-gray-700 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(id);
          }}
        >
          <X className="h-4 w-4" />
        </button>
        
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white">
          <h3 className="text-sm font-medium truncate">{name}</h3>
          <div className="flex items-center text-xs text-white/80 mt-1">
            <Clock className="h-3 w-3 mr-1" />
            <span>{formatDistanceToNow(updatedAt, { addSuffix: true })}</span>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default ImageCard;
