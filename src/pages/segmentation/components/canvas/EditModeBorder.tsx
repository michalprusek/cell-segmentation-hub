
import React from 'react';

interface EditModeBorderProps {
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  imageSize: { width: number, height: number };
  zoom: number;
}

const EditModeBorder = ({ 
  editMode, 
  slicingMode, 
  pointAddingMode, 
  imageSize, 
  zoom 
}: EditModeBorderProps) => {
  if (!editMode && !slicingMode && !pointAddingMode) return null;

  return (
    <rect
      x={0}
      y={0}
      width={imageSize.width}
      height={imageSize.height}
      fill="none"
      stroke={
        slicingMode ? "#FF0000" : 
        pointAddingMode ? "#4CAF50" : 
        "#FF3B30"
      }
      strokeWidth={3/zoom}
      strokeDasharray={`${8/zoom},${8/zoom}`}
      pointerEvents="none"
      vectorEffect="non-scaling-stroke"
    />
  );
};

export default EditModeBorder;
