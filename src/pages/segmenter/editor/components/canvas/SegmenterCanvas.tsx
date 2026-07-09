import React, {
  useMemo,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent,
  type RefObject,
} from 'react';
import type { SegmenterClass, SegmenterPolygon } from '@/lib/segmenterApi';
import {
  EditMode,
  type Point,
  type TransformState,
  type VertexDragState,
} from '../../types';
import { resolveClassColor } from '../../utils/classColor';
import SegmenterPolygonShape from './SegmenterPolygonShape';

interface SegmenterCanvasProps {
  canvasRef: RefObject<HTMLDivElement>;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onImageLoad: (width: number, height: number) => void;
  transform: TransformState;
  editMode: EditMode;
  polygons: SegmenterPolygon[];
  classes: SegmenterClass[];
  selectedPolygonId: string | null;
  vertexDragState: VertexDragState;
  tempPoints: Point[];
  cursorImagePoint: Point | null;
  onMouseDown: (e: ReactMouseEvent) => void;
  onMouseMove: (e: ReactMouseEvent) => void;
  onMouseUp: () => void;
  onWheel: (e: WheelEvent) => void;
  onPolygonClick: (id: string) => void;
  onVertexMouseDown: (
    polygonId: string,
    vertexIndex: number,
    e: ReactMouseEvent
  ) => void;
  onVertexContextMenu: (
    polygonId: string,
    vertexIndex: number,
    e: ReactMouseEvent
  ) => void;
}

function cursorForMode(mode: EditMode): string {
  switch (mode) {
    case EditMode.CreatePolygon:
      return 'crosshair';
    case EditMode.EditVertices:
      return 'default';
    case EditMode.DeletePolygon:
      return 'pointer';
    case EditMode.View:
    default:
      return 'grab';
  }
}

/**
 * The canvas: an outer mouse/wheel-handling div, a CSS-transformed
 * (translate + scale) content layer holding the `<img>`, and an SVG overlay
 * (same native pixel size as the image, unscaled itself — the ancestor CSS
 * transform provides zoom/pan) rendering every polygon plus the
 * in-progress "draw polygon" preview. Structure mirrors
 * `CanvasContainer`/`CanvasContent`/`CanvasImage` from the reused
 * spheroseg editor so `@/lib/coordinateUtils`' transform math (written
 * against that same structure) applies unmodified.
 */
const SegmenterCanvas: React.FC<SegmenterCanvasProps> = ({
  canvasRef,
  imageUrl,
  imageWidth,
  imageHeight,
  onImageLoad,
  transform,
  editMode,
  polygons,
  classes,
  selectedPolygonId,
  vertexDragState,
  tempPoints,
  cursorImagePoint,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onPolygonClick,
  onVertexMouseDown,
  onVertexContextMenu,
}) => {
  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    onImageLoad(img.naturalWidth, img.naturalHeight);
  };

  const tempPathD = useMemo(() => {
    if (tempPoints.length === 0) return '';
    const parts = tempPoints.map(p => `${p.x},${p.y}`);
    let d = `M${parts.join(' L')}`;
    if (cursorImagePoint && editMode === EditMode.CreatePolygon) {
      d += ` L${cursorImagePoint.x},${cursorImagePoint.y}`;
    }
    return d;
  }, [tempPoints, cursorImagePoint, editMode]);

  const hasImageSize = imageWidth > 0 && imageHeight > 0;

  return (
    <div
      ref={canvasRef}
      className="absolute inset-0 select-none bg-gray-100 dark:bg-gray-900"
      style={{ cursor: cursorForMode(editMode) }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onContextMenu={e => e.preventDefault()}
      data-testid="segmenter-canvas"
      data-edit-mode={editMode}
    >
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <div
          style={{
            transform: `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.zoom})`,
            transformOrigin: '0 0',
            position: 'relative',
          }}
          data-testid="segmenter-canvas-transform"
        >
          <img
            src={imageUrl}
            alt="Image to annotate"
            draggable={false}
            onLoad={handleImgLoad}
            className="absolute top-0 left-0 max-w-none select-none pointer-events-none"
            style={
              hasImageSize
                ? { width: imageWidth, height: imageHeight }
                : undefined
            }
            data-testid="segmenter-canvas-image"
          />

          {hasImageSize && (
            <svg
              width={imageWidth}
              height={imageHeight}
              className="absolute top-0 left-0"
              style={{ maxWidth: 'none', overflow: 'visible' }}
              data-testid="segmenter-canvas-svg"
            >
              {polygons.map(polygon => (
                <SegmenterPolygonShape
                  key={polygon.id}
                  polygon={polygon}
                  isSelected={polygon.id === selectedPolygonId}
                  color={resolveClassColor(polygon.classId, classes)}
                  zoom={transform.zoom}
                  editMode={editMode}
                  vertexDragState={vertexDragState}
                  onClick={onPolygonClick}
                  onVertexMouseDown={onVertexMouseDown}
                  onVertexContextMenu={onVertexContextMenu}
                />
              ))}

              {tempPathD && (
                <path
                  d={tempPathD}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={Math.max(2 / transform.zoom, 0.5)}
                  strokeDasharray={`${4 / transform.zoom} ${4 / transform.zoom}`}
                  pointerEvents="none"
                />
              )}
              {tempPoints.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={Math.max(4 / transform.zoom, 1.5)}
                  fill={i === 0 ? '#22c55e' : '#2563eb'}
                  stroke="#ffffff"
                  strokeWidth={Math.max(1 / transform.zoom, 0.3)}
                  pointerEvents="none"
                />
              ))}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
};

export default SegmenterCanvas;
