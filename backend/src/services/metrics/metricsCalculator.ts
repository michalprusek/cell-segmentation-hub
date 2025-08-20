import axios, { AxiosInstance } from 'axios';
import ExcelJS from 'exceljs';
import { createObjectCsvStringifier } from 'csv-writer';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import { logger } from '../../utils/logger';
import { config } from '../../utils/config';

export interface PolygonMetrics {
  imageId: string;
  imageName: string;
  polygonId: number;
  type: 'external' | 'internal';
  area: number;
  perimeter: number;
  equivalentDiameter: number;
  circularity: number;
  feretDiameterMax: number;
  feretDiameterMaxOrthogonalDistance: number;
  feretDiameterMin: number;
  feretAspectRatio: number;
  lengthMajorDiameterThroughCentroid: number;
  lengthMinorDiameterThroughCentroid: number;
  compactness: number;
  convexity: number;
  solidity: number;
  sphericity: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Polygon {
  points: Point[];
  type: 'external' | 'internal';
}

export interface SegmentationData {
  polygons: string;
  model: string;
  threshold: number;
  confidence?: number;
  processingTime?: number;
}

export interface ImageWithSegmentation {
  id: string;
  name: string;
  width?: number;
  height?: number;
  segmentation?: SegmentationData;
}

export type SummaryStatisticsRow = (string | number)[];

export class MetricsCalculator {
  private pythonApiUrl: string;
  private http: AxiosInstance;
  private logger = logger;

  constructor() {
    // Validate ML service URL
    try {
      const url = new URL(config.SEGMENTATION_SERVICE_URL);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Invalid protocol - must be http or https');
      }
      this.pythonApiUrl = config.SEGMENTATION_SERVICE_URL;
    } catch (error) {
      const errorMsg = `Invalid SEGMENTATION_SERVICE_URL configuration (from env var SEGMENTATION_SERVICE_URL): ${config.SEGMENTATION_SERVICE_URL} - ${error instanceof Error ? error.message : String(error)}`;
      this.logger.error(errorMsg, error as Error, 'MetricsCalculator');
      throw new Error(errorMsg);
    }

