import type { Point } from '@/lib/segmentation';

// Enhanced EditMode enum inspired by SpheroSeg
export enum EditMode {
  View = 'view',
  EditVertices = 'edit-vertices',
  AddPoints = 'add-points',
  CreatePolygon = 'create-polygon',
  CreatePolyline = 'create-polyline',
  Slice = 'slice',
  DeletePolygon = 'delete-polygon',
}

// Enhanced InteractionState for comprehensive polygon editing
export interface InteractionState {
  isDraggingVertex: boolean;
  isPanning: boolean;
  panStart: Point | null;
  draggedVertexInfo: { polygonId: string; vertexIndex: number } | null;
  originalVertexPosition?: Point | null; // For undo/redo
  sliceStartPoint: Point | null;
  // Add point mode states
  addPointStartVertex: { polygonId: string; vertexIndex: number } | null;
  addPointEndVertex: { polygonId: string; vertexIndex: number } | null;
  isAddingPoints: boolean;
}

// Transform state for zoom and pan
export interface TransformState {
  zoom: number;
  translateX: number;
  translateY: number;
}

// Constants for polygon editing
export const EDITING_CONSTANTS = {
  VERTEX_HIT_RADIUS: 8, // Base radius for vertex hit detection
  CLOSE_POLYGON_DISTANCE: 15, // Distance threshold to close polygon
  SEGMENT_HIT_DISTANCE: 20, // Distance threshold for segment clicking
  MIN_AUTO_ADD_DISTANCE: 10, // Minimum distance for auto-adding points with Shift
  ZOOM_FACTOR: 1.2, // Zoom multiplier
  MIN_ZOOM: 0.5, // 50% minimum zoom
  MAX_ZOOM: 10, // 1000% maximum zoom
} as const;

export interface DragState {
  isDragging: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

export interface VertexDragState {
  isDragging: boolean;
  polygonId: string | null;
  vertexIndex: number | null;
  dragOffset?: { x: number; y: number };
  originalPosition?: { x: number; y: number };
}

export interface TempPointsState {
  points: Array<{ x: number; y: number }>;
  startIndex: number | null;
  endIndex: number | null;
  polygonId: string | null;
}
