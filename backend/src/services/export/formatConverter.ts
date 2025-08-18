import { logger } from '../../utils/logger';

export interface Point {
  x: number;
  y: number;
}

export interface Polygon {
  points: Point[];
  type: 'external' | 'internal';
  id?: string;
}

export interface SegmentationResult {
  polygons: string; // JSON string of Polygon[]
  cellCount?: number;
  timestamp?: Date;
}

export interface ImageData {
  id: string;
  filename: string;
  width: number;
  height: number;
  segmentationResults?: SegmentationResult[];
}

// COCO Format Types
export interface COCOImage {
  id: number;
  file_name: string;
  width: number;
  height: number;
  date_captured: string;
}

export interface COCOAnnotation {
  id: number;
  image_id: number;
  category_id: number;
  segmentation: number[][] | { size: [number, number]; counts: number[] };
  bbox: [number, number, number, number];
  area: number;
  iscrowd: number;
  attributes?: {
    type: string;
    has_holes: boolean;
  };
}

export interface COCOCategory {
  id: number;
  name: string;
  supercategory: string;
  color: [number, number, number];
}

export interface COCOLicense {
  id: number;
  name: string;
  url: string;
}

export interface COCOFormat {
  info: {
    description: string;
    version: string;
    year: number;
    contributor: string;
    date_created: string;
  };
  images: COCOImage[];
  annotations: COCOAnnotation[];
  categories: COCOCategory[];
  licenses: COCOLicense[];
}

// Custom JSON Export Types
export interface JSONPolygonData {
  id: number;
  points: Point[];
  area: number;
  perimeter: number;
  boundingBox?: [number, number, number, number];
  centroid?: Point;
}

export interface JSONSegmentationData {
  cellCount: number;
  timestamp?: Date;
  polygons: {
    external: JSONPolygonData[];
    internal: JSONPolygonData[];
  };
  statistics: {
    totalExternalPolygons: number;
    totalInternalPolygons: number;
    totalArea: number;
  };
}

export interface JSONImageData {
  id: string;
  index: number;
  filename: string;
  dimensions: {
    width: number;
    height: number;
  };
  segmentation: JSONSegmentationData | null;
}

export interface JSONExportFormat {
  metadata: {
    version: string;
    created: string;
    imageCount: number;
    format: string;
  };
  images: JSONImageData[];
}

// RLE Format Type
export interface RLEFormat {
  size: [number, number];
  counts: number[];
}

