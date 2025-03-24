
import React, { useRef, useEffect, useCallback } from 'react';
import { motion } from "framer-motion";
import { Loader2 } from 'lucide-react';
import { SegmentationResult } from '@/lib/segmentation';
import { DragState, VertexDragState } from '../types';

interface EditorCanvasProps {
  loading: boolean;
  segmentation: SegmentationResult | null;
  zoom: number;
  offset: { x: number; y: number };
  selectedPolygonId: string | null;
  imageSrc: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  dragState: React.MutableRefObject<DragState>;
  vertexDragState: React.MutableRefObject<VertexDragState>;
}

const EditorCanvas = ({
  loading,
  segmentation,
  zoom,
  offset,
  selectedPolygonId,
  imageSrc,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  dragState,
  vertexDragState
}: EditorCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Draw on canvas when segmentation or view changes
  useEffect(() => {
    if (!canvasRef.current || !segmentation) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Load image and draw
    const img = new Image();
    img.onload = () => {
      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw image
      ctx.drawImage(img, 0, 0);
      
      // Draw polygons
      segmentation.polygons.forEach(polygon => {
        ctx.beginPath();
        
        if (polygon.points.length > 0) {
          ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
          
          for (let i = 1; i < polygon.points.length; i++) {
            ctx.lineTo(polygon.points[i].x, polygon.points[i].y);
          }
          
          ctx.closePath();
          
          // Different styling for selected polygon
          if (polygon.id === selectedPolygonId) {
            ctx.strokeStyle = '#FF3B30';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 59, 48, 0.2)';
          } else {
            ctx.strokeStyle = '#00BFFF';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = 'rgba(0, 191, 255, 0.2)';
          }
          ctx.fill();
          
          // Draw vertices
          polygon.points.forEach(point => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            
            if (polygon.id === selectedPolygonId) {
              ctx.fillStyle = '#FF3B30';
            } else {
              ctx.fillStyle = '#FFFFFF';
            }
            
            ctx.fill();
            ctx.strokeStyle = polygon.id === selectedPolygonId ? '#FF3B30' : '#0077FF';
            ctx.lineWidth = 2;
            ctx.stroke();
          });
        }
      });
    };
    
    img.src = segmentation.imageSrc || imageSrc;
  }, [segmentation, selectedPolygonId, imageSrc]);

  return (
    <div 
      ref={containerRef} 
      className="flex-1 overflow-hidden relative cursor-move bg-slate-950 bg-opacity-50 bg-[radial-gradient(#1a1f2c_1px,transparent_1px)] bg-[size:20px_20px]"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {loading ? (
        <motion.div 
          className="absolute inset-0 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="flex flex-col items-center">
            <Loader2 className="h-10 w-10 text-blue-500 animate-spin mb-4" />
            <p className="text-slate-300">Loading segmentation data...</p>
          </div>
        </motion.div>
      ) : (
        <motion.div 
          style={{ 
            transform: `scale(${zoom}) translate(${offset.x}px, ${offset.y}px)`,
            transformOrigin: '0 0',
          }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <canvas 
            ref={canvasRef} 
            className="bg-slate-950 shadow-xl"
          />
        </motion.div>
      )}
    </div>
  );
};

export default EditorCanvas;
