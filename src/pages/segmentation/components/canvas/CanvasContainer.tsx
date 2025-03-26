
import React from 'react';

interface CanvasContainerProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  loading: boolean;
}

/**
 * Kontejner pro plátno
 */
const CanvasContainer = React.forwardRef<HTMLDivElement, CanvasContainerProps>(({
  onMouseDown,
  onMouseMove,
  onMouseUp,
  children,
  loading
}, ref) => {
  return (
    <div 
      ref={ref} 
      className="flex-1 overflow-hidden relative bg-[#161616] bg-opacity-90 bg-[radial-gradient(#2a2f3c_1px,transparent_1px)] bg-[size:20px_20px] aspect-square max-h-[calc(100vh-12rem)] rounded-lg"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{cursor: 'move'}}
      data-testid="canvas-container"
    >
      {children}
    </div>
  );
});

CanvasContainer.displayName = 'CanvasContainer';

export default CanvasContainer;
