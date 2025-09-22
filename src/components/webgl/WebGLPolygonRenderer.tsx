/**
 * Universal WebGL Polygon Renderer Component
 *
 * Replaces ALL polygon rendering implementations (SVG, Canvas) with a single
 * high-performance WebGL solution. Handles all polygon sizes from 3 vertices
 * to 10,000+ vertices with consistent performance.
 */

import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import {
  WebGLVertexRenderer,
  WebGLVertexData,
} from '@/lib/webgl/WebGLVertexRenderer';
import { Point, Polygon } from '@/lib/segmentation';

export interface WebGLPolygonRendererProps {
  // Core data
  polygons: Polygon[];
  selectedPolygonId: string | null;
  hoveredVertex: {
    polygonId: string | null;
    vertexIndex: number | null;
  };
  vertexDragState: {
    isDragging: boolean;
    polygonId: string | null;
    vertexIndex: number | null;
    dragOffset?: { x: number; y: number };
  };

  // Transform and view
  transform: DOMMatrix;
  zoom: number;
  imageSize: { width: number; height: number };

  // Event handlers
  onVertexClick?: (
    polygonId: string,
    vertexIndex: number,
    event: MouseEvent
  ) => void;
  onVertexMouseEnter?: (polygonId: string, vertexIndex: number) => void;
  onVertexMouseLeave?: () => void;
  onPolygonClick?: (polygonId: string, event: MouseEvent) => void;

  // Performance options
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  targetFPS?: number;
  enableAntialiasing?: boolean;
  enableAnimations?: boolean;
}

// Color schemes for different polygon types and states
const VERTEX_COLORS = {
  external: {
    normal: [0.92, 0.22, 0.3] as [number, number, number], // #ea384c
    hovered: [0.91, 0.3, 0.24] as [number, number, number], // #e74c3c
    dragging: [0.75, 0.22, 0.17] as [number, number, number], // #c0392b
  },
  internal: {
    normal: [0.06, 0.65, 0.91] as [number, number, number], // #0EA5E9
    hovered: [0.2, 0.6, 0.86] as [number, number, number], // #3498db
    dragging: [0.0, 0.47, 0.8] as [number, number, number], // #0077cc
  },
};

const POLYGON_COLORS = {
  external: [0.92, 0.22, 0.3, 0.3] as [number, number, number, number], // Semi-transparent red
  internal: [0.06, 0.65, 0.91, 0.3] as [number, number, number, number], // Semi-transparent blue
};

