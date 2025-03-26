
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { SegmentationResult, Point } from '@/lib/segmentation';
import { DragState, VertexDragState, TempPointsState } from '../types';
import CanvasLoadingOverlay from './canvas/CanvasLoadingOverlay';
import CanvasImage from './canvas/CanvasImage';
import CanvasPolygonLayer from './canvas/CanvasPolygonLayer';
import CanvasZoomInfo from './canvas/CanvasZoomInfo';
import { useTheme } from '@/contexts/ThemeContext';
import EditorHelpTips from './EditorHelpTips';
import EditorModeFooter from './canvas/EditorModeFooter';

interface EditorCanvasProps {
  loading: boolean;
  segmentation: SegmentationResult | null;
  zoom: number;
  offset: { x: number; y: number };
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  imageSrc: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  dragState: React.MutableRefObject<DragState>;
  vertexDragState: React.MutableRefObject<VertexDragState>;
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  tempPoints: TempPointsState;
  cursorPosition: Point | null;
  sliceStartPoint: Point | null;
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  isShiftPressed?: boolean;
}

const EditorCanvas = ({
  loading,
  segmentation,
  zoom,
  offset,
  selectedPolygonId,
  hoveredVertex,
  imageSrc,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  dragState,
  vertexDragState,
  containerRef,
  editMode,
  slicingMode,
  pointAddingMode,
  tempPoints,
  cursorPosition,
  sliceStartPoint,
  hoveredSegment,
  isShiftPressed
}: EditorCanvasProps) => {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const { theme } = useTheme();
  const transformRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!imageSrc) return;
    
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      setImageSize({
        width: img.width,
        height: img.height
      });
      console.log(`Image loaded with dimensions: ${img.width}x${img.height}`);
    };
    
    img.src = segmentation?.imageSrc || imageSrc;
  }, [segmentation, imageSrc]);

  return (
    <CanvasContainer 
      containerRef={containerRef}
      activeMode={{ editMode, slicingMode, pointAddingMode }}
      vertexDragState={vertexDragState.current}
      dragState={dragState.current}
      hoveredVertex={hoveredVertex}
      theme={theme}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      <CanvasContent 
        loading={loading}
        segmentation={segmentation}
        imageSrc={imageSrc}
        transformRef={transformRef}
        zoom={zoom}
        offset={offset}
        imageSize={imageSize}
        selectedPolygonId={selectedPolygonId}
        hoveredVertex={hoveredVertex}
        vertexDragState={vertexDragState}
        editMode={editMode}
        slicingMode={slicingMode}
        pointAddingMode={pointAddingMode}
        tempPoints={tempPoints}
        cursorPosition={cursorPosition}
        sliceStartPoint={sliceStartPoint}
        hoveredSegment={hoveredSegment}
        isShiftPressed={isShiftPressed}
      />
      
      <CanvasUIElements 
        zoom={zoom}
        editMode={editMode}
        slicingMode={slicingMode}
        pointAddingMode={pointAddingMode}
        isShiftPressed={isShiftPressed}
        sliceStartPoint={sliceStartPoint}
      />
    </CanvasContainer>
  );
};

export default EditorCanvas;
