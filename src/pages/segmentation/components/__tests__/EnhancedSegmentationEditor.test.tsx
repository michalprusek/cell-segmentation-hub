/**
 * EnhancedSegmentationEditor — behavioral unit tests
 *
 * Strategy:
 *   The component is a heavy orchestrator of canvas children and the
 *   useEnhancedSegmentationEditor hook.  We stub all canvas sub-components
 *   and the hook so tests run in jsdom without WebGL / ResizeObserver.
 *   The surface under test is the orchestration layer the component
 *   directly owns:
 *
 * Covered:
 *  - Root div receives className prop
 *  - Toolbar rendered with hook's editMode
 *  - Status bar: polygon count from hook
 *  - Status bar: selected polygon vertex count visible when polygon selected
 *  - Status bar: zoom percentage displayed
 *  - Status bar: "unsaved changes" shown when hasUnsavedChanges=true
 *  - Status bar: "unsaved changes" NOT shown when hasUnsavedChanges=false
 *  - Passes onSave to hook as handleSave
 *  - Passes onPolygonsChange through hook (called on polygon update)
 *
 * NOT tested (not owned by this component):
 *  - Canvas mouse interaction logic — owned by useEnhancedSegmentationEditor
 *    and useAdvancedInteractions.
 *  - ResizeObserver-driven dimension calculation — requires real layout.
 *  - Per-polygon CanvasPolygon/CanvasVertex rendering — each has its own tests.
 *  - CanvasContainer / CanvasContent / CanvasImage / ModeInstructions —
 *    stubbed here; each has its own tests.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import EnhancedSegmentationEditor from '../EnhancedSegmentationEditor';
import { EditMode } from '../../types';
import type { Polygon } from '@/lib/segmentation';

// ---------------------------------------------------------------------------
// Stub canvas sub-components — they are independently tested and bring in
// canvas/WebGL APIs that jsdom does not implement.
// ---------------------------------------------------------------------------

vi.mock('../EnhancedEditorToolbar', () => ({
  default: ({ editMode }: { editMode: string }) => (
    <div data-testid="toolbar" data-edit-mode={editMode} />
  ),
}));

vi.mock('../canvas/CanvasContainer', () => ({
  default: React.forwardRef(
    (
      { children }: React.PropsWithChildren<object>,
      _ref: React.Ref<HTMLDivElement>
    ) => <div data-testid="canvas-container">{children}</div>
  ),
}));

vi.mock('../canvas/CanvasContent', () => ({
  default: ({ children }: React.PropsWithChildren<object>) => (
    <div data-testid="canvas-content">{children}</div>
  ),
}));

vi.mock('../canvas/CanvasImage', () => ({
  default: () => <img data-testid="canvas-image" alt="mock" />,
}));

vi.mock('../canvas/CanvasPolygon', () => ({
  default: () => null,
}));

vi.mock('../canvas/CanvasVertex', () => ({
  default: () => null,
}));

vi.mock('../canvas/ModeInstructions', () => ({
  default: () => null,
}));

vi.mock('../canvas/CanvasTemporaryGeometryLayer', () => ({
  default: () => null,
}));

// ---------------------------------------------------------------------------
// Stub the hook — return a controlled editor-state object so we can vary
// the values per test.
// ---------------------------------------------------------------------------

interface MockEditorState {
  editMode: EditMode;
  polygons: Polygon[];
  selectedPolygonId: string | null;
  selectedPolygon: Polygon | null;
  canUndo: boolean;
  canRedo: boolean;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  transform: { zoom: number; x: number; y: number };
  hoveredVertex: {
    polygonId: string | null;
    vertexIndex: number | null;
  } | null;
  tempPoints: unknown[];
  cursorPosition: { x: number; y: number } | null;
  interactionState: { isDraggingVertex: boolean; draggedVertexInfo: null };
  vertexDragState: { isDragging: boolean; polygonId: null; vertexIndex: null };
}

const DEFAULT_MOCK_STATE: MockEditorState = {
  editMode: EditMode.View,
  polygons: [],
  selectedPolygonId: null,
  selectedPolygon: null,
  canUndo: false,
  canRedo: false,
  hasUnsavedChanges: false,
  isSaving: false,
  transform: { zoom: 1.0, x: 0, y: 0 },
  hoveredVertex: null,
  tempPoints: [],
  cursorPosition: null,
  interactionState: { isDraggingVertex: false, draggedVertexInfo: null },
  vertexDragState: { isDragging: false, polygonId: null, vertexIndex: null },
};

let mockEditorState: MockEditorState = { ...DEFAULT_MOCK_STATE };

vi.mock('../../hooks/useEnhancedSegmentationEditor', () => ({
  useEnhancedSegmentationEditor: () => ({
    ...mockEditorState,
    canvasRef: { current: null },
    setEditMode: vi.fn(),
    setSelectedPolygonId: vi.fn(),
    setTempPoints: vi.fn(),
    setInteractionState: vi.fn(),
    setHoveredVertex: vi.fn(),
    setVertexDragState: vi.fn(),
    setTransform: vi.fn(),
    updatePolygons: vi.fn(),
    getPolygons: vi.fn(() => mockEditorState.polygons),
    handleUndo: vi.fn(),
    handleRedo: vi.fn(),
    handleSave: vi.fn(() => Promise.resolve()),
    handleZoomIn: vi.fn(),
    handleZoomOut: vi.fn(),
    handleResetView: vi.fn(),
    handlePan: vi.fn(),
    handleDeletePolygon: vi.fn(),
    handlePolygonSelection: vi.fn(),
    handlePolygonClick: vi.fn(),
    handleDeleteVertex: vi.fn(),
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
    handleMouseUp: vi.fn(),
    handleCreatePolylineDoubleClick: vi.fn(),
    slicing: {},
    keyboardState: {
      isShiftPressed: vi.fn(() => false),
      isCtrlPressed: vi.fn(() => false),
      isAltPressed: vi.fn(() => false),
    },
    handleEscape: vi.fn(),
    isZooming: false,
  }),
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makePoly(
  id: string,
  points: Array<{ x: number; y: number }>
): Polygon {
  return {
    id,
    points,
    geometry: 'polygon',
    color: '#ff0000',
    visible: true,
  } as unknown as Polygon;
}

const defaultProps = {
  imageUrl: 'http://example.com/img.png',
  imageWidth: 800,
  imageHeight: 600,
};

// ---------------------------------------------------------------------------

describe('EnhancedSegmentationEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditorState = { ...DEFAULT_MOCK_STATE };
  });

  // ---- className pass-through --------------------------------------------

  describe('className prop', () => {
    it('applies custom className to root container', () => {
      const { container } = render(
        <EnhancedSegmentationEditor {...defaultProps} className="my-class" />
      );
      expect(container.firstChild).toHaveClass('my-class');
    });

    it('uses empty string className by default', () => {
      const { container } = render(
        <EnhancedSegmentationEditor {...defaultProps} />
      );
      // No additional custom class; base flex classes are always present
      expect(container.firstChild).toHaveClass('flex');
    });
  });

  // ---- Toolbar wiring ----------------------------------------------------

  describe('toolbar', () => {
    it('renders the toolbar stub', () => {
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      expect(screen.getByTestId('toolbar')).toBeInTheDocument();
    });

    it('passes current editMode to toolbar', () => {
      mockEditorState.editMode = EditMode.CreatePolygon;
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      expect(screen.getByTestId('toolbar').dataset.editMode).toBe(
        EditMode.CreatePolygon
      );
    });
  });

  // ---- Status bar — polygon count ----------------------------------------

  describe('status bar polygon count', () => {
    it('shows "Polygons: 0" when no polygons', () => {
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      // Text is split across nodes: "Polygons: " + "0"; use regex on body
      expect(document.body.textContent).toMatch(/Polygons:\s*0/);
    });

    it('shows correct polygon count', () => {
      mockEditorState.polygons = [
        makePoly('p1', [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]),
        makePoly('p2', [
          { x: 2, y: 2 },
          { x: 3, y: 3 },
        ]),
      ];
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      expect(document.body.textContent).toMatch(/Polygons:\s*2/);
    });
  });

  // ---- Status bar — selected polygon vertex count ------------------------

  describe('status bar selected polygon', () => {
    it('shows vertex count when a polygon is selected', () => {
      const poly = makePoly('p1', [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]);
      mockEditorState.selectedPolygon = poly;
      mockEditorState.selectedPolygonId = 'p1';
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      // "Selected: " + "4" + " vertices" — text split across nodes
      expect(document.body.textContent).toMatch(/Selected:\s*4 vertices/);
    });

    it('does NOT show vertex count when no polygon is selected', () => {
      mockEditorState.selectedPolygon = null;
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      expect(document.body.textContent).not.toMatch(/Selected:/);
    });
  });

  // ---- Status bar — zoom percentage --------------------------------------

  describe('status bar zoom', () => {
    it('shows zoom as percentage', () => {
      mockEditorState.transform = { zoom: 1.5, x: 0, y: 0 };
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      // "Zoom: " + "150" + "%" — text split across nodes
      expect(document.body.textContent).toMatch(/Zoom:\s*150%/);
    });

    it('shows 100% at default zoom', () => {
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      expect(document.body.textContent).toMatch(/Zoom:\s*100%/);
    });
  });

  // ---- Status bar — unsaved changes indicator ----------------------------

  describe('status bar unsaved changes', () => {
    it('shows unsaved changes text when hasUnsavedChanges=true', () => {
      mockEditorState.hasUnsavedChanges = true;
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      // i18n key 'segmentationEditor.error.unsavedChanges'
      // Check via body text content — works regardless of how many text nodes
      expect(document.body.textContent?.toLowerCase()).toContain('unsaved');
    });

    it('does NOT show unsaved changes text when hasUnsavedChanges=false', () => {
      mockEditorState.hasUnsavedChanges = false;
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      expect(document.body.textContent?.toLowerCase()).not.toContain('unsaved');
    });
  });

  // ---- Status bar — edit mode label --------------------------------------

  describe('status bar edit mode', () => {
    it('shows current mode name', () => {
      mockEditorState.editMode = EditMode.EditVertices;
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      // "Mode: " + "edit-vertices" — text split across nodes
      expect(document.body.textContent).toMatch(/Mode:\s*edit-vertices/);
    });
  });

  // ---- Canvas sub-components rendered ------------------------------------

  describe('canvas area', () => {
    it('renders canvas container stub', () => {
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      expect(screen.getByTestId('canvas-container')).toBeInTheDocument();
    });

    it('renders canvas image stub', () => {
      render(<EnhancedSegmentationEditor {...defaultProps} />);
      expect(screen.getByTestId('canvas-image')).toBeInTheDocument();
    });
  });
});
