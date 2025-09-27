import { createCanvas, loadImage, CanvasRenderingContext2D } from 'canvas';
import { writeFile, readFile, mkdir, unlink } from 'fs/promises';
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
  ERROR = 'error',
}

interface PerformanceMetrics {
  totalPolygons: number;
  renderTime: number;
  cacheHitRate: number;
  warningThresholdExceeded: boolean;
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

  // Performance thresholds
  private readonly WARN_POLYGON_COUNT = 1000;
  private readonly ERROR_POLYGON_COUNT = 5000;
  private readonly WARN_RENDER_TIME_MS = 5000;
  private readonly ERROR_RENDER_TIME_MS = 30000;

  constructor() {
    // Using standard font rendering for better clarity and consistency
    logger.info(
      'VisualizationGenerator initialized with font-based number rendering and performance monitoring',
      'VisualizationGenerator'
    );
  }

  async generateVisualization(
    imagePath: string,
    polygons: Polygon[],
    outputPath: string,
    options?: VisualizationOptions
  ): Promise<VisualizationResult> {
    const mergedOptions = { ...this.defaultOptions, ...options };
    const startTime = Date.now();
    const metrics: PerformanceMetrics = {
      totalPolygons: polygons.length,
      renderTime: 0,
      cacheHitRate: 0,
      warningThresholdExceeded: false,
    };

    // Check polygon count thresholds
    if (polygons.length > this.ERROR_POLYGON_COUNT) {
      logger.error(
        `Polygon count (${polygons.length}) exceeds error threshold (${this.ERROR_POLYGON_COUNT})`,
        new Error('Too many polygons'),
        'VisualizationGenerator'
      );
      metrics.warningThresholdExceeded = true;
      throw new Error(
        `Polygon count (${polygons.length}) exceeds maximum threshold (${this.ERROR_POLYGON_COUNT}). Visualization aborted to prevent performance issues.`
      );
    } else if (polygons.length > this.WARN_POLYGON_COUNT) {
      logger.warn(
        `High polygon count detected: ${polygons.length} polygons. Performance may be degraded.`,
        'VisualizationGenerator'
      );
      metrics.warningThresholdExceeded = true;
    }

    try {
      // Check if image is TIFF and convert to PNG if needed
      let imageToLoad = imagePath;
      let tempPngPath: string | null = null;
      const ext = path.extname(imagePath).toLowerCase();

      if (ext === '.tiff' || ext === '.tif') {
        // Convert TIFF to PNG and save to temp file
        const tiffBuffer = await readFile(imagePath);
        const pngBuffer = await sharp(tiffBuffer)
          .png({ quality: 95, compressionLevel: 6 })
          .toBuffer();

        // Create a temporary PNG file
        tempPngPath = path.join(
          '/app/uploads/temp',
          `tiff_viz_${Date.now()}_${path.basename(imagePath, ext)}.png`
        );

        // Ensure temp directory exists
        const tempDir = path.dirname(tempPngPath);
        await mkdir(tempDir, { recursive: true });

        // Write PNG buffer to temp file
        await writeFile(tempPngPath, pngBuffer);
        imageToLoad = tempPngPath;

        logger.info(
          `Converting TIFF to PNG for visualization: ${imagePath} -> ${tempPngPath}`,
          'VisualizationGenerator'
        );
      }

      // Load the image
      const image = await loadImage(imageToLoad);
      const canvas = createCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d');

      // Draw the original image
      ctx.drawImage(image, 0, 0);

      // Reset any transformations before drawing polygons
      ctx.resetTransform();

      // Draw polygons - reset polygon numbering for each image
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

      // Clean up temp PNG file if it was created for TIFF conversion
      if (tempPngPath) {
        try {
          await unlink(tempPngPath);
          logger.debug(
            `Cleaned up temp PNG file: ${tempPngPath}`,
            'VisualizationGenerator'
          );
        } catch (error) {
          logger.warn(
            `Failed to clean up temp PNG file: ${tempPngPath}`,
            'VisualizationGenerator'
          );
        }
      }

      // Calculate final metrics
      metrics.renderTime = Date.now() - startTime;
      metrics.cacheHitRate = 0; // No longer using cache since we're using native font rendering

      // Check render time thresholds
      if (metrics.renderTime > this.ERROR_RENDER_TIME_MS) {
        logger.error(
          `Render time (${metrics.renderTime}ms) exceeds error threshold (${this.ERROR_RENDER_TIME_MS}ms)`,
          new Error('Render timeout'),
          'VisualizationGenerator'
        );
        throw new Error(
          `Render timeout: renderTime ${metrics.renderTime}ms exceeds threshold ${this.ERROR_RENDER_TIME_MS}ms`
        );
      } else if (metrics.renderTime > this.WARN_RENDER_TIME_MS) {
        logger.warn(
          `Slow render detected: ${metrics.renderTime}ms for ${polygons.length} polygons`,
          'VisualizationGenerator'
        );
      }

      // Log performance metrics
      logger.info(
        `Visualization generated: ${outputPath} | Metrics: ${polygons.length} polygons in ${metrics.renderTime}ms`,
        'VisualizationGenerator'
      );

      // Log detailed metrics for monitoring
      if (polygons.length > 100) {
        logger.debug(
          `Performance details - Polygons: ${polygons.length}, Time: ${metrics.renderTime}ms`,
          'VisualizationGenerator'
        );
      }

      return VisualizationResult.SUCCESS;
    } catch (error) {
      const renderTime = Date.now() - startTime;

      // Clean up temp PNG file if it was created for TIFF conversion (even on error)
      if (tempPngPath) {
        try {
          await unlink(tempPngPath);
          logger.debug(
            `Cleaned up temp PNG file after error: ${tempPngPath}`,
            'VisualizationGenerator'
          );
        } catch (cleanupError) {
          logger.warn(
            `Failed to clean up temp PNG file after error: ${tempPngPath}`,
            'VisualizationGenerator'
          );
        }
      }

      logger.error(
        `Failed to generate visualization for ${imagePath} after ${renderTime}ms:`,
        error instanceof Error ? error : new Error(String(error)),
        'VisualizationGenerator'
      );
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

    const color =
      polygon.type === 'external'
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
    if (
      options.showNumbers &&
      polygonNumber !== undefined &&
      polygon.type === 'external'
    ) {
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

    const baseSize = Math.max(options.fontSize ?? 32, 24);
    const radius = baseSize * 0.8; // Circle radius

    // Save context state - CRITICAL for preventing state persistence
    ctx.save();

    // Reset transformation matrix to ensure clean positioning
    ctx.resetTransform();

    // Draw white background circle with strong border
    ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.arc(centroid.x, centroid.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Try multiple font options for better compatibility
    const fontFamilies = [
      'DejaVu Sans', // Primary choice - installed via ttf-dejavu
      'Liberation Sans', // Secondary - installed via ttf-liberation
      'Noto Sans', // Tertiary - installed via font-noto
      'FreeSans', // Fallback - installed via ttf-freefont
      'Arial', // Common fallback
      'Helvetica', // macOS fallback
      'sans-serif', // Generic fallback
    ];

    // Build font string with fallbacks
    const fontString = `bold ${baseSize}px ${fontFamilies.join(', ')}`;

    try {
      // Set font with fallback chain
      ctx.font = fontString;
      ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Test if font rendering works by measuring text
      const numberStr = String(number);
      const metrics = ctx.measureText(numberStr);

      // If measurement returns valid width, fonts are working
      if (metrics && metrics.width > 0) {
        ctx.fillText(numberStr, centroid.x, centroid.y);
        logger.debug(
          `Rendered number ${number} using font rendering`,
          'VisualizationGenerator'
        );
      } else {
        // Fallback to simple geometric rendering if fonts fail
        this.drawNumberFallback(ctx, number, centroid.x, centroid.y, baseSize);
        logger.warn(
          `Font rendering failed for number ${number}, using fallback`,
          'VisualizationGenerator'
        );
      }
    } catch (error) {
      // If font operations fail, use geometric fallback
      this.drawNumberFallback(ctx, number, centroid.x, centroid.y, baseSize);
      logger.warn(
        `Font error for number ${number}: ${error}, using fallback`,
        'VisualizationGenerator'
      );
    }

    // Restore context state - ensures no state leaks to next image
    ctx.restore();
  }

  /**
   * Fallback method to draw numbers using simple strokes when fonts aren't available
   */
  private drawNumberFallback(
    ctx: CanvasRenderingContext2D,
    number: number,
    x: number,
    y: number,
    size: number
  ): void {
    // Use stroke-based rendering as fallback
    ctx.strokeStyle = 'rgba(0, 0, 0, 1.0)';
    ctx.lineWidth = Math.max(2, size * 0.1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const numberStr = String(number);
    const digitWidth = size * 0.3;
    const startX = x - (numberStr.length * digitWidth) / 2;

    // Draw each digit using simple strokes
    for (let i = 0; i < numberStr.length; i++) {
      const digit = parseInt(numberStr[i], 10);
      const digitX = startX + i * digitWidth + digitWidth / 2;
      this.strokeDigit(ctx, digit, digitX, y, size * 0.6);
    }
  }

  /**
   * Draw a single digit using strokes (simplified for readability)
   */
  private strokeDigit(
    ctx: CanvasRenderingContext2D,
    digit: number,
    x: number,
    y: number,
    size: number
  ): void {
    const halfSize = size / 2;
    const quarterSize = size / 4;

    ctx.beginPath();

    switch (digit) {
      case 0:
        ctx.arc(x, y, quarterSize, 0, Math.PI * 2);
        break;
      case 1:
        ctx.moveTo(x, y - halfSize);
        ctx.lineTo(x, y + halfSize);
        break;
      case 2:
        ctx.moveTo(x - quarterSize, y - halfSize);
        ctx.lineTo(x + quarterSize, y - halfSize);
        ctx.lineTo(x + quarterSize, y);
        ctx.lineTo(x - quarterSize, y);
        ctx.lineTo(x - quarterSize, y + halfSize);
        ctx.lineTo(x + quarterSize, y + halfSize);
        break;
      case 3:
        ctx.moveTo(x - quarterSize, y - halfSize);
        ctx.lineTo(x + quarterSize, y - halfSize);
        ctx.lineTo(x + quarterSize, y + halfSize);
        ctx.lineTo(x - quarterSize, y + halfSize);
        ctx.moveTo(x - quarterSize, y);
        ctx.lineTo(x + quarterSize, y);
        break;
      case 4:
        ctx.moveTo(x - quarterSize, y - halfSize);
        ctx.lineTo(x - quarterSize, y);
        ctx.lineTo(x + quarterSize, y);
        ctx.moveTo(x + quarterSize, y - halfSize);
        ctx.lineTo(x + quarterSize, y + halfSize);
        break;
      case 5:
        ctx.moveTo(x + quarterSize, y - halfSize);
        ctx.lineTo(x - quarterSize, y - halfSize);
        ctx.lineTo(x - quarterSize, y);
        ctx.lineTo(x + quarterSize, y);
        ctx.lineTo(x + quarterSize, y + halfSize);
        ctx.lineTo(x - quarterSize, y + halfSize);
        break;
      case 6:
        ctx.moveTo(x + quarterSize, y - halfSize);
        ctx.lineTo(x - quarterSize, y - halfSize);
        ctx.lineTo(x - quarterSize, y + halfSize);
        ctx.lineTo(x + quarterSize, y + halfSize);
        ctx.lineTo(x + quarterSize, y);
        ctx.lineTo(x - quarterSize, y);
        break;
      case 7:
        ctx.moveTo(x - quarterSize, y - halfSize);
        ctx.lineTo(x + quarterSize, y - halfSize);
        ctx.lineTo(x, y + halfSize);
        break;
      case 8:
        ctx.arc(x, y - quarterSize, quarterSize, 0, Math.PI * 2);
        ctx.moveTo(x + quarterSize, y + quarterSize);
        ctx.arc(x, y + quarterSize, quarterSize, 0, Math.PI * 2);
        break;
      case 9:
        ctx.moveTo(x + quarterSize, y + halfSize);
        ctx.lineTo(x + quarterSize, y - halfSize);
        ctx.lineTo(x - quarterSize, y - halfSize);
        ctx.lineTo(x - quarterSize, y);
        ctx.lineTo(x + quarterSize, y);
        break;
      default:
        // Draw a dot for unknown
        ctx.arc(x, y, size * 0.1, 0, Math.PI * 2);
    }

    ctx.stroke();
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

  private calculateCentroid(points: Array<{ x: number; y: number }>): {
    x: number;
    y: number;
  } {
    // Validate input
    if (!points || points.length === 0) {
      logger.warn(
        'Empty points array for centroid calculation',
        'VisualizationGenerator'
      );
      return { x: 0, y: 0 };
    }

    // Filter out invalid points
    const validPoints = points.filter(
      p =>
        p &&
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        !isNaN(p.x) &&
        !isNaN(p.y) &&
        isFinite(p.x) &&
        isFinite(p.y)
    );

    if (validPoints.length === 0) {
      logger.warn(
        'No valid points for centroid calculation',
        'VisualizationGenerator'
      );
      return { x: 0, y: 0 };
    }

    // For very small polygons, use simple arithmetic mean
    if (validPoints.length < 3) {
      const meanX =
        validPoints.reduce((sum, p) => sum + p.x, 0) / validPoints.length;
      const meanY =
        validPoints.reduce((sum, p) => sum + p.y, 0) / validPoints.length;
      return { x: meanX, y: meanY };
    }

    let area = 0;
    let cx = 0;
    let cy = 0;

    // Calculate polygon area and centroid using shoelace formula
    for (let i = 0; i < validPoints.length; i++) {
      const j = (i + 1) % validPoints.length;
      const currentPoint = validPoints[i];
      const nextPoint = validPoints[j];

      if (!currentPoint || !nextPoint) {
        continue;
      }

      const xi = currentPoint.x;
      const yi = currentPoint.y;
      const xj = nextPoint.x;
      const yj = nextPoint.y;

      const a = xi * yj - xj * yi;
      area += a;
      cx += (xi + xj) * a;
      cy += (yi + yj) * a;
    }

    area *= 0.5;

    // Guard against division by zero for degenerate/collinear polygons
    if (Math.abs(area) < 1e-8) {
      // Return arithmetic mean of vertices as fallback
      const meanX =
        validPoints.reduce((sum, p) => sum + p.x, 0) / validPoints.length;
      const meanY =
        validPoints.reduce((sum, p) => sum + p.y, 0) / validPoints.length;
      logger.debug(
        `Using arithmetic mean centroid for degenerate polygon: (${meanX.toFixed(1)}, ${meanY.toFixed(1)})`,
        'VisualizationGenerator'
      );
      return { x: meanX, y: meanY };
    }

    cx /= 6 * area;
    cy /= 6 * area;

    // Validate result
    if (!isFinite(cx) || !isFinite(cy)) {
      const meanX =
        validPoints.reduce((sum, p) => sum + p.x, 0) / validPoints.length;
      const meanY =
        validPoints.reduce((sum, p) => sum + p.y, 0) / validPoints.length;
      logger.warn(
        `Invalid centroid calculated, using arithmetic mean: (${meanX.toFixed(1)}, ${meanY.toFixed(1)})`,
        'VisualizationGenerator'
      );
      return { x: meanX, y: meanY };
    }

    return { x: cx, y: cy };
  }

  private hexToRgba(hex: string, alpha: number): string {
    // Validate hex color format
    if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
      logger.warn(
        `Invalid hex color: ${hex}, using default black`,
        'VisualizationGenerator'
      );
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
        if (
          error instanceof Error &&
          error.message.includes('missing canvas module')
        ) {
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