export class FormatConverter {
  /**
   * Convert to COCO format
   */
  async convertToCOCO(images: ImageData[]): Promise<COCOFormat> {
    const annotations: COCOAnnotation[] = [];
    const imagesList: COCOImage[] = [];
    let annotationId = 1;

    for (let imageIdx = 0; imageIdx < images.length; imageIdx++) {
      const image = images[imageIdx];
      if (!image) {
        continue;
      }
      
      // Add image to COCO images list - preserve original filename
      imagesList.push({
        id: imageIdx + 1,
        file_name: image.filename || `image_${String(imageIdx + 1).padStart(3, '0')}.jpg`,
        width: image.width || 800,
        height: image.height || 600,
        date_captured: new Date().toISOString(),
      });

      // Process segmentation results
      if (image.segmentationResults && image.segmentationResults.length > 0) {
        const result = image.segmentationResults[0];
        if (result?.polygons) {
          let polygons;
          try {
            polygons = JSON.parse(result.polygons);
          } catch (error) {
            logger.error('Failed to parse polygons JSON for COCO format', 
              error instanceof Error ? error : new Error('Unknown error'),
              'FormatConverter',
              { 
                imageId: image.id, 
                polygonsData: result.polygons ? result.polygons.substring(0, 100) + '...' : 'undefined'
              }
            );
            polygons = [];
          }
          
          // Process external polygons
          const externalPolygons = polygons.filter((p: Polygon) => p.type === 'external');
          const internalPolygons = polygons.filter((p: Polygon) => p.type === 'internal');

          for (const polygon of externalPolygons) {
            // Find internal polygons that belong to this external polygon
            // (simplified - in real scenario, you'd check spatial containment)
            const associatedInternalPolygons = internalPolygons.filter((internal: Polygon) => 
              this.isPolygonInsidePolygon(internal.points, polygon.points)
            );

            // Calculate bounding box
            const bbox = this.calculateBoundingBox(polygon.points);

            // Calculate area (accounting for holes)
            const area = this.calculatePolygonArea(polygon.points) -
              associatedInternalPolygons.reduce((sum: number, internal: Polygon) => 
                sum + this.calculatePolygonArea(internal.points), 0);

            let segmentation: number[][] | RLEFormat;

            if (associatedInternalPolygons.length > 0) {
              // Create binary mask for polygon with holes
              const mask = this.createBinaryMask(
                polygon.points,
                associatedInternalPolygons.map((p: Polygon) => p.points),
                image.width || 800,
                image.height || 600
              );

              // Encode mask to COCO RLE format
              const rle = this.encodeMaskToRLE(mask, image.width || 800, image.height || 600);
              segmentation = rle;
            } else {
              // Simple polygon without holes - use polygon format
              segmentation = [
                polygon.points.reduce((acc: number[], point: Point) => {
                  acc.push(point.x, point.y);
                  return acc;
                }, [])
              ];
            }

            annotations.push({
              id: annotationId++,
              image_id: imageIdx + 1,
              category_id: 1, // Cell/spheroid category
              segmentation,
              bbox,
              area,
              iscrowd: associatedInternalPolygons.length > 0 ? 1 : 0, // iscrowd=1 for RLE format
              attributes: {
                type: 'external',
                has_holes: associatedInternalPolygons.length > 0,
              }
            });
          }
        }
      }
    }

    // Create COCO format object
    const cocoData = {
      info: {
        description: 'Cell Segmentation Dataset',
        version: '1.0',
        year: new Date().getFullYear(),
        contributor: 'Cell Segmentation Hub',
        date_created: new Date().toISOString(),
      },
      images: imagesList,
      annotations,
      categories: [
        {
          id: 1,
          name: 'cell',
          supercategory: 'biological',
          color: [0, 255, 0] as [number, number, number],
        }
      ],
      licenses: [
        {
          id: 1,
          name: 'Internal Use',
          url: '',
        }
      ],
    };

    return cocoData;
  }

