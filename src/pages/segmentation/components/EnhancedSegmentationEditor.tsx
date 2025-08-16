import React, { useRef, useState, useEffect } from 'react';
import { useEnhancedSegmentationEditor } from '../hooks/useEnhancedSegmentationEditor';
import { Polygon } from '@/lib/segmentation';
import EnhancedEditorToolbar from './EnhancedEditorToolbar';
import CanvasContainer from './canvas/CanvasContainer';
import CanvasContent from './canvas/CanvasContent';
import CanvasImage from './canvas/CanvasImage';
import CanvasPolygon from './canvas/CanvasPolygon';
import CanvasVertex from './canvas/CanvasVertex';
import ModeInstructions from './canvas/ModeInstructions';
import CanvasTemporaryGeometryLayer from './canvas/CanvasTemporaryGeometryLayer';

interface EnhancedSegmentationEditorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  initialPolygons?: Polygon[];
  onSave?: (polygons: Polygon[]) => Promise<void>;
  onPolygonsChange?: (polygons: Polygon[]) => void;
  className?: string;
}

/**
 * Enhanced Segmentation Editor with SpheroSeg-inspired functionality
 * Complete replacement for the existing segmentation editor
 */
const EnhancedSegmentationEditor: React.FC<EnhancedSegmentationEditorProps> = ({
  imageUrl,
  imageWidth,
  imageHeight,
  initialPolygons = [],
  onSave,
  onPolygonsChange,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: 800,
    height: 600,
  });

  // Measure container dimensions and calculate canvas size
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const availableWidth = containerRect.width - 60; // Account for toolbar
        const availableHeight = containerRect.height - 100; // Account for toolbar and padding

        // Calculate dimensions preserving aspect ratio
        const aspectRatio = imageWidth / imageHeight;
        let canvasWidth = availableWidth;
        let canvasHeight = availableWidth / aspectRatio;

        if (canvasHeight > availableHeight) {
          canvasHeight = availableHeight;
          canvasWidth = availableHeight * aspectRatio;
        }

        setCanvasDimensions({
          width: Math.max(400, Math.floor(canvasWidth)), // Minimum width
          height: Math.max(300, Math.floor(canvasHeight)), // Minimum height
        });
      }
    };

    // Initial measurement
    updateDimensions();

    // ResizeObserver for responsive updates
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Window resize fallback
    window.addEventListener('resize', updateDimensions);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, [imageWidth, imageHeight]);

  // Initialize the enhanced editor
  const editor = useEnhancedSegmentationEditor({
    initialPolygons,
    imageWidth,
    imageHeight,
    canvasWidth: canvasDimensions.width,
    canvasHeight: canvasDimensions.height,
    onSave,
    onPolygonsChange,
  });

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-full bg-white dark:bg-gray-900 ${className}`}
    >
      {/* Enhanced Toolbar */}
      <EnhancedEditorToolbar
        editMode={editor.editMode}
        selectedPolygonId={editor.selectedPolygonId}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        hasUnsavedChanges={editor.hasUnsavedChanges}
        setEditMode={editor.setEditMode}
        handleUndo={editor.handleUndo}
        handleRedo={editor.handleRedo}
        handleSave={editor.handleSave}
        handleZoomIn={editor.handleZoomIn}
        handleZoomOut={editor.handleZoomOut}
        handleResetView={editor.handleResetView}
        isSaving={editor.isSaving}
      />

      {/* Main Canvas Area */}
      <div className="flex-1 p-4">
        <CanvasContainer
          ref={editor.canvasRef}
          editMode={editor.editMode}
          onMouseDown={editor.handleMouseDown}
          onMouseMove={editor.handleMouseMove}
          onMouseUp={editor.handleMouseUp}
          loading={false}
        >
          <CanvasContent transform={editor.transform}>
            {/* Base Image */}
            <CanvasImage
              src={imageUrl}
              width={imageWidth}
              height={imageHeight}
              alt="Segmentation target"
            />

            {/* SVG Overlay for polygon rendering */}
            <svg
              width={imageWidth}
              height={imageHeight}
              className="absolute top-0 left-0 pointer-events-none"
              style={{
                maxWidth: 'none',
                shapeRendering: 'geometricPrecision',
              }}
            >
              {/* Render all polygons */}
              {editor.polygons.map(polygon => (
                <CanvasPolygon
                  key={polygon.id}
                  polygon={polygon}
                  isSelected={polygon.id === editor.selectedPolygonId}
                  hoveredVertex={
                    editor.hoveredVertex || {
                      polygonId: null,
                      vertexIndex: null,
                    }
                  }
                  vertexDragState={{
                    isDragging: false,
                    polygonId: null,
                    vertexIndex: null,
                  }}
                  zoom={editor.transform.zoom}
                  onSelectPolygon={() =>
                    editor.setSelectedPolygonId(polygon.id)
                  }
                />
              ))}

              {/* Render vertices for selected polygon */}
              {editor.selectedPolygon && (
                <g>
                  {editor.selectedPolygon.points.map((point, index) => (
                    <CanvasVertex
                      key={`vertex-${index}`}
                      point={point}
                      index={index}
                      polygonId={editor.selectedPolygon?.id || ''}
                      isHovered={
                        editor.hoveredVertex?.polygonId ===
                          editor.selectedPolygon?.id &&
                        editor.hoveredVertex?.vertexIndex === index
                      }
                      isDragging={
                        editor.interactionState.isDraggingVertex &&
                        editor.interactionState.draggedVertexInfo?.polygonId ===
                          editor.selectedPolygon?.id &&
                        editor.interactionState.draggedVertexInfo
                          ?.vertexIndex === index
                      }
                      editMode={editor.editMode}
                      transform={editor.transform}
                    />
                  ))}
                </g>
              )}

              {/* Temporary geometry (preview lines, temp points, etc.) */}
              <CanvasTemporaryGeometryLayer
                transform={editor.transform}
                editMode={editor.editMode}
                tempPoints={editor.tempPoints}
                cursorPosition={editor.cursorPosition}
                interactionState={editor.interactionState}
                selectedPolygonId={editor.selectedPolygonId}
                polygons={editor.polygons}
              />
            </svg>
          </CanvasContent>

          {/* Mode Instructions Overlay */}
          <ModeInstructions
            editMode={editor.editMode}
            interactionState={editor.interactionState}
            selectedPolygonId={editor.selectedPolygonId}
            tempPoints={editor.tempPoints}
            isShiftPressed={editor.keyboardState.isShiftPressed()}
          />
        </CanvasContainer>
      </div>

      {/* Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-4">
          <span>Polygons: {editor.polygons.length}</span>
          {editor.selectedPolygon && (
            <span>
              Selected: {editor.selectedPolygon.points.length} vertices
            </span>
          )}
          <span>Zoom: {Math.round(editor.transform.zoom * 100)}%</span>
        </div>

        <div className="flex items-center gap-4">
          {editor.hasUnsavedChanges && (
            <span className="text-amber-600 dark:text-amber-400">
              Unsaved changes
            </span>
          )}
          <span>Mode: {editor.editMode}</span>
        </div>
      </div>
    </div>
  );
};

export default EnhancedSegmentationEditor;
