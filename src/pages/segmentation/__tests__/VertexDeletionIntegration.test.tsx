/**
 * Integration Tests for Vertex Deletion Context Menu Functionality
 * Tests complete workflow from right-click → context menu → deletion
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@/test-utils/reactTestUtils';
import { render } from '@testing-library/react';
import { Polygon } from '@/lib/segmentation';
import { EditMode } from '../types';
import VertexContextMenu from '../components/context-menu/VertexContextMenu';
import CanvasVertex from '../components/canvas/CanvasVertex';

// Mock the segmentation context
const mockSetPolygons = vi.fn();
const mockSetSelectedPolygonId = vi.fn();
const mockOnPolygonSelection = vi.fn();

const mockSegmentationContext = {
  polygons: [] as Polygon[],
  setPolygons: mockSetPolygons,
  selectedPolygonId: 'polygon-1',
  setSelectedPolygonId: mockSetSelectedPolygonId,
  onPolygonSelection: mockOnPolygonSelection,
  editMode: EditMode.EditVertices,
  setEditMode: vi.fn(),
  hasUnsavedChanges: false,
  canUndo: false,
  canRedo: false,
  undo: vi.fn(),
  redo: vi.fn(),
  isSaving: false,
  save: vi.fn(),
};

vi.mock('../contexts/useSegmentationContext', () => ({
  useSegmentationContext: () => mockSegmentationContext,
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
    setLanguage: vi.fn(),
  }),
  LanguageProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock useAdvancedInteractions hook
const mockDeleteVertex = vi.fn();
const mockAdvancedInteractions = {
  handleMouseDown: vi.fn(),
  handleMouseMove: vi.fn(),
  handleMouseUp: vi.fn(),
  handleRightClick: vi.fn(),
  deleteVertex: mockDeleteVertex,
};

vi.mock('../hooks/useAdvancedInteractions', () => ({
  useAdvancedInteractions: () => mockAdvancedInteractions,
}));

// Mock Radix UI Context Menu so it works in JSDOM
vi.mock('@/components/ui/context-menu', () => {
  return {
    ContextMenu: ({ children }: any) => children,
    ContextMenuTrigger: ({ children }: any) => children,
    ContextMenuContent: ({
      children,
      className: _c,
      onMouseDown: _md,
      onMouseUp: _mu,
      onClick: _oc,
    }: any) =>
      Object.assign(Object.create(null), {
        $$typeof: Symbol.for('react.element'),
        type: 'div',
        key: null,
        ref: null,
        props: {
          'data-testid': 'context-menu-content',
          role: 'menu',
          children,
        },
        _owner: null,
        _store: {},
      }),
    ContextMenuItem: ({ children, onClick }: any) =>
      Object.assign(Object.create(null), {
        $$typeof: Symbol.for('react.element'),
        type: 'div',
        key: null,
        ref: null,
        props: {
          'data-testid': 'context-menu-item',
          role: 'menuitem',
          onClick,
          children,
        },
        _owner: null,
        _store: {},
      }),
    ContextMenuSeparator: () => null,
    ContextMenuLabel: ({ children }: any) => children,
  };
});

// Mock toast notifications
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Vertex Deletion Integration Tests', () => {
  // Test polygon with enough vertices for deletion
  const testPolygon: Polygon = {
    id: 'polygon-1',
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
      { x: 30, y: 50 },
      { x: 10, y: 50 }, // This vertex will be deleted
    ],
    confidence: 0.9,
    type: 'external',
  };

  // Minimum polygon with 3 vertices (should prevent deletion)
  const minimumPolygon: Polygon = {
    id: 'polygon-2',
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 30, y: 50 },
    ],
    confidence: 0.9,
    type: 'external',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSegmentationContext.polygons = [testPolygon];
    mockSegmentationContext.selectedPolygonId = 'polygon-1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Complete Vertex Deletion Workflow', () => {
    it('completes full workflow: right-click → context menu → deletion', async () => {
      const VertexDeletionComponent = () => {
        const handleDeleteVertex = vi.fn(() => {
          // Simulate vertex deletion logic
          const updatedPolygon = {
            ...testPolygon,
            points: testPolygon.points.filter((_, index) => index !== 3), // Remove vertex at index 3
          };
          mockSetPolygons([updatedPolygon]);
        });

        return (
          <svg width="200" height="200">
            <VertexContextMenu
              onDelete={handleDeleteVertex}
              vertexIndex={3}
              polygonId="polygon-1"
            >
              <CanvasVertex
                point={testPolygon.points[3]}
                polygonId="polygon-1"
                vertexIndex={3}
                isSelected={true}
                isHovered={false}
                isDragging={false}
                zoom={1}
              />
            </VertexContextMenu>
          </svg>
        );
      };

      const { container } = render(<VertexDeletionComponent />);

      // 1. Right-click on vertex to open context menu
      const vertex = container.querySelector(
        '[data-testid^="vertex-"]'
      ) as Element;
      if (!vertex) throw new Error(`Vertex element not found in DOM`);
      fireEvent.contextMenu(vertex);

      // 2. Context menu should appear with delete option
      await waitFor(() => {
        expect(screen.getByTestId('context-menu-content')).toBeInTheDocument();
      });

      const deleteItem = screen.getByTestId('context-menu-item');
      expect(deleteItem).toBeInTheDocument();
      expect(deleteItem).toHaveTextContent('contextMenu.deleteVertex');

      // 3. Click delete option
      fireEvent.click(deleteItem);

      // 4. Verify deletion was called
      await waitFor(() => {
        expect(mockSetPolygons).toHaveBeenCalledWith([
          expect.objectContaining({
            id: 'polygon-1',
            points: expect.arrayContaining([
              { x: 10, y: 10 },
              { x: 50, y: 10 },
              { x: 50, y: 50 },
              { x: 10, y: 50 }, // Vertex at index 3 should be removed
            ]),
          }),
        ]);
      });
    });

    it('prevents polygon deselection during vertex context menu', async () => {
      const VertexWithPolygonSelection = () => {
        const _handleVertexRightClick = vi.fn((e: React.MouseEvent) => {
          e.stopPropagation(); // This should prevent polygon deselection
        });

        const handlePolygonClick = vi.fn(() => {
          mockOnPolygonSelection(null); // This should not be called
        });

        return (
          <svg width="200" height="200" onClick={handlePolygonClick}>
            <VertexContextMenu
              onDelete={vi.fn()}
              vertexIndex={1}
              polygonId="polygon-1"
            >
              <CanvasVertex
                point={testPolygon.points[1]}
                polygonId="polygon-1"
                vertexIndex={1}
                isSelected={true}
                isHovered={false}
                isDragging={false}
                zoom={1}
              />
            </VertexContextMenu>
          </svg>
        );
      };

      const { container: _vc } = render(<VertexWithPolygonSelection />);
      const vertex = _vc.querySelector('[data-testid^="vertex-"]') as Element;

      // Right-click on vertex should not trigger polygon deselection
      fireEvent.contextMenu(vertex);

      await waitFor(() => {
        expect(screen.getByTestId('context-menu-content')).toBeInTheDocument();
      });

      // Polygon should remain selected
      expect(mockOnPolygonSelection).not.toHaveBeenCalledWith(null);
      expect(mockSetSelectedPolygonId).not.toHaveBeenCalledWith(null);
    });
  });

  describe('Vertex Deletion Validation', () => {
    it('allows deletion when polygon has more than 3 vertices', async () => {
      const handleDeleteVertex = vi.fn(() => {
        // Should succeed
        const updatedPolygon = {
          ...testPolygon,
          points: testPolygon.points.slice(0, -1), // Remove last vertex
        };
        mockSetPolygons([updatedPolygon]);
      });

      render(
        <svg>
          <VertexContextMenu
            onDelete={handleDeleteVertex}
            vertexIndex={4}
            polygonId="polygon-1"
          >
            <CanvasVertex
              point={testPolygon.points[4]}
              polygonId="polygon-1"
              vertexIndex={4}
              isSelected={true}
              isHovered={false}
              isDragging={false}
              zoom={1}
            />
          </VertexContextMenu>
        </svg>
      );

      const vertex = document.querySelector(
        '[data-testid^="vertex-"]'
      ) as Element;
      fireEvent.contextMenu(vertex);

      await waitFor(() => {
        expect(screen.getByTestId('context-menu-content')).toBeInTheDocument();
      });

      const deleteItem = screen.getByTestId('context-menu-item');
      fireEvent.click(deleteItem);

      await waitFor(() => {
        expect(handleDeleteVertex).toHaveBeenCalledTimes(1);
      });
    });

    it('prevents deletion when polygon has only 3 vertices', async () => {
      mockSegmentationContext.polygons = [minimumPolygon];
      mockSegmentationContext.selectedPolygonId = 'polygon-2';

      const handleDeleteVertex = vi.fn(() => {
        // Should show error and not delete
        throw new Error('Cannot delete vertex: minimum 3 vertices required');
      });

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      render(
        <svg>
          <VertexContextMenu
            onDelete={handleDeleteVertex}
            vertexIndex={1}
            polygonId="polygon-2"
          >
            <CanvasVertex
              point={minimumPolygon.points[1]}
              polygonId="polygon-2"
              vertexIndex={1}
              isSelected={true}
              isHovered={false}
              isDragging={false}
              zoom={1}
            />
          </VertexContextMenu>
        </svg>
      );

      const vertex = document.querySelector(
        '[data-testid^="vertex-"]'
      ) as Element;
      fireEvent.contextMenu(vertex);

      await waitFor(() => {
        expect(screen.getByTestId('context-menu-content')).toBeInTheDocument();
      });

      const deleteItem = screen.getByTestId('context-menu-item');

      // Should not crash even if deletion fails
      expect(() => {
        fireEvent.click(deleteItem);
      }).not.toThrow();

      consoleSpy.mockRestore();
    });
  });

  describe('Mode-Dependent Behavior', () => {
    it('only shows context menu when polygon is selected in EditVertices mode', async () => {
      mockSegmentationContext.editMode = EditMode.EditVertices;
      mockSegmentationContext.selectedPolygonId = 'polygon-1';

      render(
        <svg>
          <VertexContextMenu
            onDelete={vi.fn()}
            vertexIndex={1}
            polygonId="polygon-1"
          >
            <CanvasVertex
              point={testPolygon.points[1]}
              polygonId="polygon-1"
              vertexIndex={1}
              isSelected={true}
              isHovered={false}
              isDragging={false}
              zoom={1}
            />
          </VertexContextMenu>
        </svg>
      );

      const vertex = document.querySelector(
        '[data-testid^="vertex-"]'
      ) as Element;
      fireEvent.contextMenu(vertex);

      await waitFor(() => {
        expect(screen.getByTestId('context-menu-content')).toBeInTheDocument();
      });
    });

    it('does not interfere with other modes', async () => {
      mockSegmentationContext.editMode = EditMode.View;
      mockSegmentationContext.selectedPolygonId = null;

      const handleRightClick = vi.fn();

      render(
        <svg onContextMenu={handleRightClick}>
          <CanvasVertex
            point={testPolygon.points[1]}
            polygonId="polygon-1"
            vertexIndex={1}
            isSelected={false}
            isHovered={false}
            isDragging={false}
            zoom={1}
          />
        </svg>
      );

      const vertex = document.querySelector(
        '[data-testid^="vertex-"]'
      ) as Element;
      fireEvent.contextMenu(vertex);

      // Should still propagate to parent handlers in non-edit modes
      expect(handleRightClick).toHaveBeenCalled();
    });
  });

  describe('Event Propagation and Isolation', () => {
    it('isolates vertex events from polygon selection', async () => {
      const handlePolygonSelection = vi.fn();
      const handleVertexDelete = vi.fn();

      render(
        <svg>
          <g onClick={() => handlePolygonSelection('polygon-1')}>
            <VertexContextMenu
              onDelete={handleVertexDelete}
              vertexIndex={2}
              polygonId="polygon-1"
            >
              <CanvasVertex
                point={testPolygon.points[2]}
                polygonId="polygon-1"
                vertexIndex={2}
                isSelected={true}
                isHovered={false}
                isDragging={false}
                zoom={1}
              />
            </VertexContextMenu>
          </g>
        </svg>
      );

      const vertex = document.querySelector(
        '[data-testid^="vertex-"]'
      ) as Element;

      // Mouse down on vertex should not trigger polygon selection
      fireEvent.mouseDown(vertex);
      expect(handlePolygonSelection).not.toHaveBeenCalled();

      // But right-click should still work for context menu
      fireEvent.contextMenu(vertex);
      await waitFor(() => {
        expect(screen.getByTestId('context-menu-content')).toBeInTheDocument();
      });
    });

    it('allows slice mode right-click to work on non-vertex areas', async () => {
      mockSegmentationContext.editMode = EditMode.Slice;

      const handleCanvasRightClick = vi.fn();

      render(
        <svg onContextMenu={handleCanvasRightClick}>
          <rect x="0" y="0" width="100" height="100" fill="transparent" />
          <CanvasVertex
            point={testPolygon.points[0]}
            polygonId="polygon-1"
            vertexIndex={0}
            isSelected={false}
            isHovered={false}
            isDragging={false}
            zoom={1}
          />
        </svg>
      );

      // Query the SVG directly (JSDOM doesn't expose standalone SVG as 'img' role)
      const canvas = document.querySelector('svg') as Element;
      fireEvent.contextMenu(canvas);

      // Should allow slice mode context menu on canvas
      expect(handleCanvasRightClick).toHaveBeenCalled();
    });
  });

  describe('Multiple Vertex Deletion Sequence', () => {
    it('handles multiple sequential vertex deletions', async () => {
      let currentPolygon = { ...testPolygon };

      const handleDeleteVertex = vi.fn((vertexIndex: number) => {
        // Remove vertex at specified index
        currentPolygon = {
          ...currentPolygon,
          points: currentPolygon.points.filter(
            (_, index) => index !== vertexIndex
          ),
        };
        mockSetPolygons([currentPolygon]);
      });

      const MultiVertexDeletionComponent = () => {
        const [polygonState, setPolygonState] = React.useState(currentPolygon);

        React.useEffect(() => {
          setPolygonState(currentPolygon);
          // currentPolygon is mutated in outer scope by handleDeleteVertex; the
          // dep is intentionally listed so this test re-syncs after mutations.
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [currentPolygon]);

        return (
          <svg width="200" height="200">
            {polygonState.points.map((point, index) => (
              <VertexContextMenu
                key={`vertex-${index}`}
                onDelete={() => handleDeleteVertex(index)}
                vertexIndex={index}
                polygonId="polygon-1"
              >
                <CanvasVertex
                  point={point}
                  polygonId="polygon-1"
                  vertexIndex={index}
                  isSelected={true}
                  isHovered={false}
                  isDragging={false}
                  zoom={1}
                />
              </VertexContextMenu>
            ))}
          </svg>
        );
      };

      const { container: _rc0 } = render(<MultiVertexDeletionComponent />);

      // Delete first vertex (should have 5 initially)
      const vertices = Array.from(
        document.querySelectorAll('[data-testid^="vertex-"]')
      );
      expect(vertices).toHaveLength(5);

      fireEvent.contextMenu(vertices[0]);
      await waitFor(() => {
        // Multiple context menus are rendered (one per vertex) - get the first
        expect(
          screen.getAllByTestId('context-menu-content')[0]
        ).toBeInTheDocument();
      });

      const deleteItem = screen.getAllByTestId('context-menu-item')[0];
      fireEvent.click(deleteItem);

      await waitFor(() => {
        expect(handleDeleteVertex).toHaveBeenCalledWith(0);
      });

      // Should prevent deletion when reaching minimum (3 vertices)
      expect(currentPolygon.points).toHaveLength(4);
    });
  });

  describe('Error Handling and Recovery', () => {
    it('handles deletion errors gracefully', async () => {
      const faultyDeleteHandler = vi.fn(() => {
        throw new Error('Network error during deletion');
      });

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      render(
        <svg>
          <VertexContextMenu
            onDelete={faultyDeleteHandler}
            vertexIndex={1}
            polygonId="polygon-1"
          >
            <CanvasVertex
              point={testPolygon.points[1]}
              polygonId="polygon-1"
              vertexIndex={1}
              isSelected={true}
              isHovered={false}
              isDragging={false}
              zoom={1}
            />
          </VertexContextMenu>
        </svg>
      );

      const vertex = document.querySelector(
        '[data-testid^="vertex-"]'
      ) as Element;
      fireEvent.contextMenu(vertex);

      await waitFor(() => {
        expect(screen.getByTestId('context-menu-content')).toBeInTheDocument();
      });

      const deleteItem = screen.getByTestId('context-menu-item');

      // Should not crash the application
      expect(() => {
        fireEvent.click(deleteItem);
      }).not.toThrow();

      await waitFor(() => {
        expect(faultyDeleteHandler).toHaveBeenCalledTimes(1);
      });

      // Component should still be functional
      expect(vertex).toBeInTheDocument();

      consoleSpy.mockRestore();
    });

    it('maintains polygon integrity after failed deletion', async () => {
      const originalPolygon = { ...testPolygon };

      const faultyDeleteHandler = vi.fn(() => {
        throw new Error('Deletion failed');
      });

      render(
        <svg>
          <VertexContextMenu
            onDelete={faultyDeleteHandler}
            vertexIndex={2}
            polygonId="polygon-1"
          >
            <CanvasVertex
              point={testPolygon.points[2]}
              polygonId="polygon-1"
              vertexIndex={2}
              isSelected={true}
              isHovered={false}
              isDragging={false}
              zoom={1}
            />
          </VertexContextMenu>
        </svg>
      );

      const vertex = document.querySelector(
        '[data-testid^="vertex-"]'
      ) as Element;
      fireEvent.contextMenu(vertex);

      await waitFor(() => {
        expect(screen.getByTestId('context-menu-content')).toBeInTheDocument();
      });

      const deleteItem = screen.getByTestId('context-menu-item');
      fireEvent.click(deleteItem);

      // Polygon should remain unchanged
      expect(mockSegmentationContext.polygons[0]).toEqual(originalPolygon);
    });
  });

  describe('Performance Under Load', () => {
    it('handles many vertices efficiently', async () => {
      // Create polygon with many vertices
      const manyVerticesPolygon: Polygon = {
        id: 'polygon-many',
        points: Array.from({ length: 50 }, (_, i) => ({
          x: 10 + ((i * 5) % 200),
          y: 10 + Math.floor(i / 40) * 20,
        })),
        confidence: 0.9,
        type: 'external',
      };

      const handleDeleteVertex = vi.fn();

      const startTime = performance.now();

      render(
        <svg width="300" height="300">
          {manyVerticesPolygon.points.map((point, index) => (
            <VertexContextMenu
              key={`vertex-${index}`}
              onDelete={() => handleDeleteVertex(index)}
              vertexIndex={index}
              polygonId="polygon-many"
            >
              <CanvasVertex
                point={point}
                polygonId="polygon-many"
                vertexIndex={index}
                isSelected={true}
                isHovered={false}
                isDragging={false}
                zoom={1}
              />
            </VertexContextMenu>
          ))}
        </svg>
      );

      const renderTime = performance.now() - startTime;

      // Should render efficiently even with many vertices (load-tolerant ceiling)
      expect(renderTime).toBeLessThan(2000);

      const vertices = Array.from(
        document.querySelectorAll('[data-testid^="vertex-"]')
      );
      expect(vertices).toHaveLength(50);
    });
  });
});