    // Initialize Axios client with baseURL and timeout
    this.http = axios.create({
      baseURL: this.pythonApiUrl,
      timeout: 30000, // 30 seconds timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Calculate metrics for all images
   */
  async calculateAllMetrics(images: ImageWithSegmentation[]): Promise<PolygonMetrics[]> {
    const allMetrics: PolygonMetrics[] = [];

    for (let imageIdx = 0; imageIdx < images.length; imageIdx++) {
      const image = images[imageIdx];
      
      if (image && image.segmentation?.polygons) {
        const result = image.segmentation;
        if (result.polygons) {
          try {
            const polygons = JSON.parse(result.polygons);
            const imageMetrics = await this.calculateImageMetrics(
              polygons,
              image.id,
              `image_${String(imageIdx + 1).padStart(3, '0')}.jpg`
            );
            allMetrics.push(...imageMetrics);
          } catch (parseError) {
            this.logger.error(
              `Failed to parse polygons for image ${image.id} at index ${imageIdx}`,
              parseError instanceof Error ? parseError : new Error(String(parseError)),
              'MetricsCalculator',
              { imageId: image.id, imageIdx }
            );
            continue;
          }
        }
      }
    }

    return allMetrics;
  }

  /**
   * Calculate metrics for polygons in a single image
   */
  async calculateImageMetrics(
    polygons: Polygon[],
    imageId: string,
    imageName: string
  ): Promise<PolygonMetrics[]> {
    const metrics: PolygonMetrics[] = [];
    
    // Separate external and internal polygons
    const externalPolygons = polygons.filter(p => p.type === 'external');
    const internalPolygons = polygons.filter(p => p.type === 'internal');

    // Calculate metrics for each external polygon
    for (let i = 0; i < externalPolygons.length; i++) {
      const polygon = externalPolygons[i];
      
      if (!polygon) {
        this.logger.warn(`Skipping undefined polygon at index ${i}`, 'MetricsCalculator');
        continue;
      }
      
      // Skip degenerate polygons with insufficient points
      if (!polygon.points || polygon.points.length < 3) {
        this.logger.warn(`Skipping degenerate polygon at index ${i} with ${polygon.points?.length || 0} points`, 'MetricsCalculator');
        continue;
      }
      
      try {
        // Find holes that are inside this specific polygon
        const holesForPolygon = internalPolygons.filter(inner => 
          this.isPolygonInside(inner, polygon)
        );

        // Calculate metrics using Python service
        const polygonMetrics = await this.calculatePolygonMetrics(
          polygon,
          holesForPolygon
        );

        metrics.push({
          imageId,
          imageName,
          polygonId: i + 1,
          type: 'external',
          ...polygonMetrics,
        });
      } catch (error) {
        this.logger.error(
          `Failed to calculate metrics for polygon ${i + 1}:`,
          error instanceof Error ? error : new Error(String(error)),
          'MetricsCalculator'
        );
        
        // Fallback to basic calculations with proper hole mapping
        const holesForPolygon = internalPolygons.filter(inner => 
          this.isPolygonInside(inner, polygon)
        );
        
        metrics.push({
          imageId,
          imageName,
          polygonId: i + 1,
          type: 'external',
          ...this.calculateBasicMetrics(polygon, holesForPolygon),
        });
      }
    }

    return metrics;
  }

  /**
   * Calculate metrics for a single polygon using Python service
   */
  private async calculatePolygonMetrics(
    polygon: Polygon,
    holes: Polygon[]
  ): Promise<Omit<PolygonMetrics, 'imageId' | 'imageName' | 'polygonId' | 'type'>> {
    try {
      // Convert polygon points to numpy-compatible format
      if (!polygon?.points) {
        throw new Error('Polygon points are undefined');
      }
      const contour = polygon.points.map(p => [p.x, p.y]);
      const holeContours = holes.map(h => {
        if (!h?.points) {
          throw new Error('Hole polygon points are undefined');
        }
        return h.points.map(p => [p.x, p.y]);
      });

      // Call Python API for metrics calculation
      const response = await this.http.post('/api/calculate-metrics', {
        contour,
        holes: holeContours,
      });

      // Validate response data has all required metric keys
      const requiredKeys = [
        'Area', 'Perimeter', 'EquivalentDiameter', 'Circularity',
        'FeretDiameterMax', 'FeretDiameterMaxOrthogonalDistance', 'FeretDiameterMin',
        'FeretAspectRatio', 'LengthMajorDiameterThroughCentroid', 'LengthMinorDiameterThroughCentroid',
        'Compactness', 'Convexity', 'Solidity', 'Sphericity'
      ];
      
      const missingKeys = requiredKeys.filter(key => !(key in response.data));
      if (missingKeys.length > 0) {
        throw new Error(`Missing required metric keys in response: ${missingKeys.join(', ')}`);
      }

      return {
        area: response.data.Area,
        perimeter: response.data.Perimeter,
        equivalentDiameter: response.data.EquivalentDiameter,
        circularity: response.data.Circularity,
        feretDiameterMax: response.data.FeretDiameterMax,
        feretDiameterMaxOrthogonalDistance: response.data.FeretDiameterMaxOrthogonalDistance,
        feretDiameterMin: response.data.FeretDiameterMin,
        feretAspectRatio: response.data.FeretAspectRatio,
        lengthMajorDiameterThroughCentroid: response.data.LengthMajorDiameterThroughCentroid,
        lengthMinorDiameterThroughCentroid: response.data.LengthMinorDiameterThroughCentroid,
        compactness: response.data.Compactness,
        convexity: response.data.Convexity,
        solidity: response.data.Solidity,
        sphericity: response.data.Sphericity,
      };
    } catch (error) {
      this.logger.error(
        'Python metrics calculation failed:',
        error instanceof Error ? error : new Error(String(error)),
        'MetricsCalculator'
      );
      throw error;
    }
  }

  /**
   * Calculate basic metrics without Python service (fallback)
   */
  private calculateBasicMetrics(
    polygon: Polygon,
    holes: Polygon[]
  ): Omit<PolygonMetrics, 'imageId' | 'imageName' | 'polygonId' | 'type'> {
    // Check if polygon has valid points
    if (!polygon?.points || polygon.points.length === 0) {
      throw new Error('Polygon points are undefined or empty');
    }

    // Calculate main polygon area
    const mainArea = this.calculatePolygonArea(polygon.points);
    
    // Subtract hole areas
    const holesArea = holes.reduce(
      (sum, hole) => {
        if (!hole?.points || hole.points.length === 0) {
          return sum; // Skip invalid holes
        }
        return sum + this.calculatePolygonArea(hole.points);
      },
      0
    );
    let area = mainArea - holesArea;

    // Calculate perimeter
    let perimeter = this.calculatePerimeter(polygon.points);

    // Add geometric value guards - clamp to safe ranges
    area = Math.max(0, area);
    perimeter = Math.max(perimeter, Number.EPSILON);

    // Calculate basic metrics with clamped values
    const circularity = (4 * Math.PI * area) / (perimeter * perimeter);
    const equivalentDiameter = Math.sqrt((4 * area) / Math.PI);

    // Estimate other metrics (these would be more accurate with OpenCV)
    const boundingBox = this.calculateBoundingBox(polygon.points);
    const feretDiameterMax = Math.sqrt(
      Math.pow(boundingBox.width, 2) + Math.pow(boundingBox.height, 2)
    );
    let feretDiameterMin = Math.min(boundingBox.width, boundingBox.height);
    feretDiameterMin = Math.max(feretDiameterMin, Number.EPSILON);
    
    // Ensure safe division for aspect ratio
    const feretAspectRatio = feretDiameterMin > 0 ? feretDiameterMax / feretDiameterMin : 1;

    return {
      area,
      perimeter,
      equivalentDiameter,
      circularity,
      feretDiameterMax,
      feretDiameterMaxOrthogonalDistance: feretDiameterMin,
      feretDiameterMin,
      feretAspectRatio: isFinite(feretAspectRatio) ? feretAspectRatio : 1,
      lengthMajorDiameterThroughCentroid: feretDiameterMax,
      lengthMinorDiameterThroughCentroid: feretDiameterMin,
      compactness: circularity,
      convexity: 0.9, // Estimate
      solidity: 0.95, // Estimate
      sphericity: circularity * 0.8, // Estimate
    };
  }

  /**
   * Export metrics to Excel
   */
  async exportToExcel(
    metrics: PolygonMetrics[],
    outputPath: string
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Polygon Metrics');

    // Add headers
    worksheet.columns = [
      { header: 'Image Name', key: 'imageName', width: 20 },
      { header: 'Image ID', key: 'imageId', width: 15 },
      { header: 'Polygon ID', key: 'polygonId', width: 10 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Area (px²)', key: 'area', width: 12 },
      { header: 'Perimeter (px)', key: 'perimeter', width: 12 },
      { header: 'Equivalent Diameter (px)', key: 'equivalentDiameter', width: 18 },
      { header: 'Circularity', key: 'circularity', width: 10 },
      { header: 'Feret Diameter Max (px)', key: 'feretDiameterMax', width: 18 },
      { header: 'Feret Diameter Min (px)', key: 'feretDiameterMin', width: 18 },
      { header: 'Feret Aspect Ratio', key: 'feretAspectRatio', width: 15 },
      { header: 'Major Axis Length (px)', key: 'lengthMajorDiameter', width: 18 },
      { header: 'Minor Axis Length (px)', key: 'lengthMinorDiameter', width: 18 },
      { header: 'Compactness', key: 'compactness', width: 12 },
      { header: 'Convexity', key: 'convexity', width: 10 },
      { header: 'Solidity', key: 'solidity', width: 10 },
      { header: 'Sphericity', key: 'sphericity', width: 10 },
    ];

    // Add data rows with validation for finite values
    metrics.forEach(m => {
      // Helper function to ensure finite values
      const safeValue = (value: number, decimals: number = 2): number => {
        if (!isFinite(value)) {
          return 0;
        }
        return parseFloat(value.toFixed(decimals));
      };
      
      worksheet.addRow({
        imageName: m.imageName,
        imageId: m.imageId,
        polygonId: m.polygonId,
        type: m.type,
        area: safeValue(m.area, 2),
        perimeter: safeValue(m.perimeter, 2),
        equivalentDiameter: safeValue(m.equivalentDiameter, 2),
        circularity: safeValue(m.circularity, 4),
        feretDiameterMax: safeValue(m.feretDiameterMax, 2),
        feretDiameterMin: safeValue(m.feretDiameterMin, 2),
        feretAspectRatio: safeValue(m.feretAspectRatio, 2),
        lengthMajorDiameter: safeValue(m.lengthMajorDiameterThroughCentroid, 2),
        lengthMinorDiameter: safeValue(m.lengthMinorDiameterThroughCentroid, 2),
        compactness: safeValue(m.compactness, 4),
        convexity: safeValue(m.convexity, 4),
        solidity: safeValue(m.solidity, 4),
        sphericity: safeValue(m.sphericity, 4),
      });
    });

    // Style the header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    const summaryData = this.generateSummaryStatistics(metrics);
    
    // Add summary data to the sheet
    summaryData.forEach((row, index) => {
      const excelRow = summarySheet.addRow(row);
      // Bold the header row
      if (index === 0) {
        excelRow.font = { bold: true };
        excelRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
      }
    });

    // Auto-fit columns in summary sheet
    summarySheet.columns.forEach(column => {
      column.width = 20;
    });

    // Create parent directory if it doesn't exist
    const parentDir = path.dirname(outputPath);
    await fs.mkdir(parentDir, { recursive: true });
    
    // Write file
    await workbook.xlsx.writeFile(outputPath);
    this.logger.info(`Excel file created: ${outputPath}`, 'MetricsCalculator');
  }

  /**
   * Export metrics to CSV
   */
  async exportToCSV(
    metrics: PolygonMetrics[],
    outputPath: string
  ): Promise<void> {
    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'imageName', title: 'Image Name' },
        { id: 'imageId', title: 'Image ID' },
        { id: 'polygonId', title: 'Polygon ID' },
        { id: 'type', title: 'Type' },
        { id: 'area', title: 'Area (px²)' },
        { id: 'perimeter', title: 'Perimeter (px)' },
        { id: 'equivalentDiameter', title: 'Equivalent Diameter (px)' },
        { id: 'circularity', title: 'Circularity' },
        { id: 'feretDiameterMax', title: 'Feret Diameter Max (px)' },
        { id: 'feretDiameterMin', title: 'Feret Diameter Min (px)' },
        { id: 'feretAspectRatio', title: 'Feret Aspect Ratio' },
        { id: 'compactness', title: 'Compactness' },
        { id: 'convexity', title: 'Convexity' },
        { id: 'solidity', title: 'Solidity' },
        { id: 'sphericity', title: 'Sphericity' },
      ],
    });

