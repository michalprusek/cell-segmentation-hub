
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
  CheckCircle,
  MoveHorizontal,
  Trash2,
  Home,
  Layers,
  Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  segmentImage, 
  SegmentationResult, 
  Point, 
  Polygon 
} from '@/lib/segmentation';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from '@/components/ui/separator';

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
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null);
  const [history, setHistory] = useState<SegmentationResult[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
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
          
          // Initialize history
          setHistory([result]);
          setHistoryIndex(0);
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
  }, [segmentation]);
  
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
        
        // Different styling for selected polygon
        if (polygon.id === selectedPolygonId) {
          ctx.strokeStyle = '#FF3B30';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 59, 48, 0.2)';
        } else {
          ctx.strokeStyle = '#00BFFF';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'rgba(0, 191, 255, 0.2)';
        }
        ctx.fill();
        
        // Draw vertices
        polygon.points.forEach(point => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
          
          if (polygon.id === selectedPolygonId) {
            ctx.fillStyle = '#FF3B30';
          } else {
            ctx.fillStyle = '#FFFFFF';
          }
          
          ctx.fill();
          ctx.strokeStyle = polygon.id === selectedPolygonId ? '#FF3B30' : '#0077FF';
          ctx.lineWidth = 2;
          ctx.stroke();
        });
      });
    };
    
    img.src = segmentation.imageSrc || '/placeholder.svg';
  }, [segmentation, selectedPolygonId]);
  
  // Handle mouse down for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !canvasRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
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
  }, [zoom, offset, segmentation]);
  
  // Helper function to check if a point is inside a polygon
  const isPointInPolygon = (x: number, y: number, points: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x, yi = points[i].y;
      const xj = points[j].x, yj = points[j].y;
      
      const intersect = ((yi > y) !== (yj > y))
          && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };
  
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
  
  // Handle undo/redo
  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setSegmentation(history[historyIndex - 1]);
    }
  };
  
  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setSegmentation(history[historyIndex + 1]);
    }
  };
  
  // Handle delete selected polygon
  const handleDeletePolygon = () => {
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
  };
  
  // Handle reset view
  const handleResetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
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
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => navigate(`/project/${projectId}`)}
              className="text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back to Project
            </Button>
            <div>
              <h1 className="text-lg font-medium">{projectTitle}</h1>
              <p className="text-sm text-slate-400">{imageName}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => navigateToImage('prev')}
                    className="text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Previous Image</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => navigateToImage('next')}
                    className="text-slate-300 border-slate-600 hover:bg-slate-700 hover:text-white"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Next Image</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    onClick={handleSave}
                    disabled={saving || loading}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
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
                </TooltipTrigger>
                <TooltipContent>Save Changes</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>
      
      {/* Main content */}
      <div className="flex-1 flex flex-col relative">
        {/* Left Toolbar */}
        <div className="absolute top-4 left-4 z-10 bg-slate-800 border border-slate-700 rounded-lg shadow-lg flex flex-col space-y-2 p-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
                  onClick={handleZoomIn}
                >
                  <ZoomIn className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Zoom In</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
                  onClick={handleZoomOut}
                >
                  <ZoomOut className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Zoom Out</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
                  onClick={handleResetView}
                >
                  <Home className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Reset View</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <Separator className="bg-slate-700" />
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                >
                  <Undo className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Undo</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-9 w-9 text-slate-300 hover:bg-slate-700 hover:text-white"
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                >
                  <Redo className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Redo</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <Separator className="bg-slate-700" />
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className={`h-9 w-9 hover:bg-slate-700 ${selectedPolygonId ? 'text-red-500 hover:text-red-400' : 'text-slate-500'}`}
                  onClick={handleDeletePolygon}
                  disabled={!selectedPolygonId}
                >
                  <Trash2 className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Delete Selected Region</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <div className="px-2 text-center text-xs py-1 border-t border-slate-700 mt-1 pt-1 text-slate-400">
            {Math.round(zoom * 100)}%
          </div>
        </div>
        
        {/* Right sidebar */}
        <Sheet>
          <SheetTrigger asChild>
            <Button 
              variant="outline" 
              size="sm"
              className="absolute top-4 right-4 z-10 bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <Layers className="h-4 w-4 mr-2" />
              Regions
            </Button>
          </SheetTrigger>
          <SheetContent className="bg-slate-800 border-slate-700 text-white">
            <SheetHeader>
              <SheetTitle className="text-white">Segmentation Regions</SheetTitle>
              <SheetDescription className="text-slate-400">
                View and manage detected regions
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />
                </div>
              ) : segmentation?.polygons.length === 0 ? (
                <div className="text-center py-10 text-slate-400">
                  <div className="mb-2">No regions detected</div>
                  <Button variant="outline" size="sm">
                    Run Detection Again
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {segmentation?.polygons.map((polygon, index) => (
                    <div 
                      key={polygon.id}
                      className={`p-3 rounded-md cursor-pointer flex items-center justify-between ${
                        selectedPolygonId === polygon.id ? 'bg-blue-900 bg-opacity-30 border border-blue-500' : 'hover:bg-slate-700'
                      }`}
                      onClick={() => setSelectedPolygonId(polygon.id)}
                    >
                      <div className="flex items-center">
                        <div 
                          className="w-4 h-4 rounded-full mr-3" 
                          style={{background: selectedPolygonId === polygon.id ? '#FF3B30' : '#00BFFF'}}
                        />
                        <span>Region {index + 1}</span>
                      </div>
                      <span className="text-xs text-slate-400">{polygon.points.length} points</span>
                    </div>
                  ))}
                </div>
              )}
              <Separator className="my-4 bg-slate-700" />
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Statistics</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-slate-700 rounded-md">
                    <div className="text-xs text-slate-400">Total Regions</div>
                    <div className="text-lg font-semibold">{segmentation?.polygons.length || 0}</div>
                  </div>
                  <div className="p-2 bg-slate-700 rounded-md">
                    <div className="text-xs text-slate-400">Selected</div>
                    <div className="text-lg font-semibold">{selectedPolygonId ? 'Yes' : 'No'}</div>
                  </div>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        
        {/* Help button */}
        <Sheet>
          <SheetTrigger asChild>
            <Button 
              variant="outline" 
              size="icon"
              className="absolute bottom-4 right-4 z-10 rounded-full h-10 w-10 bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <Info className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent className="bg-slate-800 border-slate-700 text-white">
            <SheetHeader>
              <SheetTitle className="text-white">Segmentation Editor Help</SheetTitle>
              <SheetDescription className="text-slate-400">
                Instructions and keyboard shortcuts
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">Navigation</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex justify-between items-center">
                    <span>Pan the image</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Click and drag</span>
                  </li>
                  <li className="flex justify-between items-center">
                    <span>Zoom in/out</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Mouse wheel or toolbar</span>
                  </li>
                  <li className="flex justify-between items-center">
                    <span>Reset view</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Home button</span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Editing</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex justify-between items-center">
                    <span>Select a region</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Click on it</span>
                  </li>
                  <li className="flex justify-between items-center">
                    <span>Move a vertex</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Drag the vertex point</span>
                  </li>
                  <li className="flex justify-between items-center">
                    <span>Delete selected region</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Trash icon or Delete key</span>
                  </li>
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Keyboard Shortcuts</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  <li className="flex justify-between items-center">
                    <span>Undo</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Ctrl+Z</span>
                  </li>
                  <li className="flex justify-between items-center">
                    <span>Redo</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Ctrl+Y</span>
                  </li>
                  <li className="flex justify-between items-center">
                    <span>Save</span>
                    <span className="text-xs bg-slate-700 px-2 py-1 rounded">Ctrl+S</span>
                  </li>
                </ul>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        
        {/* Canvas container */}
        <div 
          ref={containerRef} 
          className="flex-1 overflow-hidden relative cursor-move bg-slate-950 bg-opacity-50 bg-[radial-gradient(#1a1f2c_1px,transparent_1px)] bg-[size:20px_20px]"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center">
                <Loader2 className="h-10 w-10 text-blue-500 animate-spin mb-4" />
                <p className="text-slate-300">Loading segmentation data...</p>
              </div>
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
                className="bg-slate-950 shadow-xl"
              />
            </div>
          )}
        </div>
        
        {/* Status */}
        <div className="bg-slate-800 border-t border-slate-700 p-2 px-4 flex justify-between items-center">
          <div className="flex items-center">
            <CheckCircle className="h-4 w-4 text-green-500 mr-2" />
            <span className="text-sm">Segmentation Complete</span>
          </div>
          <div className="text-sm text-slate-400">
            {segmentation?.polygons.length || 0} regions detected
          </div>
        </div>
      </div>
    </div>
  );
};

export default SegmentationEditor;
