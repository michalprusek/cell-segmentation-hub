import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TransformState } from '../../types';

interface CanvasContentProps {
  transform: TransformState;
  children: React.ReactNode;
  isZooming?: boolean;
  // Legacy props for backward compatibility - will be removed
  zoom?: number;
  offset?: { x: number; y: number };
}

/**
 * Container for canvas content with transforms
 */
const CanvasContent = ({
  transform,
  children,
  isZooming = false,
  // Legacy props for backward compatibility
  zoom,
  offset,
}: CanvasContentProps) => {
  // Use new transform or fall back to legacy props
  const actualTransform = transform || {
    zoom: zoom || 1,
    translateX: offset?.x || 0,
    translateY: offset?.y || 0,
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        style={{
          transform: `translate3d(${actualTransform.translateX}px, ${actualTransform.translateY}px, 0) scale(${actualTransform.zoom})`,
          transformOrigin: '0 0',
          willChange: isZooming ? 'transform' : 'auto',
          position: 'relative',
          width: '100%',
          height: '100%',
          backfaceVisibility: 'hidden',
          perspective: 1000,
        }}
        data-testid="canvas-transform-container"
      >
        {children}
      </div>
    </div>
  );
};

export default CanvasContent;
