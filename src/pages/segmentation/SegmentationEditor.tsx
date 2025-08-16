import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectData } from '@/hooks/useProjectData';
import { useEnhancedSegmentationEditor } from './hooks/useEnhancedSegmentationEditor';
import { EditMode } from './types';
import { Polygon } from '@/lib/segmentation';
import apiClient, { SegmentationPolygon } from '@/lib/api';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

// New layout components
import VerticalToolbar from './components/VerticalToolbar';
import TopToolbar from './components/TopToolbar';
import PolygonListPanel from './components/PolygonListPanel';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';

// Canvas components
import CanvasContainer from './components/canvas/CanvasContainer';
import CanvasContent from './components/canvas/CanvasContent';
import CanvasImage from './components/canvas/CanvasImage';
import CanvasPolygon from './components/canvas/CanvasPolygon';
import CanvasSvgFilters from './components/canvas/CanvasSvgFilters';
import ModeInstructions from './components/canvas/ModeInstructions';
import CanvasTemporaryGeometryLayer from './components/canvas/CanvasTemporaryGeometryLayer';

// Layout components
import EditorHeader from './components/EditorHeader';
import StatusBar from './components/StatusBar';
import EditorLayout from './components/layout/EditorLayout';

/**
 * Migrated Segmentation Editor with Enhanced Features
 * Uses new SpheroSeg-inspired system while maintaining compatibility
 */