export const WebGLPolygonRenderer: React.FC<WebGLPolygonRendererProps> = ({
  polygons,
  selectedPolygonId,
  hoveredVertex,
  vertexDragState,
  transform,
  zoom,
  imageSize,
  onVertexClick,
  onVertexMouseEnter,
  onVertexMouseLeave,
  onPolygonClick,
  quality = 'high',
  targetFPS = 60,
  enableAntialiasing = true,
  enableAnimations = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLVertexRenderer | null>(null);
  const animationFrameRef = useRef<number>();
  const lastRenderTime = useRef(0);

  // Initialize WebGL renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    rendererRef.current = new WebGLVertexRenderer(canvas);

    if (!rendererRef.current.isInitialized()) {
      console.error('Failed to initialize WebGL renderer');
      // TODO: Fallback to Canvas renderer
      return;
    }

    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, []);

  // Calculate vertex radius based on zoom and quality settings
  const calculateVertexRadius = useCallback(
    (
      baseRadius: number,
      isHovered: boolean,
      isStartPoint: boolean,
      qualityLevel: string
    ): number => {
      const qualityMultiplier =
        {
          low: 0.8,
          medium: 0.9,
          high: 1.0,
          ultra: 1.2,
        }[qualityLevel] || 1.0;

      // Zoom-adaptive scaling with improved algorithm
      const zoomFactor = Math.max(
        0.5,
        Math.min(2.0, 1.0 / Math.pow(zoom, 0.3))
      );
      let radius = baseRadius * zoomFactor * qualityMultiplier;

      // State-based modifications
      if (isHovered) radius *= 1.15;
      if (isStartPoint) radius *= 1.1;

      return Math.max(radius, 1.0); // Minimum 1px radius
    },
    [zoom]
  );

  // Convert polygon data to WebGL vertex data
  const vertexData = useMemo((): WebGLVertexData[] => {
    const vertices: WebGLVertexData[] = [];

    for (const polygon of polygons) {
      const isSelected = polygon.id === selectedPolygonId;
      const colorScheme = VERTEX_COLORS[polygon.type || 'external'];

      for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i];
        const isHovered =
          hoveredVertex.polygonId === polygon.id &&
          hoveredVertex.vertexIndex === i;
        const isDragging =
          vertexDragState.isDragging &&
          vertexDragState.polygonId === polygon.id &&
          vertexDragState.vertexIndex === i;
        const isStartPoint = i === 0;

        // Apply drag offset if applicable
        const finalPosition =
          isDragging && vertexDragState.dragOffset
            ? {
                x: point.x + vertexDragState.dragOffset.x,
                y: point.y + vertexDragState.dragOffset.y,
              }
            : { ...point };

        // Determine color based on state
        let color: [number, number, number];
        if (isDragging) {
          color = colorScheme.dragging;
        } else if (isHovered) {
          color = colorScheme.hovered;
        } else {
          color = colorScheme.normal;
        }

        // Calculate radius
        const radius = calculateVertexRadius(
          3,
          isHovered,
          isStartPoint,
          quality
        );

        // Calculate opacity
        const baseOpacity = isSelected ? 0.95 : 0.7;
        const opacity = isDragging
          ? Math.min(baseOpacity + 0.1, 1.0)
          : baseOpacity;

        vertices.push({
          position: finalPosition,
          radius,
          color,
          opacity,
          isSelected,
          isHovered,
          isDragging,
          polygonId: polygon.id,
          vertexIndex: i,
        });
      }
    }

    return vertices;
  }, [
    polygons,
    selectedPolygonId,
    hoveredVertex,
    vertexDragState,
    quality,
    calculateVertexRadius,
  ]);

  // Render function with performance optimization
  const render = useCallback(() => {
    const now = performance.now();
    const frameTime = 1000 / targetFPS;

    // Frame rate limiting
    if (now - lastRenderTime.current < frameTime) {
      animationFrameRef.current = requestAnimationFrame(render);
      return;
    }

    lastRenderTime.current = now;

    if (!rendererRef.current || !canvasRef.current) return;

    // Update vertex data
    rendererRef.current.updateVertices(vertexData);

    // Render frame
    rendererRef.current.render(transform, zoom);

    // Continue animation loop if needed
    if (enableAnimations) {
      animationFrameRef.current = requestAnimationFrame(render);
    }
  }, [vertexData, transform, zoom, targetFPS, enableAnimations]);

  // Start/stop rendering loop
  useEffect(() => {
    if (enableAnimations) {
      animationFrameRef.current = requestAnimationFrame(render);
    } else {
      render(); // Single frame render
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [render, enableAnimations]);

  // Handle mouse events
  const handleMouseEvent = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!rendererRef.current || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();

      // Convert mouse coordinates to world coordinates
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // Convert to image coordinates
      // Since WebGL canvas inherits CSS transforms from CanvasContent,
      // canvas coordinates already match image coordinates directly
      const worldX = canvasX;
      const worldY = canvasY;

      // Hit test vertices
      const hitVertex = rendererRef.current.hitTest(worldX, worldY, vertexData);

      if (event.type === 'click') {
        if (hitVertex) {
          onVertexClick?.(
            hitVertex.polygonId,
            hitVertex.vertexIndex,
            event.nativeEvent
          );
        } else {
          // Check for polygon click (simplified)
          const hitPolygon = polygons.find(p =>
            p.points.some(point => {
              const dx = worldX - point.x;
              const dy = worldY - point.y;
              return Math.sqrt(dx * dx + dy * dy) < 10; // 10px tolerance
            })
          );
          if (hitPolygon) {
            onPolygonClick?.(hitPolygon.id, event.nativeEvent);
          }
        }
      } else if (event.type === 'mousemove') {
        if (hitVertex) {
          onVertexMouseEnter?.(hitVertex.polygonId, hitVertex.vertexIndex);
        } else {
          onVertexMouseLeave?.();
        }
      }
    },
    [
      vertexData,
      transform,
      polygons,
      onVertexClick,
      onVertexMouseEnter,
      onVertexMouseLeave,
      onPolygonClick,
    ]
  );

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver(() => {
      // Canvas will be resized in render function
      if (!enableAnimations) {
        render(); // Re-render on resize if not animating
      }
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [render, enableAnimations]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'all',
        zIndex: 10,
      }}
      onClick={handleMouseEvent}
      onMouseMove={handleMouseEvent}
      onMouseLeave={onVertexMouseLeave}
    />
  );
};

export default WebGLPolygonRenderer;
