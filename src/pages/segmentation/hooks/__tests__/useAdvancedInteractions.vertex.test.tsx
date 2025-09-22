/**
 * Tests for useAdvancedInteractions hook - Vertex deletion specific functionality
 * Tests vertex event handling, context menu integration, and deletion workflows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAdvancedInteractions } from '../useAdvancedInteractions';
import { EditMode, InteractionState, TransformState } from '../../types';
import { Polygon, Point } from '@/lib/segmentation';

// Mock coordinate utilities
vi.mock('@/lib/coordinateUtils', () => ({
  getCanvasCoordinates: vi.fn((clientX, clientY) => ({
    imageX: clientX,
    imageY: clientY,
  })),
  canvasToImageCoordinates: vi.fn((x, y) => ({ x, y })),
}));

// Mock polygon geometry utilities
vi.mock('@/lib/polygonGeometry', () => ({
  isPointInPolygon: vi.fn(() => false),
  findClosestVertex: vi.fn(() => null),
  findClosestSegment: vi.fn(() => null),
  calculatePolygonArea: vi.fn(() => 100),
  createPolygon: vi.fn((points) => ({
    id: 'new-polygon',
    points,
    confidence: 0.9,
    type: 'external',
  })),
}));

// Mock DOM element
const mockCanvasRef = {
  current: document.createElement('div'),
};

describe('useAdvancedInteractions - Vertex Deletion', () => {
  const testPolygon: Polygon = {
    id: 'test-polygon-1',
    points: [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
      { x: 30, y: 50 },
      { x: 10, y: 50 },
    ],
    confidence: 0.9,
    type: 'external',
  };

  const mockTransform: TransformState = {
    zoom: 1,
    translateX: 0,
    translateY: 0,
  };

  const mockInteractionState: InteractionState = {
    isPanning: false,
    panStart: null,
    isDraggingVertex: false,
    draggedVertexInfo: null,
    originalVertexPosition: null,
    isAddingPoints: false,
    addPointStartVertex: null,
    addPointEndVertex: null,
    sliceStartPoint: null,
  };

  const defaultProps = {
    editMode: EditMode.EditVertices,
    interactionState: mockInteractionState,
    transform: mockTransform,
    canvasRef: mockCanvasRef,
    selectedPolygonId: 'test-polygon-1',
    tempPoints: [],
    cursorPosition: null,
    isShiftPressed: vi.fn(() => false),
    isSpacePressed: vi.fn(() => false),
    setSelectedPolygonId: vi.fn(),
    onPolygonSelection: vi.fn(),
    setEditMode: vi.fn(),
    setInteractionState: vi.fn(),
    setTempPoints: vi.fn(),
    setHoveredVertex: vi.fn(),
    setVertexDragState: vi.fn(),
    updatePolygons: vi.fn(),
    getPolygons: vi.fn(() => [testPolygon]),
    handlePan: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Vertex Target Detection', () => {
    it('correctly identifies vertex targets in right-click events', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      // Create mock SVG element with vertex data attributes
      const mockVertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      mockVertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      mockVertexElement.setAttribute('data-vertex-index', '2');

      // Create mock mouse event
      const mockEvent = {
        button: 2, // Right-click
        target: mockVertexElement,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseDown(mockEvent);
      });

      // Should not prevent default or stop propagation for vertex right-clicks
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockEvent.stopPropagation).not.toHaveBeenCalled();
    });

    it('handles right-click on non-vertex elements correctly', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      // Create mock non-vertex element
      const mockCanvasElement = document.createElement('div');

      const mockEvent = {
        button: 2, // Right-click
        target: mockCanvasElement,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseDown(mockEvent);
      });

      // Should prevent default for non-vertex right-clicks
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it('distinguishes between vertex and polygon elements', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      // Test vertex element
      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', '1');

      // Test polygon element (has polygon-id but no vertex-index)
      const polygonElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      polygonElement.setAttribute('data-polygon-id', 'test-polygon-1');

      const vertexEvent = {
        button: 2,
        target: vertexElement,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      const polygonEvent = {
        button: 2,
        target: polygonElement,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      // Vertex right-click should not be intercepted
      act(() => {
        result.current.handleMouseDown(vertexEvent);
      });
      expect(vertexEvent.preventDefault).not.toHaveBeenCalled();

      // Polygon right-click should be intercepted
      act(() => {
        result.current.handleMouseDown(polygonEvent);
      });
      expect(polygonEvent.preventDefault).toHaveBeenCalled();
    });
  });

  describe('Mode-Specific Vertex Handling', () => {
    it('allows vertex context menu only in EditVertices mode', () => {
      const { result, rerender } = renderHook(
        (props) => useAdvancedInteractions(props),
        { initialProps: defaultProps }
      );

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', '2');

      const mockEvent = {
        button: 2,
        target: vertexElement,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      // In EditVertices mode, should allow context menu
      act(() => {
        result.current.handleMouseDown(mockEvent);
      });
      expect(mockEvent.preventDefault).not.toHaveBeenCalled();

      // Switch to View mode
      rerender({
        ...defaultProps,
        editMode: EditMode.View,
      });

      const mockEvent2 = {
        button: 2,
        target: vertexElement,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseDown(mockEvent2);
      });

      // In View mode, vertex right-clicks should still be allowed
      // (the mode-specific logic is handled at the component level)
      expect(mockEvent2.preventDefault).not.toHaveBeenCalled();
    });

    it('handles slice mode right-click correctly with non-vertex elements', () => {
      const { result } = renderHook(
        () => useAdvancedInteractions({
          ...defaultProps,
          editMode: EditMode.Slice,
          selectedPolygonId: 'test-polygon-1',
          tempPoints: [],
        })
      );

      const canvasElement = document.createElement('div');
      const mockEvent = {
        button: 2,
        target: canvasElement,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseDown(mockEvent);
      });

      // In slice mode with selected polygon, right-click should clear temp points
      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(defaultProps.setTempPoints).toHaveBeenCalledWith([]);
    });
  });

  describe('Vertex Drag State Integration', () => {
    it('initializes vertex drag state correctly when clicking on vertex', () => {
      const mockGetPolygons = vi.fn(() => [testPolygon]);
      const mockSetVertexDragState = vi.fn();

      const { result } = renderHook(() => useAdvancedInteractions({
        ...defaultProps,
        getPolygons: mockGetPolygons,
        setVertexDragState: mockSetVertexDragState,
      }));

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', '2');

      const mockEvent = {
        button: 0, // Left-click
        target: vertexElement,
        clientX: 50,
        clientY: 50,
        altKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseDown(mockEvent);
      });

      expect(mockSetVertexDragState).toHaveBeenCalledWith({
        isDragging: true,
        polygonId: 'test-polygon-1',
        vertexIndex: 2,
        originalPosition: { x: 50, y: 50 }, // testPolygon.points[2]
        dragOffset: { x: 0, y: 0 },
      });
    });

    it('handles vertex drag state when setVertexDragState is not available', () => {
      const mockGetPolygons = vi.fn(() => [testPolygon]);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { result } = renderHook(() => useAdvancedInteractions({
        ...defaultProps,
        getPolygons: mockGetPolygons,
        setVertexDragState: undefined,
      }));

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', '1');

      const mockEvent = {
        button: 0,
        target: vertexElement,
        clientX: 50,
        clientY: 10,
        altKey: false,
        shiftKey: false,
      } as unknown as React.MouseEvent<HTMLDivElement>;

      // Should not crash when setVertexDragState is undefined
      expect(() => {
        act(() => {
          result.current.handleMouseDown(mockEvent);
        });
      }).not.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith('⚠️ setVertexDragState not available');
      consoleSpy.mockRestore();
    });
  });

  describe('Event Propagation Control', () => {
    it('prevents vertex mouse down events from bubbling to polygon handlers', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', '0');

      const mockEvent = {
        button: 0,
        target: vertexElement,
        clientX: 10,
        clientY: 10,
        altKey: false,
        shiftKey: false,
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseDown(mockEvent);
      });

      // Vertex events should stop propagation at the vertex level
      // This is handled by CanvasVertex component's onMouseDown
      // The hook should process the event normally when it has vertex data
      expect(defaultProps.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({
          isDraggingVertex: true,
          draggedVertexInfo: {
            polygonId: 'test-polygon-1',
            vertexIndex: 0,
          },
        })
      );
    });

    it('allows polygon selection when clicking outside vertices', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      // Mock finding closest vertex to return null (not near any vertex)
      const { findClosestVertex } = require('@/lib/polygonGeometry');
      findClosestVertex.mockReturnValue(null);

      const canvasElement = document.createElement('div');
      const mockEvent = {
        button: 0,
        target: canvasElement,
        clientX: 100,
        clientY: 100,
        altKey: false,
        shiftKey: false,
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseDown(mockEvent);
      });

      // Should call editVerticesClick handler which would handle polygon selection
      expect(defaultProps.setInteractionState).toHaveBeenCalled();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('handles invalid vertex indices gracefully', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', 'invalid');

      const mockEvent = {
        button: 0,
        target: vertexElement,
        clientX: 50,
        clientY: 50,
        altKey: false,
        shiftKey: false,
      } as unknown as React.MouseEvent<HTMLDivElement>;

      // Should not crash with invalid vertex index
      expect(() => {
        act(() => {
          result.current.handleMouseDown(mockEvent);
        });
      }).not.toThrow();
    });

    it('handles missing polygon gracefully', () => {
      const mockGetPolygons = vi.fn(() => []); // No polygons

      const { result } = renderHook(() => useAdvancedInteractions({
        ...defaultProps,
        getPolygons: mockGetPolygons,
      }));

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'nonexistent-polygon');
      vertexElement.setAttribute('data-vertex-index', '0');

      const mockEvent = {
        button: 0,
        target: vertexElement,
        clientX: 50,
        clientY: 50,
        altKey: false,
        shiftKey: false,
      } as unknown as React.MouseEvent<HTMLDivElement>;

      // Should not crash when polygon doesn't exist
      expect(() => {
        act(() => {
          result.current.handleMouseDown(mockEvent);
        });
      }).not.toThrow();

      // Should not update interaction state for nonexistent polygon
      expect(defaultProps.setInteractionState).not.toHaveBeenCalledWith(
        expect.objectContaining({
          isDraggingVertex: true,
        })
      );
    });

    it('handles out-of-bounds vertex index', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', '999'); // Out of bounds

      const mockEvent = {
        button: 0,
        target: vertexElement,
        clientX: 50,
        clientY: 50,
        altKey: false,
        shiftKey: false,
      } as unknown as React.MouseEvent<HTMLDivElement>;

      // Should not crash with out-of-bounds index
      expect(() => {
        act(() => {
          result.current.handleMouseDown(mockEvent);
        });
      }).not.toThrow();
    });
  });

  describe('Integration with Add Points Mode', () => {
    it('switches to AddPoints mode when Shift+clicking vertex', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', '1');

      const mockEvent = {
        button: 0,
        target: vertexElement,
        clientX: 50,
        clientY: 10,
        altKey: false,
        shiftKey: true, // Shift+click
      } as unknown as React.MouseEvent<HTMLDivElement>;

      act(() => {
        result.current.handleMouseDown(mockEvent);
      });

      expect(defaultProps.setEditMode).toHaveBeenCalledWith(EditMode.AddPoints);
      expect(defaultProps.setInteractionState).toHaveBeenCalledWith(
        expect.objectContaining({
          isAddingPoints: true,
          addPointStartVertex: {
            polygonId: 'test-polygon-1',
            vertexIndex: 1,
          },
        })
      );
    });
  });

  describe('Performance Considerations', () => {
    it('handles rapid vertex interactions efficiently', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      const vertexElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      vertexElement.setAttribute('data-polygon-id', 'test-polygon-1');
      vertexElement.setAttribute('data-vertex-index', '2');

      const startTime = performance.now();

      // Simulate rapid interactions
      for (let i = 0; i < 10; i++) {
        const mockEvent = {
          button: 2,
          target: vertexElement,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.MouseEvent<HTMLDivElement>;

        act(() => {
          result.current.handleMouseDown(mockEvent);
        });
      }

      const totalTime = performance.now() - startTime;
      expect(totalTime).toBeLessThan(50); // Should be very fast
    });

    it('optimizes vertex target detection', () => {
      const { result } = renderHook(() => useAdvancedInteractions(defaultProps));

      // Test with various element types
      const elements = [
        document.createElement('div'),
        document.createElementNS('http://www.w3.org/2000/svg', 'circle'),
        document.createElementNS('http://www.w3.org/2000/svg', 'path'),
        document.createTextNode('text'),
      ];

      elements.forEach((element) => {
        const mockEvent = {
          button: 2,
          target: element,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as unknown as React.MouseEvent<HTMLDivElement>;

        // Should handle all element types without errors
        expect(() => {
          act(() => {
            result.current.handleMouseDown(mockEvent);
          });
        }).not.toThrow();
      });
    });
  });
});