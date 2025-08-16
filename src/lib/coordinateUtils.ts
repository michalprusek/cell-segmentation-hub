import type { Point } from './segmentation';
import type { TransformState } from '../pages/segmentation/types';

/**
 * Coordinate transformation utilities for canvas operations
 * Inspired by SpheroSeg implementation
 */

/**
 * Convert mouse coordinates to canvas/image coordinates
 */
export const getCanvasCoordinates = (
  mouseX: number,
  mouseY: number,
  transform: TransformState,
  canvasRef: React.RefObject<HTMLDivElement>
): { imageX: number; imageY: number; canvasX: number; canvasY: number } => {
  if (!canvasRef.current) {
    return { imageX: mouseX, imageY: mouseY, canvasX: mouseX, canvasY: mouseY };
  }

  const rect = canvasRef.current.getBoundingClientRect();

  // Canvas coordinates (relative to canvas element)
  const canvasX = mouseX - rect.left;
  const canvasY = mouseY - rect.top;

  // Image coordinates (accounting for zoom and translation)
  const imageX = (canvasX - transform.translateX) / transform.zoom;
  const imageY = (canvasY - transform.translateY) / transform.zoom;

  return { imageX, imageY, canvasX, canvasY };
};

/**
 * Convert image coordinates to canvas coordinates
 */
export const imageToCanvasCoordinates = (
  imagePoint: Point,
  transform: TransformState
): Point => {
  return {
    x: imagePoint.x * transform.zoom + transform.translateX,
    y: imagePoint.y * transform.zoom + transform.translateY,
  };
};

/**
 * Convert canvas coordinates to image coordinates
 */
export const canvasToImageCoordinates = (
  canvasPoint: Point,
  transform: TransformState
): Point => {
  return {
    x: (canvasPoint.x - transform.translateX) / transform.zoom,
    y: (canvasPoint.y - transform.translateY) / transform.zoom,
  };
};

/**
 * Calculate the initial centering transform for an image
 */
export const calculateCenteringTransform = (
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  padding: number = 20
): TransformState => {
  // Calculate zoom to fit image in canvas with padding
  const availableWidth = canvasWidth - padding * 2;
  const availableHeight = canvasHeight - padding * 2;

  const scaleX = availableWidth / imageWidth;
  const scaleY = availableHeight / imageHeight;
  const zoom = Math.min(scaleX, scaleY, 1); // Don't zoom in above 100%

  // Calculate translation to center the image
  const scaledWidth = imageWidth * zoom;
  const scaledHeight = imageHeight * zoom;

  const translateX = (canvasWidth - scaledWidth) / 2;
  const translateY = (canvasHeight - scaledHeight) / 2;

  return {
    zoom,
    translateX,
    translateY,
  };
};

/**
 * Calculate zoom factor for wheel events
 */
export const calculateWheelZoom = (
  currentZoom: number,
  deltaY: number,
  sensitivity: number = 0.001,
  minZoom: number = 0.1,
  maxZoom: number = 10
): number => {
  const zoomFactor = 1 - deltaY * sensitivity;
  const newZoom = currentZoom * zoomFactor;
  return Math.max(minZoom, Math.min(maxZoom, newZoom));
};

/**
 * Calculate zoom-in/out transform while keeping a point fixed
 */
export const calculateFixedPointZoom = (
  currentTransform: TransformState,
  fixedPoint: Point, // Point to keep fixed (in canvas coordinates)
  zoomFactor: number,
  minZoom: number = 0.1,
  maxZoom: number = 10
): TransformState => {
  const newZoom = Math.max(
    minZoom,
    Math.min(maxZoom, currentTransform.zoom * zoomFactor)
  );

  if (newZoom === currentTransform.zoom) {
    return currentTransform;
  }

  // Calculate the point in image coordinates
  const imagePoint = canvasToImageCoordinates(fixedPoint, currentTransform);

  // Calculate new translation to keep the image point under the fixed canvas point
  const newCanvasPoint = imageToCanvasCoordinates(imagePoint, {
    ...currentTransform,
    zoom: newZoom,
  });

  const translateX =
    currentTransform.translateX + (fixedPoint.x - newCanvasPoint.x);
  const translateY =
    currentTransform.translateY + (fixedPoint.y - newCanvasPoint.y);

  return {
    zoom: newZoom,
    translateX,
    translateY,
  };
};

