
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { 
  ChevronLeft, 
  ChevronRight, 
  Save, 
  ZoomIn, 
  ZoomOut, 
  Undo, 
  Redo,
  Loader2,
  CheckCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  segmentImage, 
  SegmentationResult, 
  Point, 
  Polygon 
} from '@/lib/segmentation';

interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

interface VertexDragState {
  isDragging: boolean;
  polygonId: string | null;
  vertexIndex: number | null;
}

const SegmentationEditor = () => {
  const { projectId, imageId } = useParams<{ projectId: string, imageId: string }>();
  const navigate = useNavigate();
  const [projectTitle, setProjectTitle] = useState('');
  const [imageName, setImageName] = useState('');
  const [imageSrc, setImageSrc] = useState('/placeholder.svg');
  const [loading, setLoading] = useState(true);
  const [segmentation, setSegmentation] = useState<SegmentationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  
  // Canvas references
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Drag state for panning
  const dragState = useRef<DragState>({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0
  });
  
  // Drag state for vertex manipulation
  const vertexDragState = useRef<VertexDragState>({
    isDragging: false,
    polygonId: null,
    vertexIndex: null
  });
  
  // Fetch project and image data
  useEffect(() => {
    const fetchData = async () => {
      try {
        // In a real app, this would fetch from Supabase
        // For demonstration, we'll use sample data
        const projects = [
          { id: 1, title: "HeLa Cell Spheroids" },
          { id: 2, title: "MCF-7 Breast Cancer" },
          { id: 3, title: "Neural Organoids" },
          { id: 4, title: "Pancreatic Islets" },
          { id: 5, title: "Liver Microtissues" },
          { id: 6, title: "Embryoid Bodies" },
        ];
        
        const project = projects.find(p => p.id.toString() === projectId);
        
        if (project) {
          setProjectTitle(project.title);
          setImageName(`${project.title.split(' ')[0]}_Image_${imageId}.png`);
          
          // Simulate loading the segmentation result
          const result = await segmentImage('/placeholder.svg');
          setSegmentation(result);
        } else {
          toast.error("Project not found");
          navigate("/dashboard");
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Failed to load segmentation data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [projectId, imageId, navigate]);
  
  // Draw on canvas when segmentation or view changes
  useEffect(() => {
    if (!canvasRef.current || !segmentation) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Load image and draw
    const img = new Image();
    img.onload = () => {
      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Draw image
      ctx.drawImage(img, 0, 0);
      
      // Draw polygons
      segmentation.polygons.forEach(polygon => {
        ctx.beginPath();
        ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
        
        for (let i = 1; i < polygon.points.length; i++) {
          ctx.lineTo(polygon.points[i].x, polygon.points[i].y);
        }
        
        ctx.closePath();
        ctx.strokeStyle = '#00BFFF';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(0, 191, 255, 0.2)';
        ctx.fill();
        
        // Draw vertices
        polygon.points.forEach(point => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.strokeStyle = '#0077FF';
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      });
    };
    
    img.src = segmentation.imageSrc || '/placeholder.svg';
  }, [segmentation]);
  
  // Handle mouse down for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !canvasRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    
    // Check if we're clicking on a vertex
    if (segmentation) {
      for (const polygon of segmentation.polygons) {
        for (let i = 0; i < polygon.points.length; i++) {
          const point = polygon.points[i];
          const dx = point.x - (x - offset.x);
          const dy = point.y - (y - offset.y);
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance <= 8 / zoom) {
            // Clicked on a vertex
            vertexDragState.current = {
              isDragging: true,
              polygonId: polygon.id,
              vertexIndex: i
            };
            return;
          }
        }
      }
    }
    
    // If we didn't click on a vertex, start panning
    dragState.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      lastX: offset.x,
      lastY: offset.y
    };
  }, [zoom, offset, segmentation]);
  
  // Handle mouse move for dragging
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !canvasRef.current) return;
    
    // Handle vertex dragging
    if (vertexDragState.current.isDragging && segmentation) {
      const rect = containerRef.current.getBoundingClientRect();
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
  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev * 1.2, 5));
  };
  
  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev / 1.2, 0.5));
  };
  
  // Handle save
  const handleSave = async () => {
    setSaving(true);
    
    try {
      // In a real app, this would save to Supabase
      await new Promise(resolve => setTimeout(resolve, 1000));
      toast.success("Segmentation saved successfully");
    } catch (error) {
      console.error("Error saving segmentation:", error);
      toast.error("Failed to save segmentation");
    } finally {
      setSaving(false);
    }
  };
  
  // Navigate to previous or next image
  const navigateToImage = (direction: 'prev' | 'next') => {
    if (!imageId) return;
    
    const currentId = parseInt(imageId);
    const newId = direction === 'prev' ? Math.max(1, currentId - 1) : currentId + 1;
    
    navigate(`/segmentation/${projectId}/${newId}`);
  };
  
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate(`/project/${projectId}`)}
            >
              Back to Project
            </Button>
            <div>
              <h1 className="text-lg font-medium">{projectTitle}</h1>
              <p className="text-sm text-gray-400">{imageName}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigateToImage('prev')}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigateToImage('next')}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
            <Button 
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex flex-col relative">
        {/* Toolbar */}
        <div className="absolute top-4 left-4 z-10 bg-gray-800 border border-gray-700 p-2 rounded-lg shadow-lg flex flex-col space-y-2">
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={handleZoomIn}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            className="h-8 w-8 p-0"
            onClick={handleZoomOut}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <div className="text-center text-xs py-1 border-t border-gray-700 mt-1 pt-1">
            {Math.round(zoom * 100)}%
          </div>
        </div>
        
        {/* Canvas container */}
        <div 
          ref={containerRef} 
          className="flex-1 overflow-hidden relative cursor-move"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
            </div>
          ) : (
            <div 
              style={{ 
                transform: `scale(${zoom}) translate(${offset.x}px, ${offset.y}px)`,
                transformOrigin: '0 0',
              }}
            >
              <canvas 
                ref={canvasRef} 
                className="bg-gray-950"
              />
            </div>
          )}
        </div>
        
        {/* Status */}
        <div className="bg-gray-800 border-t border-gray-700 p-2 px-4 flex justify-between items-center">
          <div className="flex items-center">
            <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
            <span className="text-sm">Segmentation Complete</span>
          </div>
          <div className="text-sm text-gray-400">
            {segmentation?.polygons.length || 0} regions detected
          </div>
        </div>
      </div>
    </div>
  );
};

export default SegmentationEditor;
