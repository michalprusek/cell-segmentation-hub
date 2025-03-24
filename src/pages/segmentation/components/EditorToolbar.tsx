
import React from 'react';
import { Button } from "@/components/ui/button";
import { 
  ZoomIn, 
  ZoomOut, 
  Undo, 
  Redo,
  Trash2,
  Home,
} from 'lucide-react';
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
  onResetView
}: EditorToolbarProps) => {
  return (
    <div className="absolute top-4 left-4 z-10 bg-slate-800 border border-slate-700 rounded-lg shadow-lg flex flex-col space-y-2 p-2">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
              onClick={onZoomIn}
            >
              <ZoomIn className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Zoom In</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
              onClick={onZoomOut}
            >
              <ZoomOut className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Zoom Out</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
              onClick={onResetView}
            >
              <Home className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Reset View</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <Separator className="bg-slate-700" />
      
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
              onClick={onUndo}
              disabled={historyIndex <= 0}
            >
              <Undo className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Undo</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
              onClick={onRedo}
              disabled={historyIndex >= historyLength - 1}
            >
              <Redo className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Redo</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <Separator className="bg-slate-700" />
      
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className={`h-9 w-9 hover:bg-slate-700 ${selectedPolygonId ? 'text-red-500 hover:text-red-400' : 'text-slate-500'}`}
              onClick={onDeletePolygon}
              disabled={!selectedPolygonId}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Delete Selected Region</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      
      <div className="px-2 text-center text-xs py-1 border-t border-slate-700 mt-1 pt-1 text-slate-400">
        {Math.round(zoom * 100)}%
      </div>
    </div>
  );
};

export default EditorToolbar;
