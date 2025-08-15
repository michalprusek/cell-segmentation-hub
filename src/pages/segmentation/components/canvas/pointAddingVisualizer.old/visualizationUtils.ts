
import { Point } from '@/lib/segmentation';

/**
 * Utility pro získání vhodné velikosti bodů podle zoomu
 */
export const getPointRadius = (zoom: number): number => {
  if (zoom > 4) return 6/zoom;  
  if (zoom > 3) return 5/zoom;
  if (zoom < 0.5) return 3/zoom;
  if (zoom < 0.7) return 3.5/zoom;
  return 4/zoom;
};

/**
 * Utility pro získání vhodné tloušťky čáry podle zoomu
 */
export const getStrokeWidth = (zoom: number): number => {
  if (zoom > 4) return 2.5/zoom;
  if (zoom > 3) return 2/zoom;
  if (zoom < 0.5) return 1/zoom;
  if (zoom < 0.7) return 1.2/zoom;
  return 1.5/zoom;
};

/**
 * Barvy pro různé součásti vizualizace
 */
export const getColors = () => {
  return {
    // Počáteční bod
    startPoint: {
      fill: '#FFA500',      // Oranžová
      stroke: '#FFFFFF',
      innerFill: '#FF8C00', // Tmavší oranžová
      glowColor: 'rgba(255, 165, 0, 0.3)'
    },
    // Potenciální koncový bod
    potentialEndpoint: {
      fill: '#3498db80',    // Modrá s průhledností
      stroke: '#3498db'     // Modrá
    },
    // Bod pod kurzorem
    hoverPoint: {
      fill: '#3498db',      // Sytá modrá
      stroke: '#FFFFFF',    // Bílý okraj
      glowColor: 'rgba(52, 152, 219, 0.3)'
    },
    // Dočasný bod
    tempPoint: {
      fill: '#3498db',      // Modrá
      stroke: '#FFFFFF'     // Bílý okraj
    },
    // Linka mezi body
    line: {
      color: '#3498db',     // Modrá
      hoveredColor: '#4CAF50' // Zelená pro najeté
    }
  };
};

/**
 * Vytvoří SVG path pro spojnici bodů
 */
export const createPathFromPoints = (points: Point[]): string => {
  if (points.length === 0) return '';
  
  return `M ${points[0].x} ${points[0].y} ` + 
    points.slice(1).map(point => `L ${point.x} ${point.y}`).join(' ');
};
