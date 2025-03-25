
import React, { useEffect, useRef } from 'react';
import { SegmentationResult } from '@/lib/segmentation';

interface RegionPanelProps {
  loading: boolean;
  segmentation: SegmentationResult | null;
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
}

const RegionPanel = ({ loading, segmentation, selectedPolygonId, onSelectPolygon }: RegionPanelProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);
  
  // Effect to scroll to the selected item
  useEffect(() => {
    if (selectedItemRef.current && panelRef.current) {
      const panel = panelRef.current;
      const selectedItem = selectedItemRef.current;
      
      // Calculate scroll position to ensure the selected item is visible
      const itemTop = selectedItem.offsetTop;
      const itemHeight = selectedItem.offsetHeight;
      const panelTop = panel.scrollTop;
      const panelHeight = panel.clientHeight;
      
      // Check if the item is not fully visible
      if (itemTop < panelTop) {
        // Item is above visible area
        panel.scrollTop = itemTop;
      } else if (itemTop + itemHeight > panelTop + panelHeight) {
        // Item is below visible area
        panel.scrollTop = itemTop + itemHeight - panelHeight;
      }
    }
  }, [selectedPolygonId]);
  
  if (loading || !segmentation) {
    return null;
  }
  
  return (
    <div className="absolute right-4 top-4 max-h-[70vh] w-64 overflow-hidden rounded-lg bg-card shadow-lg border border-border z-10 flex flex-col">
      <div className="p-3 font-medium border-b border-border bg-muted/50 sticky top-0">
        <h3 className="text-lg font-semibold">Segmentations</h3>
      </div>
      
      <div 
        ref={panelRef}
        className="p-2 space-y-1 overflow-y-auto max-h-[calc(70vh-50px)]"
      >
        {segmentation.polygons.map((polygon) => (
          <div
            key={polygon.id}
            ref={selectedPolygonId === polygon.id ? selectedItemRef : null}
            className={`p-2 cursor-pointer rounded-md transition-colors flex items-center space-x-2 ${
              selectedPolygonId === polygon.id
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted/50'
            }`}
            onClick={() => onSelectPolygon(polygon.id)}
          >
            <div
              className="h-3 w-3 rounded-full"
              style={{
                backgroundColor: selectedPolygonId === polygon.id ? '#FFFFFF' : '#00BFFF',
                border: selectedPolygonId === polygon.id ? '1px solid #FFFFFF' : 'none',
              }}
            />
            <span>{`segmentation polygon ${segmentation.polygons.findIndex(p => p.id === polygon.id) + 1}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RegionPanel;
