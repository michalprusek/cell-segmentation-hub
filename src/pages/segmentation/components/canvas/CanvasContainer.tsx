
import React from 'react';
import { useTheme } from '@/contexts/ThemeContext';

interface CanvasContainerProps {
  containerRef: React.RefObject<HTMLDivElement>;
  activeMode: {
    editMode: boolean;
    slicingMode: boolean;
    pointAddingMode: boolean;
  };
  vertexDragState: {
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
  };
  dragState: {
    isDragging: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
  };
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  theme: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  children: React.ReactNode;
}

/**
 * Kontejner pro editační plátno
 */
const CanvasContainer = ({
  containerRef,
  activeMode,
  vertexDragState,
  dragState,
  hoveredVertex,
  theme,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  children
}: CanvasContainerProps) => {
  const { editMode, slicingMode, pointAddingMode } = activeMode;

  /**
   * Vrátí styl kurzoru podle aktuálního stavu
   */
  const getCursorStyle = () => {
    if (editMode) return 'crosshair';
    if (slicingMode) return 'crosshair';
    if (pointAddingMode) return 'cell';
    if (vertexDragState.isDragging) return 'grabbing';
    if (dragState.isDragging) return 'grabbing';
    if (hoveredVertex.polygonId !== null) return 'grab';
    return 'move';
  };

  /**
   * Vrátí třídu okraje podle aktivního režimu
   */
  const getActiveModeBorderClass = () => {
    if (slicingMode) return 'border-2 border-red-500 shadow-lg shadow-red-500/20';
    if (pointAddingMode) return 'border-2 border-green-500 shadow-lg shadow-green-500/20';
    if (editMode) return 'border-2 border-orange-500 shadow-lg shadow-orange-500/20';
    return '';
  };

  /**
   * Vrátí vzor pozadí podle tématu
   */
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
      {children}
    </div>
  );
};

export default CanvasContainer;
