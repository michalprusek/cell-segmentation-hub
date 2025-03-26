
import { SegmentationResult } from '@/lib/segmentation';
import { useSegmentFinder } from './useSegmentFinder';
import { usePolygonSimplifier } from './usePolygonSimplifier';
import { usePointOperations } from './usePointOperations';

/**
 * Hook pro práci s body polygonu - přidávání, mazání a přesouvání bodů
 * Refactored to use smaller, more focused modules
 */
export const usePointEditor = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  // Finder pro segmenty a body
  const segmentFinder = useSegmentFinder();
  
  // Operace zjednodušení polygonu
  const polygonSimplifier = usePolygonSimplifier(segmentation, setSegmentation);
  
  // Základní operace s body
  const pointOperations = usePointOperations(segmentation, setSegmentation);

  return {
    // Exportujeme operace se segmenty
    ...segmentFinder,
    
    // Exportujeme operace s body
    ...pointOperations,
    
    // Exportujeme operace zjednodušení
    simplifyPolygon: polygonSimplifier.simplifyPolygon
  };
};
