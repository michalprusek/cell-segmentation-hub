
import React from 'react';
import { CheckCircle, AlertCircle, Info } from 'lucide-react';
import { SegmentationResult } from '@/lib/segmentation';
import { formatDistanceToNow } from 'date-fns';
import { cs } from 'date-fns/locale';

interface StatusBarProps {
  segmentation: SegmentationResult | null;
}

const StatusBar = ({ segmentation }: StatusBarProps) => {
  if (!segmentation) {
    return (
      <div className="bg-slate-800 border-t border-slate-700 p-2 px-4 flex justify-between items-center">
        <div className="flex items-center">
          <Info className="h-4 w-4 text-slate-400 mr-2" />
          <span className="text-sm text-slate-400">Čekání na data...</span>
        </div>
        <div className="text-sm text-slate-500">
          0 regionů
        </div>
      </div>
    );
  }
  
  // Zjištění stavu
  const isComplete = segmentation.status === 'completed';
  const polygonCount = segmentation?.polygons.length || 0;
  const timestamp = segmentation.timestamp 
    ? formatDistanceToNow(new Date(segmentation.timestamp), { addSuffix: true, locale: cs })
    : '';
  
  return (
    <div className="bg-slate-800 border-t border-slate-700 p-2 px-4 flex justify-between items-center">
      <div className="flex items-center space-x-4">
        <div className="flex items-center">
          {isComplete ? (
            <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
          ) : (
            <AlertCircle className="h-4 w-4 text-amber-500 mr-2" />
          )}
          <span className="text-sm">
            {isComplete ? 'Segmentace dokončena' : 'Probíhá zpracování'}
          </span>
        </div>
        
        {timestamp && (
          <div className="text-sm text-slate-400">
            Upraveno {timestamp}
          </div>
        )}
      </div>
      
      <div className="flex items-center space-x-4">
        <div className="text-sm px-2 py-1 bg-slate-700 rounded-md">
          {polygonCount} {polygonCount === 1 ? 'region' : 
                          (polygonCount > 1 && polygonCount < 5) ? 'regiony' : 'regionů'}
        </div>
        <div className="text-xs text-slate-500">
          ID: {segmentation.id}
        </div>
      </div>
    </div>
  );
};

export default StatusBar;
