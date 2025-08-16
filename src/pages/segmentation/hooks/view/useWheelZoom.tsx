
import { useCallback, useEffect, useRef } from 'react';
import { rafThrottle, ProgressiveRenderer } from '@/lib/performanceUtils';

interface ProgressiveRenderingCallbacks {
  onZoomStart?: () => void;
  onZoomEnd?: () => void;
}

/**
 * Hook pro obsluhu zoom pomocí kolečka myši s requestAnimationFrame optimalizací
 */
export const useWheelZoom = (
  zoom: number,
  offset: { x: number; y: number },
  canvasContainerRef: React.RefObject<HTMLDivElement>,
  setZoom: (zoom: number) => void,
  setOffset: (offset: { x: number; y: number }) => void,
  constrainOffset: (newOffset: { x: number; y: number }, newZoom: number) => { x: number; y: number },
  MIN_ZOOM: number,
  MAX_ZOOM: number,
  progressiveCallbacks?: ProgressiveRenderingCallbacks
) => {
  // Progressive renderer for smooth zoom experience
  const progressiveRenderer = useRef<ProgressiveRenderer | null>(null);
  
  // Initialize ProgressiveRenderer in useEffect to avoid side-effects during render
  useEffect(() => {
    if (!progressiveRenderer.current) {
      progressiveRenderer.current = new ProgressiveRenderer(
        progressiveCallbacks?.onZoomStart,
        progressiveCallbacks?.onZoomEnd,
        150 // 150ms debounce for zoom end
      );
    }
  }, [progressiveCallbacks?.onZoomStart, progressiveCallbacks?.onZoomEnd]);

  const performZoom = useCallback((
    mouseX: number,
    mouseY: number,
    zoomFactor: number
  ) => {
    const container = canvasContainerRef.current;
    if (!container) return;
    
    // Pozice myši v souřadnicích obrázku
    const mouseXInImage = mouseX / zoom - offset.x;
    const mouseYInImage = mouseY / zoom - offset.y;
    
    // Výpočet nového zoomu
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor));
    
    // Zaokrouhlíme na 2 desetinná místa pro stabilnější hodnoty
    const roundedZoom = Math.round(newZoom * 100) / 100;
    
    // Pokud se zoom skutečně změnil
    if (roundedZoom !== zoom) {
      // Start progressive rendering
      progressiveRenderer.current?.startAnimation();
      
      // Výpočet nového offsetu, aby bod pod kurzorem zůstal na stejném místě
      const newOffsetX = -mouseXInImage + (mouseX / roundedZoom);
      const newOffsetY = -mouseYInImage + (mouseY / roundedZoom);
      
      // Aplikace omezení na offset
      const constrainedOffset = constrainOffset({ x: newOffsetX, y: newOffsetY }, roundedZoom);
      
      setZoom(roundedZoom);
      setOffset(constrainedOffset);
    }
  }, [zoom, offset, canvasContainerRef, constrainOffset, setZoom, setOffset, MIN_ZOOM, MAX_ZOOM]);

  // RAF-throttled zoom handler for smooth 60fps updates - memoize to prevent throttle recreation
  const throttledZoom = useRef<{ fn: typeof performZoom; cancel: () => void } | null>(null);
  
  // Update throttled function when performZoom changes
  useEffect(() => {
    // Cancel previous throttled function if it exists
    if (throttledZoom.current) {
      throttledZoom.current.cancel();
    }
    
    // Create new throttled function
    throttledZoom.current = rafThrottle(performZoom, 16); // ~60fps
    
    // Cleanup function to cancel on unmount or dependency change
    return () => {
      if (throttledZoom.current) {
        throttledZoom.current.cancel();
      }
    };
  }, [performZoom]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    if (!canvasContainerRef.current) return;
    
    const container = canvasContainerRef.current;
    const rect = container.getBoundingClientRect();
    
    // Pozice myši v rámci containeru
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Jemnější zoom kroky pro plynulejší změny
    const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
    
    // Use throttled zoom function
    throttledZoom.current?.fn(mouseX, mouseY, zoomFactor);
  }, [canvasContainerRef]);
  
  useEffect(() => {
    const currentContainer = canvasContainerRef.current;
    if (!currentContainer) return;
    
    currentContainer.addEventListener('wheel', handleWheel, { passive: false });
    
    return () => {
      currentContainer.removeEventListener('wheel', handleWheel);
    };
  }, [handleWheel, canvasContainerRef]);

  return { 
    handleWheel,
    isZooming: progressiveRenderer.current?.isInProgress ?? false
  };
};
