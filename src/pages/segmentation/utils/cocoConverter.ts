import {
  type Polygon,
  type SegmentationResult,
  type NeuronPartClass,
  isPolyline,
  isValidSpermPartClass,
  isValidNeuronPartClass,
  NEURON_PART_CLASSES,
} from '@/lib/segmentation';
import {
  calculateMetrics,
  calculatePolylineLength,
} from './metricCalculations';
import {
  isPolygonInsidePolygon,
  calculateBoundingBox,
} from '@/lib/polygonGeometry';

// Neuron classes are separate OBJECT categories, not parts of one object the
// way head/midpiece/tail are — a standard COCO reader must not see a two-class
// dataset as a single class named 'spheroid'. Ids match the backend exporter
// (`formatConverter.ts`) so both COCO writers agree.
const NEURON_CATEGORY_IDS: Record<NeuronPartClass, number> = {
  neurite: 3,
  soma: 4,
};

const flattenPoints = (points: { x: number; y: number }[]): number[] => {
  const out: number[] = [];
  for (const p of points) {
    out.push(p.x, p.y);
  }
  return out;
};

const bboxTuple = (
  points: { x: number; y: number }[]
): [number, number, number, number] => {
  const bb = calculateBoundingBox(points);
  return [bb.minX, bb.minY, bb.width, bb.height];
};

export const convertToCOCO = (segmentation: SegmentationResult): string => {
  const closedExternal: Polygon[] = [];
  const internal: Polygon[] = [];
  const validPolylines: Polygon[] = [];
  for (const p of segmentation.polygons) {
    if (isPolyline(p)) {
      if (isValidSpermPartClass(p.partClass)) validPolylines.push(p);
    } else if (p.type === 'internal') {
      internal.push(p);
    } else if (p.type === 'external') {
      closedExternal.push(p);
    }
  }

  let annotationId = 1;
  const annotations: Array<Record<string, unknown>> = [];

  const neuronClassesPresent = new Set<NeuronPartClass>();

  for (const polygon of closedExternal) {
    const holes = internal.filter(h =>
      isPolygonInsidePolygon(h.points, polygon.points)
    );
    const neuronClass = isValidNeuronPartClass(polygon.partClass)
      ? polygon.partClass
      : undefined;
    if (neuronClass) neuronClassesPresent.add(neuronClass);
    annotations.push({
      id: annotationId++,
      image_id: 1,
      category_id: neuronClass ? NEURON_CATEGORY_IDS[neuronClass] : 1,
      segmentation: [
        flattenPoints(polygon.points),
        ...holes.map(h => flattenPoints(h.points)),
      ],
      bbox: bboxTuple(polygon.points),
      area: calculateMetrics(polygon, holes).Area,
      iscrowd: 0,
      attributes: {
        type: 'external',
        geometry: 'polygon',
        has_holes: holes.length > 0,
        ...(neuronClass && { partClass: neuronClass }),
      },
    });
  }

  for (const polyline of validPolylines) {
    annotations.push({
      id: annotationId++,
      image_id: 1,
      category_id: 2,
      segmentation: [flattenPoints(polyline.points)],
      bbox: bboxTuple(polyline.points),
      area: 0,
      iscrowd: 0,
      attributes: {
        type: 'external',
        geometry: 'polyline',
        partClass: polyline.partClass,
        ...(polyline.instanceId && { instanceId: polyline.instanceId }),
        length: calculatePolylineLength(polyline.points),
      },
    });
  }

  const categories: Array<Record<string, unknown>> = [
    { id: 1, name: 'spheroid', supercategory: 'cell' },
  ];
  if (validPolylines.length > 0) {
    categories.push({ id: 2, name: 'sperm', supercategory: 'biological' });
  }
  for (const c of NEURON_PART_CLASSES) {
    if (neuronClassesPresent.has(c)) {
      categories.push({
        id: NEURON_CATEGORY_IDS[c],
        name: c,
        supercategory: 'biological',
      });
    }
  }

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
