import { createCanvas, loadImage, Canvas, CanvasRenderingContext2D } from 'canvas';
import { writeFile } from 'fs/promises';
import { logger } from '../../utils/logger';


export interface VisualizationOptions {
  showNumbers?: boolean;
  polygonColors?: {
    external?: string;
    internal?: string;
  };
  strokeWidth?: number;
  fontSize?: number;
  transparency?: number;
}

export interface Polygon {
  points: Array<{ x: number; y: number }>;
  type: 'external' | 'internal';
  id?: string;
}

export enum VisualizationResult {
  SUCCESS = 'success',
  SKIPPED = 'skipped',
  ERROR = 'error'
}

export class VisualizationGenerator {
  private defaultOptions: VisualizationOptions = {
    showNumbers: true,
    polygonColors: {
      external: '#FF0000',
      internal: '#0000FF',
    },
    strokeWidth: 2,
    fontSize: 32,
    transparency: 0.3,
  };

  async generateVisualization(
    imagePath: string,
    polygons: Polygon[],
    outputPath: string,
    options?: VisualizationOptions
  ): Promise<VisualizationResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    try {
      // Load the image
      const image = await loadImage(imagePath);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');

      // Draw the original image
      ctx.drawImage(image as any, 0, 0);

      // Draw polygons
      let polygonNumber = 1;
      for (const polygon of polygons) {
        if (polygon.type === 'external') {
          await this.drawPolygon(ctx, polygon, mergedOptions, polygonNumber);
          polygonNumber++;
        } else {
          await this.drawPolygon(ctx, polygon, mergedOptions);
        }
      }

      // Save the canvas to file
      const buffer = canvas.toBuffer('image/png');
      await writeFile(outputPath, buffer);

      logger.info(`Visualization generated: ${outputPath}`, 'VisualizationGenerator');
      return VisualizationResult.SUCCESS;
    } catch (error) {
      logger.error(`Failed to generate visualization for ${imagePath}:`, error instanceof Error ? error : new Error(String(error)), 'VisualizationGenerator');
      return VisualizationResult.ERROR;
    }
  }

  private async drawPolygon(
    ctx: CanvasRenderingContext2D,
    polygon: Polygon,
    options: VisualizationOptions,
    polygonNumber?: number
  ): Promise<void> {
    if (!polygon.points || polygon.points.length < 3) {
      return;
    }

    const color = polygon.type === 'external'
      ? options.polygonColors?.external || '#00FF00'
      : options.polygonColors?.internal || '#FF0000';

    // Set stroke style
    ctx.strokeStyle = color;
    ctx.lineWidth = options.strokeWidth || 2;

    // Set fill style with transparency
    const fillColor = this.hexToRgba(color, options.transparency || 0.3);
    ctx.fillStyle = fillColor;

    // Begin path
    ctx.beginPath();
    if (polygon.points?.[0]) {
      ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
    }

    // Draw polygon
    for (let i = 1; i < polygon.points.length; i++) {
      const point = polygon.points[i];
      if (point && typeof point.x === 'number' && typeof point.y === 'number') {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.closePath();

    // Fill and stroke
    ctx.fill();
    ctx.stroke();

    // Draw polygon number if it's an external polygon
    if (options.showNumbers && polygonNumber !== undefined && polygon.type === 'external') {
      this.drawPolygonNumber(ctx, polygon, polygonNumber, options);
    }

    // Draw vertices
    this.drawVertices(ctx, polygon, color);
  }

  private drawPolygonNumber(
    ctx: CanvasRenderingContext2D,
    polygon: Polygon,
    number: number,
    options: VisualizationOptions
  ): void {
    // Calculate centroid
    const centroid = this.calculateCentroid(polygon.points);

    // Calculate polygon bounding box for adaptive font sizing
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of polygon.points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    
    // Calculate polygon dimensions
    const polygonWidth = maxX - minX;
    const polygonHeight = maxY - minY;
    const polygonSize = Math.min(polygonWidth, polygonHeight);
    
    // Get canvas dimensions for scaling
    const canvasSize = Math.min(ctx.canvas.width, ctx.canvas.height);
    
    // Calculate adaptive font size
    // Use user-provided fontSize as base, but scale it based on polygon and canvas size
    const baseFontSize = options.fontSize ?? 32;
    const scaleFactor = Math.max(1, canvasSize / 1000); // Scale based on canvas size
    const polygonScaleFactor = Math.max(0.3, Math.min(2, polygonSize / 50)); // Scale based on polygon size
    const adaptiveFontSize = Math.max(16, Math.min(200, baseFontSize * scaleFactor * polygonScaleFactor));

    // Set text style with adaptive font
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(3, adaptiveFontSize / 10); // Scale stroke with font size
    ctx.font = `bold ${adaptiveFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw text with thick outline for better visibility
    const text = number.toString();
    ctx.strokeText(text, centroid.x, centroid.y);
    ctx.fillText(text, centroid.x, centroid.y);
  }

  private drawVertices(
    ctx: CanvasRenderingContext2D,
    polygon: Polygon,
    color: string
  ): void {
    ctx.fillStyle = color;
    
    for (const point of polygon.points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  private calculateCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
    let area = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const pointI = points[i];
      const pointJ = points[j];
      if (!pointI || !pointJ || typeof pointI.x !== 'number' || typeof pointI.y !== 'number' || 
          typeof pointJ.x !== 'number' || typeof pointJ.y !== 'number') {
        continue;
      }
      const xi = pointI.x;
      const yi = pointI.y;
      const xj = pointJ.x;
      const yj = pointJ.y;

      const a = xi * yj - xj * yi;
      area += a;
      cx += (xi + xj) * a;
      cy += (yi + yj) * a;
    }

    area *= 0.5;
    
    // Guard against division by zero for degenerate/collinear polygons
    if (Math.abs(area) < 1e-8) {
      // Return arithmetic mean of vertices as fallback
      const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      return { x: meanX, y: meanY };
    }
    
    cx /= (6 * area);
    cy /= (6 * area);

    return { x: cx, y: cy };
  }

  private hexToRgba(hex: string, alpha: number): string {
    // Validate hex color format
    if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
      logger.warn(`Invalid hex color: ${hex}, using default black`, 'VisualizationGenerator');
      return `rgba(0, 0, 0, ${alpha})`;
    }
    
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  async generateBatchVisualizations(
    images: Array<{
      path: string;
      polygons: Polygon[];
      outputPath: string;
    }>,
    options?: VisualizationOptions,
    onProgress?: (progress: number) => void
  ): Promise<{ successful: number; skipped: number; errors: number }> {
    const total = images.length;
    let completed = 0;
    let successful = 0;
    let skipped = 0;
    let errors = 0;

    for (const image of images) {
      try {
        const result = await this.generateVisualization(
          image.path,
          image.polygons,
          image.outputPath,
          options
        );

        switch (result) {
          case VisualizationResult.SUCCESS:
            successful++;
            break;
          case VisualizationResult.SKIPPED:
            skipped++;
            break;
          case VisualizationResult.ERROR:
            errors++;
            break;
        }
      } catch (error) {
        errors++;
        logger.error(
          `Failed to generate visualization for ${image.path}`,
          error instanceof Error ? error : new Error(String(error)),
          'VisualizationGenerator'
        );
        
        // If visualization is disabled/unavailable, throw immediately to fail fast
        if (error instanceof Error && error.message.includes('missing canvas module')) {
          throw error;
        }
      }

      completed++;
      if (onProgress) {
        onProgress((completed / total) * 100);
      }
    }

    logger.info(
      `Batch visualization complete: ${successful} successful, ${skipped} skipped, ${errors} errors`,
      'VisualizationGenerator'
    );

    return { successful, skipped, errors };
  }
}