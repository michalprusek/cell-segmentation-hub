
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
  
  // Načtení obrázku a zjištění jeho velikosti
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

  // Správné nastavení cursoru podle stavu
  const getCursorStyle = () => {
    if (editMode) return 'crosshair';
    if (slicingMode) return 'crosshair';
    if (pointAddingMode) return 'cell';
    if (vertexDragState.current.isDragging) return 'grabbing';
    if (dragState.current.isDragging) return 'grabbing';
    if (hoveredVertex.polygonId !== null) return 'grab';
    return 'move';
  };

  // Určení barvy okraje pro aktivní režim
  const getActiveModeBorderClass = () => {
    if (slicingMode) return 'border-2 border-red-500 shadow-lg shadow-red-500/20';
    if (pointAddingMode) return 'border-2 border-green-500 shadow-lg shadow-green-500/20';
    if (editMode) return 'border-2 border-orange-500 shadow-lg shadow-orange-500/20';
    return '';
  };

  // Vylepšené pozadí pro lepší kontrast
  const getBackgroundPattern = () => {
    return theme === 'dark' 
      ? 'bg-[#161616] bg-opacity-90 bg-[radial-gradient(#2a2f3c_1px,transparent_1px)]' 
      : 'bg-gray-100 bg-opacity-80 bg-[radial-gradient(#d1d5db_1px,transparent_1px)]';
  };

  return (
    <div 
      ref={containerRef} 
      className={`flex-1 overflow-hidden relative ${getBackgroundPattern()} bg-[size:20px_20px] aspect-square max-h-[calc(100vh-12rem)] ${getActiveModeBorderClass()} rounded-lg`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{cursor: getCursorStyle()}}
      data-testid="canvas-container"
    >
      <AnimatePresence mode="wait">
        {/* Zobrazení stavu načítání */}
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
              {/* Obrázek na pozadí */}
              {segmentation && (
                <CanvasImage src={segmentation.imageSrc || imageSrc} alt="Source" />
              )}
              
              {/* SVG vrstva s polygony */}
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
      
      {/* Informace o zoomu */}
      <CanvasZoomInfo zoom={zoom} />
      
      {/* Editační režim indikátor */}
      {editMode && (
        <div className="absolute bottom-4 left-4 bg-gradient-to-r from-orange-600 to-orange-500 text-white px-4 py-2 rounded-md text-sm font-semibold shadow-lg">
          Edit Mode - Vytváření nového polygonu {isShiftPressed && "(Auto-přidávání při držení Shift)"}
        </div>
      )}
      
      {/* Slicing režim indikátor */}
      {slicingMode && (
        <div className="absolute bottom-4 left-4 bg-gradient-to-r from-red-600 to-red-500 text-white px-4 py-2 rounded-md text-sm font-semibold shadow-lg">
          Slicing Mode - Rozdělení polygonu {sliceStartPoint ? "(Klikněte pro dokončení)" : "(Klikněte pro začátek)"}
        </div>
      )}
      
      {/* Point adding režim indikátor */}
      {pointAddingMode && (
        <div className="absolute bottom-4 left-4 bg-gradient-to-r from-green-600 to-green-500 text-white px-4 py-2 rounded-md text-sm font-semibold shadow-lg">
          Point Adding Mode - Přidávání bodů do polygonu
        </div>
      )}

      {/* Help tips */}
      {(editMode || slicingMode || pointAddingMode) && (
        <EditorHelpTips 
          editMode={editMode} 
          slicingMode={slicingMode} 
          pointAddingMode={pointAddingMode} 
        />
      )}
    </div>
  );
};

export default EditorCanvas;
