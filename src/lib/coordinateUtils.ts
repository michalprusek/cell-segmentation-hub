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

  // With transformOrigin at 0 0, the calculation is simpler
  // We need to account for the centering of the content
  const containerWidth = rect.width;
  const containerHeight = rect.height;

  // The content is centered, so we need to adjust for that
  const centerOffsetX = containerWidth / 2;
  const centerOffsetY = containerHeight / 2;

  // Adjust for centering and then apply inverse transform
  const imageX =
    (canvasX - centerOffsetX - transform.translateX) / transform.zoom;
  const imageY =
    (canvasY - centerOffsetY - transform.translateY) / transform.zoom;

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
 * Note: canvasPoint should be relative to the container center
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

  // With transformOrigin at 0 0 and centering in the parent container,
  // we need to adjust the translation
  const scaledWidth = imageWidth * zoom;
  const scaledHeight = imageHeight * zoom;

  // Since we start from the center of the container, we need to offset by half the scaled image size
  const translateX = -scaledWidth / 2;
  const translateY = -scaledHeight / 2;

  return {
    zoom,
    translateX,
    translateY,
  };
};

/**
 * Calculate zoom-in/out transform while keeping a point fixed
 */
export const calculateFixedPointZoom = (
  currentTransform: TransformState,
  fixedPoint: Point, // Point to keep fixed (in canvas container coordinates)
  zoomFactor: number,
  minZoom: number = 0.1,
  maxZoom: number = 10,
  containerWidth?: number,
  containerHeight?: number
): TransformState => {
  const newZoom = Math.max(
    minZoom,
    Math.min(maxZoom, currentTransform.zoom * zoomFactor)
  );

  if (newZoom === currentTransform.zoom) {
    return currentTransform;
  }

  // Convert the fixed point from container coordinates to centered coordinates
  // The canvas content is centered in the container, so we need to adjust
  const centerOffsetX = containerWidth ? containerWidth / 2 : 0;
  const centerOffsetY = containerHeight ? containerHeight / 2 : 0;

  const centeredPoint = {
    x: fixedPoint.x - centerOffsetX,
    y: fixedPoint.y - centerOffsetY,
  };

  // Calculate the point in image coordinates using the centered point
  const imagePoint = canvasToImageCoordinates(centeredPoint, currentTransform);

  // Calculate new translation to keep the image point under the fixed canvas point
  const newCanvasPoint = imageToCanvasCoordinates(imagePoint, {
    ...currentTransform,
    zoom: newZoom,
  });

  const translateX =
    currentTransform.translateX + (centeredPoint.x - newCanvasPoint.x);
  const translateY =
    currentTransform.translateY + (centeredPoint.y - newCanvasPoint.y);

  return {
    zoom: newZoom,
    translateX,
    translateY,
  };
};

/**
 * Constrain transform to keep image within reasonable bounds
 * When zoomed in, allows unlimited panning for better user experience
 * When zoomed out, applies gentle constraints to prevent losing the image
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

  // When zoomed in (>= 1x), allow unlimited panning
  // so the user can freely navigate to any part of the image
  if (zoom >= 1.0) {
    return {
      zoom,
      translateX: transform.translateX,
      translateY: transform.translateY,
    };
  }

  // Everything below is the zoom < 1 path. The `zoom >= 1.0` branch that
  // used to sit here was unreachable -- the early return above already
  // took every zoom >= 1 case -- so its "very generous" constraints never
  // ran and the panning they described was simply unbounded.

  // For zoom levels < 1x (zoomed out), apply moderate constraints to prevent complete loss
  const moderateMargin = Math.max(canvasWidth, canvasHeight) * 0.8;
  const minVisibleSize = 50; // Larger minimum visibility for zoomed out images

  // For X axis - moderate constraints for zoomed out images
  const maxTranslateX = moderateMargin - scaledWidth / 2;
  const minTranslateX = -scaledWidth / 2 - moderateMargin + minVisibleSize;
  const translateX = Math.max(
    minTranslateX,
    Math.min(maxTranslateX, transform.translateX)
  );

  // For Y axis - moderate constraints for zoomed out images
  const maxTranslateY = moderateMargin - scaledHeight / 2;
  const minTranslateY = -scaledHeight / 2 - moderateMargin + minVisibleSize;
  const translateY = Math.max(
    minTranslateY,
    Math.min(maxTranslateY, transform.translateY)
  );

  return {
    zoom,
    translateX,
    translateY,
  };
};
