
import { Point } from '@/lib/segmentation';

/**
 * Funkce pro získání velikosti bodu v závislosti na zoom úrovni
 */
export const getPointRadius = (zoom: number): number => {
  // Snažíme se mít konstantní velikost bodu bez ohledu na zoom
  if (zoom > 4) {
    return 7 / zoom;
  } else if (zoom > 3) {
    return 6 / zoom;
  } else if (zoom < 0.5) {
    return 3 / zoom;
  } else if (zoom < 0.7) {
    return 4 / zoom;
  } else {
    return 5 / zoom;
  }
};

/**
 * Funkce pro získání tloušťky čáry v závislosti na zoom úrovni
 */
export const getStrokeWidth = (zoom: number): number => {
  // Snažíme se mít konstantní tloušťku čáry bez ohledu na zoom
  if (zoom > 4) {
    return 2 / zoom;
  } else if (zoom > 3) {
    return 1.5 / zoom;
  } else if (zoom < 0.5) {
    return 0.5 / zoom;
  } else if (zoom < 0.7) {
    return 0.8 / zoom;
  } else {
    return 1 / zoom;
  }
};

/**
 * Funkce pro získání barev pro jednotlivé prvky vizualizace
 */
export const getColors = () => {
  return {
    line: {
      color: '#3498db',
      dashColor: '#2980b9'
    },
    tempPoint: {
      fill: '#3498db',
      stroke: '#2980b9'
    },
    startPoint: {
      fill: '#e67e22',
      stroke: '#d35400',
      glowColor: 'rgba(230, 126, 34, 0.3)'
    },
    endPoint: {
      fill: '#2ecc71',
      stroke: '#27ae60',
      glowColor: 'rgba(46, 204, 113, 0.3)'
    },
    hoverPoint: {
      fill: '#f39c12',
      stroke: '#f1c40f',
      glowColor: 'rgba(241, 196, 15, 0.3)'
    }
  };
};

/**
 * Funkce pro vytvoření SVG cesty z bodů
 */
export const createPathFromPoints = (points: Point[]): string => {
  if (points.length === 0) return '';
  
  let path = `M ${points[0].x} ${points[0].y}`;
  
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }
  
  return path;
};
