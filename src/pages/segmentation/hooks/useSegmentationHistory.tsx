
import { useState, useEffect, useCallback } from 'react';
import { SegmentationResult } from '@/lib/segmentation';
import { toast } from "sonner";

/**
 * Hook pro správu historie segmentace (undo/redo)
 */
export const useSegmentationHistory = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const [history, setHistory] = useState<SegmentationResult[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [ignoreNextUpdate, setIgnoreNextUpdate] = useState(false);
  
  // Initialize history with the first segmentation
  useEffect(() => {
    if (segmentation && historyIndex === -1) {
      setHistory([structuredClone(segmentation)]);
      setHistoryIndex(0);
    }
  }, [segmentation, historyIndex]);
  
  // Add new history item when segmentation changes
  useEffect(() => {
    if (!segmentation || historyIndex === -1 || ignoreNextUpdate) {
      if (ignoreNextUpdate) {
        setIgnoreNextUpdate(false);
      }
      return;
    }
    
    // Compare with current history item to see if there's a real change
    const currentHistoryItem = history[historyIndex];
    
    // Simple deep comparison of polygons
    const hasChanged = JSON.stringify(currentHistoryItem?.polygons) !== 
                       JSON.stringify(segmentation.polygons);
    
    if (hasChanged) {
      // Truncate future history if we're not at the end
      if (historyIndex < history.length - 1) {
        setHistory(prev => prev.slice(0, historyIndex + 1));
      }
      
      // Add new history item
      setHistory(prev => [...prev, structuredClone(segmentation)]);
      setHistoryIndex(prev => prev + 1);
      
      console.log("Added new history state", historyIndex + 1);
    }
  }, [segmentation, historyIndex, history, ignoreNextUpdate]);
  
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      setIgnoreNextUpdate(true);
      setHistoryIndex(prev => prev - 1);
      setSegmentation(structuredClone(history[historyIndex - 1]));
      toast.info("Undo: Reverted to previous state");
      console.log("Undo to index", historyIndex - 1);
    } else {
      toast.info("Nothing to undo");
    }
  }, [historyIndex, history, setSegmentation]);
  
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setIgnoreNextUpdate(true);
      setHistoryIndex(prev => prev + 1);
      setSegmentation(structuredClone(history[historyIndex + 1]));
      toast.info("Redo: Restored next state");
      console.log("Redo to index", historyIndex + 1);
    } else {
      toast.info("Nothing to redo");
    }
  }, [historyIndex, history, setSegmentation]);
  
  return {
    history,
    historyIndex,
    handleUndo,
    handleRedo
  };
};
