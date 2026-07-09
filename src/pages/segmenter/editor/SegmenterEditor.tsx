import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  Maximize,
  Redo2,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSegmenterClasses } from '../hooks/useSegmenterClasses';
import { useSegmenterAnnotation } from './hooks/useSegmenterAnnotation';
import { useContainerSize } from './hooks/useContainerSize';
import { useEditorState } from './hooks/useEditorState';
import { EditMode } from './types';
import SegmenterCanvas from './components/canvas/SegmenterCanvas';
import ActiveClassPicker from './components/ActiveClassPicker';
import SegmenterPolygonListPanel from './components/SegmenterPolygonListPanel';

/**
 * `/segmenter/:datasetId/image/:imageId` — the polygon-only annotation
 * editor. Orchestrates: class registry (`useSegmenterClasses`), annotation
 * load/save I/O (`useSegmenterAnnotation`), the canvas viewport size
 * (`useContainerSize`) and the polygon/mode/history state machine
 * (`useEditorState`). Byte-serving for the image itself uses
 * `GET /api/segmenter/images/:imageId/file` (root-relative, same-origin —
 * consistent with `segmenterImageUrl`/`segmenterThumbnailUrl` in
 * `@/lib/segmenterApi`, which target sibling `/display` and `/thumbnail`
 * routes on the same controller).
 */
function segmenterImageFileUrl(imageId: string): string {
  return `/api/segmenter/images/${imageId}/file`;
}

