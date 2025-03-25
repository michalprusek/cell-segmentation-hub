
import React from 'react';
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Layers, Info, Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SegmentationResult } from '@/lib/segmentation';
import { useLanguage } from '@/contexts/LanguageContext';

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
  onSelectPolygon
}: RegionPanelProps) => {
  const { t } = useLanguage();
  
  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button 
            variant="outline" 
            size="sm"
            className="absolute top-4 right-4 z-10 bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
          >
            <Layers className="h-4 w-4 mr-2" />
            Segmentations
          </Button>
        </SheetTrigger>
        <SheetContent className="bg-slate-800 border-slate-700 text-white">
          <SheetHeader>
            <SheetTitle className="text-white">{t('segmentation.title')}</SheetTitle>
            <SheetDescription className="text-slate-400">
              {t('segmentation.description')}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
              </div>
            ) : segmentation?.polygons.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <div className="mb-2">{t('segmentation.noRegions')}</div>
                <Button variant="outline" size="sm">
                  {t('segmentation.runDetectionAgain')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {segmentation?.polygons.map((polygon, index) => (
                  <div 
                    key={polygon.id}
                    className={`p-3 rounded-md cursor-pointer flex items-center justify-between ${
                      selectedPolygonId === polygon.id ? 'bg-blue-900 bg-opacity-30 border border-blue-500' : 'hover:bg-slate-700'
                    }`}
                    onClick={() => onSelectPolygon(polygon.id)}
                  >
                    <div className="flex items-center">
                      <div 
                        className="w-4 h-4 rounded-full mr-3" 
                        style={{background: selectedPolygonId === polygon.id ? '#FF3B30' : '#00BFFF'}}
                      />
                      <span>{t('segmentation.region')} {index + 1}</span>
                    </div>
                    <span className="text-xs text-slate-400">{polygon.points.length} {t('segmentation.points')}</span>
                  </div>
                ))}
              </div>
            )}
            <Separator className="my-4 bg-slate-700" />
            <div className="space-y-4">
              <h3 className="text-sm font-medium">{t('segmentation.statistics')}</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-slate-700 rounded-md">
                  <div className="text-xs text-slate-400">{t('segmentation.totalPolygons')}</div>
                  <div className="text-lg font-semibold">{segmentation?.polygons.length || 0}</div>
                </div>
                <div className="p-2 bg-slate-700 rounded-md">
                  <div className="text-xs text-slate-400">{t('segmentation.selected')}</div>
                  <div className="text-lg font-semibold">{selectedPolygonId ? t('common.yes') : t('common.no')}</div>
                </div>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      
      {/* Help button */}
      <Sheet>
        <SheetTrigger asChild>
          <Button 
            variant="outline" 
            size="icon"
            className="absolute bottom-4 right-4 z-10 rounded-full h-10 w-10 bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
          >
            <Info className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent className="bg-slate-800 border-slate-700 text-white">
          <SheetHeader>
            <SheetTitle className="text-white">{t('segmentation.helpTitle')}</SheetTitle>
            <SheetDescription className="text-slate-400">
              {t('segmentation.helpDescription')}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">{t('segmentation.navigation')}</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.panImage')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">{t('segmentation.clickAndDrag')}</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.zoomInOut')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">{t('segmentation.mouseWheel')}</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.resetView')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">{t('segmentation.homeButton')}</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2">{t('segmentation.editing')}</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.selectRegion')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">{t('segmentation.clickOnIt')}</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.moveVertex')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">{t('segmentation.dragVertex')}</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.deleteRegion')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">{t('segmentation.deleteKey')}</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2">{t('segmentation.shortcuts')}</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.undo')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Ctrl+Z</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.redo')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Ctrl+Y</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>{t('segmentation.save')}</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Ctrl+S</span>
                </li>
              </ul>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default RegionPanel;
