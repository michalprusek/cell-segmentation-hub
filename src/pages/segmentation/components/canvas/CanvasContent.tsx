
import React from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { SegmentationResult, Point } from '@/lib/segmentation';
import { VertexDragState, TempPointsState } from '@/pages/segmentation/types';
import CanvasLoadingOverlay from './CanvasLoadingOverlay';
import CanvasImage from './CanvasImage';
import CanvasPolygonLayer from './CanvasPolygonLayer';

interface CanvasContentProps {
  loading: boolean;
  segmentation: SegmentationResult | null;
  imageSrc: string;
  transformRef: React.RefObject<HTMLDivElement>;
  zoom: number;
  offset: { x: number; y: number };
  imageSize: { width: number; height: number };
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  vertexDragState: React.MutableRefObject<VertexDragState>;
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

/**
 * Hlavní obsah plátna s obrázkem a polygony
 */
const CanvasContent = ({
  loading,
  segmentation,
  imageSrc,
  transformRef,
  zoom,
  offset,
  imageSize,
  selectedPolygonId,
  hoveredVertex,
  vertexDragState,
  editMode,
  slicingMode,
  pointAddingMode,
  tempPoints,
  cursorPosition,
  sliceStartPoint,
  hoveredSegment,
  isShiftPressed
}: CanvasContentProps) => {
  return (
    <AnimatePresence mode="wait">
      {loading && <CanvasLoadingOverlay loading={loading} />}
      
      {!loading && (
        <motion.div 
          key="canvas-container"
          className="absolute inset-0 flex items-center justify-center overflow-visible"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div 
            ref={transformRef}
            style={{ 
              transform: `translate(${offset.x * zoom}px, ${offset.y * zoom}px) scale(${zoom})`,
              transformOrigin: '0 0',
              willChange: 'transform',
              position: 'absolute',
              top: 0,
              left: 0
            }}
            className="absolute top-0 left-0"
            data-testid="canvas-transform-container"
          >
            {segmentation && (
              <CanvasImage src={segmentation.imageSrc || imageSrc} alt="Source" />
            )}
            
            {segmentation && imageSize.width > 0 && (
              <CanvasPolygonLayer 
                segmentation={segmentation}
                imageSize={imageSize}
                selectedPolygonId={selectedPolygonId}
                hoveredVertex={hoveredVertex}
                vertexDragState={vertexDragState}
                zoom={zoom}
                editMode={editMode}
                slicingMode={slicingMode}
                pointAddingMode={pointAddingMode}
                tempPoints={tempPoints}
                cursorPosition={cursorPosition}
                sliceStartPoint={sliceStartPoint}
                hoveredSegment={hoveredSegment}
                isShiftPressed={isShiftPressed}
              />
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CanvasContent;
