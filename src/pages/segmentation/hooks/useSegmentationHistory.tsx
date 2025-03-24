
import { useState, useEffect } from 'react';
import { SegmentationResult } from '@/lib/segmentation';

/**
 * Hook pro správu historie segmentace (undo/redo)
 */
export const useSegmentationHistory = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const [history, setHistory] = useState<SegmentationResult[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  // Inicializace historie
  useEffect(() => {
    if (segmentation && historyIndex === -1) {
      setHistory([segmentation]);
      setHistoryIndex(0);
    }
  }, [segmentation]);
  
  // Přidání nové položky do historie
  useEffect(() => {
    if (!segmentation || historyIndex === -1) return;
    
    if (historyIndex < history.length - 1) {
      setHistory(prev => prev.slice(0, historyIndex + 1));
    }
    
    setHistory(prev => [...prev, {...segmentation}]);
    setHistoryIndex(prev => prev + 1);
  }, [segmentation, historyIndex]);
  
  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setSegmentation(history[historyIndex - 1]);
    }
  };
  
  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setSegmentation(history[historyIndex + 1]);
    }
  };
  
  return {
    history,
    historyIndex,
    handleUndo,
    handleRedo
  };
};
