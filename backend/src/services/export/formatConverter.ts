import { logger } from '../../utils/logger';
import {
  SPERM_PART_CLASSES,
  type SpermPartClass,
  isValidSpermPartClass,
} from '../../utils/polygonValidation';

export interface Point {
  x: number;
  y: number;
}

export interface Polygon {
  points: Point[];
  type: 'external' | 'internal';
  id?: string;
  geometry?: 'polygon' | 'polyline';
  partClass?: SpermPartClass;
  instanceId?: string;
}

const isPolyline = (p: Polygon): boolean => p.geometry === 'polyline';

const flattenPoints = (points: Point[]): number[] => {
  const out: number[] = [];
  for (const p of points) {
    out.push(p.x, p.y);
  }
  return out;
};

const CELL_CATEGORY: COCOCategory = {
  id: 1,
  name: 'cell',
  supercategory: 'biological',
  color: [0, 255, 0],
};

const SPERM_CATEGORY: COCOCategory = {
  id: 2,
  name: 'sperm',
  supercategory: 'biological',
  color: [255, 128, 0],
};

const buildCocoCategories = (hasSperm: boolean): COCOCategory[] =>
  hasSperm ? [CELL_CATEGORY, SPERM_CATEGORY] : [CELL_CATEGORY];

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
    geometry?: 'polygon' | 'polyline';
    has_holes?: boolean;
    partClass?: SpermPartClass;
    instanceId?: string;
    length?: number;
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

export interface JSONPolylineData {
  id: number;
  points: Point[];
  geometry: 'polyline';
  partClass?: SpermPartClass;
  instanceId?: string;
  length: number;
  boundingBox?: [number, number, number, number];
}

export interface JSONSpermInstance {
  instanceId: string;
  parts: {
    head?: { points: Point[]; length: number };
    midpiece?: { points: Point[]; length: number };
    tail?: { points: Point[]; length: number };
  };
  totalLength: number;
}

export interface JSONSegmentationData {
  cellCount: number;
  timestamp?: Date;
  polygons: {
    external: JSONPolygonData[];
    internal: JSONPolygonData[];
  };
  polylines?: JSONPolylineData[];
  spermInstances?: JSONSpermInstance[];
  statistics: {
    totalExternalPolygons: number;
    totalInternalPolygons: number;
    totalArea: number;
    totalPolylines?: number;
    totalSpermInstances?: number;
    orphanPolylineCount?: number;
  };
}

export interface YOLOConversionResult {
  content: string;
  warnings: string[];
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
    let hasSperm = false;
    let totalInvalidPartClass = 0;
    const sampleAffectedImages: string[] = [];

