/**
 * Segmentation editor specific testing utilities
 * Provides mocks, helpers, and assertions for polygon editing functionality
 */

import { vi } from 'vitest';
import type { Point, Polygon } from '@/lib/segmentation';
import type {
  EditMode,
  InteractionState,
  TransformState,
} from '@/pages/segmentation/types';
import {
  createMockCanvasContext,
  MockCanvasRenderingContext2D,
} from './canvasTestUtils';

/**
 * Mock segmentation editor props type
 */
export interface MockSegmentationEditorProps {
  initialPolygons?: Polygon[];
  imageWidth?: number;
  imageHeight?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  onSave?: () => Promise<void>;
  onPolygonsChange?: (polygons: Polygon[]) => void;
  imageId?: string;
  [key: string]: any;
}

/**
 * Create mock segmentation editor props for testing
 */
export const createMockSegmentationEditorProps = (
  overrides: Partial<MockSegmentationEditorProps> = {}
): MockSegmentationEditorProps => ({
  initialPolygons: [],
  imageWidth: 1000,
  imageHeight: 800,
  canvasWidth: 800,
  canvasHeight: 600,
  onSave: vi.fn().mockResolvedValue(undefined),
  onPolygonsChange: vi.fn(),
  imageId: 'test-image-id',
  ...overrides,
});

/**
 * Create mock polygon for testing with realistic properties
 */
export const createMockPolygon = (
  overrides: Partial<Polygon> = {}
): Polygon => ({
  id: `polygon-${Math.random().toString(36).substr(2, 9)}`,
  points: [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 50 },
    { x: 10, y: 50 },
  ],
  confidence: 0.9,
  type: 'external',
  ...overrides,
});

/**
 * Create multiple mock polygons with different shapes
 */
export const createMockPolygons = (count: number = 3): Polygon[] => {
  const polygons: Polygon[] = [];

  for (let i = 0; i < count; i++) {
    const baseX = i * 100;
    const baseY = i * 80;

    if (i % 3 === 0) {
      // Rectangle
      polygons.push(
        createMockPolygon({
          id: `rect-${i}`,
          points: [
            { x: baseX, y: baseY },
            { x: baseX + 60, y: baseY },
            { x: baseX + 60, y: baseY + 40 },
            { x: baseX, y: baseY + 40 },
          ],
        })
      );
    } else if (i % 3 === 1) {
      // Triangle
      polygons.push(
        createMockPolygon({
          id: `triangle-${i}`,
          points: [
            { x: baseX + 30, y: baseY },
            { x: baseX + 60, y: baseY + 50 },
            { x: baseX, y: baseY + 50 },
          ],
        })
      );
    } else {
      // Hexagon
      const centerX = baseX + 30;
      const centerY = baseY + 30;
      const radius = 25;
      const points: Point[] = [];
      for (let angle = 0; angle < 360; angle += 60) {
        const radians = (angle * Math.PI) / 180;
        points.push({
          x: centerX + Math.cos(radians) * radius,
          y: centerY + Math.sin(radians) * radius,
        });
      }

      polygons.push(
        createMockPolygon({
          id: `hex-${i}`,
          points,
        })
      );
    }
  }

  return polygons;
};

/**
 * Mock interaction state with realistic values
 */
export const createMockInteractionState = (
  overrides: Partial<InteractionState> = {}
): InteractionState => ({
  isDraggingVertex: false,
  isPanning: false,
  panStart: null,
  draggedVertexInfo: null,
  originalVertexPosition: null,
  sliceStartPoint: null,
  addPointStartVertex: null,
  addPointEndVertex: null,
  isAddingPoints: false,
  ...overrides,
});

/**
 * Mock transform state with realistic values
 */
export const createMockTransformState = (
  overrides: Partial<TransformState> = {}
): TransformState => ({
  zoom: 1,
  translateX: 0,
  translateY: 0,
  ...overrides,
});

