
import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from "framer-motion";
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';

// Custom hooks
import { useSegmentationEditor } from './hooks/useSegmentationEditor';

// Components
import EditorHeader from './components/EditorHeader';
import EditorToolbar from './components/EditorToolbar';
import EditorCanvas from './components/EditorCanvas';
import RegionPanel from './components/RegionPanel';
import StatusBar from './components/StatusBar';
import KeyboardShortcutsHelp from './components/KeyboardShortcutsHelp';
import { SegmentationProvider } from './contexts/SegmentationContext';

const SegmentationEditor = () => {
  const { projectId, imageId } = useParams<{ projectId: string, imageId: string }>();
  const { user } = useAuth();
  const { theme } = useTheme();
  
  const {
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
    tempPoints,
    cursorPosition,
    editMode,
    slicingMode,
    pointAddingMode,
    sliceStartPoint,
    hoveredSegment,
    canvasContainerRef,
    projectImages,
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
    toggleEditMode,
    toggleSlicingMode,
    togglePointAddingMode,
    exitAllEditModes,
    isShiftPressed,
    handleSlicePolygon,
    handleEditPolygon,
    handleDuplicatePolygon,
    handleDeleteVertex,
    handleDuplicateVertex
  } = useSegmentationEditor(projectId, imageId, user?.id);

  // Add keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Exit any edit mode with Escape key
      if (e.key === 'Escape') {
        exitAllEditModes();
        return;
      }
      
      // Edit mode toggle with 'e' key
      if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleEditMode();
      }
      
      // Slicing mode toggle with 's' key
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleSlicingMode();
      }
      
      // Point adding mode toggle with 'a' key
      if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        togglePointAddingMode();
      }
      
      // Undo with Ctrl+Z
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
      }
      
      // Redo with Ctrl+Y or Ctrl+Shift+Z
      if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
          (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleEditMode, toggleSlicingMode, togglePointAddingMode, handleUndo, handleRedo, exitAllEditModes]);

  // Calculate if we can undo/redo
  const canUndo = historyIndex > 0;
  const canRedo = history.length > 0 && historyIndex < history.length - 1;
  
  // Get current image index
  const currentImageIndex = projectImages.findIndex(img => img.id === imageId);
  const totalImages = projectImages.length;
  
  // Determine which edit mode is active
  const isAnyEditModeActive = editMode || slicingMode || pointAddingMode;

  return (
    <SegmentationProvider segmentation={segmentation}>
      <motion.div 
        className={`h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <EditorHeader 
          projectId={projectId || ''}
          projectTitle={projectTitle}
          imageName={imageName}
          saving={saving}
          loading={loading}
          currentImageIndex={currentImageIndex !== -1 ? currentImageIndex : 0}
          totalImages={totalImages}
          onNavigate={navigateToImage}
          onSave={handleSave}
        />
        
        {/* Main content */}
        <div className="flex-1 flex flex-col relative overflow-hidden items-center justify-center p-4">
          {/* Left Toolbar */}
          <EditorToolbar 
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetView={handleResetView}
            onSave={handleSave}
            editMode={editMode}
            slicingMode={slicingMode}
            pointAddingMode={pointAddingMode}
            onToggleEditMode={toggleEditMode}
            onToggleSlicingMode={toggleSlicingMode}
            onTogglePointAddingMode={togglePointAddingMode}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={canUndo}
            canRedo={canRedo}
          />
          
          {/* Right sidebar */}
          <RegionPanel 
            loading={loading}
            segmentation={segmentation}
            selectedPolygonId={selectedPolygonId}
            onSelectPolygon={setSelectedPolygonId}
          />
          
          {/* Canvas container */}
          <div className="w-full h-full flex items-center justify-center">
            <EditorCanvas 
              loading={loading}
              segmentation={segmentation}
              zoom={zoom}
              offset={offset}
              selectedPolygonId={selectedPolygonId}
              hoveredVertex={hoveredVertex}
              imageSrc={imageSrc}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              dragState={dragState}
              vertexDragState={vertexDragState}
              containerRef={canvasContainerRef}
              editMode={editMode}
              slicingMode={slicingMode}
              pointAddingMode={pointAddingMode}
              tempPoints={tempPoints}
              cursorPosition={cursorPosition}
              sliceStartPoint={sliceStartPoint}
              hoveredSegment={hoveredSegment}
              isShiftPressed={isShiftPressed}
              onSelectPolygon={setSelectedPolygonId}
              onDeletePolygon={handleDeletePolygon}
              onSlicePolygon={handleSlicePolygon}
              onEditPolygon={handleEditPolygon}
              onDuplicatePolygon={handleDuplicatePolygon}
              onDeleteVertex={handleDeleteVertex}
              onDuplicateVertex={handleDuplicateVertex}
            />
          </div>
          
          {/* Status */}
          <StatusBar 
            segmentation={segmentation} 
            editMode={isAnyEditModeActive ? 
              (editMode ? "edit" : slicingMode ? "slice" : "add-point") : undefined}
          />

          {/* Keyboard shortcuts help */}
          <KeyboardShortcutsHelp />
        </div>
      </motion.div>
    </SegmentationProvider>
  );
};

export default SegmentationEditor;
