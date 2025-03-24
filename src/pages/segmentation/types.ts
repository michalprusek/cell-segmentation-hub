
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
}