    const header = csvStringifier.getHeaderString();
    const records = csvStringifier.stringifyRecords(metrics);

    // Create parent directory if it doesn't exist
    const parentDir = path.dirname(outputPath);
    await fs.mkdir(parentDir, { recursive: true });
    
    await fs.writeFile(outputPath, header + records);
    this.logger.info(`CSV file created: ${outputPath}`, 'MetricsCalculator');
  }

  /**
   * Generate summary statistics for metrics
   */
  private generateSummaryStatistics(metrics: PolygonMetrics[]): SummaryStatisticsRow[] {
    const externalMetrics = metrics.filter(m => m.type === 'external');
    
    if (externalMetrics.length === 0) {
      return [['No external polygons found']];
    }

    const stats = {
      count: externalMetrics.length,
      avgArea: this.average(externalMetrics.map(m => m.area)),
      minArea: Math.min(...externalMetrics.map(m => m.area)),
      maxArea: Math.max(...externalMetrics.map(m => m.area)),
      avgPerimeter: this.average(externalMetrics.map(m => m.perimeter)),
      avgCircularity: this.average(externalMetrics.map(m => m.circularity)),
      avgSphericity: this.average(externalMetrics.map(m => m.sphericity)),
    };

    return [
      ['Summary Statistics'],
      [''],
      ['Metric', 'Value'],
      ['Total External Polygons', stats.count],
      ['Average Area (px²)', stats.avgArea.toFixed(2)],
      ['Minimum Area (px²)', stats.minArea.toFixed(2)],
      ['Maximum Area (px²)', stats.maxArea.toFixed(2)],
      ['Average Perimeter (px)', stats.avgPerimeter.toFixed(2)],
      ['Average Circularity', stats.avgCircularity.toFixed(4)],
      ['Average Sphericity', stats.avgSphericity.toFixed(4)],
    ];
  }

