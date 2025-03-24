
import { useState, useRef, useCallback } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { DragState, VertexDragState } from '../types';

/**
 * Hook pro práci s polygony v segmentačním editoru
 */
export const usePolygonInteraction = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void,
  zoom: number,
  offset: { x: number; y: number },
  setOffset: (offset: { x: number; y: number }) => void
) => {
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [hoveredVertex, setHoveredVertex] = useState<{ polygonId: string | null, vertexIndex: number | null }>({
    polygonId: null,
    vertexIndex: null
  });
  
  const dragState = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0
  });
  
  const vertexDragState = useRef<VertexDragState>({
    isDragging: false,
    polygonId: null,
    vertexIndex: null
  });
  
  // Detekce bodu v polygonu
  const isPointInPolygon = useCallback((x: number, y: number, points: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      
      const intersect = ((yi > y) !== (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }, []);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const containerElement = e.currentTarget as HTMLElement;
    if (!containerElement) return;
    
    const rect = containerElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const x = mouseX / zoom - offset.x;
    const y = mouseY / zoom - offset.y;
    
    if (vertexDragState.current.isDragging && segmentation) {
      const polygonId = vertexDragState.current.polygonId;
      const vertexIndex = vertexDragState.current.vertexIndex;
      
      if (polygonId !== null && vertexIndex !== null) {
        setSegmentation({
          ...segmentation,
          polygons: segmentation.polygons.map(polygon => {
            if (polygon.id === polygonId) {
              const points = [...polygon.points];
              points[vertexIndex] = { x, y };
              return { ...polygon, points };
            }
            return polygon;
          })
        });
      }
      return;
    }
    
    if (dragState.current.isDragging) {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      
      setOffset({
        x: dragState.current.lastX + dx / zoom,
        y: dragState.current.lastY + dy / zoom
      });
      return;
    }
    
    if (segmentation) {
      let foundVertex = false;
      
      for (const polygon of segmentation.polygons) {
        for (let i = 0; i < polygon.points.length; i++) {
          const point = polygon.points[i];
          const dx = point.x - x;
          const dy = point.y - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Přizpůsobení poloměru detekce podle zoomu
          const detectionRadius = 10 / zoom;
          
          if (distance <= detectionRadius) {
            setHoveredVertex({
              polygonId: polygon.id,
              vertexIndex: i
            });
            foundVertex = true;
            containerElement.style.cursor = 'pointer';
            break;
          }
        }
        if (foundVertex) break;
      }
      
      if (!foundVertex) {
        if (hoveredVertex.polygonId !== null || hoveredVertex.vertexIndex !== null) {
          setHoveredVertex({ polygonId: null, vertexIndex: null });
          containerElement.style.cursor = 'move';
        }
      }
    }
  }, [zoom, offset, segmentation, hoveredVertex, setOffset, setSegmentation]);
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const containerElement = e.currentTarget as HTMLElement;
    if (!containerElement) return;
    
    const rect = containerElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const x = mouseX / zoom - offset.x;
    const y = mouseY / zoom - offset.y;
    
    if (segmentation) {
      for (const polygon of segmentation.polygons) {
        for (let i = 0; i < polygon.points.length; i++) {
          const point = polygon.points[i];
          const dx = point.x - x;
          const dy = point.y - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          // Přizpůsobení poloměru detekce podle zoomu
          const detectionRadius = 10 / zoom;
          
          if (distance <= detectionRadius) {
            setSelectedPolygonId(polygon.id);
            vertexDragState.current = {
              isDragging: true,
              polygonId: polygon.id,
              vertexIndex: i
            };
            containerElement.style.cursor = 'grabbing';
            return;
          }
        }
        
        const isInside = isPointInPolygon(x, y, polygon.points);
        if (isInside) {
          setSelectedPolygonId(polygon.id);
          return;
        }
      }
      
      setSelectedPolygonId(null);
    }
    
    dragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: offset.x,
      lastY: offset.y
    };
    
    containerElement.style.cursor = 'grabbing';
  }, [zoom, offset, segmentation, isPointInPolygon]);
  
  const handleMouseUp = useCallback(() => {
    dragState.current.isDragging = false;
    vertexDragState.current.isDragging = false;
    
    if (document.body) {
      document.body.style.cursor = 'default';
    }
    
    if (vertexDragState.current.polygonId) {
      vertexDragState.current = {
        isDragging: false,
        polygonId: null,
        vertexIndex: null
      };
    }
  }, []);
  
  const handleDeletePolygon = useCallback(() => {
    if (!selectedPolygonId || !segmentation) return;
    
    setSegmentation({
      ...segmentation,
      polygons: segmentation.polygons.filter(polygon => polygon.id !== selectedPolygonId)
    });
    
    setSelectedPolygonId(null);
  }, [selectedPolygonId, segmentation, setSegmentation]);
  
  return {
    selectedPolygonId,
    hoveredVertex,
    dragState,
    vertexDragState,
    setSelectedPolygonId,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleDeletePolygon,
    isPointInPolygon
  };
};