/**
 * Constrain transform to keep image within reasonable bounds
 */
export const constrainTransform = (
  transform: TransformState,
  imageWidth: number,
  imageHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  minZoom: number = 0.1,
  maxZoom: number = 10
): TransformState => {
  // Constrain zoom
  const zoom = Math.max(minZoom, Math.min(maxZoom, transform.zoom));

  // Calculate image bounds in canvas coordinates
  const scaledWidth = imageWidth * zoom;
  const scaledHeight = imageHeight * zoom;

  // Prevent image from moving too far off-screen
  // Allow only a small margin (10% of image size) to be hidden beyond canvas edges
  const marginX = Math.min(scaledWidth * 0.1, 100); // Max 100px margin
  const marginY = Math.min(scaledHeight * 0.1, 100); // Max 100px margin

  // Calculate boundaries
  const maxTranslateX = marginX;
  const minTranslateX = canvasWidth - scaledWidth - marginX;
  const maxTranslateY = marginY;
  const minTranslateY = canvasHeight - scaledHeight - marginY;

  // For small images or high zoom levels, center the image if it fits within canvas
  let translateX = transform.translateX;
  let translateY = transform.translateY;

  if (scaledWidth <= canvasWidth) {
    // Image fits horizontally - center it
    translateX = (canvasWidth - scaledWidth) / 2;
  } else {
    // Apply constraints
    translateX = Math.max(
      minTranslateX,
      Math.min(maxTranslateX, transform.translateX)
    );
  }

  if (scaledHeight <= canvasHeight) {
    // Image fits vertically - center it
    translateY = (canvasHeight - scaledHeight) / 2;
  } else {
    // Apply constraints
    translateY = Math.max(
      minTranslateY,
      Math.min(maxTranslateY, transform.translateY)
    );
  }

  return {
    zoom,
    translateX,
    translateY,
  };
};

/**
 * Check if a point is visible in the current viewport
 */
export const isPointVisible = (
  imagePoint: Point,
  transform: TransformState,
  canvasWidth: number,
  canvasHeight: number,
  margin: number = 50
): boolean => {
  const canvasPoint = imageToCanvasCoordinates(imagePoint, transform);

  return (
    canvasPoint.x >= -margin &&
    canvasPoint.x <= canvasWidth + margin &&
    canvasPoint.y >= -margin &&
    canvasPoint.y <= canvasHeight + margin
  );
};

/**
 * Check if a polygon is visible in the current viewport
 */
export const isPolygonVisible = (
  polygonPoints: Point[],
  transform: TransformState,
  canvasWidth: number,
  canvasHeight: number,
  margin: number = 50
): boolean => {
  // Simple approach: check if any vertex is visible
  // For better performance with many polygons, could use bounding box intersection
  return polygonPoints.some(point =>
    isPointVisible(point, transform, canvasWidth, canvasHeight, margin)
  );
};

/**
 * Get viewport bounds in image coordinates
 */
export const getViewportBounds = (
  transform: TransformState,
  canvasWidth: number,
  canvasHeight: number,
  margin: number = 0
): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} => {
  const topLeft = canvasToImageCoordinates(
    { x: -margin, y: -margin },
    transform
  );
  const bottomRight = canvasToImageCoordinates(
    { x: canvasWidth + margin, y: canvasHeight + margin },
    transform
  );

  return {
    minX: topLeft.x,
    maxX: bottomRight.x,
    minY: topLeft.y,
    maxY: bottomRight.y,
  };
};