/**
 * Mock canvas operations for polygon rendering
 */
export const createPolygonRenderingMocks = () => {
  const context = createMockCanvasContext();

  const renderPolygon = (polygon: Polygon) => {
    context.beginPath();
    if (polygon.points.length > 0) {
      context.moveTo(polygon.points[0].x, polygon.points[0].y);
      for (let i = 1; i < polygon.points.length; i++) {
        context.lineTo(polygon.points[i].x, polygon.points[i].y);
      }
    }
    context.closePath();
    context.stroke();
  };

  const renderVertex = (point: Point, radius: number = 5) => {
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
  };

  return {
    context,
    renderPolygon,
    renderVertex,
  };
};

/**
 * Mock coordinate transformation utilities
 */
export const createCoordinateTransformMocks = () => {
  const canvasToImage = vi.fn(
    (canvasPoint: Point, transform: TransformState): Point => ({
      x: (canvasPoint.x - transform.translateX) / transform.zoom,
      y: (canvasPoint.y - transform.translateY) / transform.zoom,
    })
  );

  const imageToCanvas = vi.fn(
    (imagePoint: Point, transform: TransformState): Point => ({
      x: imagePoint.x * transform.zoom + transform.translateX,
      y: imagePoint.y * transform.zoom + transform.translateY,
    })
  );

  const getCanvasCoordinates = vi.fn(
    (
      clientX: number,
      clientY: number,
      canvasRect: DOMRect,
      transform: TransformState
    ): Point => {
      const canvasX = clientX - canvasRect.left;
      const canvasY = clientY - canvasRect.top;
      return canvasToImage({ x: canvasX, y: canvasY }, transform);
    }
  );

  return {
    canvasToImage,
    imageToCanvas,
    getCanvasCoordinates,
  };
};

/**
 * Mock keyboard event handlers
 */
export const createKeyboardEventMocks = () => {
  const keysPressed = new Set<string>();

  const keyDown = vi.fn((key: string) => {
    keysPressed.add(key);
  });

  const keyUp = vi.fn((key: string) => {
    keysPressed.delete(key);
  });

  const isKeyPressed = vi.fn((key: string) => keysPressed.has(key));

  const clearKeys = () => {
    keysPressed.clear();
  };

  return {
    keyDown,
    keyUp,
    isKeyPressed,
    clearKeys,
    get keysPressed() {
      return new Set(keysPressed);
    },
  };
};

/**
 * Mock mouse interaction sequence
 */
export const simulateMouseInteraction = async (
  element: HTMLElement,
  sequence: Array<{
    type: 'mousedown' | 'mousemove' | 'mouseup' | 'click' | 'dblclick';
    x: number;
    y: number;
    button?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    delay?: number;
  }>
) => {
  for (const action of sequence) {
    const event = new MouseEvent(action.type, {
      clientX: action.x,
      clientY: action.y,
      button: action.button || 0,
      ctrlKey: action.ctrlKey || false,
      shiftKey: action.shiftKey || false,
      bubbles: true,
      cancelable: true,
    });

    element.dispatchEvent(event);

    if (action.delay) {
      await new Promise(resolve => setTimeout(resolve, action.delay));
    }
  }
};

/**
 * Mock polygon geometry operations
 */
