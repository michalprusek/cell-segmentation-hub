
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from "framer-motion";
import { SegmentationResult } from '@/lib/segmentation';
import { DragState, VertexDragState } from '../types';
import CanvasLoadingOverlay from './canvas/CanvasLoadingOverlay';
import CanvasImage from './canvas/CanvasImage';
import CanvasPolygonLayer from './canvas/CanvasPolygonLayer';
import CanvasZoomInfo from './canvas/CanvasZoomInfo';
import { useTheme } from '@/contexts/ThemeContext';

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
  containerRef
}: EditorCanvasProps) => {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const { theme } = useTheme();
  const transformRef = useRef<HTMLDivElement>(null);
  
  // Načtení obrázku a zjištění jeho velikosti
  useEffect(() => {
    if (!imageSrc) return;
    
    const img = new Image();
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
    if (vertexDragState.current.isDragging) return 'grabbing';
    if (dragState.current.isDragging) return 'grabbing';
    if (hoveredVertex.polygonId !== null) return 'grab';
    return 'move';
  };

  return (
    <div 
      ref={containerRef} 
      className={`flex-1 overflow-hidden relative ${
        theme === 'dark' 
          ? 'bg-[#161616] bg-opacity-90 bg-[radial-gradient(#1a1f2c_1px,transparent_1px)]' 
          : 'bg-gray-100 bg-opacity-80 bg-[radial-gradient(#d1d5db_1px,transparent_1px)]'
      } bg-[size:20px_20px] aspect-square max-h-[calc(100vh-12rem)]`}
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
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Informace o zoomu */}
      <CanvasZoomInfo zoom={zoom} />
    </div>
  );
};

export default EditorCanvas;
