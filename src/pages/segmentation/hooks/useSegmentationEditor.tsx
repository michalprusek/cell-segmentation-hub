
import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { segmentImage, SegmentationResult, Point } from '@/lib/segmentation';
import { DragState, VertexDragState } from '../types';

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
  
  // References for drag states
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

  // Helper function to check if a point is inside a polygon
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

  // Fetch project and image data
  useEffect(() => {
    console.log("SegmentationEditor mounted with params:", { projectId, imageId, userId });
    
    if (!projectId || !imageId) {
      toast.error("Missing project or image ID");
      return;
    }
    
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch project data
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
        
        // Fetch image data
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
        
        // Get segmentation data
        let result: SegmentationResult;
        
        if (imageData.segmentation_status === 'completed' && imageData.segmentation_result) {
          // Use existing results
          result = imageData.segmentation_result as unknown as SegmentationResult;
        } else {
          // Generate new segmentation (would typically be done server-side)
          result = await segmentImage(imageData.image_url || '/placeholder.svg');
          
          // Update segmentation status in the database
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
        
        // Initialize history
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

  // Handle mouse down for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const containerElement = e.currentTarget;
    if (!containerElement) return;
    
    const rect = containerElement.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
    // Check if we're clicking on a polygon or vertex
    if (segmentation) {
      for (const polygon of segmentation.polygons) {
        // Check vertices first
        for (let i = 0; i < polygon.points.length; i++) {
          const point = polygon.points[i];
          const dx = point.x - (x - offset.x);
          const dy = point.y - (y - offset.y);
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance <= 8 / zoom) {
            // Clicked on a vertex
            setSelectedPolygonId(polygon.id);
            vertexDragState.current = {
              isDragging: true,
              polygonId: polygon.id,
              vertexIndex: i
            };
            return;
          }
        }
        
        // Check if we're clicking inside a polygon
        const isInside = isPointInPolygon(x - offset.x, y - offset.y, polygon.points);
        if (isInside) {
          setSelectedPolygonId(polygon.id);
          return;
        }
      }
      
      // If we clicked on empty space, deselect current polygon
      setSelectedPolygonId(null);
    }
    
    // If we didn't click on a vertex or polygon, start panning
    dragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: offset.x,
      lastY: offset.y
    };
  }, [zoom, offset, segmentation, isPointInPolygon]);
  
  // Handle mouse move for dragging
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const containerElement = e.currentTarget;
    if (!containerElement) return;
    
    // Handle vertex dragging
    if (vertexDragState.current.isDragging && segmentation) {
      const rect = containerElement.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom - offset.x;
      const y = (e.clientY - rect.top) / zoom - offset.y;
      
      setSegmentation(prev => {
        if (!prev) return prev;
        
        return {
          ...prev,
          polygons: prev.polygons.map(polygon => {
            if (polygon.id === vertexDragState.current.polygonId) {
              const points = [...polygon.points];
              if (vertexDragState.current.vertexIndex !== null) {
                points[vertexDragState.current.vertexIndex] = { x, y };
              }
              return { ...polygon, points };
            }
            return polygon;
          })
        };
      });
      
      return;
    }
    
    // Handle panning
    if (dragState.current.isDragging) {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      
      setOffset({
        x: dragState.current.lastX + dx / zoom,
        y: dragState.current.lastY + dy / zoom
      });
    }
  }, [zoom, offset, segmentation]);
  
  // Handle mouse up to end dragging
  const handleMouseUp = useCallback(() => {
    dragState.current.isDragging = false;
    vertexDragState.current.isDragging = false;
  }, []);
  
  // Handle zoom in/out
  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev * 1.2, 5));
  }, []);
  
  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev / 1.2, 0.5));
  }, []);
  
  // Handle undo/redo
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
  
  // Handle delete selected polygon
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
  
  // Handle reset view
  const handleResetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);
  
  // Handle save
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
  
  // Navigate to previous or next image
  const navigateToImage = useCallback((direction: 'prev' | 'next') => {
    if (!imageId || !projectId) return;
    
    const currentId = imageId;
    
    // In a real app, this would query the database for adjacent images
    // For now, we just increment or decrement the ID (simplified approach)
    const newId = direction === 'prev' 
      ? `${parseInt(currentId) - 1}` 
      : `${parseInt(currentId) + 1}`;
    
    // This is a simplified approach - in a real app you would check if the image exists
    window.location.href = `/segmentation/${projectId}/${newId}`;
  }, [imageId, projectId]);
  
  // Record history when segmentation changes
  useEffect(() => {
    if (!segmentation || historyIndex === -1) return;
    
    // If we're not at the end of the history array, truncate it
    if (historyIndex < history.length - 1) {
      setHistory(prev => prev.slice(0, historyIndex + 1));
    }
    
    // Add current state to history
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
    zoom,
    offset,
    history,
    historyIndex,
    dragState,
    vertexDragState,
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
    isPointInPolygon
  };
};
