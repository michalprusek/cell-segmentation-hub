
import type { SegmentationResult, Point, Polygon } from "@/lib/segmentation";

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
}

export interface TempPointsState {
  points: Array<{x: number, y: number}>;
  startIndex: number | null;
  endIndex: number | null;
  polygonId: string | null;
}

export interface EditorState {
  segmentation: SegmentationResult | null;
  selectedPolygonId: string | null;
  zoom: number;
  offset: { x: number; y: number };
  history: SegmentationResult[];
  historyIndex: number;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  isDragging: boolean;
  isMovingVertex: boolean;
  editMode: boolean;
  tempPoints: TempPointsState;
}

export interface EditorActions {
  setSegmentation: (seg: SegmentationResult | null) => void;
  setSelectedPolygonId: (id: string | null) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleDeletePolygon: () => void;
  handleResetView: () => void;
  handleSave: () => Promise<void>;
  isPointInPolygon: (x: number, y: number, points: Point[]) => boolean;
  moveVertex: (polygonId: string, vertexIndex: number, newPosition: Point) => void;
  addVertexToPolygon: (polygonId: string, position: Point, afterIndex: number) => void;
  removeVertexFromPolygon: (polygonId: string, vertexIndex: number) => void;
  toggleEditMode: () => void;
  handleEditModeClick: (x: number, y: number) => void;
}

/**
 * Props pro hlavní polygonovou vrstvu
 */
export interface PolygonLayerProps {
  segmentation: SegmentationResult;
  imageSize: { width: number, height: number };
  selectedPolygonId: string | null;
  hoveredVertex: { polygonId: string | null, vertexIndex: number | null };
  vertexDragState: VertexDragState;
  zoom: number;
  editMode: boolean;
  slicingMode: boolean;
  pointAddingMode: boolean;
  tempPoints: TempPointsState;
  cursorPosition: Point | null;
  sliceStartPoint: Point | null;
  hoveredSegment: {
    polygonId: string | null,
    segmentIndex: number | null,
    projectedPoint: Point | null
  };
  isShiftPressed?: boolean;
  onSelectPolygon?: (id: string) => void;
  onDeletePolygon?: (id: string) => void;
  onSlicePolygon?: (id: string) => void;
  onEditPolygon?: (id: string) => void;
  onDuplicatePolygon?: (id: string) => void;
  onDeleteVertex?: (polygonId: string, vertexIndex: number) => void;
  onDuplicateVertex?: (polygonId: string, vertexIndex: number) => void;
  pointAddingTempPoints?: Point[];
  selectedVertexIndex?: number | null;
  selectedPolygonPoints?: Point[] | null;
}