const SegmenterEditor: React.FC = () => {
  const { datasetId, imageId } = useParams<{
    datasetId: string;
    imageId: string;
  }>();
  const navigate = useNavigate();

  const {
    classes,
    loading: classesLoading,
    createClass,
    renameClass,
    deleteClass,
  } = useSegmenterClasses(datasetId);

  const {
    initialPolygons,
    initialImageWidth,
    initialImageHeight,
    loading: annotationLoading,
    saving,
    save,
  } = useSegmenterAnnotation(imageId);

  const [activeClassId, setActiveClassId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeClassId && classes.length > 0) {
      setActiveClassId(classes[0].id);
    }
  }, [classes, activeClassId]);

  // Natural pixel size of the served image is the source of truth; the
  // saved annotation's dimensions are only a placeholder until the <img>
  // itself reports `naturalWidth`/`naturalHeight` (or for a brand-new image
  // with no saved annotation yet, until it loads at all).
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);
  const imageWidth = naturalWidth || initialImageWidth;
  const imageHeight = naturalHeight || initialImageHeight;

  const {
    ref: containerRef,
    width: containerWidth,
    height: containerHeight,
  } = useContainerSize();

  const editor = useEditorState({
    imageId,
    initialPolygons,
    imageWidth,
    imageHeight,
    containerWidth,
    containerHeight,
    activeClassId,
  });

  const handleImageLoad = useCallback((w: number, h: number) => {
    setNaturalWidth(w);
    setNaturalHeight(h);
  }, []);

  const handleSave = useCallback(async () => {
    if (!imageWidth || !imageHeight) return;
    const ok = await save(editor.polygons, imageWidth, imageHeight);
    if (ok) {
      editor.markSaved();
      toast.success('Annotation saved');
    }
  }, [save, editor, imageWidth, imageHeight]);

  // Keyboard shortcuts: Escape cancels the in-progress draw, Enter closes
  // it, Delete/Backspace removes the selected polygon, Ctrl/Cmd+Z(+Shift)
  // undo/redo, Ctrl/Cmd+S saves. Ignored while typing in a form field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      if (e.key === 'Escape') {
        editor.cancelDraw();
      } else if (e.key === 'Enter') {
        editor.finishPolygon();
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        editor.selectedPolygonId
      ) {
        editor.deleteSelectedPolygon();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        editor.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, handleSave]);

  // Warn before an accidental tab close/navigate-away with unsaved edits.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (editor.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editor.hasUnsavedChanges]);

  const isLoading = classesLoading || annotationLoading;

  if (!datasetId || !imageId) {
    return (
      <div className="p-6 text-sm text-red-600">
        Missing dataset or image id in the route.
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full flex-col bg-gray-50 dark:bg-gray-950">
      <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/segmenter/${datasetId}`)}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <Button
            variant={editor.editMode === EditMode.View ? 'default' : 'outline'}
            size="sm"
            onClick={() => editor.setEditMode(EditMode.View)}
          >
            Select
          </Button>
          <Button
            variant={
              editor.editMode === EditMode.CreatePolygon ? 'default' : 'outline'
            }
            size="sm"
            onClick={() => editor.setEditMode(EditMode.CreatePolygon)}
          >
            Draw polygon
          </Button>
          <Button
            variant={
              editor.editMode === EditMode.EditVertices ? 'default' : 'outline'
            }
            size="sm"
            disabled={!editor.selectedPolygonId}
            onClick={() => editor.setEditMode(EditMode.EditVertices)}
          >
            Edit vertices
          </Button>
          <Button
            variant={
              editor.editMode === EditMode.DeletePolygon ? 'default' : 'outline'
            }
            size="sm"
            onClick={() => editor.setEditMode(EditMode.DeletePolygon)}
          >
            Delete polygon
          </Button>
        </div>

        <div className="flex items-center gap-1 ml-2">
          <Button
            variant="outline"
            size="icon"
            onClick={editor.undo}
            disabled={!editor.canUndo}
            aria-label="Undo"
            title="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={editor.redo}
            disabled={!editor.canRedo}
            aria-label="Redo"
            title="Redo"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={editor.zoomOut}
            aria-label="Zoom out"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={editor.zoomIn}
            aria-label="Zoom in"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={editor.resetView}
            aria-label="Reset view"
            title="Reset view"
          >
            <Maximize className="h-4 w-4" />
          </Button>
        </div>

        <Button
          size="sm"
          className="ml-2"
          onClick={() => void handleSave()}
          disabled={saving || !imageWidth || !imageHeight}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-1" />
          )}
          {editor.hasUnsavedChanges ? 'Save*' : 'Save'}
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-gray-100 dark:bg-gray-900"
        >
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <SegmenterCanvas
              canvasRef={editor.canvasRef}
              imageUrl={segmenterImageFileUrl(imageId)}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              onImageLoad={handleImageLoad}
              transform={editor.transform}
              editMode={editor.editMode}
              polygons={editor.polygons}
              classes={classes}
              selectedPolygonId={editor.selectedPolygonId}
              vertexDragState={editor.vertexDragState}
              tempPoints={editor.tempPoints}
              cursorImagePoint={editor.cursorImagePoint}
              onMouseDown={editor.handleContainerMouseDown}
              onMouseMove={editor.handleContainerMouseMove}
              onMouseUp={editor.handleContainerMouseUp}
              onWheel={editor.handleWheel}
              onPolygonClick={editor.handlePolygonClick}
              onVertexMouseDown={editor.handleVertexMouseDown}
              onVertexContextMenu={editor.handleVertexContextMenu}
            />
          )}
        </div>

        <aside className="w-80 flex-shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto p-3 space-y-3">
          <ActiveClassPicker
            classes={classes}
            loading={classesLoading}
            activeClassId={activeClassId}
            onSelectActive={setActiveClassId}
            onCreateClass={createClass}
            onRenameClass={renameClass}
            onDeleteClass={deleteClass}
          />
          <SegmenterPolygonListPanel
            polygons={editor.polygons}
            classes={classes}
            selectedPolygonId={editor.selectedPolygonId}
            onSelect={editor.selectPolygon}
            onDelete={editor.deletePolygon}
            onChangeClass={editor.setPolygonClass}
          />
        </aside>
      </div>
    </div>
  );
};

export default SegmenterEditor;
