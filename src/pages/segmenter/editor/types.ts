/**
 * Core types for the `/segmenter` polygon-only editor. Deliberately
 * self-contained (does NOT import `@/pages/segmentation/types`) so this
 * module never drags in the video/MT/sperm/polyline machinery of the
 * reused spheroseg editor — see
 * `docs/superpowers/plans/2026-07-09-segmenter-p0.md` Task 5.
 *
 * `Point`/`SegPolygon` are aliases of the wire types in `@/lib/segmenterApi`
 * so the editor's in-memory model IS the wire shape — no mapping layer
 * needed between load/save and the canvas.
 */
import type { SegmenterPoint, SegmenterPolygon } from '@/lib/segmenterApi';

export type Point = SegmenterPoint;
export type SegPolygon = SegmenterPolygon;

/** Minimum viable mode set per the P0 plan: View (select/pan) /
 *  CreatePolygon (click to add vertices) / EditVertices (drag/delete
 *  vertices of the selected polygon) / DeletePolygon (click a polygon to
 *  remove it). AddPoints/Slice are explicitly out of scope for P0. */
export enum EditMode {
  View = 'view',
  CreatePolygon = 'create-polygon',
  EditVertices = 'edit-vertices',
  DeletePolygon = 'delete-polygon',
}

export interface TransformState {
  zoom: number;
  translateX: number;
  translateY: number;
}

export interface VertexDragState {
  isDragging: boolean;
  polygonId: string | null;
  vertexIndex: number | null;
  dragOffset: Point | null;
}

export const EMPTY_VERTEX_DRAG_STATE: VertexDragState = {
  isDragging: false,
  polygonId: null,
  vertexIndex: null,
  dragOffset: null,
};

export const EDITOR_CONSTANTS = {
  MIN_ZOOM: 0.1,
  MAX_ZOOM: 15,
  ZOOM_STEP: 1.2,
  /** Screen-space px threshold for "click near the first vertex closes the
   *  polygon" — divided by the current zoom to get an image-space distance. */
  CLOSE_POLYGON_DISTANCE: 12,
} as const;
