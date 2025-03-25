
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/LanguageContext';

interface StatusBarProps {
  segmentation: SegmentationResult | null;
}

const StatusBar = ({ segmentation }: StatusBarProps) => {
  const { t } = useLanguage();
  
  if (!segmentation) return null;
  
  // Vypočítáme celkový počet bodů napříč všemi polygony
  const totalVertices = segmentation.polygons.reduce(
    (sum, polygon) => sum + polygon.points.length, 
    0
  );
  
  return (
    <div className="absolute bottom-0 left-0 right-0 h-8 bg-gray-800/90 dark:bg-black/80 text-white flex items-center justify-center space-x-8 text-xs">
      <div className="flex items-center space-x-1">
        <span className="text-gray-400">{t('segmentation.totalPolygons')}:</span>
        <span>{segmentation.polygons.length}</span>
      </div>
      
      <div className="flex items-center space-x-1">
        <span className="text-gray-400">{t('segmentation.totalVertices')}:</span>
        <span>{totalVertices}</span>
      </div>
      
      <div className="flex items-center space-x-1">
        <span className="text-gray-400">{t('segmentation.completedSegmentation')}:</span>
        <span className="text-green-500">{segmentation.id ? t('common.yes') : t('common.no')}</span>
      </div>
      
      {segmentation.id && (
        <div className="flex items-center space-x-1">
          <span className="text-gray-400">{t('common.segmentation')} ID:</span>
          <span className="text-blue-400">seg-{segmentation.id.substring(0, 4)}</span>
        </div>
      )}
    </div>
  );
};

export default StatusBar;