  /**
   * Convert to YOLO format (returns string content for text file)
   */
  async convertToYOLO(
    polygonsJson: string,
    imageWidth: number,
    imageHeight: number
  ): Promise<string> {
    let polygons;
    try {
      polygons = JSON.parse(polygonsJson);
      if (!Array.isArray(polygons)) {
        throw new Error('Parsed polygons is not an array');
      }
    } catch (error) {
      logger.error('Failed to parse polygons JSON for YOLO format', 
        error instanceof Error ? error : new Error('Unknown error'),
        'FormatConverter',
        { 
          polygonsData: polygonsJson ? polygonsJson.substring(0, 100) + '...' : 'undefined'
        }
      );
      throw new Error(`Invalid polygon data format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    const lines: string[] = [];

    // Filter external polygons only for YOLO
    const externalPolygons = polygons.filter((p: Polygon) => p.type === 'external');

    for (const polygon of externalPolygons) {
      // Calculate bounding box
      const bbox = this.calculateBoundingBox(polygon.points);
      
      // Normalize coordinates for YOLO (0-1 range)
      const x_center = (bbox[0] + bbox[2] / 2) / imageWidth;
      const y_center = (bbox[1] + bbox[3] / 2) / imageHeight;
      const width = bbox[2] / imageWidth;
      const height = bbox[3] / imageHeight;

      // YOLO format: class_id x_center y_center width height
      // Using class_id 0 for cells
      lines.push(`0 ${x_center.toFixed(6)} ${y_center.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`);

      // Optionally add polygon coordinates (YOLO segmentation format)
      // Format: class_id x1 y1 x2 y2 ... xn yn
      const segmentationPoints = polygon.points
        .map((p: Point) => `${(p.x / imageWidth).toFixed(6)} ${(p.y / imageHeight).toFixed(6)}`)
        .join(' ');
      
      lines.push(`# Segmentation: 0 ${segmentationPoints}`);
    }

    return lines.join('\n');
  }

  /**
   * Convert to custom JSON format
   */
  async convertToJSON(images: ImageData[]): Promise<JSONExportFormat> {
    const exportData: JSONExportFormat = {
      metadata: {
        version: '1.0',
        created: new Date().toISOString(),
        imageCount: images.length,
        format: 'custom_json',
      },
      images: [],
    };

    for (let imageIdx = 0; imageIdx < images.length; imageIdx++) {
      const image = images[imageIdx];
      if (!image) {
        continue;
      }
      
      const imageData: JSONImageData = {
        id: image.id,
        index: imageIdx + 1,
        filename: image.filename || `image_${String(imageIdx + 1).padStart(3, '0')}.jpg`,
        dimensions: {
          width: image.width || 800,
          height: image.height || 600,
        },
        segmentation: null,
      };

      // Process segmentation results
      if (image.segmentationResults && image.segmentationResults.length > 0) {
        const result = image.segmentationResults[0];
        if (result?.polygons) {
          let polygons;
          try {
            polygons = JSON.parse(result.polygons);
          } catch (error) {
            logger.error('Failed to parse polygons JSON for custom JSON format', 
              error instanceof Error ? error : new Error('Unknown error'),
              'FormatConverter',
              { 
                polygonsData: result?.polygons ? result.polygons.substring(0, 100) + '...' : 'undefined'
              }
            );
            polygons = [];
          }
          
          const externalPolygons = polygons.filter((p: Polygon) => p.type === 'external');
          const internalPolygons = polygons.filter((p: Polygon) => p.type === 'internal');

          imageData.segmentation = {
            cellCount: result.cellCount || externalPolygons.length,
            timestamp: result.timestamp,
            polygons: {
              external: externalPolygons.map((p: Polygon, idx: number) => ({
                id: idx + 1,
                points: p.points,
                area: this.calculatePolygonArea(p.points),
                perimeter: this.calculatePerimeter(p.points),
                boundingBox: this.calculateBoundingBox(p.points),
                centroid: this.calculateCentroid(p.points),
              })),
              internal: internalPolygons.map((p: Polygon, idx: number) => ({
                id: idx + 1,
                points: p.points,
                area: this.calculatePolygonArea(p.points),
                perimeter: this.calculatePerimeter(p.points),
              })),
            },
            statistics: {
              totalExternalPolygons: externalPolygons.length,
              totalInternalPolygons: internalPolygons.length,
              totalArea: externalPolygons.reduce((sum: number, p: Polygon) => 
                sum + this.calculatePolygonArea(p.points), 0) -
                internalPolygons.reduce((sum: number, p: Polygon) => 
                  sum + this.calculatePolygonArea(p.points), 0),
            },
          };
        }
      }

      exportData.images.push(imageData);
    }

    return exportData;
  }

  /**
   * Calculate bounding box [x, y, width, height]
   */
  private calculateBoundingBox(points: Point[]): [number, number, number, number] {
    if (!points || points.length === 0) {
      return [0, 0, 0, 0];
    }
    
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    
    return [minX, minY, maxX - minX, maxY - minY];
  }

  /**
   * Calculate polygon area using shoelace formula
   */
  private calculatePolygonArea(points: Point[]): number {
    let area = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pointI = points[i];
      const pointJ = points[j];
      if (pointI && pointJ) {
        area += pointI.x * pointJ.y;
        area -= pointJ.x * pointI.y;
      }
    }

    return Math.abs(area / 2);
  }

  /**
   * Calculate polygon perimeter
   */
  private calculatePerimeter(points: Point[]): number {
    let perimeter = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const pointI = points[i];
      const pointJ = points[j];
      if (pointI && pointJ) {
        const dx = pointJ.x - pointI.x;
        const dy = pointJ.y - pointI.y;
        perimeter += Math.sqrt(dx * dx + dy * dy);
      }
    }

    return perimeter;
  }

