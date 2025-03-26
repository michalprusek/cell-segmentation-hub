
import React from 'react';
import { motion, AnimatePresence } from "framer-motion";

interface CanvasContentProps {
  zoom: number;
  offset: { x: number; y: number };
  children: React.ReactNode;
}

/**
 * Kontejner pro obsah plátna s transformacemi
 */
const CanvasContent = ({
  zoom,
  offset,
  children
}: CanvasContentProps) => {
  return (
    <div 
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
      {children}
    </div>
  );
};

export default CanvasContent;
