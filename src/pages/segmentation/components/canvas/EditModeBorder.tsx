
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

  // Vylepšení viditelnosti okrajů
  const getBorderColor = () => {
    if (slicingMode) return "#FF3B30";
    if (pointAddingMode) return "#4CAF50";
    return "#FF9500";
  };

  return (
    <rect
      x={0}
      y={0}
      width={imageSize.width}
      height={imageSize.height}
      fill="none"
      stroke={getBorderColor()}
      strokeWidth={4/zoom}
      strokeDasharray={`${10/zoom},${8/zoom}`}
      pointerEvents="none"
      vectorEffect="non-scaling-stroke"
      filter="url(#border-glow)"
    />
  );
};

export default EditModeBorder;
