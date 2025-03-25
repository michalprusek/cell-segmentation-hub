
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
    editMode,
    canvasContainerRef,
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
  } = useSegmentationEditor(projectId, imageId, user?.id);

  // Add keyboard shortcuts for edit mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Edit mode toggle with 'e' key
      if (e.key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        toggleEditMode();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleEditMode]);

  return (
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
          onToggleEditMode={toggleEditMode}
        />
        
        {/* Right sidebar */}
        <RegionPanel 
          loading={loading}
          segmentation={segmentation}
          selectedPolygonId={selectedPolygonId}
          onSelectPolygon={setSelectedPolygonId}
        />
        
        {/* Canvas container - čtvercový */}
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
            tempPoints={tempPoints}
          />
        </div>
        
        {/* Status */}
        <StatusBar segmentation={segmentation} />
      </div>
    </motion.div>
  );
};

export default SegmentationEditor;
