
import React from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { SegmentationProvider } from '../../contexts/SegmentationContext';
import EditorLayout from '../layout/EditorLayout';
import EditorHeader from '../EditorHeader';
import EditorContent from '../layout/EditorContent';
import EditorToolbar from '../EditorToolbar';
import EditorCanvas from '../EditorCanvas';
import RegionPanel from '../RegionPanel';
import StatusBar from '../StatusBar';
import KeyboardShortcutsHelp from '../KeyboardShortcutsHelp';
import KeyboardEventHandler from '../keyboard/KeyboardEventHandler';

interface EditorContainerProps {
  projectId: string;
  projectTitle: string;
  imageName: string;
  imageSrc: string;
  loading: boolean;
  saving: boolean;
  segmentation: any; // Použijeme typ SegmentationResult
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  zoom: number;
  offset: { x: number; y: number };
  history: any[]; // Použijeme typ SegmentationResult[]
  historyIndex: number;
  dragState: React.MutableRefObject<any>;
  vertexDragState: React.MutableRefObject<any>;
  tempPoints: any;
  cursorPosition: { x: number, y: number } | null;
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  sliceStartPoint: { x: number, y: number } | null;
  hoveredSegment: any;
  canvasContainerRef: React.RefObject<HTMLDivElement>;
  projectImages: any[];
  sourcePolygonId: string | null;
  setSelectedPolygonId: (id: string | null) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseUp: (e: React.MouseEvent) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleDeletePolygon: () => void;
  handleResetView: () => void;
  handleSave: () => Promise<void>;
  navigateToImage: (direction: 'prev' | 'next') => void;
  toggleEditMode: () => void;
  toggleSlicingMode: () => void;
  togglePointAddingMode: () => void;
  exitAllEditModes: () => void;
  isShiftPressed: boolean;
  handleSlicePolygon: (id: string) => void;
  handleEditPolygon: (id: string) => void;
  handleDeleteVertex: (polygonId: string, vertexIndex: number) => void;
  handleDuplicateVertex: (polygonId: string, vertexIndex: number) => void;
}

/**
 * Hlavní kontejner pro editor segmentace
 */
const EditorContainer = ({
  projectId,
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
}: EditorContainerProps) => {
  const { t } = useLanguage();
  
  const currentImageIndex = projectImages.findIndex(img => img.id === imageName);
  const totalImages = projectImages.length;
  
  const canUndo = historyIndex > 0;
  const canRedo = history.length > 0 && historyIndex < history.length - 1;
  
  const isAnyEditModeActive = editMode || slicingMode || pointAddingMode;

  return (
    <SegmentationProvider segmentation={segmentation}>
      <KeyboardEventHandler
        onUndo={handleUndo}
        onRedo={handleRedo}
        toggleEditMode={toggleEditMode}
        toggleSlicingMode={toggleSlicingMode}
        togglePointAddingMode={togglePointAddingMode}
        exitAllEditModes={exitAllEditModes}
      >
        <EditorLayout>
          <EditorHeader 
            projectId={projectId}
            projectTitle={projectTitle}
            imageName={imageName}
            saving={saving}
            loading={loading}
            currentImageIndex={currentImageIndex !== -1 ? currentImageIndex : 0}
            totalImages={totalImages}
            onNavigate={navigateToImage}
            onSave={handleSave}
          />
          
          <EditorContent>
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
          </EditorContent>
        </EditorLayout>
      </KeyboardEventHandler>
    </SegmentationProvider>
  );
};

export default EditorContainer;
