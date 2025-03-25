
import React, { useState, useEffect } from 'react';
import { Card } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { Clock, X, CheckCircle, Clock3, AlertCircle, Loader2 } from "lucide-react";
import { useLanguage } from '@/contexts/LanguageContext';
import type { SegmentationResult } from "@/lib/segmentation";
import { motion } from "framer-motion";
import { supabase } from '@/integrations/supabase/client';

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
  segmentationStatus: initialStatus, 
  onDelete, 
  onClick 
}: ImageCardProps) => {
  const { t } = useLanguage();
  const [status, setStatus] = useState(initialStatus);

  // Listen for realtime updates to this image
  useEffect(() => {
    // Set initial status
    setStatus(initialStatus);
    
    // Subscribe to changes for this specific image
    const subscription = supabase
      .channel('table-db-changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'images',
        filter: `id=eq.${id}`
      }, (payload) => {
        if (payload.new && payload.new.segmentation_status) {
          setStatus(payload.new.segmentation_status);
        }
      })
      .subscribe();
      
    // Cleanup
    return () => {
      supabase.removeChannel(subscription);
    };
  }, [id, initialStatus]);

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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <Card 
        key={id} 
        className="overflow-hidden cursor-pointer group hover:ring-2 hover:ring-blue-300 transition-all duration-200 dark:bg-gray-800 dark:border-gray-700 shadow-sm hover:shadow-md"
        onClick={onClick}
      >
        <div className="relative">
          <div className="aspect-[16/9]">
            <img 
              src={url} 
              alt={name} 
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          </div>
          
          <motion.div 
            className="absolute top-2 left-2 flex items-center space-x-1 bg-white/90 dark:bg-black/70 backdrop-blur-sm px-2 py-1 rounded-full text-xs"
            initial={{ x: -20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            {getStatusIcon(status)}
            <span className="capitalize">{t(`dashboard.${status}`)}</span>
          </motion.div>
          
          <motion.button
            className="absolute top-2 right-2 bg-white/90 dark:bg-black/70 p-1 rounded-full text-gray-700 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 0 }}
            transition={{ delay: 0.1 }}
          >
            <X className="h-4 w-4" />
          </motion.button>
          
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 text-white transform transition-transform duration-200 group-hover:translate-y-0">
            <h3 className="text-sm font-medium truncate">{name}</h3>
            <div className="flex items-center text-xs text-white/80 mt-1">
              <Clock className="h-3 w-3 mr-1" />
              <span>{formatDistanceToNow(updatedAt, { addSuffix: true })}</span>
            </div>
          </div>
        </div>
      </Card>
    </motion.div>
  );
};

export default ImageCard;
