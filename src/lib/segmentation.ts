// Simple segmentation service
// This simulates image segmentation with thresholding and contour finding
// In a real app, this would use more advanced methods like WebAssembly or call a backend API

import type { SegmentationData } from '@/types';

export interface Point {
  x: number;
  y: number;
}

export const SPERM_PART_CLASSES = ['head', 'midpiece', 'tail'] as const;
export type SpermPartClass = (typeof SPERM_PART_CLASSES)[number];

export const isValidSpermPartClass = (
  value: unknown
): value is SpermPartClass =>
  typeof value === 'string' &&
  (SPERM_PART_CLASSES as readonly string[]).includes(value);

// Wider class union covering both sperm parts and spheroid 'core'
// (dense central region detected by the disintegration model).
export const POLYGON_PART_CLASSES = [...SPERM_PART_CLASSES, 'core'] as const;
export type PolygonPartClass = (typeof POLYGON_PART_CLASSES)[number];

export interface Polygon {
  id: string;
  points: Point[];
  type: 'external' | 'internal'; // Changed from optional to required
  class?: string;
  name?: string;
  confidence?: number;
  area?: number;
  parent_id?: string;
  geometry?: 'polygon' | 'polyline'; // absent = 'polygon' (backward compat with rows stored before sperm model)
  partClass?: PolygonPartClass;
  instanceId?: string;
  /** Microcapsule completeness flag written by the instance model: `false`
   *  when the capsule's mask is cut off by the image border. Such capsules are
   *  drawn grey in the editor and excluded from metrics. Absent for other
   *  project types. */
  complete?: boolean;
  /** Cross-frame microtubule track ID; populated by the tracker after a
   *  video container's batch finishes segmentation. Equal across frames
   *  for sibling polylines representing the same MT over time. */
  trackId?: string;
  /** Base64-encoded float16 (M × 32) embedding sampled at each polyline
   *  point during microtubule inference. Internal — used by the tracker
   *  and kymograph services on the backend. Read paths SHOULD strip this
   *  field before serving to the editor (it's a several-KB-per-polyline
   *  blob with no UI consumer). Field name starts with ``_`` to signal
   *  "internal" in JSON dumps. */
  _embedding?: string;
  /** User-assigned microtubule type-label id. Resolved to a class
   *  name/colour via the project's `mtTypeLabels` palette. Microtubule
   *  projects only; set/cleared via the tracks/type endpoint. */
  mtType?: string;
}

export const isPolyline = (p: Polygon): boolean => p.geometry === 'polyline';

/** Branded string identifying a polygon for cross-frame UI state. Use
 *  `Set<PolygonKey>` / `Map<PolygonKey, ...>` to make accidental keying
 *  by arbitrary strings (filenames, ids of other entities) a compile
 *  error. */
export type PolygonKey = string & { readonly __brand: 'PolygonKey' };

/** Cross-frame stable key for UI state: `trackId` if set (microtubule
 *  polylines), else the per-inference `id`. Uses `||` not `??` so an
 *  accidentally empty `trackId` falls back to id rather than colliding
 *  every empty-trackId polygon to the same key. */
export const polygonKey = (p: Polygon): PolygonKey =>
  (p.trackId || p.id) as PolygonKey;

// SegmentationResult type removed - use Polygon[] directly

// Apply a simple thresholding algorithm to create a binary mask
export const applyThresholding = async (
  imageSrc: string,
  threshold: number = 127
): Promise<ImageData> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // Create a canvas to draw the image
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // Draw the image on the canvas
      ctx.drawImage(img, 0, 0);

      // Get the image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Apply thresholding
      for (let i = 0; i < data.length; i += 4) {
        const gray =
          0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const binary = gray > threshold ? 255 : 0;
        data[i] = binary; // R
        data[i + 1] = binary; // G
        data[i + 2] = binary; // B
        data[i + 3] = 255; // A
      }

      resolve(imageData);
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = imageSrc;
  });
};

// Contour finding - returns empty array as we fetch real segmentation from backend
export const findContours = (_imageData: ImageData): Polygon[] => {
  // In production, segmentation is performed by the ML backend service
  // This function returns an empty array since we don't generate fake polygons
  return [];
};

// Main segmentation function - returns empty result as segmentation is done by backend
export const segmentImage = async (
  imageSrc: string
): Promise<SegmentationData> => {
  // In production, segmentation is performed by the ML backend service
  // This function returns an empty result
  return {
    imageSrc,
    polygons: [],
    imageWidth: 0,
    imageHeight: 0,
    timestamp: new Date(),
  };
};

// Calculate polygon perimeter
export const calculatePerimeter = (polygon: Point[]): number => {
  let perimeter = 0;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = polygon[j].x - polygon[i].x;
    const dy = polygon[j].y - polygon[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }

  return perimeter;
};
