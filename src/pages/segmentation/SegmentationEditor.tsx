
import React from 'react';
import { useParams } from 'react-router-dom';
import { motion } from "framer-motion";
import { useAuth } from '@/contexts/AuthContext';

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
  
  const {
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
  } = useSegmentationEditor(projectId, imageId, user?.id);

  return (
    <motion.div 
      className="min-h-screen bg-slate-900 text-white flex flex-col"
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
      <div className="flex-1 flex flex-col relative">
        {/* Left Toolbar */}
        <EditorToolbar 
          zoom={zoom}
          historyIndex={historyIndex}
          historyLength={history.length}
          selectedPolygonId={selectedPolygonId}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onDeletePolygon={handleDeletePolygon}
          onResetView={handleResetView}
        />
        
        {/* Right sidebar */}
        <RegionPanel 
          loading={loading}
          segmentation={segmentation}
          selectedPolygonId={selectedPolygonId}
          onSelectPolygon={setSelectedPolygonId}
        />
        
        {/* Canvas container */}
        <EditorCanvas 
          loading={loading}
          segmentation={segmentation}
          zoom={zoom}
          offset={offset}
          selectedPolygonId={selectedPolygonId}
          imageSrc={imageSrc}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          dragState={dragState}
          vertexDragState={vertexDragState}
        />
        
        {/* Status */}
        <StatusBar segmentation={segmentation} />
      </div>
    </motion.div>
  );
};

export default SegmentationEditor;
