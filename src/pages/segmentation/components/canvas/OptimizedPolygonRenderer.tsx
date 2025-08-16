/**
 * High-performance polygon renderer with batching and progressive rendering
 * Implements advanced SVG optimizations and render batching
 */

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import { Polygon } from '@/lib/segmentation';
import { RenderBatch } from '@/lib/rendering/RenderBatchManager';
import { VertexDragState } from '@/pages/segmentation/types';
import { rafSchedule } from '@/lib/performanceUtils';

interface OptimizedPolygonRendererProps {
  polygons: Polygon[];
  batches: RenderBatch[];
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null; vertexIndex: number | null };
  vertexDragState: VertexDragState;
  zoom: number;
  offset: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  isAnimating: boolean;
  renderQuality: 'low' | 'medium' | 'high' | 'ultra';
  onSelectPolygon?: (id: string) => void;
  onDeletePolygon?: (id: string) => void;
  onSlicePolygon?: (id: string) => void;
  onEditPolygon?: (id: string) => void;
}

interface PolygonRenderData {
  id: string;
  pathData: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  isSelected: boolean;
  isHovered: boolean;
  priority: number;
  renderHints: {
    fillEnabled: boolean;
    strokeEnabled: boolean;
    shadowEnabled: boolean;
    antiAliasing: boolean;
  };
}

/**
 * Optimized SVG path generation with caching
 */
const generateSVGPath = (polygon: Polygon, useSimplification: boolean = false): string => {
  const points = polygon.points;
  if (points.length === 0) return '';

  let pathData = `M ${points[0].x},${points[0].y}`;
  
  if (useSimplification && points.length > 50) {
    // Use simplified path for complex polygons
    for (let i = 2; i < points.length; i += 2) {
      pathData += ` L ${points[i].x},${points[i].y}`;
    }
  } else {
    // Full detail path
    for (let i = 1; i < points.length; i++) {
      pathData += ` L ${points[i].x},${points[i].y}`;
    }
  }
  
  return pathData + ' Z';
};

/**
 * Generate polygon colors based on type and state
 */
const getPolygonColors = (
  polygon: Polygon,
  isSelected: boolean,
  isHovered: boolean,
  renderQuality: string
) => {
  const baseAlpha = renderQuality === 'low' ? 0.6 : 0.8;
  
  if (polygon.type === 'internal') {
    return {
      fill: isSelected 
        ? `rgba(14, 165, 233, ${baseAlpha})` 
        : `rgba(14, 165, 233, ${baseAlpha * 0.7})`,
      stroke: isSelected || isHovered 
        ? '#0EA5E9' 
        : 'rgba(14, 165, 233, 0.9)',
      strokeWidth: isSelected ? 2 : 1.5
    };
  } else {
    return {
      fill: isSelected 
        ? `rgba(234, 56, 76, ${baseAlpha})` 
        : `rgba(234, 56, 76, ${baseAlpha * 0.7})`,
      stroke: isSelected || isHovered 
        ? '#ea384c' 
        : 'rgba(234, 56, 76, 0.9)',
      strokeWidth: isSelected ? 2 : 1.5
    };
  }
};

/**
 * Memoized individual polygon component
 */
const OptimizedPolygon = React.memo<{
  renderData: PolygonRenderData;
  onSelect?: (id: string) => void;
}>(({ renderData, onSelect }) => {
  const handleClick = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    if (onSelect) {
      onSelect(renderData.id);
    }
  }, [renderData.id, onSelect]);

  return (
    <path
      d={renderData.pathData}
      fill={renderData.renderHints.fillEnabled ? renderData.fillColor : 'none'}
      stroke={renderData.renderHints.strokeEnabled ? renderData.strokeColor : 'none'}
      strokeWidth={renderData.strokeWidth}
      opacity={renderData.opacity}
      style={{
        cursor: 'pointer',
        transition: renderData.isSelected ? 'none' : 'opacity 0.15s ease',
        filter: renderData.renderHints.shadowEnabled && renderData.isSelected 
          ? 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))' 
          : 'none',
        shapeRendering: renderData.renderHints.antiAliasing 
          ? 'geometricPrecision' 
          : 'optimizeSpeed'
      }}
      onClick={handleClick}
      data-polygon-id={renderData.id}
      data-priority={renderData.priority}
    />
  );
});

OptimizedPolygon.displayName = 'OptimizedPolygon';

/**
 * Batch renderer for groups of polygons
 */
