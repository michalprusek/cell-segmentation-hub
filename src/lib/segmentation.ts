// Simple segmentation service
// This simulates image segmentation with thresholding and contour finding
// In a real app, this would use more advanced methods like WebAssembly or call a backend API

import type { PolygonData, SegmentationData } from '@/types';

export interface Point {
  x: number;
  y: number;
}

export interface Polygon {
  id: string;
  points: Point[];
  type: 'external' | 'internal'; // Changed from optional to required
  class?: string;
  name?: string;
  confidence?: number;
  area?: number;
  parent_id?: string; // For internal polygons, references the parent external polygon
}

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
export const findContours = (imageData: ImageData): Polygon[] => {
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

// Calculate polygon area, with consideration for internal holes
export const calculatePolygonArea = (polygon: Point[]): number => {
  let area = 0;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }

  return Math.abs(area) / 2;
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
