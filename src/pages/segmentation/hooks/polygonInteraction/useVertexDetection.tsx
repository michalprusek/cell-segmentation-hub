
import { useCallback } from 'react';
import { Point } from '@/lib/segmentation';

/**
 * Hook pro detekci bodů polygonu
 */
export const useVertexDetection = (zoom: number) => {
  /**
   * Detekuje, zda je bod kurzoru v blízkosti bodu polygonu
   * Použití většího poloměru pro detekci při nízkém zoomu
   */
  const isNearVertex = useCallback((
    canvasX: number, 
    canvasY: number, 
    point: Point, 
    detectionRadius: number = 15
  ): boolean => {
    // Výpočet vzdálenosti mezi bodem kurzoru a bodem polygonu v prostoru plátna
    const dx = point.x - canvasX;
    const dy = point.y - canvasY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Přizpůsobení poloměru detekce podle zoomu
    // Čím menší zoom, tím větší detekční poloměr potřebujeme
    const adjustedRadius = Math.max(5, detectionRadius / (zoom || 1));
    
    return distance <= adjustedRadius;
  }, [zoom]);

  return { isNearVertex };
};
