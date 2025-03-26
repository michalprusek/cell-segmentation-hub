
import React from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSegmentationEditor } from './hooks/useSegmentationEditor';
import EditorContainer from './components/editor/EditorContainer';

/**
 * Hlavní komponenta segmentačního editoru
 */
const SegmentationEditor = () => {
  const { projectId, imageId } = useParams<{ projectId: string, imageId: string }>();
  const { user } = useAuth();
  const { theme } = useTheme();
  
  // Získání všech funkcí a stavů z hlavního hooku
  const editorState = useSegmentationEditor(projectId, imageId, user?.id);
  
  return (
    <EditorContainer 
      projectId={projectId || ''}
      projectTitle={editorState.projectTitle}
      imageName={editorState.imageName}
      imageSrc={editorState.imageSrc}
      loading={editorState.loading}
      saving={editorState.saving}
      segmentation={editorState.segmentation}
      selectedPolygonId={editorState.selectedPolygonId}
      hoveredVertex={editorState.hoveredVertex}
      zoom={editorState.zoom}
      offset={editorState.offset}
      history={editorState.history}
      historyIndex={editorState.historyIndex}
      dragState={editorState.dragState}
      vertexDragState={editorState.vertexDragState}
      tempPoints={editorState.tempPoints}
      cursorPosition={editorState.cursorPosition}
      editMode={editorState.editMode}
      slicingMode={editorState.slicingMode}
      pointAddingMode={editorState.pointAddingMode}
      sliceStartPoint={editorState.sliceStartPoint}
      hoveredSegment={editorState.hoveredSegment}
      canvasContainerRef={editorState.canvasContainerRef}
      projectImages={editorState.projectImages}
      sourcePolygonId={editorState.sourcePolygonId}
      setSelectedPolygonId={editorState.setSelectedPolygonId}
      handleMouseDown={editorState.handleMouseDown}
      handleMouseMove={editorState.handleMouseMove}
      handleMouseUp={editorState.handleMouseUp}
      handleZoomIn={editorState.handleZoomIn}
      handleZoomOut={editorState.handleZoomOut}
      handleUndo={editorState.handleUndo}
      handleRedo={editorState.handleRedo}
      handleDeletePolygon={editorState.handleDeletePolygon}
      handleResetView={editorState.handleResetView}
      handleSave={editorState.handleSave}
      navigateToImage={editorState.navigateToImage}
      toggleEditMode={editorState.toggleEditMode}
      toggleSlicingMode={editorState.toggleSlicingMode}
      togglePointAddingMode={editorState.togglePointAddingMode}
      exitAllEditModes={editorState.exitAllEditModes}
      isShiftPressed={editorState.isShiftPressed}
      handleSlicePolygon={editorState.handleSlicePolygon}
      handleEditPolygon={editorState.handleEditPolygon}
      handleDeleteVertex={editorState.handleDeleteVertex}
      handleDuplicateVertex={editorState.handleDuplicateVertex}
    />
  );
};

export default SegmentationEditor;
