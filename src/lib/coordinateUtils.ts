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
 * Share of the smaller of (viewport, image) that must stay covered by the
 * image on each axis. OpenSeadragon's `visibilityRatio`, at its default.
 */
export const PAN_VISIBILITY_RATIO = 0.5;

/**
 * Clamp the zoom, and keep the image from being panned out of sight.
 *
 * This is OpenSeadragon's boundary constraint (`Viewport._applyBoundaryConstraints`,
 * v5.0.1): on each axis the image must overlap the viewport by at least
 * `PAN_VISIBILITY_RATIO` of whichever is smaller, the viewport or the image.
 * An image larger than the viewport can therefore bring ANY of its edges to
 * the viewport's centre, at every zoom.
 *
 * It replaced a margin of 0.8x the viewport's longer side around the centred
 * position, applied only below zoom 1 (above it, panning was unlimited). That
 * margin did not grow with the image, so on a 4104 x 2174 sperm frame in a
 * 1300 px wide canvas the rightmost ~340 screen px could not be reached at
 * zoom 0.99 — a sperm at the border slid out of view as you zoomed toward it
 * and could not be panned back — and crossing zoom 1 switched the clamp off.
 *
 * The content is laid out from the container's centre, so the image's
 * on-screen left edge is `canvasWidth / 2 + translateX`.
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
  const zoom = Math.max(minZoom, Math.min(maxZoom, transform.zoom));

  return {
    zoom,
    translateX: constrainAxis(
      transform.translateX,
      imageWidth * zoom,
      canvasWidth
    ),
    translateY: constrainAxis(
      transform.translateY,
      imageHeight * zoom,
      canvasHeight
    ),
  };
};

/**
 * One axis of `constrainTransform`. The image spans
 * `[viewport / 2 + translate, viewport / 2 + translate + scaled]` on screen and
 * must overlap `[0, viewport]` by `threshold`.
 */
const constrainAxis = (
  translate: number,
  scaled: number,
  viewport: number
): number => {
  // No measured viewport or image yet: nothing to keep in view.
  if (!(viewport > 0) || !(scaled > 0)) return translate;

  const threshold = PAN_VISIBILITY_RATIO * Math.min(viewport, scaled);
  const min = threshold - viewport / 2 - scaled; // right edge >= threshold
  const max = viewport / 2 - threshold; // left edge <= viewport - threshold
  return Math.max(min, Math.min(max, translate));
};
