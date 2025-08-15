import { useMemo } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { EditMode, TransformState, InteractionState } from '../types';

/**
 * Adapter to convert between old and new state formats
 * Provides backward compatibility during migration
 */

interface LegacyState {
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  deleteMode: boolean;
  zoom: number;
  offset: { x: number; y: number };
  dragState: { isDragging: boolean; startX: number; startY: number };
  vertexDragState: { isDragging: boolean; polygonId: string; vertexIndex: number };
  tempPoints: Array<{ x: number; y: number }> | null;
  sliceStartPoint: { x: number; y: number } | null;
  hoveredSegment: { polygonId: string; segmentIndex: number } | null;
}

interface NewState {
  editMode: EditMode;
  transform: TransformState;
  interactionState: InteractionState;
  tempPoints: Array<{ x: number; y: number }>;
}

/**
 * Convert old EditMode booleans to new EditMode enum
 */
export const convertToNewEditMode = (legacy: LegacyState): EditMode => {
  if (legacy.slicingMode) return EditMode.Slice;
  if (legacy.pointAddingMode) return EditMode.AddPoints;
  if (legacy.deleteMode) return EditMode.DeletePolygon;
  if (legacy.editMode) return EditMode.EditVertices;
  return EditMode.View;
};

/**
 * Convert new EditMode enum to old boolean states
 */
export const convertToLegacyEditModes = (editMode: EditMode) => {
  return {
    editMode: editMode === EditMode.EditVertices,
    slicingMode: editMode === EditMode.Slice,
    pointAddingMode: editMode === EditMode.AddPoints,
    deleteMode: editMode === EditMode.DeletePolygon
  };
};

/**
 * Convert old transform state to new TransformState
 */
export const convertToNewTransform = (legacy: LegacyState): TransformState => {
  return {
    zoom: legacy.zoom,
    translateX: legacy.offset.x,
    translateY: legacy.offset.y
  };
};

/**
 * Convert new TransformState to old format
 */
export const convertToLegacyTransform = (transform: TransformState) => {
  return {
    zoom: transform.zoom,
    offset: { x: transform.translateX, y: transform.translateY }
  };
};

/**
 * Convert old interaction states to new InteractionState
 */
export const convertToNewInteractionState = (legacy: LegacyState): InteractionState => {
  return {
    isDraggingVertex: legacy.vertexDragState.isDragging,
    isPanning: legacy.dragState.isDragging,
    panStart: legacy.dragState.isDragging ? 
      { x: legacy.dragState.startX, y: legacy.dragState.startY } : null,
    draggedVertexInfo: legacy.vertexDragState.isDragging ? {
      polygonId: legacy.vertexDragState.polygonId,
      vertexIndex: legacy.vertexDragState.vertexIndex
    } : null,
    originalVertexPosition: null, // This would need to be tracked separately
    sliceStartPoint: legacy.sliceStartPoint,
    addPointStartVertex: null, // New functionality
    addPointEndVertex: null, // New functionality
    isAddingPoints: false // New functionality
  };
};

/**
 * Convert SegmentationResult to Polygon array for new system
 */
