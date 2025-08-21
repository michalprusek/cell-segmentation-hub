import { createCanvas, loadImage, CanvasRenderingContext2D } from 'canvas';
import { writeFile, readFile } from 'fs/promises';
import sharp from 'sharp';
import path from 'path';
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

  constructor() {
    // No complex font registration needed - use universal approach
    logger.info('VisualizationGenerator initialized with universal number rendering', 'VisualizationGenerator');
  }

  async generateVisualization(
    imagePath: string,
    polygons: Polygon[],
    outputPath: string,
    options?: VisualizationOptions
  ): Promise<VisualizationResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };

    try {
      // Check if image is TIFF and convert to PNG if needed
      let imageToLoad = imagePath;
      const ext = path.extname(imagePath).toLowerCase();
      
      if (ext === '.tiff' || ext === '.tif') {
        // Convert TIFF to PNG buffer
        const tiffBuffer = await readFile(imagePath);
        const pngBuffer = await sharp(tiffBuffer)
          .png()
          .toBuffer();
        
        // Create a temporary PNG file path (in memory)
        imageToLoad = `data:image/png;base64,${pngBuffer.toString('base64')}`;
        
        logger.info(`Converting TIFF to PNG for visualization: ${imagePath}`, 'VisualizationGenerator');
      }
      
      // Load the image
      const image = await loadImage(imageToLoad);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');

      // Draw the original image
      ctx.drawImage(image, 0, 0);

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

    // Use geometric approach - draw numbers as simple shapes
    const baseSize = Math.max(options.fontSize ?? 32, 24);
    const radius = baseSize * 0.8; // Circle radius
    
    // Save context state
    ctx.save();
    
    // Draw white background circle with strong border
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    ctx.arc(centroid.x, centroid.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Draw number using geometric shapes instead of text
    ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
    ctx.lineWidth = Math.max(3, baseSize * 0.08);
    
    this.drawNumberShape(ctx, number, centroid.x, centroid.y, baseSize * 0.5);
    
    // Restore context state
    ctx.restore();
    
    // Log successful rendering for debugging
    logger.debug(`Rendered polygon number ${number} at (${centroid.x.toFixed(1)}, ${centroid.y.toFixed(1)}) using geometric shapes`, 'VisualizationGenerator');
  }

  /**
   * Draw numbers using simple geometric shapes - universal approach
   */
  private drawNumberShape(ctx: CanvasRenderingContext2D, number: number, centerX: number, centerY: number, size: number): void {
    const width = size * 0.6;
    const height = size;
    const strokeWidth = Math.max(2, size * 0.12);
    
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    const left = centerX - width / 2;
    const right = centerX + width / 2;
    const top = centerY - height / 2;
    const bottom = centerY + height / 2;
    const middle = centerY;
    
    switch (number) {
      case 1:
        // Vertical line with small top stroke
        ctx.beginPath();
        ctx.moveTo(centerX, top);
        ctx.lineTo(centerX, bottom);
        ctx.moveTo(centerX - width * 0.2, top + height * 0.15);
        ctx.lineTo(centerX, top);
        ctx.stroke();
        break;
        
      case 2:
        ctx.beginPath();
        ctx.moveTo(left, top + height * 0.25);
        ctx.quadraticCurveTo(centerX, top, right, top + height * 0.25);
        ctx.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        ctx.lineTo(left, bottom - height * 0.1);
        ctx.lineTo(right, bottom);
        ctx.stroke();
        break;
        
      case 3:
        ctx.beginPath();
        ctx.moveTo(left, top + height * 0.2);
        ctx.quadraticCurveTo(centerX, top, right, top + height * 0.25);
        ctx.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        ctx.moveTo(centerX, middle);
        ctx.quadraticCurveTo(right, middle + height * 0.1, right, bottom - height * 0.25);
        ctx.quadraticCurveTo(centerX, bottom, left, bottom - height * 0.2);
        ctx.stroke();
        break;
        
      case 4:
        ctx.beginPath();
        ctx.moveTo(left + width * 0.2, top);
        ctx.lineTo(left + width * 0.2, middle);
        ctx.lineTo(right, middle);
        ctx.moveTo(right - width * 0.2, top);
        ctx.lineTo(right - width * 0.2, bottom);
        ctx.stroke();
        break;
        
      case 5:
        ctx.beginPath();
        ctx.moveTo(right, top);
        ctx.lineTo(left, top);
        ctx.lineTo(left, middle - height * 0.1);
        ctx.quadraticCurveTo(centerX, middle - height * 0.1, right, middle + height * 0.1);
        ctx.quadraticCurveTo(right, bottom - height * 0.1, centerX, bottom);
        ctx.lineTo(left, bottom - height * 0.2);
        ctx.stroke();
        break;
        
      case 6:
        ctx.beginPath();
        ctx.moveTo(right - width * 0.2, top);
        ctx.quadraticCurveTo(left, top, left, middle);
        ctx.quadraticCurveTo(left, bottom, centerX, bottom);
        ctx.quadraticCurveTo(right, bottom, right, middle + height * 0.1);
        ctx.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        ctx.lineTo(left, middle);
        ctx.stroke();
        break;
        
      case 7:
        ctx.beginPath();
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
        ctx.lineTo(centerX, bottom);
        ctx.stroke();
        break;
        
      case 8:
        ctx.beginPath();
        // Top circle
        ctx.moveTo(left, top + height * 0.2);
        ctx.quadraticCurveTo(centerX, top, right, top + height * 0.2);
        ctx.quadraticCurveTo(right, middle - height * 0.1, centerX, middle);
        ctx.quadraticCurveTo(left, middle - height * 0.1, left, top + height * 0.2);
        // Bottom circle
        ctx.moveTo(left, middle + height * 0.1);
        ctx.quadraticCurveTo(left, bottom, centerX, bottom);
        ctx.quadraticCurveTo(right, bottom, right, middle + height * 0.1);
        ctx.quadraticCurveTo(right, middle + height * 0.1, centerX, middle);
        ctx.stroke();
        break;
        
      case 9:
        ctx.beginPath();
        ctx.moveTo(centerX, middle);
        ctx.quadraticCurveTo(right, middle - height * 0.1, right, top + height * 0.2);
        ctx.quadraticCurveTo(right, top, centerX, top);
        ctx.quadraticCurveTo(left, top, left, middle - height * 0.1);
        ctx.quadraticCurveTo(left, middle + height * 0.1, centerX, middle);
        ctx.lineTo(right, middle);
        ctx.quadraticCurveTo(right, bottom, left + width * 0.2, bottom);
        ctx.stroke();
        break;
        
      case 0:
        ctx.beginPath();
        ctx.moveTo(centerX, top);
        ctx.quadraticCurveTo(right, top, right, middle);
        ctx.quadraticCurveTo(right, bottom, centerX, bottom);
        ctx.quadraticCurveTo(left, bottom, left, middle);
        ctx.quadraticCurveTo(left, top, centerX, top);
        ctx.stroke();
        break;
        
      default: {
        // For numbers > 9, show simple dot pattern
        const dotSize = size * 0.15;
        const dots = Math.min(number, 12); // Max 12 dots
        const angleStep = (Math.PI * 2) / dots;
        const dotRadius = size * 0.3;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
        for (let i = 0; i < dots; i++) {
          const angle = i * angleStep - Math.PI / 2;
          const dotX = centerX + Math.cos(angle) * dotRadius;
          const dotY = centerY + Math.sin(angle) * dotRadius;
          
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
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
    // Validate input
    if (!points || points.length === 0) {
      logger.warn('Empty points array for centroid calculation', 'VisualizationGenerator');
      return { x: 0, y: 0 };
    }

    // Filter out invalid points
    const validPoints = points.filter(p => 
      p && typeof p.x === 'number' && typeof p.y === 'number' && 
      !isNaN(p.x) && !isNaN(p.y) && isFinite(p.x) && isFinite(p.y)
    );

    if (validPoints.length === 0) {
      logger.warn('No valid points for centroid calculation', 'VisualizationGenerator');
      return { x: 0, y: 0 };
    }

    // For very small polygons, use simple arithmetic mean
    if (validPoints.length < 3) {
      const meanX = validPoints.reduce((sum, p) => sum + p.x, 0) / validPoints.length;
      const meanY = validPoints.reduce((sum, p) => sum + p.y, 0) / validPoints.length;
      return { x: meanX, y: meanY };
    }

    let area = 0;
    let cx = 0;
    let cy = 0;

    // Calculate polygon area and centroid using shoelace formula
    for (let i = 0; i < validPoints.length; i++) {
      const j = (i + 1) % validPoints.length;
      const xi = validPoints[i].x;
      const yi = validPoints[i].y;
      const xj = validPoints[j].x;
      const yj = validPoints[j].y;

      const a = xi * yj - xj * yi;
      area += a;
      cx += (xi + xj) * a;
      cy += (yi + yj) * a;
    }

    area *= 0.5;
    
    // Guard against division by zero for degenerate/collinear polygons
    if (Math.abs(area) < 1e-8) {
      // Return arithmetic mean of vertices as fallback
      const meanX = validPoints.reduce((sum, p) => sum + p.x, 0) / validPoints.length;
      const meanY = validPoints.reduce((sum, p) => sum + p.y, 0) / validPoints.length;
      logger.debug(`Using arithmetic mean centroid for degenerate polygon: (${meanX.toFixed(1)}, ${meanY.toFixed(1)})`, 'VisualizationGenerator');
      return { x: meanX, y: meanY };
    }
    
    cx /= (6 * area);
    cy /= (6 * area);

    // Validate result
    if (!isFinite(cx) || !isFinite(cy)) {
      const meanX = validPoints.reduce((sum, p) => sum + p.x, 0) / validPoints.length;
      const meanY = validPoints.reduce((sum, p) => sum + p.y, 0) / validPoints.length;
      logger.warn(`Invalid centroid calculated, using arithmetic mean: (${meanX.toFixed(1)}, ${meanY.toFixed(1)})`, 'VisualizationGenerator');
      return { x: meanX, y: meanY };
    }

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