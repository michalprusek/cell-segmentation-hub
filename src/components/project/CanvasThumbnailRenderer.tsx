import React, { useRef, useEffect, useMemo, useCallback, useState } from 'react';
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
  disableResizeObserver?: boolean; // Option to disable ResizeObserver for max stability
}

// Color configuration for different polygon types
const POLYGON_COLORS = {
  external: {
    fill: 'rgba(239, 68, 68, 0.3)',   // red-500 with higher opacity for visibility
    stroke: 'rgba(239, 68, 68, 1.0)'  // fully opaque stroke
  },
  internal: {
    fill: 'rgba(14, 165, 233, 0.3)',  // blue-500 with higher opacity for visibility
    stroke: 'rgba(14, 165, 233, 1.0)' // fully opaque stroke
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
  width,
  height,
  style,
  disableResizeObserver = false
}) => {
  // Define fixed, stable dimensions matching ImageCard for consistent rendering
  const THUMBNAIL_WIDTH = 250; // Fixed width matching ImageCard
  const THUMBNAIL_HEIGHT = 167; // Fixed height matching ImageCard
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT });
  
  // Use fixed size if no explicit dimensions provided, avoiding container-dependent sizing
  const actualWidth = width || THUMBNAIL_WIDTH;
  const actualHeight = height || THUMBNAIL_HEIGHT;
  
  // Still track container size for debugging but don't use it for rendering calculations
  useEffect(() => {
    const container = containerRef.current;
    if (!container || disableResizeObserver) {
      // Set stable default size if ResizeObserver is disabled
      if (disableResizeObserver) {
        setContainerSize({ width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT });
      }
      return;
    }

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const newSize = {
        width: rect.width || THUMBNAIL_WIDTH,
        height: rect.height || THUMBNAIL_HEIGHT
      };
      setContainerSize(newSize);
      
      // Log size changes for debugging
      if (process.env.NODE_ENV === 'development') {
        logger.debug('🔧 Container size changed (not affecting rendering):', {
          oldSize: containerSize,
          newSize,
          usingFixedSize: !width && !height,
          actualRenderSize: `${actualWidth}x${actualHeight}`,
          disableResizeObserver
        });
      }
    };

    // Initial size
    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [width, height, actualWidth, actualHeight, disableResizeObserver, containerSize]);

  // Memoize scaling calculations
  const scalingParams = useMemo(() => {
    const { imageWidth, imageHeight } = thumbnailData;
    
    // Since the underlying image uses object-cover and may be cropped/scaled,
    // we need to calculate how the image is actually displayed in the container.
    // With object-cover, the image scales to fill the container while preserving aspect ratio,
    // potentially cropping parts of the image.
    
    const imageAspectRatio = imageWidth / imageHeight;
    const containerAspectRatio = actualWidth / actualHeight;
    
    let displayedImageWidth, displayedImageHeight;
    let offsetX = 0, offsetY = 0;
    
    if (imageAspectRatio > containerAspectRatio) {
      // Image is wider than container - height fills container, width is cropped
      displayedImageHeight = actualHeight;
      displayedImageWidth = actualHeight * imageAspectRatio;
      offsetX = (actualWidth - displayedImageWidth) / 2;
    } else {
      // Image is taller than container - width fills container, height is cropped
      displayedImageWidth = actualWidth;
      displayedImageHeight = actualWidth / imageAspectRatio;
      offsetY = (actualHeight - displayedImageHeight) / 2;
    }
    
    // Calculate scale from original image coordinates to displayed image coordinates
    const scale = Math.min(displayedImageWidth / imageWidth, displayedImageHeight / imageHeight);

    return {
      scale,
      offsetX,
      offsetY,
      scaledWidth: displayedImageWidth,
      scaledHeight: displayedImageHeight,
      imageAspectRatio,
      containerAspectRatio
    };
  }, [thumbnailData, actualWidth, actualHeight]);

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
    if (!canvas) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('🚫 Canvas thumbnail render: No canvas element');
      }
      return;
    }
    
    if (!thumbnailData.polygons.length) {
      if (process.env.NODE_ENV === 'development') {
        logger.warn('🚫 Canvas thumbnail render: No polygons to render', {
          thumbnailData: {
            polygonCount: thumbnailData.polygonCount,
            pointCount: thumbnailData.pointCount,
            imageSize: `${thumbnailData.imageWidth}x${thumbnailData.imageHeight}`
          }
        });
      }
      return;
    }

    // Performance monitoring
    // Enhanced debug logging at start
    if (process.env.NODE_ENV === 'development') {
      logger.debug('🔧 Starting canvas thumbnail render', {
        polygonCount: thumbnailData.polygons.length,
        hasPolygons: thumbnailData.polygons.length > 0,
        renderingMode: width && height ? 'explicit-size' : 'fixed-stable-size',
        canvasSize: `${actualWidth}x${actualHeight}`,
        containerSize: `${containerSize.width}x${containerSize.height}`,
        sizeMismatch: actualWidth !== containerSize.width || actualHeight !== containerSize.height,
        originalImageSize: `${thumbnailData.imageWidth}x${thumbnailData.imageHeight}`,
        displayedImageSize: `${scalingParams.scaledWidth.toFixed(1)}x${scalingParams.scaledHeight.toFixed(1)}`,
        aspectRatios: `image:${scalingParams.imageAspectRatio.toFixed(3)} container:${scalingParams.containerAspectRatio.toFixed(3)}`,
        scale: scalingParams.scale.toFixed(3),
        offset: `${scalingParams.offsetX.toFixed(1)},${scalingParams.offsetY.toFixed(1)}`,
        isObjectCoverCropping: scalingParams.imageAspectRatio !== scalingParams.containerAspectRatio,
        stableRendering: true
      });
    }

    const endRenderMeasure = measureThumbnailRender(
      thumbnailData.polygonCount,
      thumbnailData.pointCount
    );

    const endCanvasMeasure = measureCanvasOperation('thumbnail-render', {
      polygonCount: thumbnailData.polygonCount,
      pointCount: thumbnailData.pointCount,
      levelOfDetail: thumbnailData.levelOfDetail,
      canvasSize: `${actualWidth}x${actualHeight}`
    });

    try {
      const devicePixelRatio = window.devicePixelRatio || 1;
      const { scale, offsetX, offsetY } = scalingParams;

      // Set actual canvas size accounting for device pixel ratio (this resets context)
      canvas.width = actualWidth * devicePixelRatio;
      canvas.height = actualHeight * devicePixelRatio;
      
      // Re-acquire context after setting dimensions
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Scale context to account for device pixel ratio
      ctx.scale(devicePixelRatio, devicePixelRatio);
      
      // Setup canvas context
      setupCanvasContext(ctx, devicePixelRatio);

      // Clear canvas
      ctx.clearRect(0, 0, actualWidth, actualHeight);

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
          canvasSize: `${actualWidth}x${actualHeight}`,
          originalImageSize: `${thumbnailData.imageWidth}x${thumbnailData.imageHeight}`,
          displayedImageSize: `${scalingParams.scaledWidth.toFixed(1)}x${scalingParams.scaledHeight.toFixed(1)}`,
          aspectRatios: `image:${scalingParams.imageAspectRatio.toFixed(3)} container:${scalingParams.containerAspectRatio.toFixed(3)}`,
          offset: `${offsetX.toFixed(1)},${offsetY.toFixed(1)}`,
          devicePixelRatio,
          containerSize
        });
      }
    } finally {
      endRenderMeasure();
      endCanvasMeasure();
    }
  }, [thumbnailData, scalingParams, actualWidth, actualHeight, renderPolygons, containerSize, width, height]);

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
    <div
      ref={containerRef}
      className={cn(
        'absolute inset-0 w-full h-full pointer-events-none',
        className
      )}
      style={{
        zIndex: 10,
        ...style
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{
          width: '100%',
          height: '100%',
          // Force consistent rendering size regardless of container changes
          minWidth: `${actualWidth}px`,
          minHeight: `${actualHeight}px`,
          maxWidth: `${actualWidth}px`,
          maxHeight: `${actualHeight}px`,
        }}
        aria-label={`Segmentation thumbnail with ${thumbnailData.polygonCount} polygons`}
      />
    </div>
  );
};

export default React.memo(CanvasThumbnailRenderer);