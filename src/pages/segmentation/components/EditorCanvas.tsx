
import React from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import CanvasContainer from './canvas/CanvasContainer';
import CanvasContent from './canvas/CanvasContent';
import CanvasImage from './canvas/CanvasImage';
import CanvasPolygonLayer from './canvas/CanvasPolygonLayer';
import CanvasUIElements from './canvas/CanvasUIElements';
import CanvasLoadingOverlay from './canvas/CanvasLoadingOverlay';
import { TempPointsState } from '../types';

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
  onMouseUp: (e: React.MouseEvent) => void;
  dragState: React.MutableRefObject<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  }>;
  vertexDragState: React.MutableRefObject<{
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
  }>;
  containerRef: React.RefObject<HTMLDivElement>;
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  tempPoints: TempPointsState;
  cursorPosition: { x: number, y: number } | null;
  sliceStartPoint: { x: number, y: number } | null;
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: { x: number, y: number } | null
  };
  isShiftPressed?: boolean;
  onSelectPolygon?: (id: string) => void;
  onDeletePolygon?: (id: string) => void;
  onSlicePolygon?: (id: string) => void;
  onEditPolygon?: (id: string) => void;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
  pointAddingTempPoints?: { x: number, y: number }[];
  selectedVertexIndex?: number | null;
  selectedPolygonPoints?: { x: number, y: number }[] | null;
  sourcePolygonId?: string | null;
}

/**
 * Editor plátno - hlavní komponenta pro zobrazení a editaci segmentace
 */
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
  isShiftPressed,
  onSelectPolygon,
  onDeletePolygon,
  onSlicePolygon,
  onEditPolygon,
  onDeleteVertex,
  onDuplicateVertex,
  pointAddingTempPoints,
  selectedVertexIndex,
  selectedPolygonPoints
}: EditorCanvasProps) => {
  return (
    <CanvasContainer 
      ref={containerRef}
      onMouseDown={onMouseDown} 
      onMouseMove={onMouseMove} 
      onMouseUp={onMouseUp}
      loading={loading}
    >
      <CanvasContent zoom={zoom} offset={offset}>
        <CanvasImage 
          src={imageSrc} 
          loading={!loading && !!segmentation} 
        />
        
        {segmentation && (
          <CanvasPolygonLayer 
            segmentation={segmentation}
            imageSize={{ width: 1000, height: 1000 }}
            selectedPolygonId={selectedPolygonId}
            hoveredVertex={hoveredVertex}
            vertexDragState={{
              isDragging: vertexDragState.current.isDragging,
              polygonId: vertexDragState.current.polygonId,
              vertexIndex: vertexDragState.current.vertexIndex
            }}
            zoom={zoom}
            editMode={editMode}
            slicingMode={slicingMode}
            pointAddingMode={pointAddingMode}
            tempPoints={tempPoints}
            cursorPosition={cursorPosition}
            sliceStartPoint={sliceStartPoint}
            hoveredSegment={hoveredSegment}
            isShiftPressed={isShiftPressed}
            onSelectPolygon={onSelectPolygon}
            onDeletePolygon={onDeletePolygon}
            onSlicePolygon={onSlicePolygon}
            onEditPolygon={onEditPolygon}
            onDeleteVertex={onDeleteVertex}
            onDuplicateVertex={onDuplicateVertex}
            pointAddingTempPoints={pointAddingTempPoints}
            selectedVertexIndex={selectedVertexIndex}
            selectedPolygonPoints={selectedPolygonPoints}
          />
        )}
        
        <CanvasUIElements 
          zoom={zoom} 
          editMode={editMode}
          slicingMode={slicingMode}
          pointAddingMode={pointAddingMode}
          sliceStartPoint={sliceStartPoint}
        />
      </CanvasContent>
      
      <CanvasLoadingOverlay loading={loading} />
    </CanvasContainer>
  );
};

export default EditorCanvas;
