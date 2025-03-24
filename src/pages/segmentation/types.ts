
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
}
