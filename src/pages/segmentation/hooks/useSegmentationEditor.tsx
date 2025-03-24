
import { useState, useCallback } from 'react';
import { useSegmentationCore } from './useSegmentationCore';
import { useSegmentationView } from './useSegmentationView';
import { usePolygonInteraction } from './usePolygonInteraction';
import { useSegmentationHistory } from './useSegmentationHistory';

/**
 * Hlavní hook pro segmentační editor, který kombinuje funkcionalitu ze všech dílčích hooků
 */
export const useSegmentationEditor = (
  projectId: string | undefined,
  imageId: string | undefined,
  userId: string | undefined
) => {
  // Základní data a funkce segmentačního editoru
  const core = useSegmentationCore(projectId, imageId, userId);
  
  // Funkce pro práci s zobrazením a navigací
  const view = useSegmentationView(core.canvasContainerRef, core.imageSrc);
  
  // Funkce pro interakci s polygony
  const polygonInteraction = usePolygonInteraction(
    core.segmentation,
    core.setSegmentation,
    view.zoom,
    view.offset,
    view.setOffset
  );
  
  // Funkce pro správu historie segmentace
  const historyManagement = useSegmentationHistory(
    core.segmentation,
    core.setSegmentation
  );
  
  // Kombinace všech stavů a funkcí z dílčích hooků
  return {
    ...core,
    ...view,
    ...polygonInteraction,
    ...historyManagement
  };
};
