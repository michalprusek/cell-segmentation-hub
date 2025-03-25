
import React from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { SegmentationResult } from '@/lib/segmentation';
import { cn } from '@/lib/utils';
import { Layers, Check, Eye } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface RegionPanelProps {
  loading: boolean;
  segmentation: SegmentationResult | null;
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
}

const RegionPanel = ({ loading, segmentation, selectedPolygonId, onSelectPolygon }: RegionPanelProps) => {
  const { t } = useLanguage();
  
  if (loading || !segmentation) {
    return null;
  }

  return (
    <div className="absolute top-0 right-0 p-4 z-10">
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2 }}
          className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm shadow-lg rounded-lg overflow-hidden min-w-[240px]"
        >
          <div className="p-3 border-b dark:border-gray-700 flex items-center">
            <Layers className="w-5 h-5 mr-2 text-blue-500" />
            <h3 className="font-medium">Segmentations</h3>
          </div>
          
          {segmentation.polygons.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('segmentation.noPolygons')}
            </div>
          ) : (
            <ul className="max-h-[300px] overflow-y-auto p-1">
              {segmentation.polygons.map((polygon) => (
                <li 
                  key={polygon.id}
                  className={cn(
                    "flex items-center p-2 rounded-md cursor-pointer mb-1 transition-colors",
                    selectedPolygonId === polygon.id
                      ? "bg-blue-100 dark:bg-blue-900/40"
                      : "hover:bg-gray-100 dark:hover:bg-gray-700/40"
                  )}
                  onClick={() => onSelectPolygon(polygon.id)}
                >
                  <div 
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: selectedPolygonId === polygon.id ? '#FF3B30' : '#00BFFF' }}
                  />
                  <span className={cn(
                    "flex-1 text-sm",
                    selectedPolygonId === polygon.id ? "font-medium" : ""
                  )}>
                    {t('segmentation.polygon')} {segmentation.polygons.indexOf(polygon) + 1}
                  </span>
                  
                  {selectedPolygonId === polygon.id && (
                    <Check className="w-4 h-4 text-blue-500 ml-2" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

export default RegionPanel;
