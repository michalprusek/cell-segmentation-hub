import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { segmentImage, SegmentationResult, Point } from '@/lib/segmentation';
import { DragState, VertexDragState, EditorState } from '../types';

export const useSegmentationEditor = (
  projectId: string | undefined,
  imageId: string | undefined,
  userId: string | undefined
) => {
  const [projectTitle, setProjectTitle] = useState('');
  const [imageName, setImageName] = useState('');
  const [imageSrc, setImageSrc] = useState('/placeholder.svg');
  const [loading, setLoading] = useState(true);
  const [segmentation, setSegmentation] = useState<SegmentationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [history, setHistory] = useState<SegmentationResult[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [hoveredVertex, setHoveredVertex] = useState<{ polygonId: string | null, vertexIndex: number | null }>({
    polygonId: null,
    vertexIndex: null
  });
  
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  
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

  useEffect(() => {
    console.log("SegmentationEditor mounted with params:", { projectId, imageId, userId });
    
    if (!projectId || !imageId) {
      toast.error("Missing project or image ID");
      return;
    }
    
    const fetchData = async () => {
      try {
        setLoading(true);
        
        const { data: projectData, error: projectError } = await supabase
          .from("projects")
          .select("*")
          .eq("id", projectId)
          .maybeSingle();
        
        if (projectError) {
          throw new Error(`Error fetching project: ${projectError.message}`);
        }
        
        if (!projectData) {
          toast.error("Project not found");
          return;
        }
        
        setProjectTitle(projectData.title);
        
        const { data: imageData, error: imageError } = await supabase
          .from("images")
          .select("*")
          .eq("id", imageId)
          .eq("project_id", projectId)
          .maybeSingle();
        
        if (imageError) {
          throw new Error(`Error fetching image: ${imageError.message}`);
        }
        
        if (!imageData) {
          toast.error("Image not found");
          return;
        }
        
        setImageName(imageData.name || `Image_${imageId}`);
        setImageSrc(imageData.image_url || '/placeholder.svg');
        
        let result: SegmentationResult;
        
        if (imageData.segmentation_status === 'completed' && imageData.segmentation_result) {
          result = imageData.segmentation_result as unknown as SegmentationResult;
        } else {
          result = await segmentImage(imageData.image_url || '/placeholder.svg');
          
          await supabase
            .from("images")
            .update({
              segmentation_status: 'completed',
              segmentation_result: result as unknown as any,
              updated_at: new Date().toISOString()
            })
            .eq("id", imageId);
        }
        
        setSegmentation(result);
        
        setHistory([result]);
        setHistoryIndex(0);
      } catch (error) {
        console.error("Error in SegmentationEditor:", error);
        toast.error("Failed to load segmentation data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [projectId, imageId, userId]);
  
  useEffect(() => {
    if (segmentation && canvasContainerRef.current) {
      centerImage();
    }
  }, [segmentation]);

  const centerImage = useCallback(() => {
    if (!canvasContainerRef.current || !segmentation) return;
    
    const container = canvasContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    const img = new Image();
    img.src = segmentation.imageSrc || imageSrc;
    
    img.onload = () => {
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      
      const offsetX = (containerWidth - img.width) / 2;
      const offsetY = (containerHeight - img.height) / 2;
      
      setOffset({ x: offsetX / zoom, y: offsetY / zoom });
    };
  }, [segmentation, imageSrc, zoom]);
  
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const mouseXInImage = (mouseX / zoom) - offset.x;
    const mouseYInImage = (mouseY / zoom) - offset.y;
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, zoom * delta));
    
    const newOffsetX = -mouseXInImage + (mouseX / newZoom);
    const newOffsetY = -mouseYInImage + (mouseY / newZoom);
    
    setZoom(newZoom);
    setOffset({ x: newOffsetX, y: newOffsetY });
  }, [zoom, offset]);
  
  useEffect(() => {
    const currentContainer = canvasContainerRef.current;
    if (!currentContainer) return;
    
    currentContainer.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      currentContainer.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

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
        setSegmentation(prev => {
          if (!prev) return prev;
          
          return {
            ...prev,
            polygons: prev.polygons.map(polygon => {
              if (polygon.id === polygonId) {
                const points = [...polygon.points];
                points[vertexIndex] = { x, y };
                return { ...polygon, points };
              }
              return polygon;
            })
          };
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
  }, [zoom, offset, segmentation, hoveredVertex]);

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
  }, [zoom, offset, segmentation, isPointInPolygon, setSelectedPolygonId]);
  
  const handleMouseUp = useCallback(() => {
    dragState.current.isDragging = false;
    vertexDragState.current.isDragging = false;
    
    if (canvasContainerRef.current) {
      canvasContainerRef.current.style.cursor = 'move';
    }
    
    if (vertexDragState.current.polygonId && segmentation) {
      vertexDragState.current = {
        isDragging: false,
        polygonId: null,
        vertexIndex: null
      };
    }
  }, [segmentation]);
  
  const handleZoomIn = useCallback(() => {
    setZoom(prev => {
      const newZoom = Math.min(prev * 1.2, 10);
      return newZoom;
    });
  }, []);
  
  const handleZoomOut = useCallback(() => {
    setZoom(prev => {
      const newZoom = Math.max(prev / 1.2, 0.1);
      return newZoom;
    });
  }, []);
  
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setSegmentation(history[historyIndex - 1]);
    }
  }, [historyIndex, history]);
  
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setSegmentation(history[historyIndex + 1]);
    }
  }, [historyIndex, history]);
  
  const handleDeletePolygon = useCallback(() => {
    if (!selectedPolygonId || !segmentation) return;
    
    setSegmentation(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        polygons: prev.polygons.filter(polygon => polygon.id !== selectedPolygonId)
      };
    });
    
    setSelectedPolygonId(null);
    toast.success("Region deleted");
  }, [selectedPolygonId, segmentation]);
  
  const handleResetView = useCallback(() => {
    setZoom(1);
    centerImage();
  }, [centerImage]);
  
  const handleSave = useCallback(async () => {
    if (!segmentation || !imageId) return;
    
    setSaving(true);
    
    try {
      const { error } = await supabase
        .from("images")
        .update({
          segmentation_status: 'completed',
          segmentation_result: segmentation as unknown as any,
          updated_at: new Date().toISOString()
        })
        .eq("id", imageId);
      
      if (error) throw new Error(error.message);
      
      toast.success("Segmentation saved successfully");
    } catch (error: any) {
      console.error("Error saving segmentation:", error);
      toast.error(`Failed to save segmentation: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }, [segmentation, imageId]);
  
  const navigateToImage = useCallback((direction: 'prev' | 'next') => {
    if (!imageId || !projectId) return;
    
    const currentId = imageId;
    
    const newId = direction === 'prev' 
      ? `${parseInt(currentId) - 1}` 
      : `${parseInt(currentId) + 1}`;
    
    window.location.href = `/segmentation/${projectId}/${newId}`;
  }, [imageId, projectId]);
  
  useEffect(() => {
    if (!segmentation || historyIndex === -1) return;
    
    if (historyIndex < history.length - 1) {
      setHistory(prev => prev.slice(0, historyIndex + 1));
    }
    
    setHistory(prev => [...prev, {...segmentation}]);
    setHistoryIndex(prev => prev + 1);
  }, [segmentation, historyIndex, history]);

  return {
    projectTitle,
    imageName,
    imageSrc,
    loading,
    saving,
    segmentation,
    selectedPolygonId,
    hoveredVertex,
    zoom,
    offset,
    history,
    historyIndex,
    dragState,
    vertexDragState,
    canvasContainerRef,
    setSegmentation,
    setSelectedPolygonId,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleZoomIn,
    handleZoomOut,
    handleUndo,
    handleRedo,
    handleDeletePolygon,
    handleResetView,
    handleSave,
    navigateToImage,
    isPointInPolygon,
    centerImage
  };
};