const BatchRenderer = React.memo<{
  batch: RenderBatch;
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null; vertexIndex: number | null };
  renderQuality: 'low' | 'medium' | 'high' | 'ultra';
  onSelectPolygon?: (id: string) => void;
}>(({ batch, selectedPolygonId, hoveredVertex, renderQuality, onSelectPolygon }) => {
  const renderData = useMemo(() => {
    return batch.polygons.map((polygon, index) => {
      const isSelected = polygon.id === selectedPolygonId;
      const isHovered = hoveredVertex.polygonId === polygon.id;
      const colors = getPolygonColors(polygon, isSelected, isHovered, renderQuality);
      
      return {
        id: polygon.id,
        pathData: generateSVGPath(polygon, batch.renderHints.useSimplification),
        fillColor: colors.fill,
        strokeColor: colors.stroke,
        strokeWidth: colors.strokeWidth / batch.renderHints.simplificationTolerance,
        opacity: 1.0,
        isSelected,
        isHovered,
        priority: batch.priority,
        renderHints: {
          fillEnabled: true,
          strokeEnabled: true,
          shadowEnabled: renderQuality === 'high' || renderQuality === 'ultra',
          antiAliasing: renderQuality === 'ultra'
        }
      } as PolygonRenderData;
    });
  }, [batch, selectedPolygonId, hoveredVertex, renderQuality]);

  return (
    <g 
      className="polygon-batch"
      data-batch-id={batch.id}
      data-batch-priority={batch.priority}
      data-polygon-count={batch.polygons.length}
    >
      {renderData.map((data) => (
        <OptimizedPolygon
          key={data.id}
          renderData={data}
          onSelect={onSelectPolygon}
        />
      ))}
    </g>
  );
});

BatchRenderer.displayName = 'BatchRenderer';

/**
 * Progressive batch renderer for smooth rendering of large datasets
 */
const ProgressiveBatchRenderer: React.FC<{
  batches: RenderBatch[];
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null; vertexIndex: number | null };
  renderQuality: 'low' | 'medium' | 'high' | 'ultra';
  onSelectPolygon?: (id: string) => void;
  maxBatchesPerFrame?: number;
}> = ({
  batches,
  selectedPolygonId,
  hoveredVertex,
  renderQuality,
  onSelectPolygon,
  maxBatchesPerFrame = 5
}) => {
  const [renderedBatches, setRenderedBatches] = useState<RenderBatch[]>([]);
  const [renderIndex, setRenderIndex] = useState(0);
  const rafRef = useRef<number>();
  const isMountedRef = useRef(true);

  // Sort batches by priority (higher priority first)
  const sortedBatches = useMemo(() => {
    return [...batches].sort((a, b) => b.priority - a.priority);
  }, [batches]);

  // Set up unmount tracking
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Progressive rendering logic
  useEffect(() => {
    if (renderIndex < sortedBatches.length) {
      rafRef.current = requestAnimationFrame(() => {
        // Only update state if component is still mounted
        if (isMountedRef.current) {
          const nextBatches = sortedBatches.slice(
            renderIndex,
            Math.min(renderIndex + maxBatchesPerFrame, sortedBatches.length)
          );
          
          setRenderedBatches(prev => [...prev, ...nextBatches]);
          setRenderIndex(prev => prev + nextBatches.length);
        }
      });
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [renderIndex, sortedBatches, maxBatchesPerFrame]);

  // Reset when batches change
  useEffect(() => {
    if (isMountedRef.current) {
      setRenderedBatches([]);
      setRenderIndex(0);
    }
  }, [sortedBatches]);

  return (
    <g className="progressive-polygon-renderer">
      {renderedBatches.map((batch) => (
        <BatchRenderer
          key={batch.id}
          batch={batch}
          selectedPolygonId={selectedPolygonId}
          hoveredVertex={hoveredVertex}
          renderQuality={renderQuality}
          onSelectPolygon={onSelectPolygon}
        />
      ))}
    </g>
  );
};

/**
 * Main optimized polygon renderer
 */
const OptimizedPolygonRenderer: React.FC<OptimizedPolygonRendererProps> = ({
  polygons,
  batches,
  selectedPolygonId,
  hoveredVertex,
  vertexDragState,
  zoom,
  offset,
  containerWidth,
  containerHeight,
  isAnimating,
  renderQuality,
  onSelectPolygon,
  onDeletePolygon,
  onSlicePolygon,
  onEditPolygon
}) => {
  const [renderMode, setRenderMode] = useState<'immediate' | 'progressive'>('immediate');

  // Determine render mode based on complexity
  useEffect(() => {
    const totalPolygons = batches.reduce((sum, batch) => sum + batch.polygons.length, 0);
    const shouldUseProgressive = totalPolygons > 100 || batches.length > 20;
    
    setRenderMode(shouldUseProgressive ? 'progressive' : 'immediate');
  }, [batches]);

  // Immediate rendering for small datasets
  const renderImmediate = useCallback(() => {
    return (
      <g className="immediate-polygon-renderer">
        {batches.map((batch) => (
          <BatchRenderer
            key={batch.id}
            batch={batch}
            selectedPolygonId={selectedPolygonId}
            hoveredVertex={hoveredVertex}
            renderQuality={renderQuality}
            onSelectPolygon={onSelectPolygon}
          />
        ))}
      </g>
    );
  }, [batches, selectedPolygonId, hoveredVertex, renderQuality, onSelectPolygon]);

  // Empty state
  if (polygons.length === 0 || batches.length === 0) {
    return null;
  }

  return (
    <g className="optimized-polygon-renderer">
      {renderMode === 'immediate' ? (
        renderImmediate()
      ) : (
        <ProgressiveBatchRenderer
          batches={batches}
          selectedPolygonId={selectedPolygonId}
          hoveredVertex={hoveredVertex}
          renderQuality={renderQuality}
          onSelectPolygon={onSelectPolygon}
          maxBatchesPerFrame={renderQuality === 'low' ? 10 : 5}
        />
      )}
    </g>
  );
};

export default React.memo(OptimizedPolygonRenderer);