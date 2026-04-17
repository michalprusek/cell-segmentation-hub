import {
  type Polygon,
  type SegmentationResult,
  isPolyline,
  isValidSpermPartClass,
} from '@/lib/segmentation';
import { calculateMetrics } from './metricCalculations';
import { isPolygonInsidePolygon } from '@/lib/polygonGeometry';

const polylineLength = (points: { x: number; y: number }[]): number => {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
};

const flattenPoints = (points: { x: number; y: number }[]): number[] =>
  points.reduce<number[]>((acc, p) => [...acc, p.x, p.y], []);

const boundingBox = (
  points: { x: number; y: number }[]
): [number, number, number, number] => {
  if (points.length === 0) return [0, 0, 0, 0];
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
};

export const convertToCOCO = (segmentation: SegmentationResult): string => {
  const closedExternal = segmentation.polygons.filter(
    p => p.type === 'external' && p.geometry !== 'polyline'
  );
  const allInternalPolygons = segmentation.polygons.filter(
    p => p.type === 'internal'
  );
  const allPolylines = segmentation.polygons.filter(p => isPolyline(p));
  const validPolylines = allPolylines.filter((p: Polygon) =>
    isValidSpermPartClass(p.partClass)
  );

  let annotationId = 1;
  const annotations: Array<Record<string, unknown>> = [];

  for (const polygon of closedExternal) {
    const holes = allInternalPolygons.filter(internal =>
      isPolygonInsidePolygon(internal.points, polygon.points)
    );
    const segmentationPoints = [
      flattenPoints(polygon.points),
      ...holes.map(h => flattenPoints(h.points)),
    ];
    const [x, y, width, height] = boundingBox(polygon.points);
    const area = calculateMetrics(polygon, holes).Area;

    annotations.push({
      id: annotationId++,
      image_id: 1,
      category_id: 1,
      segmentation: segmentationPoints,
      bbox: [x, y, width, height],
      area,
      iscrowd: 0,
      attributes: {
        type: 'external',
        geometry: 'polygon',
        has_holes: holes.length > 0,
      },
    });
  }

  for (const polyline of validPolylines) {
    annotations.push({
      id: annotationId++,
      image_id: 1,
      category_id: 2,
      segmentation: [flattenPoints(polyline.points)],
      bbox: boundingBox(polyline.points),
      area: 0,
      iscrowd: 0,
      attributes: {
        type: 'external',
        geometry: 'polyline',
        partClass: polyline.partClass,
        ...(polyline.instanceId && { instanceId: polyline.instanceId }),
        length: polylineLength(polyline.points),
      },
    });
  }

  const categories =
    validPolylines.length > 0
      ? [
          { id: 1, name: 'spheroid', supercategory: 'cell' },
          { id: 2, name: 'sperm', supercategory: 'biological' },
        ]
      : [{ id: 1, name: 'spheroid', supercategory: 'cell' }];

  const coco = {
    info: {
      description: 'Spheroid segmentation dataset',
      version: '1.0',
      year: new Date().getFullYear(),
      date_created: new Date().toISOString(),
    },
    images: [
      {
        id: 1,
        file_name: segmentation.imageSrc?.split('/').pop() || 'image.png',
        width: 800,
        height: 600,
        date_captured: new Date().toISOString(),
      },
    ],
    annotations,
    categories,
  };

  return JSON.stringify(coco, null, 2);
};
