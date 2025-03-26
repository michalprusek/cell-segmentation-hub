
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
    sourcePolygonId,
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
    handleDeleteVertex,
    handleDuplicateVertex
  } = useSegmentationEditor(projectId, imageId, user?.id);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        exitAllEditModes();
        return;
      }
      
      if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleEditMode();
      }
      
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleSlicingMode();
      }
      
      if (e.key === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        togglePointAddingMode();
      }
      
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleUndo();
      }
      
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

  const canUndo = historyIndex > 0;
  const canRedo = history.length > 0 && historyIndex < history.length - 1;
  
  const currentImageIndex = projectImages.findIndex(img => img.id === imageId);
  const totalImages = projectImages.length;
  
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
        
        <div className="flex-1 flex flex-col relative overflow-hidden items-center justify-center p-4">
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
          
          <RegionPanel 
            loading={loading}
            segmentation={segmentation}
            selectedPolygonId={selectedPolygonId}
            onSelectPolygon={setSelectedPolygonId}
          />
          
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
              onDeleteVertex={handleDeleteVertex}
              onDuplicateVertex={handleDuplicateVertex}
              sourcePolygonId={sourcePolygonId}
            />
          </div>
          
          <StatusBar 
            segmentation={segmentation} 
            editMode={isAnyEditModeActive ? 
              (editMode ? "edit" : slicingMode ? "slice" : "add-point") : undefined}
          />

          <KeyboardShortcutsHelp />
        </div>
      </motion.div>
    </SegmentationProvider>
  );
};

export default SegmentationEditor;
