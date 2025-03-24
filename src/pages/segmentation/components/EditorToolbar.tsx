
import React from 'react';
import { Button } from "@/components/ui/button";
import { 
  ZoomIn, 
  ZoomOut, 
  Undo, 
  Redo,
  Trash2,
  Home,
  Save,
  Download,
  Upload
} from 'lucide-react';
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { motion } from "framer-motion";
import { useLanguage } from '@/contexts/LanguageContext';

interface EditorToolbarProps {
  zoom: number;
  historyIndex: number;
  historyLength: number;
  selectedPolygonId: string | null;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeletePolygon: () => void;
  onResetView: () => void;
  onSave: () => Promise<void>;
}

const EditorToolbar = ({
  zoom,
  historyIndex,
  historyLength,
  selectedPolygonId,
  onZoomIn,
  onZoomOut,
  onUndo,
  onRedo,
  onDeletePolygon,
  onResetView,
  onSave
}: EditorToolbarProps) => {
  const { t } = useLanguage();
  
  return (
    <motion.div 
      className="absolute top-4 left-4 z-10 bg-slate-800/95 border border-slate-700 rounded-lg shadow-xl flex flex-col space-y-2 p-2 backdrop-blur-sm"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      <div className="px-2 py-1 text-center text-xs font-semibold text-slate-300 border-b border-slate-700 mb-1">
        {t('tools.title')}
      </div>
      
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white bg-slate-800/90"
              onClick={onZoomIn}
            >
              <ZoomIn className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{t('tools.zoomIn')} (Shortcut: +)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white bg-slate-800/90"
              onClick={onZoomOut}
            >
              <ZoomOut className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{t('tools.zoomOut')} (Shortcut: -)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white bg-slate-800/90"
              onClick={onResetView}
            >
              <Home className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{t('tools.resetView')} (Shortcut: R)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <Separator className="bg-slate-700 my-1" />
      
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white bg-slate-800/90"
              onClick={onUndo}
              disabled={historyIndex <= 0}
            >
              <Undo className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{t('tools.undo')} (Shortcut: Ctrl+Z)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white bg-slate-800/90"
              onClick={onRedo}
              disabled={historyIndex >= historyLength - 1}
            >
              <Redo className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{t('tools.redo')} (Shortcut: Ctrl+Shift+Z)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <Separator className="bg-slate-700 my-1" />
      
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className={`h-9 w-9 hover:bg-slate-700 ${selectedPolygonId ? 'text-red-500 hover:text-red-400 bg-slate-900/80' : 'text-slate-500 bg-slate-800/80'}`}
              onClick={onDeletePolygon}
              disabled={!selectedPolygonId}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{t('tools.deleteRegion')} (Shortcut: Delete)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <Separator className="bg-slate-700 my-1" />
      
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-green-500 hover:bg-slate-700 hover:text-green-400 bg-slate-800/90"
              onClick={onSave}
            >
              <Save className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{t('tools.saveSegmentation')} (Shortcut: Ctrl+S)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-blue-500 hover:bg-slate-700 hover:text-blue-400 bg-slate-800/90"
            >
              <Download className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{t('tools.exportData')} (Shortcut: Ctrl+E)</span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </motion.div>
  );
};

export default EditorToolbar;