export const createGeometryMocks = () => {
  const isPointInPolygon = vi.fn((point: Point, polygon: Polygon): boolean => {
    // Simple bounding box check for testing
    const minX = Math.min(...polygon.points.map(p => p.x));
    const maxX = Math.max(...polygon.points.map(p => p.x));
    const minY = Math.min(...polygon.points.map(p => p.y));
    const maxY = Math.max(...polygon.points.map(p => p.y));

    return (
      point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
    );
  });

  const distanceToVertex = vi.fn((point: Point, vertex: Point): number => {
    return Math.sqrt(
      Math.pow(point.x - vertex.x, 2) + Math.pow(point.y - vertex.y, 2)
    );
  });

  const findNearestVertex = vi.fn(
    (point: Point, polygon: Polygon, threshold: number = 10) => {
      let nearestIndex = -1;
      let nearestDistance = Infinity;

      polygon.points.forEach((vertex, index) => {
        const distance = distanceToVertex(point, vertex);
        if (distance < threshold && distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      return nearestIndex >= 0
        ? { index: nearestIndex, distance: nearestDistance }
        : null;
    }
  );

  const calculatePolygonBounds = vi.fn((polygon: Polygon) => {
    const xs = polygon.points.map(p => p.x);
    const ys = polygon.points.map(p => p.y);

    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  });

  return {
    isPointInPolygon,
    distanceToVertex,
    findNearestVertex,
    calculatePolygonBounds,
  };
};

/**
 * Mock undo/redo history management
 */
export const createHistoryMocks = () => {
  const history: Polygon[][] = [];
  let currentIndex = -1;

  const addToHistory = vi.fn((polygons: Polygon[]) => {
    // Remove any future history if we're not at the end
    history.splice(currentIndex + 1);
    history.push([...polygons]);
    currentIndex = history.length - 1;
  });

  const undo = vi.fn(() => {
    if (currentIndex > 0) {
      currentIndex--;
      return history[currentIndex];
    }
    return null;
  });

  const redo = vi.fn(() => {
    if (currentIndex < history.length - 1) {
      currentIndex++;
      return history[currentIndex];
    }
    return null;
  });

  const canUndo = vi.fn(() => currentIndex > 0);
  const canRedo = vi.fn(() => currentIndex < history.length - 1);

  const clearHistory = () => {
    history.length = 0;
    currentIndex = -1;
  };

  return {
    history,
    get currentIndex() {
      return currentIndex;
    },
    addToHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
  };
};

/**
 * Mock file operations for export/import
 */
export const createFileMocks = () => {
  const exportToCOCO = vi.fn(
    (polygons: Polygon[], imageWidth: number, imageHeight: number) => {
      return {
        images: [
          {
            id: 1,
            width: imageWidth,
            height: imageHeight,
            file_name: 'test-image.jpg',
          },
        ],
        annotations: polygons.map((polygon, index) => ({
          id: index + 1,
          image_id: 1,
          category_id: 1,
          segmentation: [polygon.points.flatMap(p => [p.x, p.y])],
          area: calculatePolygonArea(polygon),
          bbox: calculatePolygonBbox(polygon),
        })),
        categories: [
          {
            id: 1,
            name: 'cell',
            supercategory: 'object',
          },
        ],
      };
    }
  );

  const exportToExcel = vi.fn((polygons: Polygon[]) => {
    return polygons.map((polygon, index) => ({
      'Polygon ID': polygon.id,
      Index: index + 1,
      Area: calculatePolygonArea(polygon),
      Perimeter: calculatePolygonPerimeter(polygon),
      Confidence: polygon.confidence,
      Type: polygon.type,
      Vertices: polygon.points.length,
    }));
  });

  const calculatePolygonArea = (polygon: Polygon): number => {
    let area = 0;
    const points = polygon.points;

    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      area += (points[j].x + points[i].x) * (points[j].y - points[i].y);
    }

    return Math.abs(area / 2);
  };

  const calculatePolygonPerimeter = (polygon: Polygon): number => {
    let perimeter = 0;
    const points = polygon.points;

    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      perimeter += Math.sqrt(
        Math.pow(next.x - current.x, 2) + Math.pow(next.y - current.y, 2)
      );
    }

    return perimeter;
  };

  const calculatePolygonBbox = (
    polygon: Polygon
  ): [number, number, number, number] => {
    const xs = polygon.points.map(p => p.x);
    const ys = polygon.points.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return [minX, minY, maxX - minX, maxY - minY];
  };

  return {
    exportToCOCO,
    exportToExcel,
    calculatePolygonArea,
    calculatePolygonPerimeter,
    calculatePolygonBbox,
  };
};

/**
 * Mock WebSocket connection for real-time updates
 */
export const createWebSocketMocks = () => {
  const mockWebSocket = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onopen: null as any,
    onclose: null as any,
    onmessage: null as any,
    onerror: null as any,
  };

  const simulateMessage = (data: any) => {
    if (mockWebSocket.onmessage) {
      mockWebSocket.onmessage({ data: JSON.stringify(data) } as any);
    }
  };

  const simulateOpen = () => {
    if (mockWebSocket.onopen) {
      mockWebSocket.onopen({} as any);
    }
  };

  const simulateClose = () => {
    if (mockWebSocket.onclose) {
      mockWebSocket.onclose({} as any);
    }
  };

  return {
    mockWebSocket,
    simulateMessage,
    simulateOpen,
    simulateClose,
  };
};

