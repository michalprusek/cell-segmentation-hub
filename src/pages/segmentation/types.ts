import type { SegmentationResult, Point } from '@/lib/segmentation';

// Enhanced EditMode enum inspired by SpheroSeg
export enum EditMode {
  View = 'view',
  EditVertices = 'edit-vertices',
  AddPoints = 'add-points',
  CreatePolygon = 'create-polygon',
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

export interface ProjectImage {
  id: string;
  name: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  segmentationResult?: SegmentationResult;
}

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

export interface EditorState {
  segmentation: SegmentationResult | null;
  selectedPolygonId: string | null;
  transform: TransformState;
  history: SegmentationResult[];
  historyIndex: number;
  hoveredVertex: { polygonId: string | null; vertexIndex: number | null };
  editMode: EditMode;
  interactionState: InteractionState;
  tempPoints: Point[];
  // Keep legacy support for gradual migration
  /** @deprecated since v2.0.0 - Use transform.zoom instead. Will be removed in v3.0.0 */
  zoom: number;
  /** @deprecated since v2.0.0 - Use transform.translateX/translateY instead. Will be removed in v3.0.0 */
  offset: { x: number; y: number };
  /** @deprecated since v2.0.0 - Use interactionState.isPanning instead. Will be removed in v3.0.0 */
  isDragging: boolean;
  /** @deprecated since v2.0.0 - Use interactionState.isDraggingVertex instead. Will be removed in v3.0.0 */
  isMovingVertex: boolean;
}

export interface EditorActions {
  setSegmentation: (seg: SegmentationResult | null) => void;
  setSelectedPolygonId: (id: string | null) => void;

  // Transform controls
  setTransform: (transform: TransformState) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetView: () => void;

  // History controls
  handleUndo: () => void;
  handleRedo: () => void;

  // Edit mode controls
  setEditMode: (mode: EditMode) => void;
  setInteractionState: (state: InteractionState) => void;
  setTempPoints: (points: Point[]) => void;
  setHoveredVertex: (
    vertex: { polygonId: string; vertexIndex: number } | null
  ) => void;

  // Polygon operations
  handleDeletePolygon: (polygonId?: string) => void;
  handleSave: () => Promise<void>;

  // Advanced editing
  moveVertex: (
    polygonId: string,
    vertexIndex: number,
    newPosition: Point
  ) => void;
  addVertexToPolygon: (
    polygonId: string,
    position: Point,
    afterIndex: number
  ) => void;
  removeVertexFromPolygon: (polygonId: string, vertexIndex: number) => void;
  slicePolygon: (
    polygonId: string,
    startPoint: Point,
    endPoint: Point
  ) => boolean;
  createPolygon: (points: Point[]) => void;

  // Utilities
  isPointInPolygon: (x: number, y: number, points: Point[]) => boolean;
  getCanvasCoordinates: (clientX: number, clientY: number) => Point;

  // Event handlers
  handleMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void;
  handleWheel: (e: React.WheelEvent<HTMLDivElement>) => void;

  // Legacy support
  /** @deprecated since v2.0.0 - Use setEditMode instead. Will be removed in v3.0.0 */
  toggleEditMode: () => void;
  /** @deprecated since v2.0.0 - Use specific edit mode handlers instead. Will be removed in v3.0.0 */
  handleEditModeClick: (x: number, y: number) => void;
}

/**
 * Props pro hlavní polygonovou vrstvu
 */
export interface PolygonLayerProps {
  segmentation: SegmentationResult;
  imageSize: { width: number; height: number };
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null; vertexIndex: number | null };
  vertexDragState: VertexDragState;
  zoom: number;
  offset: { x: number; y: number };
  containerWidth: number;
  containerHeight: number;
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  tempPoints: TempPointsState;
  cursorPosition: Point | null;
  sliceStartPoint: Point | null;
  hoveredSegment: {
    polygonId: string | null;
    segmentIndex: number | null;
    projectedPoint: Point | null;
  };
  isShiftPressed?: boolean;
  onSelectPolygon?: (id: string) => void;
  onDeletePolygon?: (id: string) => void;
  onSlicePolygon?: (id: string) => void;
  onEditPolygon?: (id: string) => void;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
  pointAddingTempPoints?: Point[];
  selectedVertexIndex?: number | null;
  selectedPolygonPoints?: Point[] | null;
  sourcePolygonId?: string | null;
  isZooming?: boolean;
}
