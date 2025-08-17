import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { measureThumbnailRender, measureCanvasOperation } from '@/lib/performanceMonitor';

interface Point {
  x: number;
  y: number;
}

interface SimplifiedPolygon {
  id: string;
  points: Point[];
  type: 'external' | 'internal';
  class?: string;
  originalPointCount?: number;
  compressionRatio?: number;
}

interface ThumbnailData {
  polygons: SimplifiedPolygon[];
  imageWidth: number;
  imageHeight: number;
  levelOfDetail: 'low' | 'medium' | 'high';
  polygonCount: number;
  pointCount: number;
  compressionRatio: number;
}

interface CanvasThumbnailRendererProps {
  thumbnailData: ThumbnailData;
  className?: string;
  width?: number;
  height?: number;
  style?: React.CSSProperties;
}

// Color configuration for different polygon types
const POLYGON_COLORS = {
  external: {
    fill: 'rgba(239, 68, 68, 0.2)',   // red-500 with opacity
    stroke: 'rgba(239, 68, 68, 0.8)'
  },
  internal: {
    fill: 'rgba(14, 165, 233, 0.2)',  // blue-500 with opacity  
    stroke: 'rgba(14, 165, 233, 0.8)'
  }
} as const;

// Performance optimization: Reusable canvas context setup
const setupCanvasContext = (ctx: CanvasRenderingContext2D, devicePixelRatio: number) => {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1 * devicePixelRatio;
};

const CanvasThumbnailRenderer: React.FC<CanvasThumbnailRendererProps> = ({
  thumbnailData,
  className,
  width = 300,
  height = 300,
  style
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Memoize scaling calculations
  const scalingParams = useMemo(() => {
    const { imageWidth, imageHeight } = thumbnailData;
    
    // Calculate scale to fit within canvas while preserving aspect ratio
    const scaleX = width / imageWidth;
    const scaleY = height / imageHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // Center the scaled image
    const scaledWidth = imageWidth * scale;
    const scaledHeight = imageHeight * scale;
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;

    return {
      scale,
      offsetX,
      offsetY,
      scaledWidth,
      scaledHeight
    };
  }, [thumbnailData, width, height]);

  // Optimized polygon rendering function
  const renderPolygons = useCallback((
    ctx: CanvasRenderingContext2D,
    polygons: SimplifiedPolygon[],
    scale: number,
    offsetX: number,
    offsetY: number,
    devicePixelRatio: number
  ) => {
    // Separate polygons by type for batch rendering
    const externalPolygons = polygons.filter(p => p.type === 'external');
    const internalPolygons = polygons.filter(p => p.type === 'internal');

    // Render external polygons first (they might be larger)
    const renderPolygonBatch = (polys: SimplifiedPolygon[], color: typeof POLYGON_COLORS.external) => {
      if (polys.length === 0) return;

      // Set fill style once for all polygons of this type
      ctx.fillStyle = color.fill;
      ctx.strokeStyle = color.stroke;
      ctx.lineWidth = 1 * devicePixelRatio;

      ctx.beginPath();
      
      for (const polygon of polys) {
        if (polygon.points.length < 3) continue;

        const firstPoint = polygon.points[0];
        ctx.moveTo(
          offsetX + firstPoint.x * scale,
          offsetY + firstPoint.y * scale
        );

        // Draw lines to remaining points
        for (let i = 1; i < polygon.points.length; i++) {
          const point = polygon.points[i];
          ctx.lineTo(
            offsetX + point.x * scale,
            offsetY + point.y * scale
          );
        }

        ctx.closePath();
      }

      // Fill and stroke all polygons of this type at once
      ctx.fill();
      ctx.stroke();
    };

    // Render external polygons
    renderPolygonBatch(externalPolygons, POLYGON_COLORS.external);
    
    // Render internal polygons
    renderPolygonBatch(internalPolygons, POLYGON_COLORS.internal);
  }, []);

  // Main rendering function with RAF optimization
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumbnailData.polygons.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Performance monitoring
    const endRenderMeasure = measureThumbnailRender(
      thumbnailData.polygonCount,
      thumbnailData.pointCount
    );

    const endCanvasMeasure = measureCanvasOperation('thumbnail-render', {
      polygonCount: thumbnailData.polygonCount,
      pointCount: thumbnailData.pointCount,
      levelOfDetail: thumbnailData.levelOfDetail,
      canvasSize: `${width}x${height}`
    });

    try {
      const devicePixelRatio = window.devicePixelRatio || 1;
      const { scale, offsetX, offsetY } = scalingParams;

      // Set actual canvas size accounting for device pixel ratio
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
      
      // Scale context to account for device pixel ratio
      ctx.scale(devicePixelRatio, devicePixelRatio);
      
      // Setup canvas context
      setupCanvasContext(ctx, devicePixelRatio);

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Render polygons
      renderPolygons(ctx, thumbnailData.polygons, scale, offsetX, offsetY, devicePixelRatio);

      // Debug logging in development
      if (process.env.NODE_ENV === 'development') {
        logger.debug('🎨 Canvas thumbnail rendered', {
          polygonCount: thumbnailData.polygons.length,
          pointCount: thumbnailData.pointCount,
          levelOfDetail: thumbnailData.levelOfDetail,
          compressionRatio: thumbnailData.compressionRatio.toFixed(2),
          scale: scale.toFixed(3),
          canvasSize: `${width}x${height}`,
          devicePixelRatio
        });
      }
    } finally {
      endRenderMeasure();
      endCanvasMeasure();
    }
  }, [thumbnailData, scalingParams, width, height, renderPolygons]);

  // Effect to handle rendering with RAF
  useEffect(() => {
    // Cancel any pending animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Schedule rendering on next frame
    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [render]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        'absolute inset-0 w-full h-full pointer-events-none',
        className
      )}
      style={{
        zIndex: 10,
        width: `${width}px`,
        height: `${height}px`,
        ...style
      }}
      aria-label={`Segmentation thumbnail with ${thumbnailData.polygonCount} polygons`}
    />
  );
};

export default React.memo(CanvasThumbnailRenderer);