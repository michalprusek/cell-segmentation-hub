
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
            Regions
          </Button>
        </SheetTrigger>
        <SheetContent className="bg-slate-800 border-slate-700 text-white">
          <SheetHeader>
            <SheetTitle className="text-white">Segmentation Regions</SheetTitle>
            <SheetDescription className="text-slate-400">
              View and manage detected regions
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
              </div>
            ) : segmentation?.polygons.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <div className="mb-2">No regions detected</div>
                <Button variant="outline" size="sm">
                  Run Detection Again
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
                      <span>Region {index + 1}</span>
                    </div>
                    <span className="text-xs text-slate-400">{polygon.points.length} points</span>
                  </div>
                ))}
              </div>
            )}
            <Separator className="my-4 bg-slate-700" />
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Statistics</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 bg-slate-700 rounded-md">
                  <div className="text-xs text-slate-400">Total Regions</div>
                  <div className="text-lg font-semibold">{segmentation?.polygons.length || 0}</div>
                </div>
                <div className="p-2 bg-slate-700 rounded-md">
                  <div className="text-xs text-slate-400">Selected</div>
                  <div className="text-lg font-semibold">{selectedPolygonId ? 'Yes' : 'No'}</div>
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
            <SheetTitle className="text-white">Segmentation Editor Help</SheetTitle>
            <SheetDescription className="text-slate-400">
              Instructions and keyboard shortcuts
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div>
              <h3 className="text-sm font-medium mb-2">Navigation</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex justify-between items-center">
                  <span>Pan the image</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Click and drag</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>Zoom in/out</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Mouse wheel or toolbar</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>Reset view</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Home button</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2">Editing</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex justify-between items-center">
                  <span>Select a region</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Click on it</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>Move a vertex</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Drag the vertex point</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>Delete selected region</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Trash icon or Delete key</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2">Keyboard Shortcuts</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li className="flex justify-between items-center">
                  <span>Undo</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Ctrl+Z</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>Redo</span>
                  <span className="text-xs bg-slate-700 px-2 py-1 rounded">Ctrl+Y</span>
                </li>
                <li className="flex justify-between items-center">
                  <span>Save</span>
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
