
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/LanguageContext';

interface StatusBarProps {
  segmentation: SegmentationResult | null;
}

const StatusBar = ({ segmentation }: StatusBarProps) => {
  const { t } = useLanguage();
  
  // Výpočet celkového počtu vrcholů ve všech polygonech
  const totalVertices = React.useMemo(() => {
    if (!segmentation) return 0;
    
    return segmentation.polygons.reduce((sum, polygon) => {
      return sum + polygon.points.length;
    }, 0);
  }, [segmentation]);
  
  return (
    <div className="absolute bottom-0 left-0 right-0 bg-slate-800/90 backdrop-blur-sm text-white py-1.5 px-4 flex items-center justify-between text-xs">
      <div className="flex items-center space-x-4">
        <div>
          {t('segmentation.totalPolygons').replace('{count}', String(segmentation?.polygons.length || 0))}
        </div>
        <div>
          {t('segmentation.totalVertices').replace('{count}', String(totalVertices))}
        </div>
      </div>
      
      <div className="flex items-center space-x-2">
        <div className="text-green-400">
          {t('common.segmentation')} {segmentation ? 'ID: ' + segmentation.id.substring(0, 8) : ''}
        </div>
        <div className={`px-2 py-0.5 rounded-full text-xs flex items-center ${getStatusColor(segmentation?.status)}`}>
          {segmentation?.status && t(`segmentation.${segmentation.status}Segmentation`)}
        </div>
      </div>
    </div>
  );
};

// Helper funkce pro stanovení barvy podle stavu segmentace
const getStatusColor = (status?: 'pending' | 'processing' | 'completed' | 'failed') => {
  switch (status) {
    case 'completed':
      return 'bg-green-700/40 text-green-300';
    case 'pending':
      return 'bg-yellow-700/40 text-yellow-300';
    case 'processing':
      return 'bg-blue-700/40 text-blue-300';
    case 'failed':
      return 'bg-red-700/40 text-red-300';
    default:
      return 'bg-gray-700/40 text-gray-300';
  }
};

export default StatusBar;