    for (let imageIdx = 0; imageIdx < images.length; imageIdx++) {
      const image = images[imageIdx];
      if (!image) {
        continue;
      }

      // Add image to COCO images list
      imagesList.push({
        id: imageIdx + 1,
        file_name: image.filename,
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
            logger.error(
              'Failed to parse polygons JSON for COCO format',
              error instanceof Error ? error : new Error('Unknown error'),
              'FormatConverter',
              {
                imageId: image.id,
                polygonsData: result.polygons
                  ? result.polygons.substring(0, 100) + '...'
                  : 'undefined',
              }
            );
            polygons = [];
          }

          const closedExternalPolygons: Polygon[] = [];
          const internalPolygons: Polygon[] = [];
          const validPolylines: Polygon[] = [];
          let invalidPartClassCount = 0;
          for (const p of polygons as Polygon[]) {
            if (isPolyline(p)) {
              if (isValidSpermPartClass(p.partClass)) {
                validPolylines.push(p);
              } else {
                invalidPartClassCount += 1;
              }
            } else if (p.type === 'internal') {
              internalPolygons.push(p);
            } else if (p.type === 'external') {
              closedExternalPolygons.push(p);
            }
          }
          if (invalidPartClassCount > 0) {
            totalInvalidPartClass += invalidPartClassCount;
            if (sampleAffectedImages.length < 10) {
              sampleAffectedImages.push(image.id);
            }
          }
          if (validPolylines.length > 0) {
            hasSperm = true;
          }

          for (const polygon of closedExternalPolygons) {
            // Find internal polygons that belong to this external polygon
            // (simplified - in real scenario, you'd check spatial containment)
            const associatedInternalPolygons = internalPolygons.filter(
              (internal: Polygon) =>
                this.isPolygonInsidePolygon(internal.points, polygon.points)
            );

            // Calculate bounding box
            const bbox = this.calculateBoundingBox(polygon.points);

            // Calculate area (accounting for holes)
            const area =
              this.calculatePolygonArea(polygon.points) -
              associatedInternalPolygons.reduce(
                (sum: number, internal: Polygon) =>
                  sum + this.calculatePolygonArea(internal.points),
                0
              );

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
              const rle = this.encodeMaskToRLE(
                mask,
                image.width || 800,
                image.height || 600
              );
              segmentation = rle;
            } else {
              segmentation = [flattenPoints(polygon.points)];
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
                geometry: 'polygon',
                has_holes: associatedInternalPolygons.length > 0,
              },
            });
          }

          for (const polyline of validPolylines) {
            annotations.push({
              id: annotationId++,
              image_id: imageIdx + 1,
              category_id: 2,
              segmentation: [flattenPoints(polyline.points)],
              bbox: this.calculateBoundingBox(polyline.points),
              area: 0,
              iscrowd: 0,
              attributes: {
                type: 'external',
                geometry: 'polyline',
                partClass: polyline.partClass,
                ...(polyline.instanceId && { instanceId: polyline.instanceId }),
                length: this.calculatePolylineLength(polyline.points),
              },
            });
          }
        }
      }
    }

    if (totalInvalidPartClass > 0) {
      logger.warn(
        `COCO export skipped ${totalInvalidPartClass} polyline(s) with missing or invalid partClass across ${sampleAffectedImages.length}+ image(s)`,
        'FormatConverter',
        {
          expected: SPERM_PART_CLASSES,
          totalSkipped: totalInvalidPartClass,
          sampleImageIds: sampleAffectedImages,
        }
      );
    }

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
      categories: buildCocoCategories(hasSperm),
      licenses: [
        {
          id: 1,
          name: 'Internal Use',
          url: '',
        },
      ],
    };

    return cocoData;
  }

  async convertToYOLO(
    polygonsJson: string,
    imageWidth: number,
    imageHeight: number
  ): Promise<YOLOConversionResult> {
    let polygons;
    try {
      polygons = JSON.parse(polygonsJson);
      if (!Array.isArray(polygons)) {
        throw new Error('Parsed polygons is not an array');
      }
    } catch (error) {
      logger.error(
        'Failed to parse polygons JSON for YOLO format',
        error instanceof Error ? error : new Error('Unknown error'),
        'FormatConverter',
        {
          polygonsData: polygonsJson
            ? polygonsJson.substring(0, 100) + '...'
            : 'undefined',
        }
      );
      throw new Error(
        `Invalid polygon data format: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
    const lines: string[] = [];
    const warnings: string[] = [];

    // YOLO has no open-curve representation; polylines are skipped (warning emitted).
    const polylines = polygons.filter((p: Polygon) => isPolyline(p));
    if (polylines.length > 0) {
      const msg = `YOLO format does not support open polylines — skipped ${polylines.length} polyline(s). Use COCO or JSON for sperm data.`;
      warnings.push(msg);
      logger.warn(msg, 'FormatConverter', {
        polylineCount: polylines.length,
      });
    }

    const externalPolygons = polygons.filter(
      (p: Polygon) =>
        p.type === 'external' && p.geometry !== 'polyline'
    );

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
      lines.push(
        `0 ${x_center.toFixed(6)} ${y_center.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`
      );

      // Optionally add polygon coordinates (YOLO segmentation format)
      // Format: class_id x1 y1 x2 y2 ... xn yn
      const segmentationPoints = polygon.points
        .map(
          (p: Point) =>
            `${(p.x / imageWidth).toFixed(6)} ${(p.y / imageHeight).toFixed(6)}`
        )
        .join(' ');

      lines.push(`# Segmentation: 0 ${segmentationPoints}`);
    }

    return { content: lines.join('\n'), warnings };
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
    let totalOrphans = 0;
    const orphanSampleImages: string[] = [];

    for (let imageIdx = 0; imageIdx < images.length; imageIdx++) {
      const image = images[imageIdx];
      if (!image) {
        continue;
      }

      const imageData: JSONImageData = {
        id: image.id,
        index: imageIdx + 1,
        filename: image.filename,
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
            logger.error(
              'Failed to parse polygons JSON for custom JSON format',
              error instanceof Error ? error : new Error('Unknown error'),
              'FormatConverter',
              {
                polygonsData: result?.polygons
                  ? result.polygons.substring(0, 100) + '...'
                  : 'undefined',
              }
            );
            polygons = [];
          }

          const externalPolygons: Polygon[] = [];
          const internalPolygons: Polygon[] = [];
          const polylines: Polygon[] = [];
          for (const p of polygons as Polygon[]) {
            if (isPolyline(p)) {
              polylines.push(p);
            } else if (p.type === 'internal') {
              internalPolygons.push(p);
            } else if (p.type === 'external') {
              externalPolygons.push(p);
            }
          }

          const polylinesData: JSONPolylineData[] = polylines.map(
            (p: Polygon, idx: number) => ({
              id: idx + 1,
              points: p.points,
              geometry: 'polyline',
              ...(isValidSpermPartClass(p.partClass) && {
                partClass: p.partClass,
              }),
              ...(p.instanceId && { instanceId: p.instanceId }),
              length: this.calculatePolylineLength(p.points),
              boundingBox: this.calculateBoundingBox(p.points),
            })
          );

          const { instances: spermInstances, orphanCount } =
            this.groupPolylinesByInstanceId(polylines);
          if (orphanCount > 0) {
            totalOrphans += orphanCount;
            if (orphanSampleImages.length < 10) {
              orphanSampleImages.push(image.id);
            }
          }

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
            ...(polylinesData.length > 0 && { polylines: polylinesData }),
            ...(spermInstances.length > 0 && { spermInstances }),
            statistics: {
              totalExternalPolygons: externalPolygons.length,
              totalInternalPolygons: internalPolygons.length,
              totalArea:
                externalPolygons.reduce(
                  (sum: number, p: Polygon) =>
                    sum + this.calculatePolygonArea(p.points),
                  0
                ) -
                internalPolygons.reduce(
                  (sum: number, p: Polygon) =>
                    sum + this.calculatePolygonArea(p.points),
                  0
                ),
              ...(polylinesData.length > 0 && {
                totalPolylines: polylinesData.length,
              }),
              ...(spermInstances.length > 0 && {
                totalSpermInstances: spermInstances.length,
              }),
              ...(orphanCount > 0 && { orphanPolylineCount: orphanCount }),
            },
          };
        }
      }

      exportData.images.push(imageData);
    }

    if (totalOrphans > 0) {
      logger.warn(
        `JSON export found ${totalOrphans} polyline(s) without instanceId across ${orphanSampleImages.length}+ image(s) — excluded from spermInstances grouping`,
        'FormatConverter',
        { totalOrphans, sampleImageIds: orphanSampleImages }
      );
    }

    return exportData;
  }

  /**
   * Calculate bounding box [x, y, width, height]
   */
  private calculateBoundingBox(
    points: Point[]
  ): [number, number, number, number] {
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

  private calculatePolylineLength(points: Point[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      if (prev && curr) {
        const dx = curr.x - prev.x;
        const dy = curr.y - prev.y;
        length += Math.sqrt(dx * dx + dy * dy);
      }
    }
    return length;
  }

  private groupPolylinesByInstanceId(polylines: Polygon[]): {
    instances: JSONSpermInstance[];
    orphanCount: number;
  } {
    const groups = new Map<string, Polygon[]>();
    let orphanCount = 0;
    for (const p of polylines) {
      if (!p.instanceId) {
        orphanCount += 1;
        continue;
      }
      const list = groups.get(p.instanceId);
      if (list) {
        list.push(p);
      } else {
        groups.set(p.instanceId, [p]);
      }
    }

    const instances: JSONSpermInstance[] = [];
    for (const [instanceId, parts] of groups) {
      const head = parts.find(p => p.partClass === 'head');
      const midpiece = parts.find(p => p.partClass === 'midpiece');
      const tail = parts.find(p => p.partClass === 'tail');

      const headLen = head ? this.calculatePolylineLength(head.points) : 0;
      const midLen = midpiece
        ? this.calculatePolylineLength(midpiece.points)
        : 0;
      const tailLen = tail ? this.calculatePolylineLength(tail.points) : 0;

      instances.push({
        instanceId,
        parts: {
          ...(head && { head: { points: head.points, length: headLen } }),
          ...(midpiece && {
            midpiece: { points: midpiece.points, length: midLen },
          }),
          ...(tail && { tail: { points: tail.points, length: tailLen } }),
        },
        totalLength: headLen + midLen + tailLen,
      });
    }
    return { instances, orphanCount };
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

    cx /= 6 * area;
    cy /= 6 * area;

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
    if (polygon.length < 3) {
      return;
    }

    // Create edge table
    const edges: Array<{ yMin: number; yMax: number; x: number; dx: number }> =
      [];

    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i];
      const p2 = polygon[(i + 1) % polygon.length];

      if (!p1 || !p2) {
        continue;
      }

      if (p1.y !== p2.y) {
        // Skip horizontal edges
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
      const activeEdges = edges.filter(
        edge => y >= Math.floor(edge.yMin) && y < Math.ceil(edge.yMax)
      );

      if (activeEdges.length < 2) {
        continue;
      }

      // Calculate x intersections
      const intersections = activeEdges
        .map(edge => edge.x + (y - edge.yMin) * edge.dx)
        .sort((a, b) => a - b);

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
  private encodeMaskToRLE(
    mask: Uint8Array,
    width: number,
    height: number
  ): {
    size: [number, number];
    counts: number[];
  } {
    // Validate inputs
    if (!mask || width < 0 || height < 0) {
      throw new Error(
        'Invalid mask parameters: mask, width, and height must be valid'
      );
    }

    if (width * height > mask.length) {
      throw new Error(
        `Invalid dimensions: width*height (${width * height}) exceeds mask length (${mask.length})`
      );
    }

    const counts: number[] = [];
    let currentValue = 0; // Start with background (0)
    let currentCount = 0;

    // Process in Fortran column-major order (column by column)
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const maskIndex = y * width + x;
        // Add defensive bounds checks
        const pixelValue =
          maskIndex >= 0 &&
          maskIndex < mask.length &&
          mask[maskIndex] !== undefined &&
          mask[maskIndex] > 0
            ? 1
            : 0;

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
      counts,
    };
  }

  /**
   * Check if polygon is inside another polygon using point-in-polygon test
   */
  private isPolygonInsidePolygon(
    innerPolygon: Point[],
    outerPolygon: Point[]
  ): boolean {
    // Simple check: test if all points of inner polygon are inside outer polygon
    return innerPolygon.every(point =>
      this.isPointInPolygon(point, outerPolygon)
    );
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

      if (
        xi === undefined ||
        yi === undefined ||
        xj === undefined ||
        yj === undefined
      ) {
        continue;
      }

      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }

    return inside;
  }
}
