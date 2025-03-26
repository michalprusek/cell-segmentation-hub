
import { Point } from '@/lib/segmentation';

/**
 * Spatial Grid pro optimalizaci vyhledávání bodů v polygonu
 */
export class SpatialGrid {
  private grid: Map<string, number[]> = new Map();
  private cellSize: number;
  private points: Point[];

  constructor(points: Point[], cellSize = 50) {
    this.points = points;
    this.cellSize = cellSize;
    this.buildIndex();
  }

  private buildIndex(): void {
    this.points.forEach((p, i) => {
      const key = this.getCellKey(p);
      if (!this.grid.has(key)) {
        this.grid.set(key, []);
      }
      this.grid.get(key)?.push(i);
    });
  }

  private getCellKey(point: Point): string {
    const cellX = Math.floor(point.x / this.cellSize);
    const cellY = Math.floor(point.y / this.cellSize);
    return `${cellX},${cellY}`;
  }

  findPointsInRadius(center: Point, radius: number): number[] {
    const result: number[] = [];
    const cellRadius = Math.ceil(radius / this.cellSize);
    
    const centerCellX = Math.floor(center.x / this.cellSize);
    const centerCellY = Math.floor(center.y / this.cellSize);
    
    // Procházíme okolní buňky
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${centerCellX + dx},${centerCellY + dy}`;
        const cellPoints = this.grid.get(key) || [];
        
        // Kontrolujeme body v buňce
        for (const pointIndex of cellPoints) {
          const point = this.points[pointIndex];
          const dist = Math.sqrt(
            Math.pow(point.x - center.x, 2) + 
            Math.pow(point.y - center.y, 2)
          );
          
          if (dist <= radius) {
            result.push(pointIndex);
          }
        }
      }
    }
    
    return result;
  }
}
