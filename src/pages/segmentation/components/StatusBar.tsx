
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/LanguageContext';

interface StatusBarProps {
  segmentation: SegmentationResult | null;
  editMode?: string;
}

const StatusBar = ({ segmentation, editMode }: StatusBarProps) => {
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
      
      {editMode && (
        <div className="flex items-center space-x-1">
          <span className="text-gray-400">{t('segmentation.mode')}:</span>
          <span className={`${
            editMode === "edit" ? "text-purple-500" : 
            editMode === "slice" ? "text-red-500" : 
            "text-green-500"
          }`}>
            {editMode === "edit" 
              ? t('segmentation.modes.editMode') 
              : editMode === "slice" 
                ? t('segmentation.modes.slicingMode') 
                : t('segmentation.modes.pointAddingMode')}
          </span>
        </div>
      )}
    </div>
  );
};

export default StatusBar;