/**
 * Performance testing utilities for complex operations
 */
export const createPerformanceTestUtils = () => {
  const measureRenderTime = async (
    renderOperation: () => void,
    iterations: number = 10
  ): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    fps: number;
  }> => {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      renderOperation();
      const end = performance.now();
      times.push(end - start);
    }

    const averageTime = times.reduce((sum, time) => sum + time, 0) / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const fps = 1000 / averageTime;

    return { averageTime, minTime, maxTime, fps };
  };

  const measureMemoryUsage = (): {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  } => {
    // Guard for non-Chrome browsers where performance.memory doesn't exist
    if (typeof performance === 'undefined' || !('memory' in performance)) {
      return {
        usedJSHeapSize: 0,
        totalJSHeapSize: 0,
        jsHeapSizeLimit: 0,
      };
    }

    // @ts-expect-error - performance.memory exists in Chrome
    const memory = performance.memory;

    return {
      usedJSHeapSize: memory?.usedJSHeapSize || 0,
      totalJSHeapSize: memory?.totalJSHeapSize || 0,
      jsHeapSizeLimit: memory?.jsHeapSizeLimit || 0,
    };
  };

  return {
    measureRenderTime,
    measureMemoryUsage,
  };
};

/**
 * Mock error scenarios for testing error handling
 */
export const createErrorScenarios = () => {
  const networkError = () => {
    throw new Error('Network request failed');
  };

  const invalidPolygonData = (): Polygon => ({
    id: 'invalid',
    points: [], // Empty points array
    confidence: NaN,
    type: 'external',
  });

  const corruptedImageData = () => {
    throw new Error('Invalid image data');
  };

  const insufficientMemory = () => {
    throw new Error('Out of memory');
  };

  return {
    networkError,
    invalidPolygonData,
    corruptedImageData,
    insufficientMemory,
  };
};

/**
 * Utility to create comprehensive test scenarios
 */
export const createTestScenarios = () => {
  return {
    // Basic polygon editing
    singlePolygonEdit: {
      polygons: [createMockPolygon()],
      editMode: 'EditVertices' as EditMode,
      selectedPolygonId: 'test-polygon',
    },

    // Multi-polygon selection
    multiPolygonScene: {
      polygons: createMockPolygons(5),
      editMode: 'View' as EditMode,
      selectedPolygonId: null,
    },

    // Complex interaction
    complexEdit: {
      polygons: createMockPolygons(3),
      editMode: 'AddPoints' as EditMode,
      selectedPolygonId: 'rect-0',
      tempPoints: [{ x: 25, y: 25 }],
      interactionState: createMockInteractionState({
        isAddingPoints: true,
        addPointStartVertex: { x: 10, y: 10 },
      }),
    },

    // High zoom scenario
    zoomedView: {
      polygons: createMockPolygons(2),
      transform: createMockTransformState({
        zoom: 5,
        translateX: -200,
        translateY: -150,
      }),
    },

    // Performance stress test
    manyPolygons: {
      polygons: createMockPolygons(50),
      editMode: 'View' as EditMode,
    },
  };
};
