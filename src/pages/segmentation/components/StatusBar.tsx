
import React from 'react';
import { CheckCircle } from 'lucide-react';
import { SegmentationResult } from '@/lib/segmentation';

interface StatusBarProps {
  segmentation: SegmentationResult | null;
}

const StatusBar = ({ segmentation }: StatusBarProps) => {
  return (
    <div className="bg-slate-800 border-t border-slate-700 p-2 px-4 flex justify-between items-center">
      <div className="flex items-center">
        <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
        <span className="text-sm">Segmentation Complete</span>
      </div>
      <div className="text-sm text-slate-400">
        {segmentation?.polygons.length || 0} regions detected
      </div>
    </div>
  );
};

export default StatusBar;
