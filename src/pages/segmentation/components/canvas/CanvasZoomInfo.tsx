import React from 'react';

interface CanvasZoomInfoProps {
  zoom: number;
}

const CanvasZoomInfo = ({ zoom }: CanvasZoomInfoProps) => {
  return (
    <div className="absolute bottom-4 left-4 bg-slate-800/80 px-3 py-1 rounded-md text-sm backdrop-blur-sm">
      {Math.round(zoom * 100)}%
    </div>
  );
};

export default CanvasZoomInfo;
