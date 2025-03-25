
import React from 'react';
import { Button } from "@/components/ui/button";
import { 
  ZoomIn, 
  ZoomOut, 
  Home,
  Save,
  Edit,
  Undo2,
  Redo2
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
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onSave: () => Promise<void>;
  editMode: boolean;
  onToggleEditMode: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const EditorToolbar = ({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetView,
  onSave,
  editMode,
  onToggleEditMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo
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
              variant={editMode ? "default" : "ghost"}
              size="icon" 
              className={`h-9 w-9 ${editMode ? 'bg-red-600 text-white hover:bg-red-700' : 'text-slate-300 hover:bg-slate-700 hover:text-white bg-slate-800/90'}`}
              onClick={onToggleEditMode}
            >
              <Edit className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>{editMode ? "Exit Edit Mode" : "Enter Edit Mode"} (Shortcut: E)</span>
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
              disabled={!canUndo}
            >
              <Undo2 className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>Undo (Shortcut: Ctrl+Z)</span>
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
              disabled={!canRedo}
            >
              <Redo2 className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="bg-slate-900 border-slate-700">
            <span>Redo (Shortcut: Ctrl+Y)</span>
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
    </motion.div>
  );
};

export default EditorToolbar;