const SegmentationEditor = () => {
  const { projectId, imageId } = useParams<{
    projectId: string;
    imageId: string;
  }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Project data
  const {
    projectTitle,
    images,
    loading: projectLoading,
  } = useProjectData(projectId, user?.id);

  // Create compatibility objects for existing code
  const projectImages = images || [];
  const selectedImage = projectImages.find(img => img.id === imageId);
  const project = { name: projectTitle || 'Unknown Project' };

  // State for segmentation polygons from API
  const [segmentationPolygons, setSegmentationPolygons] = useState<
    SegmentationPolygon[] | null
  >(null);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [hiddenPolygonIds, setHiddenPolygonIds] = useState<Set<string>>(
    new Set()
  );
  const [canvasDimensions, setCanvasDimensions] = useState({
    width: 800,
    height: 600,
  });

  // Calculate canvas dimensions dynamically based on container and image
  const updateCanvasDimensions = useCallback(
    (containerWidth: number, containerHeight: number) => {
      if (imageDimensions) {
        const imageAspectRatio = imageDimensions.width / imageDimensions.height;
        const containerAspectRatio = containerWidth / containerHeight;

        let newWidth, newHeight;
        if (imageAspectRatio > containerAspectRatio) {
          // Image is wider than container
          newWidth = containerWidth;
          newHeight = containerWidth / imageAspectRatio;
        } else {
          // Image is taller than container
          newHeight = containerHeight;
          newWidth = containerHeight * imageAspectRatio;
        }

        // Apply devicePixelRatio for crisp rendering
        const dpr = window.devicePixelRatio || 1;
        setCanvasDimensions({
          width: Math.round(newWidth * dpr) / dpr,
          height: Math.round(newHeight * dpr) / dpr,
        });
      }
    },
    [imageDimensions]
  );

  // Update canvas dimensions when image dimensions change
  useEffect(() => {
    if (imageDimensions) {
      // Use a default container size for now, could be measured from ref
      const defaultContainerWidth = 800;
      const defaultContainerHeight = 600;
      updateCanvasDimensions(defaultContainerWidth, defaultContainerHeight);
    }
  }, [imageDimensions, updateCanvasDimensions]);

  const canvasWidth = canvasDimensions.width;
  const canvasHeight = canvasDimensions.height;

  // Get initial polygons from segmentation data
  const initialPolygons = useMemo(() => {
    // Return empty array if no segmentation data exists
    if (!segmentationPolygons || segmentationPolygons.length === 0) {
      return [];
    }

    // Transform SegmentationPolygon[] to Polygon[] and filter out invalid polygons
    const polygons: Polygon[] = segmentationPolygons
      .filter(segPoly => segPoly.points && segPoly.points.length >= 3)
      .map(segPoly => {
        const validPoints = segPoly.points
          .map(point => {
            // Convert from array format [x, y] to object format {x, y}
            if (Array.isArray(point)) {
              return { x: point[0], y: point[1] };
            }
            // Validate object points have numeric x and y
            if (typeof point === 'object' && point !== null) {
              if (typeof point.x === 'number' && typeof point.y === 'number') {
                return point;
              }
              // Skip invalid object points
              console.warn(
                'Skipping invalid point with non-numeric coordinates:',
                point
              );
              return null;
            }
            // Skip other invalid formats
            console.warn('Skipping invalid point format:', point);
            return null;
          })
          .filter((point): point is { x: number; y: number } => point !== null);

        // Only include polygon if it still has at least 3 valid points
        if (validPoints.length >= 3) {
          return {
            id: segPoly.id,
            points: validPoints,
            type: segPoly.type,
            class: segPoly.class,
            confidence: segPoly.confidence,
            area: segPoly.area,
          };
        }

        console.warn(
          'Dropping polygon due to insufficient valid points:',
          segPoly.id
        );
        return null;
      })
      .filter((polygon): polygon is Polygon => polygon !== null);

    const invalidCount = segmentationPolygons.length - polygons.length;
    if (invalidCount > 0) {
      logger.warn(
        `⚠️ Filtered out ${invalidCount} invalid polygons (missing or insufficient points)`
      );
    }

    logger.debug('🔄 Transformed segmentation polygons for editor:', {
      hasSegmentationData: true,
      inputCount: segmentationPolygons.length,
      validCount: polygons.length,
      filteredOut: invalidCount,
      imageDimensions,
      firstPolygon: polygons[0]
        ? {
            id: polygons[0].id,
            type: polygons[0].type,
            pointsCount: polygons[0].points?.length || 0,
            firstPoints: polygons[0].points?.slice(0, 3),
          }
        : null,
    });

    return polygons;
  }, [segmentationPolygons, imageDimensions]);

  // Initialize enhanced editor
  const editor = useEnhancedSegmentationEditor({
    initialPolygons,
    imageWidth: imageDimensions?.width || 1024,
    imageHeight: imageDimensions?.height || 768,
    canvasWidth,
    canvasHeight,
    onSave: async polygons => {
      if (!projectId || !imageId) return;

      try {
        // Transform Polygon[] to SegmentationPolygon[] for API
        const polygonData: SegmentationPolygon[] = polygons.map(polygon => ({
          id: polygon.id,
          points: polygon.points,
          type: polygon.type || 'external',
          class: polygon.class || 'spheroid',
          parentIds: [], // Add empty array for API compatibility
          confidence: polygon.confidence,
          area: polygon.area,
        }));

        const updatedPolygons = await apiClient.updateSegmentationResults(
          imageId,
          polygonData
        );
        setSegmentationPolygons(updatedPolygons);
        toast.success('Segmentation saved successfully');
      } catch (error) {
        logger.error('Failed to save segmentation:', error);
        toast.error('Failed to save segmentation data');
      }
    },
    // Removed onPolygonsChange to prevent circular updates
  });

  // Wrapper for handling polygon selection that automatically switches to View mode
  // when deselecting a polygon in Edit Vertices mode
  const handlePolygonSelection = useCallback(
    (polygonId: string | null) => {
      // Don't allow polygon selection changes when in Slice mode
      // The slice mode handles its own polygon selection logic
      if (editor.editMode === EditMode.Slice) {
        return;
      }

      // If deselecting (setting to null) and we're in Edit Vertices mode, switch to View mode
      if (polygonId === null && editor.editMode === EditMode.EditVertices) {
        editor.setEditMode(EditMode.View);
      }
      editor.setSelectedPolygonId(polygonId);
    },
    [editor, editor.editMode, editor.setEditMode, editor.setSelectedPolygonId]
  );

  // Load segmentation data
  useEffect(() => {
    const loadSegmentation = async () => {
      if (!projectId || !imageId) return;

      try {
        const polygons = await apiClient.getSegmentationResults(imageId);
        // Handle empty or null segmentation gracefully
        if (!polygons) {
          logger.debug('No segmentation data found for image:', imageId);
          setSegmentationPolygons(null);
          return;
        }
        logger.debug('📥 Loaded segmentation polygons from API:', {
          imageId,
          polygonCount: polygons.length,
          firstPolygon: polygons[0]
            ? {
                id: polygons[0].id,
                type: polygons[0].type,
                pointsCount: polygons[0].points?.length || 0,
                samplePoints: polygons[0].points?.slice(0, 3),
              }
            : null,
        });
        setSegmentationPolygons(polygons);
      } catch (error) {
        logger.error('Failed to load segmentation:', error);
        // Set to null instead of showing error for missing segmentation
        if (
          error &&
          typeof error === 'object' &&
          'response' in error &&
          (error as { response?: { status?: number } }).response?.status === 404
        ) {
          logger.debug('No segmentation found for image (404):', imageId);
          setSegmentationPolygons(null);
        } else {
          toast.error('Failed to load segmentation data');
          setSegmentationPolygons(null);
        }
      }
    };

    loadSegmentation();
  }, [projectId, imageId]);

  // Debug logging for polygon rendering (only when polygons change)
  useEffect(() => {
    const filteredPolygons = editor.polygons.filter(
      polygon => !hiddenPolygonIds.has(polygon.id)
    );
    logger.debug('🎨 Polygon rendering state:', {
      totalPolygons: editor.polygons.length,
      visiblePolygons: filteredPolygons.length,
      hiddenCount: hiddenPolygonIds.size,
      imageDimensions,
      transform: editor.transform,
      svgViewBox: `0 0 ${imageDimensions?.width || canvasWidth} ${imageDimensions?.height || canvasHeight}`,
      firstPolygon: filteredPolygons[0]
        ? {
            id: filteredPolygons[0].id,
            pointsCount: filteredPolygons[0].points?.length || 0,
            samplePoints: filteredPolygons[0].points?.slice(0, 5),
            bounds:
              filteredPolygons[0].points?.length > 0
                ? {
                    minX: Math.min(...filteredPolygons[0].points.map(p => p.x)),
                    maxX: Math.max(...filteredPolygons[0].points.map(p => p.x)),
                    minY: Math.min(...filteredPolygons[0].points.map(p => p.y)),
                    maxY: Math.max(...filteredPolygons[0].points.map(p => p.y)),
                  }
                : null,
          }
        : null,
    });
  }, [editor.polygons, hiddenPolygonIds, imageDimensions, canvasHeight, canvasWidth, editor.transform]);

  // Handle image load to get dimensions
  const handleImageLoad = (width: number, height: number) => {
    setImageDimensions({ width, height });
  };

  // Navigation functions
  const navigateToImage = (direction: 'prev' | 'next') => {
    if (!projectImages?.length) return;

    const currentIndex = projectImages.findIndex(img => img.id === imageId);
    if (currentIndex === -1) return;

    let nextIndex;

    if (direction === 'next') {
      nextIndex =
        currentIndex < projectImages.length - 1 ? currentIndex + 1 : 0;
    } else {
      nextIndex =
        currentIndex > 0 ? currentIndex - 1 : projectImages.length - 1;
    }

    const nextImage = projectImages[nextIndex];
    if (nextImage) {
      navigate(`/segmentation/${projectId}/${nextImage.id}`);
    }
  };

  // Legacy compatibility handlers
  const handleTogglePolygonVisibility = (polygonId: string) => {
    setHiddenPolygonIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(polygonId)) {
        newSet.delete(polygonId);
      } else {
        newSet.add(polygonId);
      }
      return newSet;
    });
  };

  const handleRenamePolygon = (polygonId: string, name: string) => {
    const updatedPolygons = editor.polygons.map(p =>
      p.id === polygonId ? { ...p, name } : p
    );
    editor.updatePolygons(updatedPolygons);
  };

  const handleDeletePolygonFromPanel = (polygonId: string) => {
    editor.handleDeletePolygon(polygonId);
    setHiddenPolygonIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(polygonId);
      return newSet;
    });
  };

  // Convert new EditMode to legacy booleans for compatibility
  const legacyModes = useMemo(
    () => ({
      editMode: editor.editMode === EditMode.EditVertices,
      slicingMode: editor.editMode === EditMode.Slice,
      pointAddingMode: editor.editMode === EditMode.AddPoints,
      deleteMode: editor.editMode === EditMode.DeletePolygon,
    }),
    [editor.editMode]
  );

  const currentImageIndex =
    projectImages?.findIndex(img => img.id === imageId) ?? -1;
  const isAnyEditModeActive = editor.editMode !== EditMode.View;

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        Loading...
      </div>
    );
  }

  if (!selectedImage) {
    return (
      <div className="flex items-center justify-center h-screen">
        Image not found
      </div>
    );
  }

  // Spočítáme počty viditelných a skrytých polygonů
  const visiblePolygonsCount = editor.polygons.length - hiddenPolygonIds.size;
  const hiddenPolygonsCount = hiddenPolygonIds.size;

  return (
    <EditorLayout>
      {/* Header */}
      <EditorHeader
        projectId={projectId || ''}
        projectTitle={project?.name || 'Unknown Project'}
        imageName={selectedImage.name}
        currentImageIndex={currentImageIndex !== -1 ? currentImageIndex : 0}
        totalImages={projectImages?.length || 0}
        onNavigate={navigateToImage}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Vertical Toolbar */}
        <VerticalToolbar
          editMode={editor.editMode}
          selectedPolygonId={editor.selectedPolygonId}
          setEditMode={editor.setEditMode}
          disabled={projectLoading}
          onZoomIn={editor.handleZoomIn}
          onZoomOut={editor.handleZoomOut}
          onResetView={editor.handleResetView}
        />

        {/* Center: Canvas and Top Toolbar */}
        <div className="flex-1 flex flex-col">
          {/* Top Toolbar */}
          <TopToolbar
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            hasUnsavedChanges={editor.hasUnsavedChanges}
            handleUndo={editor.handleUndo}
            handleRedo={editor.handleRedo}
            handleSave={editor.handleSave}
            disabled={projectLoading}
            isSaving={editor.isSaving}
          />

          {/* Canvas Area */}
          <div className="flex-1 flex">
            <div className="flex-1 p-2">
              <CanvasContainer
                ref={editor.canvasRef}
                editMode={editor.editMode}
                onMouseDown={editor.handleMouseDown}
                onMouseMove={editor.handleMouseMove}
                onMouseUp={editor.handleMouseUp}
                loading={projectLoading}
                // Legacy compatibility props
                slicingMode={legacyModes.slicingMode}
                pointAddingMode={legacyModes.pointAddingMode}
                deleteMode={legacyModes.deleteMode}
              >
                <CanvasContent transform={editor.transform}>
                  {/* Base Image */}
                  {selectedImage && (
                    <CanvasImage
                      src={selectedImage.url}
                      width={imageDimensions?.width || canvasWidth}
                      height={imageDimensions?.height || canvasHeight}
                      alt="Segmentation target"
                      onLoad={handleImageLoad}
                    />
                  )}

                  {/* SVG Overlay for polygon rendering - uses same dimensions as image */}
                  <svg
                    width={imageDimensions?.width || canvasWidth}
                    height={imageDimensions?.height || canvasHeight}
                    viewBox={`0 0 ${imageDimensions?.width || canvasWidth} ${imageDimensions?.height || canvasHeight}`}
                    className="absolute top-0 left-0"
                    style={{
                      width: imageDimensions?.width || canvasWidth,
                      height: imageDimensions?.height || canvasHeight,
                      maxWidth: 'none',
                      shapeRendering: 'geometricPrecision',
                      pointerEvents: 'auto',
                      zIndex: 10,
                    }}
                    onClick={e => {
                      // Unselect polygon when clicking on empty canvas area
                      if (e.target === e.currentTarget) {
                        handlePolygonSelection(null);
                      }
                    }}
                    data-transform={JSON.stringify(editor.transform)}
                    data-image-dims={JSON.stringify(imageDimensions)}
                    data-polygon-count={editor.polygons.length}
                  >
                    {/* SVG Filters for glow effects */}
                    <CanvasSvgFilters />

                    {/* Render all polygons */}
                    {(() => {
                      const visiblePolygons = editor.polygons
                        .filter(polygon => !hiddenPolygonIds.has(polygon.id))
                        .filter(
                          polygon =>
                            polygon.points && polygon.points.length >= 3
                        );

                      // Render polygons
                      return (
                        <>
                          {/* Actual polygons */}
                          {visiblePolygons.map(polygon => (
                            <CanvasPolygon
                              key={polygon.id}
                              polygon={polygon}
                              isSelected={
                                polygon.id === editor.selectedPolygonId
                              }
                              hoveredVertex={
                                editor.hoveredVertex || {
                                  polygonId: null,
                                  vertexIndex: null,
                                }
                              }
                              vertexDragState={editor.vertexDragState}
                              zoom={editor.transform.zoom}
                              onSelectPolygon={() =>
                                handlePolygonSelection(polygon.id)
                              }
                            />
                          ))}
                        </>
                      );
                    })()}

                    {/* Vertices are now rendered inside CanvasPolygon component */}

                    {/* Temporary geometry (preview lines, temp points, etc.) */}
                    <CanvasTemporaryGeometryLayer
                      transform={editor.transform}
                      editMode={editor.editMode}
                      tempPoints={editor.tempPoints}
                      cursorPosition={editor.cursorPosition}
                      interactionState={editor.interactionState}
                      selectedPolygonId={editor.selectedPolygonId}
                      polygons={editor.polygons}
                    />
                  </svg>
                </CanvasContent>

                {/* Mode Instructions Overlay */}
                <ModeInstructions
                  editMode={editor.editMode}
                  interactionState={editor.interactionState}
                  selectedPolygonId={editor.selectedPolygonId}
                  tempPoints={editor.tempPoints}
                  isShiftPressed={editor.keyboardState.isShiftPressed()}
                />
              </CanvasContainer>
            </div>

            {/* Right: Polygon List Panel */}
            <PolygonListPanel
              loading={projectLoading}
              polygons={editor.polygons}
              selectedPolygonId={editor.selectedPolygonId}
              onSelectPolygon={handlePolygonSelection}
              hiddenPolygonIds={hiddenPolygonIds}
              onTogglePolygonVisibility={handleTogglePolygonVisibility}
              onRenamePolygon={handleRenamePolygon}
              onDeletePolygon={handleDeletePolygonFromPanel}
            />
          </div>
        </div>
      </div>

      {/* Bottom: Status Bar with Keyboard Shortcuts */}
      <div className="relative">
        {/* Keyboard Shortcuts Button - positioned in bottom left corner */}
        <KeyboardShortcutsHelp className="absolute left-2 bottom-2 z-10" />

        {/* Status Bar */}
        <StatusBar
          polygons={editor.polygons}
          editMode={editor.editMode}
          selectedPolygonId={editor.selectedPolygonId}
          visiblePolygonsCount={visiblePolygonsCount}
          hiddenPolygonsCount={hiddenPolygonsCount}
        />
      </div>
    </EditorLayout>
  );
};

export default SegmentationEditor;