  private average(numbers: number[]): number {
    if (!numbers || numbers.length === 0) {
      return 0;
    }
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }

  private calculatePolygonArea(points: Point[]): number {
    if (!points || points.length < 3) {
      return 0;
    }

    let area = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const currentPoint = points[i];
      const nextPoint = points[j];
      
      if (!currentPoint || !nextPoint || 
          typeof currentPoint.x !== 'number' || typeof currentPoint.y !== 'number' ||
          typeof nextPoint.x !== 'number' || typeof nextPoint.y !== 'number') {
        continue;
      }
      
      area += currentPoint.x * nextPoint.y;
      area -= nextPoint.x * currentPoint.y;
    }

    return Math.abs(area / 2);
  }

  private calculatePerimeter(points: Point[]): number {
    if (!points || points.length < 2) {
      return 0;
    }

    let perimeter = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const currentPoint = points[i];
      const nextPoint = points[j];
      
      if (!currentPoint || !nextPoint || 
          typeof currentPoint.x !== 'number' || typeof currentPoint.y !== 'number' ||
          typeof nextPoint.x !== 'number' || typeof nextPoint.y !== 'number') {
        continue;
      }
      
      const dx = nextPoint.x - currentPoint.x;
      const dy = nextPoint.y - currentPoint.y;
      perimeter += Math.sqrt(dx * dx + dy * dy);
    }

    return perimeter;
  }

  private calculateBoundingBox(points: Point[]): { width: number; height: number } {
    if (!points || points.length === 0) {
      return { width: 0, height: 0 };
    }

    const xs = points.filter(p => p && typeof p.x === 'number').map(p => p.x);
    const ys = points.filter(p => p && typeof p.y === 'number').map(p => p.y);
    
    if (xs.length === 0 || ys.length === 0) {
      return { width: 0, height: 0 };
    }
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    
    return {
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  /**
   * Check if a point is inside a polygon using ray-casting algorithm
   */
  private isPointInPolygon(point: Point, polygon: Polygon): boolean {
    if (!polygon?.points || polygon.points.length < 3) {
      return false;
    }

    const { x, y } = point;
    const points = polygon.points;
    let inside = false;

    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i]?.x || 0;
      const yi = points[i]?.y || 0;
      const xj = points[j]?.x || 0;
      const yj = points[j]?.y || 0;

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * Check if inner polygon is completely inside outer polygon
   * Uses centroid test - checks if centroid of inner polygon is inside outer polygon
   */
  private isPolygonInside(inner: Polygon, outer: Polygon): boolean {
    if (!inner?.points || !outer?.points || inner.points.length === 0 || outer.points.length === 0) {
      return false;
    }

    // Calculate centroid of inner polygon
    const centroid = this.calculateCentroid(inner.points);
    
    // Check if centroid is inside outer polygon
    return this.isPointInPolygon(centroid, outer);
  }

  /**
   * Calculate centroid of a polygon
   */
  private calculateCentroid(points: Point[]): Point {
    if (!points || points.length === 0) {
      return { x: 0, y: 0 };
    }

    let cx = 0;
    let cy = 0;
    let area = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const currentPoint = points[i];
      const nextPoint = points[j];
      
      if (!currentPoint || !nextPoint || 
          typeof currentPoint.x !== 'number' || typeof currentPoint.y !== 'number' ||
          typeof nextPoint.x !== 'number' || typeof nextPoint.y !== 'number') {
        continue;
      }
      
      const cross = currentPoint.x * nextPoint.y - nextPoint.x * currentPoint.y;
      area += cross;
      cx += (currentPoint.x + nextPoint.x) * cross;
      cy += (currentPoint.y + nextPoint.y) * cross;
    }

    area *= 0.5;
    if (Math.abs(area) < Number.EPSILON) {
      // Fallback to simple average for degenerate cases
      const avgX = points.reduce((sum, p) => sum + (p?.x || 0), 0) / points.length;
      const avgY = points.reduce((sum, p) => sum + (p?.y || 0), 0) / points.length;
      return { x: avgX, y: avgY };
    }

    cx /= (6 * area);
    cy /= (6 * area);

    return { x: cx, y: cy };
  }
}