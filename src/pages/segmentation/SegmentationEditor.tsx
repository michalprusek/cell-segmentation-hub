import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useProjectData } from '@/hooks/useProjectData';
import { sortImagesBySettings } from '@/hooks/useImageFilter';
import { useEnhancedSegmentationEditor } from './hooks/useEnhancedSegmentationEditor';
import { useSegmentationReload } from './hooks/useSegmentationReload';
import { useSegmentationQueue } from '@/hooks/useSegmentationQueue';
import useDebounce from '@/hooks/useDebounce';
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
import SegmentationErrorBoundary from './components/SegmentationErrorBoundary';

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
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Project data - fetch all images for segmentation editor
  const {
    projectTitle,
    images,
    loading: projectLoading,
  } = useProjectData(projectId, user?.id, { fetchAll: true });

  // WebSocket connection for segmentation status updates
  const {
    lastUpdate,
    queueStats,
    isConnected: isWebSocketConnected,
  } = useSegmentationQueue(projectId);

  // Debounce WebSocket updates to prevent rapid state changes
  const debouncedLastUpdate = useDebounce(lastUpdate, 300);

  // Create compatibility objects for existing code
  // Apply the same sorting as in ProjectDetail page
  const projectImages = useMemo(() => {
    if (!images) return [];
    return sortImagesBySettings(images);
  }, [images]);

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

  // Use custom hook for segmentation reload logic
  const { isReloading, reloadSegmentation, cleanupReloadOperations } =
    useSegmentationReload({
      projectId,
      imageId,
      onPolygonsLoaded: setSegmentationPolygons,
      onDimensionsUpdated: setImageDimensions,
      maxRetries: 2,
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
    // Return empty array if no segmentation data exists or if it's not an array
    if (
      !segmentationPolygons ||
      !Array.isArray(segmentationPolygons) ||
      segmentationPolygons.length === 0
    ) {
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
    imageId, // Pass imageId to track image changes
    onSave: async (polygons, targetImageId) => {
      const saveToImageId = targetImageId || imageId;
      if (!projectId || !saveToImageId) return;

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

        const updatedResult = await apiClient.updateSegmentationResults(
          saveToImageId,
          polygonData,
          imageDimensions?.width,
          imageDimensions?.height
        );
        // Only update UI state if we're saving the current image (not autosave for different image)
        if (saveToImageId === imageId) {
          setSegmentationPolygons(updatedResult.polygons || []);
          toast.success(t('toast.dataSaved'));
        } else {
          // This is an autosave for a different image, don't show success toast or update UI
          logger.debug('✅ Autosaved polygons for image:', saveToImageId);
        }
      } catch (error) {
        logger.error('Failed to save segmentation:', error);
        toast.error(t('toast.operationFailed'));
      }
    },
    // Removed onPolygonsChange to prevent circular updates
  });

  // Wrapper for handling polygon selection that automatically switches to EditVertices mode
  // when selecting a polygon and to View mode when deselecting
  const handlePolygonSelection = useCallback(
    (polygonId: string | null) => {
      // Don't allow polygon selection changes when in Slice mode
      // The slice mode handles its own polygon selection logic
      if (editor.editMode === EditMode.Slice) {
        return;
      }

      if (polygonId === null) {
        // If deselecting (setting to null) and we're in Edit Vertices mode, switch to View mode
        if (editor.editMode === EditMode.EditVertices) {
          editor.setEditMode(EditMode.View);
        }
      } else {
        // When selecting a polygon, automatically enable EditVertices mode (purple frame)
        editor.setEditMode(EditMode.EditVertices);
      }

      editor.setSelectedPolygonId(polygonId);
    },
    [editor]
  );

  // Load segmentation data
  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();

    const loadSegmentation = async () => {
      if (!projectId || !imageId) return;

      // Immediately clear polygons when switching images to prevent showing old data
      setSegmentationPolygons(null);
      setImageDimensions(null); // Also clear image dimensions
      logger.debug(
        '🧹 Cleared polygons and dimensions for new image:',
        imageId
      );

      // Check if the image has completed segmentation before trying to fetch results
      const hasSegmentation =
        selectedImage?.segmentationStatus === 'completed' ||
        selectedImage?.segmentationStatus === 'segmented';

      if (!hasSegmentation) {
        logger.debug(
          'Image does not have completed segmentation, skipping fetch:',
          {
            imageId,
            status: selectedImage?.segmentationStatus,
          }
        );

        // Set image dimensions from project data if available
        if (selectedImage?.width && selectedImage?.height) {
          logger.debug(
            '📐 Setting image dimensions from project data (no segmentation):',
            {
              width: selectedImage.width,
              height: selectedImage.height,
            }
          );
          if (isMounted) {
            setImageDimensions({
              width: selectedImage.width,
              height: selectedImage.height,
            });
          }
        }
        return;
      }

      try {
        const segmentationData = await apiClient.getSegmentationResults(
          imageId,
          {
            signal: abortController.signal,
          }
        );

        // Check if component is still mounted
        if (!isMounted) return;
        // Handle empty or null segmentation gracefully
        if (!segmentationData || !segmentationData.polygons) {
          logger.debug('No segmentation data found for image:', imageId);
          if (isMounted) {
            setSegmentationPolygons(null);
          }

          // Still try to set image dimensions from project data if available
          if (selectedImage?.width && selectedImage?.height) {
            logger.debug(
              '📐 Setting image dimensions from project data (no segmentation):',
              {
                width: selectedImage.width,
                height: selectedImage.height,
              }
            );
            setImageDimensions({
              width: selectedImage.width,
              height: selectedImage.height,
            });
          }
          return;
        }

        const polygons = segmentationData.polygons;

        // Extract image dimensions from segmentation data if available
        if (segmentationData.imageWidth && segmentationData.imageHeight) {
          logger.debug('📐 Setting image dimensions from segmentation data:', {
            width: segmentationData.imageWidth,
            height: segmentationData.imageHeight,
          });
          setImageDimensions({
            width: segmentationData.imageWidth,
            height: segmentationData.imageHeight,
          });
        } else if (selectedImage?.width && selectedImage?.height) {
          // Fallback to image dimensions from project data (database)
          logger.debug(
            '📐 Setting image dimensions from project data (fallback):',
            {
              width: selectedImage.width,
              height: selectedImage.height,
            }
          );
          if (isMounted) {
            setImageDimensions({
              width: selectedImage.width,
              height: selectedImage.height,
            });
          }
        }

        logger.debug('📥 Loaded segmentation polygons from API:', {
          imageId,
          polygonCount: polygons.length,
          imageDimensions:
            segmentationData.imageWidth && segmentationData.imageHeight
              ? `${segmentationData.imageWidth}x${segmentationData.imageHeight}`
              : 'not available',
          firstPolygon: polygons[0]
            ? {
                id: polygons[0].id,
                type: polygons[0].type,
                pointsCount: polygons[0].points?.length || 0,
                samplePoints: polygons[0].points?.slice(0, 3),
              }
            : null,
        });
        if (isMounted) {
          setSegmentationPolygons(polygons);
        }
      } catch (error: any) {
        // Ignore aborted requests
        if (error.name === 'AbortError') return;
        logger.error('Failed to load segmentation:', error);
        // Set to null instead of showing error for missing segmentation
        if (
          error &&
          typeof error === 'object' &&
          'response' in error &&
          (error as { response?: { status?: number } }).response?.status === 404
        ) {
          logger.debug('No segmentation found for image (404):', imageId);
          if (isMounted) {
            if (isMounted) {
              setSegmentationPolygons(null);
            }
          }
        } else {
          if (isMounted) {
            toast.error(t('toast.operationFailed'));
            if (isMounted) {
              setSegmentationPolygons(null);
            }
          }
        }
      }
    };

    loadSegmentation();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [
    projectId,
    imageId,
    t,
    selectedImage?.width,
    selectedImage?.height,
    selectedImage?.segmentationStatus,
  ]);

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
  }, [
    editor.polygons,
    hiddenPolygonIds,
    imageDimensions,
    canvasHeight,
    canvasWidth,
    editor.transform,
  ]);

  // Listen for segmentation completion and auto-reload polygons (debounced)
  const handleSegmentationStatusUpdate = useCallback(() => {
    // Only proceed if we have a WebSocket update for the current image
    if (!debouncedLastUpdate || debouncedLastUpdate.imageId !== imageId) {
      return;
    }

    // Auto-reload polygons when segmentation is completed
    if (
      !isReloading &&
      (debouncedLastUpdate.status === 'segmented' ||
        debouncedLastUpdate.status === 'completed')
    ) {
      logger.debug(
        '🎯 Segmentation completed via WebSocket, auto-reloading polygons:',
        {
          imageId: debouncedLastUpdate.imageId,
          status: debouncedLastUpdate.status,
          polygonCount: debouncedLastUpdate.polygonCount,
        }
      );

      // Add a small delay to ensure the API is ready
      setTimeout(() => {
        if (!isReloading) {
          reloadSegmentation();
        }
      }, 500);

      return;
    }

    // Also handle failed segmentation
    if (
      debouncedLastUpdate.status === 'failed' ||
      debouncedLastUpdate.status === 'no_segmentation'
    ) {
      logger.debug('❌ Segmentation failed/empty, clearing polygons:', {
        imageId: debouncedLastUpdate.imageId,
        status: debouncedLastUpdate.status,
      });
      setSegmentationPolygons(null);
    }
  }, [
    debouncedLastUpdate,
    imageId,
    isReloading,
    reloadSegmentation,
    setSegmentationPolygons,
  ]);

  useEffect(() => {
    handleSegmentationStatusUpdate();
  }, [handleSegmentationStatusUpdate]);

  // Cleanup timeout and abort controller when component unmounts or imageId changes
  useEffect(() => {
    return () => {
      cleanupReloadOperations();
    };
  }, [imageId, cleanupReloadOperations]);

  // Handle image load to get dimensions (only if not already set from segmentation data)
  const handleImageLoad = (width: number, height: number) => {
    setImageDimensions(current => {
      // Only update if dimensions are not already set from segmentation data
      if (!current) {
        logger.debug('📐 Setting image dimensions from image load:', {
          width,
          height,
        });
        return { width, height };
      }

      // Log if dimensions differ between image and segmentation data
      if (current.width !== width || current.height !== height) {
        logger.warn('⚠️ Image dimensions mismatch:', {
          fromSegmentation: current,
          fromImage: { width, height },
          imageId,
        });
        // Keep segmentation data dimensions (they're more reliable)
        return current;
      }

      return current;
    });
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

  // Context menu handlers for polygon right-click
  const handleDeletePolygonFromContextMenu = useCallback(
    (polygonId: string) => {
      editor.handleDeletePolygon(polygonId);
      setHiddenPolygonIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(polygonId);
        return newSet;
      });
    },
    [editor]
  );

  const handleSlicePolygonFromContextMenu = useCallback(
    (polygonId: string) => {
      // Select the polygon and switch to slice mode (skip to step 2)
      editor.setSelectedPolygonId(polygonId);
      editor.setEditMode(EditMode.Slice);
    },
    [editor]
  );

  const handleEditPolygonFromContextMenu = useCallback(
    (polygonId: string) => {
      // Select the polygon and switch to edit vertices mode
      editor.setSelectedPolygonId(polygonId);
      editor.setEditMode(EditMode.EditVertices);
    },
    [editor]
  );

  // Context menu handlers for vertex right-click
  const handleDeleteVertexFromContextMenu = useCallback(
    (polygonId: string, vertexIndex: number) => {
      editor.handleDeleteVertex(polygonId, vertexIndex);
    },
    [editor]
  );

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

  // Autosave on component unmount (when leaving the editor completely)
  useEffect(() => {
    return () => {
      // Cleanup function - called when component unmounts
      if (editor.hasUnsavedChanges && editor.handleSave) {
        logger.debug('🧹 Autosaving on editor unmount');
        // Note: This may not always complete due to component unmounting
        editor.handleSave().catch(error => {
          logger.error('Failed to autosave on unmount:', error);
        });
      }
    };
  }, []); // Empty dependency array means this runs only on unmount

  const currentImageIndex =
    projectImages?.findIndex(img => img.id === imageId) ?? -1;
  const isAnyEditModeActive = editor.editMode !== EditMode.View;

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        {t('common.loading')}
      </div>
    );
  }

  if (!selectedImage) {
    return (
      <div className="flex items-center justify-center h-screen">
        {t('common.no_preview')}
      </div>
    );
  }

  // Spočítáme počty viditelných a skrytých polygonů
  const visiblePolygonsCount = editor.polygons.length - hiddenPolygonIds.size;
  const hiddenPolygonsCount = hiddenPolygonIds.size;

  return (
    <SegmentationErrorBoundary>
      <EditorLayout>
        {/* Header */}
        <EditorHeader
          projectId={projectId || ''}
          projectTitle={project?.name || t('projects.noProjects')}
          imageName={selectedImage.name}
          currentImageIndex={currentImageIndex !== -1 ? currentImageIndex : 0}
          totalImages={projectImages?.length || 0}
          onNavigate={navigateToImage}
          hasUnsavedChanges={editor.hasUnsavedChanges}
          onSave={editor.handleSave}
          imageId={imageId}
          segmentationStatus={selectedImage?.segmentationStatus}
          lastUpdate={lastUpdate}
          queueStats={queueStats}
          isWebSocketConnected={isWebSocketConnected}
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
            <div className="flex-1 flex overflow-hidden">
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
                        alt={t('common.image')}
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
                        // BUT skip deselection when in AddPoints mode to allow point placement
                        if (
                          e.target === e.currentTarget &&
                          editor.editMode !== EditMode.AddPoints
                        ) {
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
                                key={`${polygon.id}-${editor.isUndoRedoInProgress ? 'undo' : 'normal'}`}
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
                                isUndoRedoInProgress={
                                  editor.isUndoRedoInProgress
                                }
                                onSelectPolygon={() =>
                                  handlePolygonSelection(polygon.id)
                                }
                                onDeletePolygon={
                                  handleDeletePolygonFromContextMenu
                                }
                                onSlicePolygon={
                                  handleSlicePolygonFromContextMenu
                                }
                                onEditPolygon={handleEditPolygonFromContextMenu}
                                onDeleteVertex={
                                  handleDeleteVertexFromContextMenu
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

          {/* Loading indicator overlay */}
          {isReloading && (
            <div className="absolute inset-0 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm z-20 flex items-center justify-center">
              <div className="flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-2 rounded-lg shadow-lg">
                <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('segmentationEditor.reloadingSegmentation')}
                </span>
              </div>
            </div>
          )}

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
    </SegmentationErrorBoundary>
  );
};

export default SegmentationEditor;
