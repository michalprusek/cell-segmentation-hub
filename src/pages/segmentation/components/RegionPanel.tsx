
import React, { useState } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  List, 
  MoreHorizontal 
} from 'lucide-react';
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { SegmentationResult } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/LanguageContext';
import { motion } from 'framer-motion';

interface RegionPanelProps {
  loading: boolean;
  segmentation: SegmentationResult | null;
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
}

const RegionPanel = ({ 
  loading,
  segmentation, 
  selectedPolygonId, 
  onSelectPolygon: setSelectedPolygonId 
}: RegionPanelProps) => {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false); // Změněno na false, aby byl panel defaultně sbalený
  
  if (!segmentation) return null;
  
  const handlePolygonSelect = (id: string) => {
    setSelectedPolygonId(id === selectedPolygonId ? null : id);
  };
  
  return (
    <motion.div
      className="absolute top-4 right-4 z-10 w-64 bg-white dark:bg-slate-800 rounded-lg shadow-lg overflow-hidden"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="border-b border-gray-200 dark:border-gray-700">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full h-12 flex items-center justify-between px-4 font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <div className="flex items-center">
                <List className="h-5 w-5 mr-2" />
                <span>Segmentations</span>
              </div>
              {isOpen ? (
                <ChevronUp className="h-5 w-5 text-gray-500" />
              ) : (
                <ChevronDown className="h-5 w-5 text-gray-500" />
              )}
            </Button>
          </CollapsibleTrigger>
        </div>
        
        <CollapsibleContent>
          <div className="max-h-60 overflow-y-auto py-2">
            {loading ? (
              <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                {t('segmentation.loading') || 'Loading...'}
              </div>
            ) : segmentation.polygons.length === 0 ? (
              <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                {t('segmentation.noPolygons')}
              </div>
            ) : (
              segmentation.polygons.map((polygon, index) => (
                <div 
                  key={polygon.id}
                  className={`px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    polygon.id === selectedPolygonId ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                  }`}
                  onClick={() => handlePolygonSelect(polygon.id)}
                >
                  <div className="flex items-center">
                    <div className="h-3 w-3 rounded-full bg-blue-500 mr-3"></div>
                    <span className="text-sm">
                      {t('segmentation.polygon')} {index + 1}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </motion.div>
  );
};

export default RegionPanel;
