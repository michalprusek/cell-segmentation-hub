
import React from 'react';
import { Point } from '@/lib/segmentation';
import CanvasZoomInfo from './CanvasZoomInfo';
import EditorHelpTips from '../EditorHelpTips';
import EditorModeFooter from './EditorModeFooter';

interface CanvasUIElementsProps {
  zoom: number;
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  isShiftPressed?: boolean;
  sliceStartPoint: Point | null;
}

/**
 * UI prvky na plátně - informace o zoomu, tipy, nápovědní panely
 */
const CanvasUIElements = ({
  zoom,
  editMode,
  slicingMode,
  pointAddingMode,
  isShiftPressed,
  sliceStartPoint
}: CanvasUIElementsProps) => {
  return (
    <>
      <CanvasZoomInfo zoom={zoom} />
      
      {editMode && (
        <EditorModeFooter 
          mode="edit"
          text={`Edit Mode - Vytváření nového polygonu ${isShiftPressed ? "(Auto-přidávání při držení Shift)" : ""}`}
        />
      )}
      
      {slicingMode && (
        <EditorModeFooter 
          mode="slice"
          text={`Slicing Mode - Rozdělení polygonu ${sliceStartPoint ? "(Klikněte pro dokončení)" : "(Klikněte pro začátek)"}`}
        />
      )}
      
      {pointAddingMode && (
        <EditorModeFooter 
          mode="add"
          text="Point Adding Mode - Přidávání bodů do polygonu"
        />
      )}

      {(editMode || slicingMode || pointAddingMode) && (
        <EditorHelpTips 
          editMode={editMode} 
          slicingMode={slicingMode} 
          pointAddingMode={pointAddingMode} 
        />
      )}
    </>
  );
};

export default CanvasUIElements;
