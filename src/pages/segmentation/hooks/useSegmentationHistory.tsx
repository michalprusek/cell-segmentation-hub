
import { useState, useEffect, useCallback, useRef } from 'react';
import { SegmentationResult, Point } from '@/lib/segmentation';
import { toast } from "sonner";

/**
 * EditAction rozhraní pro atomické operace
 */
interface EditAction {
  description: string;
  timestamp: number;
  apply: () => void;
  undo: () => void;
}

/**
 * Vylepšený hook pro správu historie segmentace (undo/redo)
 */
export const useSegmentationHistory = (
  segmentation: SegmentationResult | null,
  setSegmentation: (seg: SegmentationResult | null) => void
) => {
  const [history, setHistory] = useState<SegmentationResult[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [ignoreNextUpdate, setIgnoreNextUpdate] = useState(false);
  const isDraggingVertex = useRef(false);
  const dragStartSegmentation = useRef<SegmentationResult | null>(null);
  
  // Optimalizace: Throttling pro historii
  const historyThrottleTimeout = useRef<number | null>(null);
  
  // Optimalizace: Hashování stavu pro porovnání změn
  const lastStateHash = useRef<string>('');
  
  /**
   * Vytvoří hash reprezentující stav polygonů pro porovnání změn
   */
  const createStateHash = useCallback((seg: SegmentationResult | null): string => {
    if (!seg) return '';
    // Jednoduchý hash založený na počtu polygonů a bodů
    return seg.polygons.map(p => 
      `${p.id}:${p.points.length}:${p.points.reduce((sum, pt) => sum + pt.x + pt.y, 0)}`
    ).join('|');
  }, []);
  
  // Initialize history with the first segmentation
  useEffect(() => {
    if (segmentation && historyIndex === -1) {
      setHistory([structuredClone(segmentation)]);
      setHistoryIndex(0);
      lastStateHash.current = createStateHash(segmentation);
    }
  }, [segmentation, historyIndex, createStateHash]);
  
  // Add new history item when segmentation changes, with optimalizací
  useEffect(() => {
    if (!segmentation || historyIndex === -1 || ignoreNextUpdate) {
      if (ignoreNextUpdate) {
        setIgnoreNextUpdate(false);
      }
      return;
    }
    
    // Pokud právě táhneme vertex, neukládáme mezistav do historie
    if (isDraggingVertex.current) {
      return;
    }
    
    // Výpočet hashe aktuálního stavu pro porovnání změn
    const currentHash = createStateHash(segmentation);
    
    // Porovnání s posledním hashem
    if (currentHash === lastStateHash.current) {
      return; // Žádná změna, přeskočíme aktualizaci
    }
    
    // Throttling - omezení frekvence aktualizací historie
    if (historyThrottleTimeout.current !== null) {
      window.clearTimeout(historyThrottleTimeout.current);
    }
    
    historyThrottleTimeout.current = window.setTimeout(() => {
      // Truncate future history if we're not at the end
      if (historyIndex < history.length - 1) {
        setHistory(prev => prev.slice(0, historyIndex + 1));
      }
      
      // Aktualizace hashe
      lastStateHash.current = currentHash;
      
      // Add new history item
      setHistory(prev => [...prev, structuredClone(segmentation)]);
      setHistoryIndex(prev => prev + 1);
      
      console.log("Added new history state", historyIndex + 1);
      
      historyThrottleTimeout.current = null;
    }, 300); // 300ms throttling
    
  }, [segmentation, historyIndex, history, ignoreNextUpdate, createStateHash]);
  
  // Upravená funkce pro trackování stavu tažení vertexu
  const setDraggingVertex = useCallback((isDragging: boolean) => {
    if (isDragging && !isDraggingVertex.current && segmentation) {
      // Store the initial state when dragging starts
      dragStartSegmentation.current = structuredClone(segmentation);
      isDraggingVertex.current = true;
    } else if (!isDragging && isDraggingVertex.current) {
      // Add history item when dragging ends, if the state changed
      isDraggingVertex.current = false;
      
      if (dragStartSegmentation.current && segmentation) {
        // Porovnání stavu pomocí hashe
        const startHash = createStateHash(dragStartSegmentation.current);
        const endHash = createStateHash(segmentation);
        
        if (startHash !== endHash) {
          // Truncate future history if we're not at the end
          if (historyIndex < history.length - 1) {
            setHistory(prev => prev.slice(0, historyIndex + 1));
          }
          
          // Add new history item
          setHistory(prev => [...prev, structuredClone(segmentation)]);
          setHistoryIndex(prev => prev + 1);
          lastStateHash.current = endHash;
          
          console.log("Added vertex drag history state", historyIndex + 1);
        }
      }
    }
  }, [segmentation, historyIndex, history, createStateHash]);
  
  /**
   * Vylepšená funkce Undo s lepší zpětnou vazbou
   */
  const handleUndo = useCallback(() => {
    // Pokud právě táhneme vertex, nemůžeme provést undo
    if (isDraggingVertex.current) {
      toast.error("Nelze provést Undo během tažení bodu");
      return;
    }
    
    if (historyIndex > 0) {
      setIgnoreNextUpdate(true);
      setHistoryIndex(prev => prev - 1);
      
      const prevState = structuredClone(history[historyIndex - 1]);
      setSegmentation(prevState);
      lastStateHash.current = createStateHash(prevState);
      
      toast.info("Undo: Vráceno do předchozího stavu");
      console.log("Undo to index", historyIndex - 1);
    } else {
      toast.info("Nejsou k dispozici žádné akce pro Undo");
    }
  }, [historyIndex, history, setSegmentation, createStateHash]);
  
  /**
   * Vylepšená funkce Redo s lepší zpětnou vazbou
   */
  const handleRedo = useCallback(() => {
    // Pokud právě táhneme vertex, nemůžeme provést redo
    if (isDraggingVertex.current) {
      toast.error("Nelze provést Redo během tažení bodu");
      return;
    }
    
    if (historyIndex < history.length - 1) {
      setIgnoreNextUpdate(true);
      setHistoryIndex(prev => prev + 1);
      
      const nextState = structuredClone(history[historyIndex + 1]);
      setSegmentation(nextState);
      lastStateHash.current = createStateHash(nextState);
      
      toast.info("Redo: Obnoveno do následujícího stavu");
      console.log("Redo to index", historyIndex + 1);
    } else {
      toast.info("Nejsou k dispozici žádné akce pro Redo");
    }
  }, [historyIndex, history, setSegmentation, createStateHash]);
  
  /**
   * Vytvoření snapshotu historie pro pozdější návrat
   */
  const createSnapshot = useCallback((name: string = "Snapshot"): number => {
    if (!segmentation) return -1;
    
    // Ujistíme se, že aktuální stav je uložen v historii
    const currentHash = createStateHash(segmentation);
    if (lastStateHash.current !== currentHash) {
      const clonedState = structuredClone(segmentation);
      
      // Truncate future history if we're not at the end
      if (historyIndex < history.length - 1) {
        setHistory(prev => prev.slice(0, historyIndex + 1));
      }
      
      // Add new history item
      setHistory(prev => [...prev, clonedState]);
      setHistoryIndex(history.length);
      lastStateHash.current = currentHash;
    }
    
    toast.success(`Vytvořen snapshot: ${name}`);
    return historyIndex;
  }, [segmentation, historyIndex, history, createStateHash]);
  
  /**
   * Návrat k dříve vytvořenému snapshotu
   */
  const restoreSnapshot = useCallback((index: number): boolean => {
    if (index < 0 || index >= history.length) {
      toast.error("Neplatný index snapshotu");
      return false;
    }
    
    setIgnoreNextUpdate(true);
    setHistoryIndex(index);
    
    const restoredState = structuredClone(history[index]);
    setSegmentation(restoredState);
    lastStateHash.current = createStateHash(restoredState);
    
    toast.success("Snapshot byl obnoven");
    return true;
  }, [history, setSegmentation, createStateHash]);
  
  /**
   * Vymazání historie
   */
  const clearHistory = useCallback(() => {
    if (!segmentation) return;
    
    // Zachováme pouze aktuální stav
    setHistory([structuredClone(segmentation)]);
    setHistoryIndex(0);
    lastStateHash.current = createStateHash(segmentation);
    
    toast.info("Historie byla vymazána");
  }, [segmentation, createStateHash]);

  return {
    history,
    historyIndex,
    handleUndo,
    handleRedo,
    setDraggingVertex,
    createSnapshot,
    restoreSnapshot,
    clearHistory
  };
};
