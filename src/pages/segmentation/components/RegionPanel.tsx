
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';

interface RegionPanelProps {
  loading: boolean;
  segmentation: SegmentationResult | null;
  selectedPolygonId: string | null;
  onSelectPolygon: (id: string | null) => void;
}

const RegionPanel = ({ loading, segmentation, selectedPolygonId, onSelectPolygon }: RegionPanelProps) => {
  if (loading || !segmentation) {
    return null;
  }
  
  return (
    <div className="absolute right-4 top-4 max-h-[70vh] w-64 overflow-auto rounded-lg bg-card shadow-lg border border-border z-10">
      <div className="p-3 font-medium border-b border-border bg-muted/50">
        <h3 className="text-lg font-semibold">Segmentations</h3>
      </div>
      
      <div className="p-2 space-y-1">
        {segmentation.polygons.map((polygon) => (
          <div
            key={polygon.id}
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