export const convertSegmentationToPolygons = (segmentation: SegmentationResult | null, imageWidth?: number, imageHeight?: number) => {
  console.log('🔄 convertSegmentationToPolygons called:', {
    hasSegmentation: !!segmentation,
    hasPolygons: !!segmentation?.polygons,
    polygonCount: segmentation?.polygons?.length || 0,
    firstPolygon: segmentation?.polygons?.[0] ? {
      id: segmentation.polygons[0].id,
      pointsCount: segmentation.polygons[0].points?.length || 0,
      type: segmentation.polygons[0].type,
      firstPoint: segmentation.polygons[0].points?.[0],
      firstPointType: typeof segmentation.polygons[0].points?.[0]
    } : null
  });
  
  if (!segmentation?.polygons) {
    console.log('⚠️ No segmentation polygons found');
    return [];
  }
  
  // Check if we need to scale coordinates
  const segmentationWidth = segmentation.imageWidth || segmentation.width;
  const segmentationHeight = segmentation.imageHeight || segmentation.height;
  
  // If segmentation dimensions are missing or 0, assume coordinates are already in image space
  const scaleX = (imageWidth && segmentationWidth && segmentationWidth > 0) ? imageWidth / segmentationWidth : 1;
  const scaleY = (imageHeight && segmentationHeight && segmentationHeight > 0) ? imageHeight / segmentationHeight : 1;
  
  console.log('🔧 Coordinate scaling:', {
    segmentationSize: { width: segmentationWidth, height: segmentationHeight },
    imageSize: { width: imageWidth, height: imageHeight },
    scale: { x: scaleX, y: scaleY },
    needsScaling: scaleX !== 1 || scaleY !== 1,
    originalFirstPoint: segmentation.polygons?.[0]?.points?.[0],
    rawSegmentationData: {
      imageWidth: segmentation.imageWidth,
      imageHeight: segmentation.imageHeight,
      width: segmentation.width,
      height: segmentation.height
    }
  });

  // Convert array coordinates to {x, y} objects if necessary
  const convertedPolygons = segmentation.polygons.map(polygon => {
    if (!polygon.points || polygon.points.length === 0) {
      console.log('⚠️ Polygon has no points:', polygon.id);
      return polygon;
    }
    
    // Check if points are arrays [x, y] and convert to {x, y}
    const firstPoint = polygon.points[0];
    if (Array.isArray(firstPoint)) {
      console.log('🔧 Converting array coordinates to objects for polygon:', polygon.id);
      // EXPERIMENTAL: Try different coordinate transformations
      // Current polygon seems to be offset, let's try to center it
      const centerX = imageWidth ? imageWidth / 2 : 500;
      const centerY = imageHeight ? imageHeight / 2 : 500;
      
      // Calculate current polygon center
      const avgX = polygon.points.reduce((sum: number, p: any) => sum + p[0], 0) / polygon.points.length;
      const avgY = polygon.points.reduce((sum: number, p: any) => sum + p[1], 0) / polygon.points.length;
      
      console.log('🎯 Polygon center analysis:', {
        polygonCenter: { x: avgX, y: avgY },
        imageCenter: { x: centerX, y: centerY },
        offset: { x: centerX - avgX, y: centerY - avgY }
      });
      
      return {
        ...polygon,
        points: polygon.points.map((point: any) => ({
          x: point[0] * scaleX,
          y: point[1] * scaleY
        }))
      };
    } else {
      // Apply scaling to existing {x, y} objects
      return {
        ...polygon,
        points: polygon.points.map((point: any) => ({
          x: point.x * scaleX,
          y: point.y * scaleY
        }))
      };
    }
  });
  
  // Debug the final converted coordinates
  if (convertedPolygons.length > 0) {
    const firstPolygon = convertedPolygons[0];
    const samplePoints = firstPolygon.points.slice(0, 5); // First 5 points
    console.log('📍 Sample converted coordinates:', {
      polygonId: firstPolygon.id,
      samplePoints,
      minX: Math.min(...firstPolygon.points.map(p => p.x)),
      maxX: Math.max(...firstPolygon.points.map(p => p.x)),
      minY: Math.min(...firstPolygon.points.map(p => p.y)),
      maxY: Math.max(...firstPolygon.points.map(p => p.y))
    });
  }
  
  console.log('✅ Returning', convertedPolygons.length, 'converted polygons');
  return convertedPolygons;
};

/**
 * Convert Polygon array back to SegmentationResult for legacy system
 */
export const convertPolygonsToSegmentation = (
  polygons: any[], 
  originalSegmentation: SegmentationResult | null
) => {
  if (!originalSegmentation) return null;
  
  // Validate polygons before conversion
  const validPolygons = polygons.filter(polygon => {
    if (!polygon || !Array.isArray(polygon.points)) {
      console.warn('Invalid polygon detected during conversion:', polygon);
      return false;
    }
    
    // Ensure minimum of 3 points for a valid polygon
    if (polygon.points.length < 3) {
      console.warn('Polygon has insufficient points:', polygon.points.length);
      return false;
    }
    
    // Validate point structure
    const hasValidPoints = polygon.points.every(point => 
      point && typeof point.x === 'number' && typeof point.y === 'number' &&
      !isNaN(point.x) && !isNaN(point.y)
    );
    
    if (!hasValidPoints) {
      console.warn('Polygon contains invalid points:', polygon.points);
      return false;
    }
    
    return true;
  });
  
  return {
    ...originalSegmentation,
    polygons: validPolygons
  };
};

/**
 * Legacy adapter hook for gradual migration
 */
export const useLegacyAdapter = (legacyState: any) => {
  const newEditMode = useMemo(() => 
    convertToNewEditMode(legacyState), 
    [legacyState.editMode, legacyState.slicingMode, legacyState.pointAddingMode, legacyState.deleteMode]
  );

  const newTransform = useMemo(() => 
    convertToNewTransform(legacyState),
    [legacyState.zoom, legacyState.offset?.x, legacyState.offset?.y]
  );

  const newInteractionState = useMemo(() => 
    convertToNewInteractionState(legacyState),
    [
      legacyState.dragState?.isDragging,
      legacyState.dragState?.startX,
      legacyState.dragState?.startY,
      legacyState.vertexDragState?.isDragging,
      legacyState.vertexDragState?.polygonId,
      legacyState.vertexDragState?.vertexIndex,
      legacyState.sliceStartPoint?.x,
      legacyState.sliceStartPoint?.y
    ]
  );

  const newTempPoints = useMemo(() => 
    legacyState.tempPoints || [],
    [legacyState.tempPoints]
  );

  const polygons = useMemo(() => 
    convertSegmentationToPolygons(legacyState.segmentation),
    [legacyState.segmentation?.polygons, legacyState.segmentation?.imageId]
  );

  return {
    editMode: newEditMode,
    transform: newTransform,
    interactionState: newInteractionState,
    tempPoints: newTempPoints,
    polygons
  };
};