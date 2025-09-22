import axios, { AxiosInstance } from 'axios';
import ExcelJS from 'exceljs';
import { createObjectCsvStringifier } from 'csv-writer';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';
import { logger } from '../../utils/logger';
import { config } from '../../utils/config';
import { /* SCALE_CONFIG, */ validateScale, /* getScaleValidationMessage, getScaleWarningMessage */ } from './scaleConfig';

export interface PolygonMetrics {
  imageId: string;
  imageName: string;
  polygonId: number;
  type: 'external' | 'internal';
  area: number;
  perimeter: number;
  perimeterWithHoles: number;
  equivalentDiameter: number;
  circularity: number;
  feretDiameterMax: number;
  feretDiameterMaxOrthogonalDistance: number;
  feretDiameterMin: number;
  feretAspectRatio: number;
  lengthMajorDiameterThroughCentroid: number;
  lengthMinorDiameterThroughCentroid: number;
  boundingBoxWidth: number;
  boundingBoxHeight: number;
  extent: number;
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
   * Calculate metrics for all images with performance monitoring
   */
  async calculateAllMetrics(images: ImageWithSegmentation[], pixelToMicrometerScale?: number): Promise<PolygonMetrics[]> {
    const startTime = Date.now();
    const allMetrics: PolygonMetrics[] = [];
    let totalPolygonCount = 0;

    // Performance thresholds
    const WARN_POLYGON_COUNT = 1000;
    const ERROR_POLYGON_COUNT = 5000;
    const WARN_CALC_TIME_MS = 5000;
    const ERROR_CALC_TIME_MS = 30000;

    for (let imageIdx = 0; imageIdx < images.length; imageIdx++) {
      const image = images[imageIdx];
      
      if (image && image.segmentation?.polygons) {
        const result = image.segmentation;
        if (result.polygons) {
          try {
            const polygons = JSON.parse(result.polygons);
            totalPolygonCount += polygons.length;
            
            const imageMetrics = await this.calculateImageMetrics(
              polygons,
              image.id,
              image.name
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

    // Calculate performance metrics
    const calcTime = Date.now() - startTime;
    
    // Check thresholds and log warnings
    if (totalPolygonCount > ERROR_POLYGON_COUNT) {
      this.logger.error(
        `Polygon count (${totalPolygonCount}) exceeds error threshold (${ERROR_POLYGON_COUNT})`,
        new Error('Too many polygons for metrics calculation'),
        'MetricsCalculator'
      );
    } else if (totalPolygonCount > WARN_POLYGON_COUNT) {
      this.logger.warn(
        `High polygon count in metrics calculation: ${totalPolygonCount} polygons`,
        'MetricsCalculator'
      );
    }

    if (calcTime > ERROR_CALC_TIME_MS) {
      this.logger.error(
        `Metrics calculation time (${calcTime}ms) exceeds error threshold (${ERROR_CALC_TIME_MS}ms)`,
        new Error('Metrics calculation timeout'),
        'MetricsCalculator'
      );
    } else if (calcTime > WARN_CALC_TIME_MS) {
      this.logger.warn(
        `Slow metrics calculation: ${calcTime}ms for ${totalPolygonCount} polygons across ${images.length} images`,
        'MetricsCalculator'
      );
    }

    // Log performance summary
    const polygonsPerSec = calcTime > 0 
      ? (totalPolygonCount / (calcTime / 1000)).toFixed(0) 
      : 'N/A';
    this.logger.info(
      `Metrics calculated: ${totalPolygonCount} polygons across ${images.length} images in ${calcTime}ms (${polygonsPerSec} polygons/sec)`,
      'MetricsCalculator'
    );

    // Apply scale conversion if provided
    if (pixelToMicrometerScale) {
      if (pixelToMicrometerScale <= 0 || !isFinite(pixelToMicrometerScale)) {
        this.logger.warn(
          `Invalid scale value: ${pixelToMicrometerScale}. Scale must be greater than 0. Using pixel units instead.`,
          'MetricsCalculator'
        );
        // Continue with pixel units (don't apply scale)
        return allMetrics;
      }
      return this.applyScaleConversion(allMetrics, pixelToMicrometerScale);
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
        'Area', 'Perimeter', 'PerimeterWithHoles', 'EquivalentDiameter', 'Circularity',
        'FeretDiameterMax', 'FeretDiameterMaxOrthogonalDistance', 'FeretDiameterMin',
        'FeretAspectRatio', 'LengthMajorDiameterThroughCentroid', 'LengthMinorDiameterThroughCentroid',
        'BoundingBoxWidth', 'BoundingBoxHeight', 'Extent', 'Compactness', 'Convexity', 'Solidity', 'Sphericity'
      ];
      
      const missingKeys = requiredKeys.filter(key => !(key in response.data));
      if (missingKeys.length > 0) {
        throw new Error(`Missing required metric keys in response: ${missingKeys.join(', ')}`);
      }

      return {
        area: response.data.Area,
        perimeter: response.data.Perimeter,
        perimeterWithHoles: response.data.PerimeterWithHoles,
        equivalentDiameter: response.data.EquivalentDiameter,
        circularity: response.data.Circularity,
        feretDiameterMax: response.data.FeretDiameterMax,
        feretDiameterMaxOrthogonalDistance: response.data.FeretDiameterMaxOrthogonalDistance,
        feretDiameterMin: response.data.FeretDiameterMin,
        feretAspectRatio: response.data.FeretAspectRatio,
        lengthMajorDiameterThroughCentroid: response.data.LengthMajorDiameterThroughCentroid,
        lengthMinorDiameterThroughCentroid: response.data.LengthMinorDiameterThroughCentroid,
        boundingBoxWidth: response.data.BoundingBoxWidth,
        boundingBoxHeight: response.data.BoundingBoxHeight,
        extent: response.data.Extent,
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

    // Calculate main polygon area using Shoelace formula
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
    let area = Math.max(0, mainArea - holesArea);

    // Calculate perimeter of external boundary only
    const externalPerimeter = this.calculatePerimeter(polygon.points);

    // Calculate perimeter with holes (external + all hole perimeters)
    const holesPerimeter = holes.reduce(
      (sum, hole) => {
        if (!hole?.points || hole.points.length === 0) {
          return sum; // Skip invalid holes
        }
        return sum + this.calculatePerimeter(hole.points);
      },
      0
    );
    const perimeterWithHoles = externalPerimeter + holesPerimeter;

    // Add geometric value guards - clamp to safe ranges
    area = Math.max(0, area);
    const perimeter = Math.max(externalPerimeter, Number.EPSILON);

    // Calculate bounding box for extent calculation
    const boundingBox = this.calculateBoundingBox(polygon.points);
    const boundingBoxArea = boundingBox.width * boundingBox.height;

    // Calculate circularity: 4*pi * area / perimeter^2 (clamped to [0,1])
    const circularity = perimeter > 0
      ? Math.min(1.0, (4 * Math.PI * area) / (perimeter * perimeter))
      : 0;

    // Calculate compactness: P^2/(4*pi*A) - reciprocal of circularity
    const compactness = area > 0
      ? (perimeter * perimeter) / (4 * Math.PI * area)
      : 0;

    // Calculate extent: Area/(BBox.width * BBox.height)
    const extent = boundingBoxArea > 0 ? area / boundingBoxArea : 0;

    // Calculate equivalent diameter: diameter of circle with same area
    const equivalentDiameter = Math.sqrt((4 * area) / Math.PI);

    // Calculate convex hull for convexity, solidity, and proper Feret diameters
    const convexHull = this.calculateConvexHull(polygon.points);
    const convexArea = this.calculatePolygonArea(convexHull);
    const convexPerimeter = this.calculatePerimeter(convexHull);

    // Convexity: perimeter of convex hull / perimeter of polygon
    const convexity = perimeter > 0 ? convexPerimeter / perimeter : 0;

    // Solidity: area of polygon / area of convex hull
    const solidity = convexArea > 0 ? area / convexArea : 0;

    // Calculate proper Feret diameters using rotating calipers
    const feretDiameters = this.rotatingCalipers(convexHull);

    // Ensure safe division for aspect ratio
    const feretAspectRatio = feretDiameters.min > 0
      ? feretDiameters.max / feretDiameters.min
      : 0;

    return {
      area,
      perimeter,
      perimeterWithHoles,
      equivalentDiameter,
      circularity,
      feretDiameterMax: feretDiameters.max,
      feretDiameterMaxOrthogonalDistance: feretDiameters.orthogonal,
      feretDiameterMin: feretDiameters.min,
      feretAspectRatio: isFinite(feretAspectRatio) ? feretAspectRatio : 0,
      lengthMajorDiameterThroughCentroid: feretDiameters.max,
      lengthMinorDiameterThroughCentroid: feretDiameters.min,
      boundingBoxWidth: boundingBox.width,
      boundingBoxHeight: boundingBox.height,
      extent,
      compactness,
      convexity,
      solidity,
      sphericity: circularity * 0.8, // Estimate for 3D-like sphericity
    };
  }

  /**
   * Export metrics to Excel
   */
  async exportToExcel(
    metrics: PolygonMetrics[],
    outputPath: string,
    pixelToMicrometerScale?: number
  ): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Polygon Metrics');

    // Determine units based on scale
    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    // Add headers
    worksheet.columns = [
      { header: 'Image Name', key: 'imageName', width: 20 },
      { header: 'Image ID', key: 'imageId', width: 15 },
      { header: 'Polygon ID', key: 'polygonId', width: 10 },
      { header: 'Type', key: 'type', width: 10 },
      { header: `Area (${areaUnit})`, key: 'area', width: 12 },
      { header: `Perimeter (${lengthUnit})`, key: 'perimeter', width: 12 },
      { header: `Perimeter with Holes (${lengthUnit})`, key: 'perimeterWithHoles', width: 20 },
      { header: `Equivalent Diameter (${lengthUnit})`, key: 'equivalentDiameter', width: 18 },
      { header: 'Circularity', key: 'circularity', width: 10 },
      { header: `Feret Diameter Max (${lengthUnit})`, key: 'feretDiameterMax', width: 18 },
      { header: `Feret Diameter Min (${lengthUnit})`, key: 'feretDiameterMin', width: 18 },
      { header: `Feret Diameter Orthogonal (${lengthUnit})`, key: 'feretDiameterOrthogonal', width: 22 },
      { header: 'Feret Aspect Ratio', key: 'feretAspectRatio', width: 15 },
      { header: `Major Axis Length (${lengthUnit})`, key: 'lengthMajorDiameter', width: 18 },
      { header: `Minor Axis Length (${lengthUnit})`, key: 'lengthMinorDiameter', width: 18 },
      { header: `Bounding Box Width (${lengthUnit})`, key: 'boundingBoxWidth', width: 20 },
      { header: `Bounding Box Height (${lengthUnit})`, key: 'boundingBoxHeight', width: 20 },
      { header: 'Extent', key: 'extent', width: 10 },
      { header: 'Compactness', key: 'compactness', width: 12 },
      { header: 'Convexity', key: 'convexity', width: 10 },
      { header: 'Solidity', key: 'solidity', width: 10 },
      { header: 'Sphericity', key: 'sphericity', width: 10 },
    ];

    // Add data rows with validation for finite values
    metrics.forEach(m => {
      // Helper function to ensure finite values
      const safeValue = (value: number, decimals = 2): number => {
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
        perimeterWithHoles: safeValue(m.perimeterWithHoles, 2),
        equivalentDiameter: safeValue(m.equivalentDiameter, 2),
        circularity: safeValue(m.circularity, 4),
        feretDiameterMax: safeValue(m.feretDiameterMax, 2),
        feretDiameterMin: safeValue(m.feretDiameterMin, 2),
        feretDiameterOrthogonal: safeValue(m.feretDiameterMaxOrthogonalDistance, 2),
        feretAspectRatio: safeValue(m.feretAspectRatio, 2),
        lengthMajorDiameter: safeValue(m.lengthMajorDiameterThroughCentroid, 2),
        lengthMinorDiameter: safeValue(m.lengthMinorDiameterThroughCentroid, 2),
        boundingBoxWidth: safeValue(m.boundingBoxWidth, 2),
        boundingBoxHeight: safeValue(m.boundingBoxHeight, 2),
        extent: safeValue(m.extent, 4),
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
    const summaryData = this.generateSummaryStatistics(metrics, pixelToMicrometerScale);
    
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
    outputPath: string,
    pixelToMicrometerScale?: number
  ): Promise<void> {
    // Determine units based on scale
    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'imageName', title: 'Image Name' },
        { id: 'imageId', title: 'Image ID' },
        { id: 'polygonId', title: 'Polygon ID' },
        { id: 'type', title: 'Type' },
        { id: 'area', title: `Area (${areaUnit})` },
        { id: 'perimeter', title: `Perimeter (${lengthUnit})` },
        { id: 'perimeterWithHoles', title: `Perimeter with Holes (${lengthUnit})` },
        { id: 'equivalentDiameter', title: `Equivalent Diameter (${lengthUnit})` },
        { id: 'circularity', title: 'Circularity' },
        { id: 'feretDiameterMax', title: `Feret Diameter Max (${lengthUnit})` },
        { id: 'feretDiameterMin', title: `Feret Diameter Min (${lengthUnit})` },
        { id: 'feretDiameterMaxOrthogonalDistance', title: `Feret Diameter Orthogonal (${lengthUnit})` },
        { id: 'feretAspectRatio', title: 'Feret Aspect Ratio' },
        { id: 'lengthMajorDiameterThroughCentroid', title: `Major Axis Length (${lengthUnit})` },
        { id: 'lengthMinorDiameterThroughCentroid', title: `Minor Axis Length (${lengthUnit})` },
        { id: 'boundingBoxWidth', title: `Bounding Box Width (${lengthUnit})` },
        { id: 'boundingBoxHeight', title: `Bounding Box Height (${lengthUnit})` },
        { id: 'extent', title: 'Extent' },
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
  private generateSummaryStatistics(metrics: PolygonMetrics[], pixelToMicrometerScale?: number): SummaryStatisticsRow[] {
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
      avgCompactness: this.average(externalMetrics.map(m => m.compactness)),
      avgExtent: this.average(externalMetrics.map(m => m.extent)),
      avgSolidity: this.average(externalMetrics.map(m => m.solidity)),
      avgSphericity: this.average(externalMetrics.map(m => m.sphericity)),
    };

    // Determine units based on scale
    const isScaled = pixelToMicrometerScale && pixelToMicrometerScale > 0;
    const areaUnit = isScaled ? 'um^2' : 'px^2';
    const lengthUnit = isScaled ? 'um' : 'px';

    return [
      ['Summary Statistics'],
      [''],
      ['Metric', 'Value'],
      ['Total External Polygons', stats.count],
      [`Average Area (${areaUnit})`, stats.avgArea.toFixed(2)],
      [`Minimum Area (${areaUnit})`, stats.minArea.toFixed(2)],
      [`Maximum Area (${areaUnit})`, stats.maxArea.toFixed(2)],
      [`Average Perimeter (${lengthUnit})`, stats.avgPerimeter.toFixed(2)],
      ['Average Circularity', stats.avgCircularity.toFixed(4)],
      ['Average Compactness', stats.avgCompactness.toFixed(4)],
      ['Average Extent', stats.avgExtent.toFixed(4)],
      ['Average Solidity', stats.avgSolidity.toFixed(4)],
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
   * Calculate convex hull using Graham scan algorithm
   */
  private calculateConvexHull(points: Point[]): Point[] {
    if (points.length < 3) {return points;}

    // Sort points by x-coordinate, then by y-coordinate
    const sortedPoints = [...points].sort((a, b) => {
      if (a.x === b.x) {return a.y - b.y;}
      return a.x - b.x;
    });

    // Build lower hull
    const lower: Point[] = [];
    for (const point of sortedPoints) {
      while (
        lower.length >= 2 &&
        this.cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
      ) {
        lower.pop();
      }
      lower.push(point);
    }

    // Build upper hull
    const upper: Point[] = [];
    for (let i = sortedPoints.length - 1; i >= 0; i--) {
      const point = sortedPoints[i];
      while (
        upper.length >= 2 &&
        this.cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
      ) {
        upper.pop();
      }
      upper.push(point);
    }

    // Remove last point of each half because it's repeated
    lower.pop();
    upper.pop();

    return lower.concat(upper);
  }

  /**
   * Calculate cross product for convex hull algorithm
   */
  private cross(o: Point, a: Point, b: Point): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  /**
   * Calculate distance between two points
   */
  private distance(p1: Point, p2: Point): number {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate the distance from a point to a line defined by two points
   */
  private pointToLineDistance(
    point: Point,
    lineStart: Point,
    lineEnd: Point
  ): number {
    const A = point.x - lineStart.x;
    const B = point.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;

    if (lenSq === 0) {return this.distance(point, lineStart);}

    const param = dot / lenSq;

    let xx: number, yy: number;

    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }

    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Rotating calipers algorithm to find Feret diameters
   * Returns max, min, and orthogonal Feret diameters
   */
  private rotatingCalipers(hull: Point[]): {
    max: number;
    min: number;
    orthogonal: number;
  } {
    if (hull.length < 3) {
      return { max: 0, min: 0, orthogonal: 0 };
    }

    let maxDist = 0;
    let minDist = Infinity;
    let orthogonalDist = 0;
    let maxPair: [Point, Point] | null = null;

    // Find maximum Feret diameter (max distance between any two hull points)
    for (let i = 0; i < hull.length; i++) {
      for (let j = i + 1; j < hull.length; j++) {
        const dist = this.distance(hull[i], hull[j]);
        if (dist > maxDist) {
          maxDist = dist;
          maxPair = [hull[i], hull[j]];
        }
      }
    }

    // Find minimum Feret diameter (min caliper width)
    // For each edge of the hull, find the furthest point from that edge
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length;
      let maxDistFromEdge = 0;

      // Find the furthest point from this edge
      for (let k = 0; k < hull.length; k++) {
        if (k === i || k === j) {continue;}
        const dist = this.pointToLineDistance(hull[k], hull[i], hull[j]);
        maxDistFromEdge = Math.max(maxDistFromEdge, dist);
      }

      // The caliper width for this orientation is the distance to the furthest point
      if (maxDistFromEdge > 0 && maxDistFromEdge < minDist) {
        minDist = maxDistFromEdge;
      }
    }

    // Find orthogonal Feret diameter
    // This is the width perpendicular to the maximum Feret diameter
    if (maxPair) {
      const [p1, p2] = maxPair;
      let maxOrthDist = 0;

      // Find the maximum perpendicular distance from the max Feret line
      for (const point of hull) {
        const dist = this.pointToLineDistance(point, p1, p2);
        maxOrthDist = Math.max(maxOrthDist, dist);
      }

      orthogonalDist = maxOrthDist * 2; // Width is twice the max distance from centerline
    }

    // Handle edge cases
    if (minDist === Infinity) {
      // Fallback for degenerate cases
      minDist = maxDist;
    }

    return {
      max: maxDist,
      min: minDist,
      orthogonal: orthogonalDist,
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

  /**
   * Apply scale conversion to metrics with enhanced validation
   */
  private applyScaleConversion(metrics: PolygonMetrics[], scale: number): PolygonMetrics[] {
    // Validate scale using enhanced validation
    const validation = validateScale(scale);
    
    if (!validation.valid) {
      this.logger.error(validation.error || 'Invalid scale value', new Error('Scale validation failed'), 'MetricsCalculator');
      this.logger.info('Falling back to pixel units due to invalid scale', 'MetricsCalculator');
      return metrics;
    }
    
    if (validation.warning) {
      this.logger.warn(validation.warning, 'MetricsCalculator');
      
      // Log additional context for debugging
      this.logger.info(
        `Scale conversion will proceed with ${scale} um/pixel. ` +
        `This will convert: 1 pixel = ${scale.toFixed(4)} um, ` +
        `100x100 px area = ${(10000 * scale * scale).toFixed(2)} um^2`,
        'MetricsCalculator'
      );
    } else {
      // Log normal scale application for valid common values
      this.logger.info(
        `Applying scale conversion: ${scale} um/pixel (1 pixel = ${scale.toFixed(4)} um)`,
        'MetricsCalculator'
      );
    }
    
    return metrics.map(metric => ({
      ...metric,
      // Convert area from px^2 to um^2 (multiply by scale^2)
      area: metric.area * (scale * scale),
      // Convert linear measurements from px to um (multiply by scale)
      perimeter: metric.perimeter * scale,
      perimeterWithHoles: metric.perimeterWithHoles * scale,
      equivalentDiameter: metric.equivalentDiameter * scale,
      feretDiameterMax: metric.feretDiameterMax * scale,
      feretDiameterMaxOrthogonalDistance: metric.feretDiameterMaxOrthogonalDistance * scale,
      feretDiameterMin: metric.feretDiameterMin * scale,
      lengthMajorDiameterThroughCentroid: metric.lengthMajorDiameterThroughCentroid * scale,
      lengthMinorDiameterThroughCentroid: metric.lengthMinorDiameterThroughCentroid * scale,
      boundingBoxWidth: metric.boundingBoxWidth * scale,
      boundingBoxHeight: metric.boundingBoxHeight * scale,
      // Dimensionless ratios remain unchanged
      circularity: metric.circularity,
      feretAspectRatio: metric.feretAspectRatio,
      extent: metric.extent,
      compactness: metric.compactness,
      convexity: metric.convexity,
      solidity: metric.solidity,
      sphericity: metric.sphericity,
    }));
  }
}