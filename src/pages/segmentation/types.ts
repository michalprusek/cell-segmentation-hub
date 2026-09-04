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
  /** Cursor position, in image coordinates, when the vertex was grabbed.
   *  The drag moves the vertex by (cursor - this), so grabbing a vertex
   *  slightly off-centre no longer teleports it under the pointer. */
  vertexGrabPoint?: Point | null;
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
  MIN_AUTO_ADD_DISTANCE: 10, // Minimum distance for auto-adding points with Shift
  ZOOM_FACTOR: 1.2, // Zoom multiplier
  MIN_ZOOM: 0.5, // 50% minimum zoom
  MAX_ZOOM: 10, // 1000% maximum zoom
} as const;

export interface VertexDragState {
  isDragging: boolean;
  polygonId: string | null;
  vertexIndex: number | null;
  dragOffset?: { x: number; y: number };
  originalPosition?: { x: number; y: number };
  /** What the drag moves. 'vertex' moves the single point at `vertexIndex`;
   *  'translate' moves the whole shape and ignores `vertexIndex`. One state
   *  for both, so the live preview, the commit and undo all follow one path
   *  — the alternative was a parallel drag state that could disagree. */
  mode?: 'vertex' | 'translate';
}