  /**
   * Calculate polygon centroid
   */
  private calculateCentroid(points: Point[]): Point {
    let area = 0;
    let cx = 0;
    let cy = 0;

    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const pointI = points[i];
      const pointJ = points[j];
      if (!pointI || !pointJ) {
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
    if (Math.abs(area) < 1e-9) {
      // Return arithmetic mean of vertices as fallback
      const meanX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
      const meanY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
      return { x: meanX, y: meanY };
    }
    
    cx /= (6 * area);
    cy /= (6 * area);

    return { x: cx, y: cy };
  }

  /**
   * Create binary mask from polygon with holes
   */
  private createBinaryMask(
    outerPolygon: Point[], 
    innerPolygons: Point[][], 
    width: number, 
    height: number
  ): Uint8Array {
    const mask = new Uint8Array(width * height);
    
    // Fill outer polygon
    this.fillPolygonInMask(mask, outerPolygon, width, height, 1);
    
    // Cut out inner polygons (holes)
    for (const innerPolygon of innerPolygons) {
      this.fillPolygonInMask(mask, innerPolygon, width, height, 0);
    }
    
    return mask;
  }

  /**
   * Fill polygon in binary mask using scanline algorithm
   */
  private fillPolygonInMask(
    mask: Uint8Array, 
    polygon: Point[], 
    width: number, 
    height: number, 
    value: number
  ): void {
    if (polygon.length < 3) {return;}

    // Create edge table
    const edges: Array<{yMin: number; yMax: number; x: number; dx: number}> = [];
    
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];
      
      if (!p1 || !p2) {
        continue;
      }
      
      if (p1.y !== p2.y) { // Skip horizontal edges
        const yMin = Math.min(p1.y, p2.y);
        const yMax = Math.max(p1.y, p2.y);
        const x = p1.y < p2.y ? p1.x : p2.x;
        const dx = (p2.x - p1.x) / (p2.y - p1.y);
        
        edges.push({ yMin, yMax, x, dx });
      }
    }

    // Sort edges by yMin
    edges.sort((a, b) => a.yMin - b.yMin);

    // Scanline fill
    for (let y = 0; y < height; y++) {
      const activeEdges = edges.filter(edge => 
        y >= Math.floor(edge.yMin) && y < Math.ceil(edge.yMax)
      );
      
      if (activeEdges.length < 2) {
        continue;
      }

      // Calculate x intersections
      const intersections = activeEdges.map(edge => 
        edge.x + (y - edge.yMin) * edge.dx
      ).sort((a, b) => a - b);

      // Fill between pairs of intersections
      for (let i = 0; i < intersections.length - 1; i += 2) {
        const x1 = intersections[i];
        const x2 = intersections[i + 1];
        if (x1 === undefined || x2 === undefined) {
          continue;
        }
        
        const xStart = Math.max(0, Math.ceil(x1));
        const xEnd = Math.min(width - 1, Math.floor(x2));
        
        for (let x = xStart; x <= xEnd; x++) {
          mask[y * width + x] = value;
        }
      }
    }
  }

  /**
   * Encode binary mask to COCO RLE format (Fortran column-major order)
   */
  private encodeMaskToRLE(mask: Uint8Array, width: number, height: number): {
    size: [number, number];
    counts: number[];
  } {
    // Validate inputs
    if (!mask || width < 0 || height < 0) {
      throw new Error('Invalid mask parameters: mask, width, and height must be valid');
    }
    
    if (width * height > mask.length) {
      throw new Error(`Invalid dimensions: width*height (${width * height}) exceeds mask length (${mask.length})`);
    }

    const counts: number[] = [];
    let currentValue = 0; // Start with background (0)
    let currentCount = 0;

    // Process in Fortran column-major order (column by column)
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const maskIndex = y * width + x;
        // Add defensive bounds checks
        const pixelValue = maskIndex >= 0 && maskIndex < mask.length && mask[maskIndex] !== undefined && mask[maskIndex] > 0 ? 1 : 0;
        
        if (pixelValue === currentValue) {
          currentCount++;
        } else {
          // Value changed, save current run
          if (counts.length > 0 || currentValue === 1) {
            counts.push(currentCount);
          }
          currentValue = pixelValue;
          currentCount = 1;
        }
      }
    }
    
    // Add final run
    if (currentCount > 0 && (counts.length > 0 || currentValue === 1)) {
      counts.push(currentCount);
    }

    return {
      size: [height, width], // COCO format uses [height, width]
      counts
    };
  }

  /**
   * Check if polygon is inside another polygon using point-in-polygon test
   */
  private isPolygonInsidePolygon(innerPolygon: Point[], outerPolygon: Point[]): boolean {
    // Simple check: test if all points of inner polygon are inside outer polygon
    return innerPolygon.every(point => this.isPointInPolygon(point, outerPolygon));
  }

  /**
   * Point-in-polygon test using ray casting algorithm
   */
  private isPointInPolygon(point: Point, polygon: Point[]): boolean {
    const x = point.x;
    const y = point.y;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i]?.x;
      const yi = polygon[i]?.y;
      const xj = polygon[j]?.x;
      const yj = polygon[j]?.y;
      
      if (xi === undefined || yi === undefined || xj === undefined || yj === undefined) {
        continue;
      }

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }
}