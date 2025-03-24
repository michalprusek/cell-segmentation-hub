
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
  
  // Reference pro canvas a container
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  
  // Reference pro drag states
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

  // Pomocná funkce pro kontrolu, zda je bod uvnitř polygonu
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
  
  // Centrování obrazu při prvním načtení
  useEffect(() => {
    if (segmentation && canvasContainerRef.current) {
      centerImage();
    }
  }, [segmentation]);

  // Vycentrovat obrázek
  const centerImage = useCallback(() => {
    if (!canvasContainerRef.current || !segmentation) return;
    
    const container = canvasContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    // Vytvoření dočasného obrázku pro získání rozměrů
    const img = new Image();
    img.src = segmentation.imageSrc || imageSrc;
    
    img.onload = () => {
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      
      // Vypočítat offset, aby byl obrázek uprostřed
      const offsetX = (containerWidth - img.width) / 2;
      const offsetY = (containerHeight - img.height) / 2;
      
      setOffset({ x: offsetX / zoom, y: offsetY / zoom });
    };
  }, [segmentation, imageSrc, zoom]);
  
  // Kolo myši pro zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Pozice myši relativně k containeru
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Konverze pozice myši do souřadnic v aktuálním měřítku
    const mouseXInCanvas = (mouseX / zoom) - offset.x;
    const mouseYInCanvas = (mouseY / zoom) - offset.y;
    
    // Nový zoom
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, zoom * delta));
    
    // Nový offset, aby se zachovala pozice kurzoru
    const newOffsetX = -mouseXInCanvas + (mouseX / newZoom);
    const newOffsetY = -mouseYInCanvas + (mouseY / newZoom);
    
    setZoom(newZoom);
    setOffset({ x: newOffsetX, y: newOffsetY });
  }, [zoom, offset]);
  
  // Přidat a odebrat event listener pro kolečko myši
  useEffect(() => {
    const currentContainer = canvasContainerRef.current;
    if (!currentContainer) return;
    
    currentContainer.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      currentContainer.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel]);

  // Mouse handling - over/out na vertexech
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const containerElement = e.currentTarget;
    if (!containerElement) return;
    
    const rect = containerElement.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
    // Pokud táhneme vertex, aktualizovat jeho pozici
    if (vertexDragState.current.isDragging && segmentation) {
      setSegmentation(prev => {
        if (!prev) return prev;
        
        return {
          ...prev,
          polygons: prev.polygons.map(polygon => {
            if (polygon.id === vertexDragState.current.polygonId) {
              const points = [...polygon.points];
              if (vertexDragState.current.vertexIndex !== null) {
                points[vertexDragState.current.vertexIndex] = { 
                  x: x - offset.x, 
                  y: y - offset.y 
                };
              }
              return { ...polygon, points };
            }
            return polygon;
          })
        };
      });
      
      return;
    }
    
    // Pokud táhneme celou scénu, aktualizovat offset
    if (dragState.current.isDragging) {
      const dx = e.clientX - dragState.current.startX;
      const dy = e.clientY - dragState.current.startY;
      
      setOffset({
        x: dragState.current.lastX + dx / zoom,
        y: dragState.current.lastY + dy / zoom
      });
      return;
    }
    
    // Detekce najetí myši na vertex
    if (segmentation) {
      let found = false;
      
      for (const polygon of segmentation.polygons) {
        for (let i = 0; i < polygon.points.length; i++) {
          const point = polygon.points[i];
          const dx = point.x - (x - offset.x);
          const dy = point.y - (y - offset.y);
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance <= 8 / zoom) {
            // Najetí na vertex
            setHoveredVertex({
              polygonId: polygon.id,
              vertexIndex: i
            });
            found = true;
            break;
          }
        }
        if (found) break;
      }
      
      if (!found && (hoveredVertex.polygonId !== null || hoveredVertex.vertexIndex !== null)) {
        setHoveredVertex({ polygonId: null, vertexIndex: null });
      }
    }
  }, [zoom, offset, segmentation, hoveredVertex]);

  // Handle mouse down pro zahájení tažení
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const containerElement = e.currentTarget;
    if (!containerElement) return;
    
    const rect = containerElement.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
    // Kontrola, zda klikáme na polygon nebo vertex
    if (segmentation) {
      for (const polygon of segmentation.polygons) {
        // Nejprve kontrola vertexů
        for (let i = 0; i < polygon.points.length; i++) {
          const point = polygon.points[i];
          const dx = point.x - (x - offset.x);
          const dy = point.y - (y - offset.y);
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance <= 8 / zoom) {
            // Klik na vertex
            setSelectedPolygonId(polygon.id);
            vertexDragState.current = {
              isDragging: true,
              polygonId: polygon.id,
              vertexIndex: i
            };
            return;
          }
        }
        
        // Kontrola, zda klikáme uvnitř polygonu
        const isInside = isPointInPolygon(x - offset.x, y - offset.y, polygon.points);
        if (isInside) {
          setSelectedPolygonId(polygon.id);
          return;
        }
      }
      
      // Pokud jsme klikli na prázdné místo, odselektovat aktuální polygon
      setSelectedPolygonId(null);
    }
    
    // Pokud jsme neklikli na vertex ani polygon, začít posun plátna
    dragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: offset.x,
      lastY: offset.y
    };
  }, [zoom, offset, segmentation, isPointInPolygon]);
  
  // Ukončení tažení při puštění tlačítka myši
  const handleMouseUp = useCallback(() => {
    dragState.current.isDragging = false;
    vertexDragState.current.isDragging = false;
  }, []);
  
  // Funkce pro zoom
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
  
  // Funkce pro undo/redo
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
  
  // Smazání vybraného polygonu
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
  
  // Reset pohledu
  const handleResetView = useCallback(() => {
    setZoom(1);
    centerImage();
  }, [centerImage]);
  
  // Uložení segmentace
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
  
  // Navigace na předchozí nebo další obrázek
  const navigateToImage = useCallback((direction: 'prev' | 'next') => {
    if (!imageId || !projectId) return;
    
    const currentId = imageId;
    
    // V reálné aplikaci by toto dotazovalo databázi pro sousední obrázky
    // Pro teď jen inkrementujeme nebo dekrementujeme ID (zjednodušený přístup)
    const newId = direction === 'prev' 
      ? `${parseInt(currentId) - 1}` 
      : `${parseInt(currentId) + 1}`;
    
    // Toto je zjednodušený přístup - v reálné aplikaci byste kontrolovali, zda obrázek existuje
    window.location.href = `/segmentation/${projectId}/${newId}`;
  }, [imageId, projectId]);
  
  // Zaznamenání historie při změně segmentace
  useEffect(() => {
    if (!segmentation || historyIndex === -1) return;
    
    // Pokud nejsme na konci pole historie, ořížnout ho
    if (historyIndex < history.length - 1) {
      setHistory(prev => prev.slice(0, historyIndex + 1));
    }
    
    // Přidat aktuální stav do historie
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
