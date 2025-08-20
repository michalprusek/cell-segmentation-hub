/**
 * Comprehensive Canvas API mocking utilities for segmentation editor tests
 * Provides realistic mocks for 2D canvas operations, rendering, and measurements
 */

import { vi } from 'vitest';
import type { Point } from '@/lib/segmentation';

// Mock canvas rendering context with comprehensive method tracking
export interface MockCanvasRenderingContext2D
  extends Partial<CanvasRenderingContext2D> {
  // Drawing state tracking
  __mockState: {
    fillStyle: string | CanvasGradient | CanvasPattern;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    lineWidth: number;
    globalAlpha: number;
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    miterLimit: number;
    lineDashOffset: number;
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    globalCompositeOperation: GlobalCompositeOperation;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
  };

  // Operation tracking
  __drawCalls: Array<{
    method: string;
    args: any[];
    timestamp: number;
  }>;

  // Path tracking
  __currentPath: Point[];
  __paths: Point[][];

  // Transform tracking
  __transforms: DOMMatrix[];
  __currentTransform: DOMMatrix;

  // Clear tracking data
  __clearMocks: () => void;
}

/**
 * Create a comprehensive mock of CanvasRenderingContext2D
 */
export const createMockCanvasContext = (): MockCanvasRenderingContext2D => {
  const drawCalls: any[] = [];
  const paths: Point[][] = [];
  const currentPath: Point[] = [];
  const transforms: DOMMatrix[] = [];
  let currentTransform = new DOMMatrix();

  const mockState = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
    miterLimit: 10,
    lineDashOffset: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low' as ImageSmoothingQuality,
  };

  const recordCall = (method: string, args: any[]) => {
    drawCalls.push({
      method,
      args: [...args],
      timestamp: performance.now(),
    });
  };

  const mockContext: MockCanvasRenderingContext2D = {
    // State tracking
    __mockState: mockState,
    __drawCalls: drawCalls,
    __currentPath: currentPath,
    __paths: paths,
    __transforms: transforms,
    __currentTransform: currentTransform,

    // Clear tracking data
    __clearMocks: () => {
      drawCalls.length = 0;
      paths.length = 0;
      currentPath.length = 0;
      transforms.length = 0;
      currentTransform = new DOMMatrix();
    },

    // Canvas state - we'll set this later to avoid circular dependency
    canvas: null as any,

    // Drawing rectangles
    clearRect: vi.fn((x: number, y: number, w: number, h: number) => {
      recordCall('clearRect', [x, y, w, h]);
    }),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      recordCall('fillRect', [x, y, w, h]);
    }),
    strokeRect: vi.fn((x: number, y: number, w: number, h: number) => {
      recordCall('strokeRect', [x, y, w, h]);
    }),

    // Drawing text
    fillText: vi.fn((text: string, x: number, y: number, maxWidth?: number) => {
      recordCall('fillText', [text, x, y, maxWidth]);
    }),
    strokeText: vi.fn(
      (text: string, x: number, y: number, maxWidth?: number) => {
        recordCall('strokeText', [text, x, y, maxWidth]);
      }
    ),
    measureText: vi.fn((text: string) => {
      recordCall('measureText', [text]);
      return {
        width: text.length * 8, // Rough character width estimation
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: text.length * 8,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2,
        fontBoundingBoxAscent: 12,
        fontBoundingBoxDescent: 3,
        emHeightAscent: 10,
        emHeightDescent: 2,
        hangingBaseline: 8,
        alphabeticBaseline: 0,
        ideographicBaseline: -2,
      };
    }),

    // Drawing images
    drawImage: vi.fn((...args: any[]) => {
      recordCall('drawImage', args);
    }),

    // Path operations
    beginPath: vi.fn(() => {
      recordCall('beginPath', []);
      currentPath.length = 0;
    }),
    closePath: vi.fn(() => {
      recordCall('closePath', []);
      if (currentPath.length > 0) {
        currentPath.push({ ...currentPath[0] }); // Close to start
      }
    }),
    moveTo: vi.fn((x: number, y: number) => {
      recordCall('moveTo', [x, y]);
      // Don't clear existing path, just start new subpath
      currentPath.push({ x, y });
    }),
    lineTo: vi.fn((x: number, y: number) => {
      recordCall('lineTo', [x, y]);
      currentPath.push({ x, y });
    }),
    quadraticCurveTo: vi.fn(
      (cpx: number, cpy: number, x: number, y: number) => {
        recordCall('quadraticCurveTo', [cpx, cpy, x, y]);
        // Approximate curve with line for testing
        currentPath.push({ x, y });
      }
    ),
    bezierCurveTo: vi.fn(
      (
        cp1x: number,
        cp1y: number,
        cp2x: number,
        cp2y: number,
        x: number,
        y: number
      ) => {
        recordCall('bezierCurveTo', [cp1x, cp1y, cp2x, cp2y, x, y]);
        // Approximate curve with line for testing
        currentPath.push({ x, y });
      }
    ),
    arc: vi.fn(
      (
        x: number,
        y: number,
        radius: number,
        startAngle: number,
        endAngle: number,
        counterclockwise?: boolean
      ) => {
        recordCall('arc', [
          x,
          y,
          radius,
          startAngle,
          endAngle,
          counterclockwise,
        ]);
        // Approximate arc with points
        const steps = 8;
        const angleStep = (endAngle - startAngle) / steps;
        for (let i = 0; i <= steps; i++) {
          const angle = startAngle + i * angleStep;
          currentPath.push({
            x: x + Math.cos(angle) * radius,
            y: y + Math.sin(angle) * radius,
          });
        }
      }
    ),
    arcTo: vi.fn(
      (x1: number, y1: number, x2: number, y2: number, radius: number) => {
        recordCall('arcTo', [x1, y1, x2, y2, radius]);
        // Simplified arc approximation
        currentPath.push({ x: x2, y: y2 });
      }
    ),
    rect: vi.fn((x: number, y: number, w: number, h: number) => {
      recordCall('rect', [x, y, w, h]);
      currentPath.push({ x, y });
      currentPath.push({ x: x + w, y });
      currentPath.push({ x: x + w, y: y + h });
      currentPath.push({ x, y: y + h });
      currentPath.push({ x, y }); // Close rectangle
    }),

    // Path drawing
    fill: vi.fn((path?: Path2D) => {
      recordCall('fill', [path]);
      if (currentPath.length > 0) {
        paths.push([...currentPath]);
      }
    }),
    stroke: vi.fn((path?: Path2D) => {
      recordCall('stroke', [path]);
      if (currentPath.length > 0) {
        paths.push([...currentPath]);
      }
    }),
    clip: vi.fn((path?: Path2D) => {
      recordCall('clip', [path]);
    }),

    // Hit testing
    isPointInPath: vi.fn((x: number, y: number, path?: Path2D) => {
      recordCall('isPointInPath', [x, y, path]);
      // Simple point-in-polygon test for currentPath
      if (currentPath.length < 3) return false;

      let inside = false;
      for (
        let i = 0, j = currentPath.length - 1;
        i < currentPath.length;
        j = i++
      ) {
        if (
          currentPath[i].y > y !== currentPath[j].y > y &&
          x <
            ((currentPath[j].x - currentPath[i].x) * (y - currentPath[i].y)) /
              (currentPath[j].y - currentPath[i].y) +
              currentPath[i].x
        ) {
          inside = !inside;
        }
      }
      return inside;
    }),
    isPointInStroke: vi.fn((x: number, y: number, path?: Path2D) => {
      recordCall('isPointInStroke', [x, y, path]);
      // Simplified stroke hit test
      const tolerance = mockState.lineWidth / 2;
      return currentPath.some(
        point =>
          Math.abs(point.x - x) <= tolerance &&
          Math.abs(point.y - y) <= tolerance
      );
    }),

    // Transformations
    save: vi.fn(() => {
      recordCall('save', []);
      transforms.push(new DOMMatrix(currentTransform));
    }),
    restore: vi.fn(() => {
      recordCall('restore', []);
      if (transforms.length > 0) {
        currentTransform = transforms.pop()!;
      }
    }),
    scale: vi.fn((x: number, y: number) => {
      recordCall('scale', [x, y]);
      currentTransform = currentTransform.scale(x, y);
    }),
    rotate: vi.fn((angle: number) => {
      recordCall('rotate', [angle]);
      currentTransform = currentTransform.rotate((angle * 180) / Math.PI);
    }),
    translate: vi.fn((x: number, y: number) => {
      recordCall('translate', [x, y]);
      currentTransform = currentTransform.translate(x, y);
    }),
    transform: vi.fn(
      (a: number, b: number, c: number, d: number, e: number, f: number) => {
        recordCall('transform', [a, b, c, d, e, f]);
        const matrix = new DOMMatrix([a, b, c, d, e, f]);
        currentTransform = currentTransform.multiply(matrix);
      }
    ),
    setTransform: vi.fn(
      (a: number, b: number, c: number, d: number, e: number, f: number) => {
        recordCall('setTransform', [a, b, c, d, e, f]);
        currentTransform = new DOMMatrix([a, b, c, d, e, f]);
      }
    ),
    resetTransform: vi.fn(() => {
      recordCall('resetTransform', []);
      currentTransform = new DOMMatrix();
    }),
    getTransform: vi.fn(() => {
      recordCall('getTransform', []);
      return new DOMMatrix(currentTransform);
    }),

    // Gradients and patterns
    createLinearGradient: vi.fn(
      (x0: number, y0: number, x1: number, y1: number) => {
        recordCall('createLinearGradient', [x0, y0, x1, y1]);
        return {
          addColorStop: vi.fn(),
        } as any;
      }
    ),
    createRadialGradient: vi.fn(
      (
        x0: number,
        y0: number,
        r0: number,
        x1: number,
        y1: number,
        r1: number
      ) => {
        recordCall('createRadialGradient', [x0, y0, r0, x1, y1, r1]);
        return {
          addColorStop: vi.fn(),
        } as any;
      }
    ),
    createPattern: vi.fn((image: any, repetition: string | null) => {
      recordCall('createPattern', [image, repetition]);
      return {} as any;
    }),

    // Image data
    createImageData: vi.fn((...args: any[]) => {
      recordCall('createImageData', args);
      const [width, height] =
        args.length === 2 ? args : [args[0].width, args[0].height];
      return {
        data: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      };
    }),
    getImageData: vi.fn((sx: number, sy: number, sw: number, sh: number) => {
      recordCall('getImageData', [sx, sy, sw, sh]);
      return {
        data: new Uint8ClampedArray(sw * sh * 4),
        width: sw,
        height: sh,
      };
    }),
    putImageData: vi.fn((...args: any[]) => {
      recordCall('putImageData', args);
    }),

    // State properties with getters/setters
    get fillStyle() {
      return mockState.fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      mockState.fillStyle = value;
      recordCall('set fillStyle', [value]);
    },

    get strokeStyle() {
      return mockState.strokeStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      mockState.strokeStyle = value;
      recordCall('set strokeStyle', [value]);
    },

    get lineWidth() {
      return mockState.lineWidth;
    },
    set lineWidth(value: number) {
      mockState.lineWidth = value;
      recordCall('set lineWidth', [value]);
    },

    get globalAlpha() {
      return mockState.globalAlpha;
    },
    set globalAlpha(value: number) {
      mockState.globalAlpha = value;
      recordCall('set globalAlpha', [value]);
    },

    get font() {
      return mockState.font;
    },
    set font(value: string) {
      mockState.font = value;
      recordCall('set font', [value]);
    },

    get textAlign() {
      return mockState.textAlign;
    },
    set textAlign(value: CanvasTextAlign) {
      mockState.textAlign = value;
      recordCall('set textAlign', [value]);
    },

    get textBaseline() {
      return mockState.textBaseline;
    },
    set textBaseline(value: CanvasTextBaseline) {
      mockState.textBaseline = value;
      recordCall('set textBaseline', [value]);
    },

    get lineCap() {
      return mockState.lineCap;
    },
    set lineCap(value: CanvasLineCap) {
      mockState.lineCap = value;
      recordCall('set lineCap', [value]);
    },

    get lineJoin() {
      return mockState.lineJoin;
    },
    set lineJoin(value: CanvasLineJoin) {
      mockState.lineJoin = value;
      recordCall('set lineJoin', [value]);
    },

    get miterLimit() {
      return mockState.miterLimit;
    },
    set miterLimit(value: number) {
      mockState.miterLimit = value;
      recordCall('set miterLimit', [value]);
    },

    get globalCompositeOperation() {
      return mockState.globalCompositeOperation;
    },
    set globalCompositeOperation(value: GlobalCompositeOperation) {
      mockState.globalCompositeOperation = value;
      recordCall('set globalCompositeOperation', [value]);
    },

    // Line dash
    setLineDash: vi.fn((segments: number[]) => {
      recordCall('setLineDash', [segments]);
    }),
    getLineDash: vi.fn(() => {
      recordCall('getLineDash', []);
      return [];
    }),

    get lineDashOffset() {
      return mockState.lineDashOffset;
    },
    set lineDashOffset(value: number) {
      mockState.lineDashOffset = value;
      recordCall('set lineDashOffset', [value]);
    },

    // Shadow properties
    get shadowColor() {
      return mockState.shadowColor;
    },
    set shadowColor(value: string) {
      mockState.shadowColor = value;
      recordCall('set shadowColor', [value]);
    },

    get shadowBlur() {
      return mockState.shadowBlur;
    },
    set shadowBlur(value: number) {
      mockState.shadowBlur = value;
      recordCall('set shadowBlur', [value]);
    },

    get shadowOffsetX() {
      return mockState.shadowOffsetX;
    },
    set shadowOffsetX(value: number) {
      mockState.shadowOffsetX = value;
      recordCall('set shadowOffsetX', [value]);
    },

    get shadowOffsetY() {
      return mockState.shadowOffsetY;
    },
    set shadowOffsetY(value: number) {
      mockState.shadowOffsetY = value;
      recordCall('set shadowOffsetY', [value]);
    },

    // Image smoothing
    get imageSmoothingEnabled() {
      return mockState.imageSmoothingEnabled;
    },
    set imageSmoothingEnabled(value: boolean) {
      mockState.imageSmoothingEnabled = value;
      recordCall('set imageSmoothingEnabled', [value]);
    },

    get imageSmoothingQuality() {
      return mockState.imageSmoothingQuality;
    },
    set imageSmoothingQuality(value: ImageSmoothingQuality) {
      mockState.imageSmoothingQuality = value;
      recordCall('set imageSmoothingQuality', [value]);
    },
  };

  // Create a minimal mock canvas reference to avoid circular dependency
  mockContext.canvas = {
    width: 800,
    height: 600,
    style: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getContext: vi.fn(() => mockContext),
    toDataURL: vi.fn(() => 'data:image/png;base64,mock-data'),
    toBlob: vi.fn((callback: BlobCallback) => {
      callback(new Blob(['mock-canvas-data'], { type: 'image/png' }));
    }),
  } as any;

  return mockContext;
};

/**
 * Create a mock canvas element with 2D context
 */
export const createMockCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas') as HTMLCanvasElement;
  const context = createMockCanvasContext();

  // Mock getContext to return our mock context
  canvas.getContext = vi.fn((contextType: string) => {
    if (contextType === '2d') {
      return context;
    }
    return null;
  }) as any;

  // Set canvas properties
  canvas.width = 800;
  canvas.height = 600;

  // Mock other canvas methods
  canvas.toDataURL = vi.fn(() => 'data:image/png;base64,mock-data');
  canvas.toBlob = vi.fn((callback: BlobCallback) => {
    const blob = new Blob(['mock-canvas-data'], { type: 'image/png' });
    callback(blob);
  });

  return canvas;
};

/**
 * Helper to assert canvas drawing operations
 */
export const expectCanvasToHaveDrawn = (
  context: MockCanvasRenderingContext2D,
  method: string,
  expectedCalls: number = 1
) => {
  const calls = context.__drawCalls.filter(call => call.method === method);
  expect(calls).toHaveLength(expectedCalls);
  return calls;
};

/**
 * Helper to assert polygon was drawn
 */
export const expectPolygonDrawn = (
  context: MockCanvasRenderingContext2D,
  expectedVertices: Point[]
) => {
  // Check that moveTo and lineTo were called for the polygon
  const moveToCall = context.__drawCalls.find(
    call =>
      call.method === 'moveTo' &&
      call.args[0] === expectedVertices[0].x &&
      call.args[1] === expectedVertices[0].y
  );
  expect(moveToCall).toBeDefined();

  // Check that lineTo was called for remaining vertices
  for (let i = 1; i < expectedVertices.length; i++) {
    const lineToCall = context.__drawCalls.find(
      call =>
        call.method === 'lineTo' &&
        call.args[0] === expectedVertices[i].x &&
        call.args[1] === expectedVertices[i].y
    );
    expect(lineToCall).toBeDefined();
  }
};

/**
 * Helper to create mock image for testing
 */
export const createMockImage = (
  width: number = 100,
  height: number = 100
): HTMLImageElement => {
  const img = new Image(width, height);

  // Mock image loading
  Object.defineProperty(img, 'naturalWidth', { value: width, writable: false });
  Object.defineProperty(img, 'naturalHeight', {
    value: height,
    writable: false,
  });
  Object.defineProperty(img, 'complete', { value: true, writable: false });

  // Mock onload trigger
  img.onload = null;
  img.onerror = null;

  return img;
};

/**
 * Mock getBoundingClientRect for canvas container
 */
export const mockCanvasContainer = (
  width: number = 800,
  height: number = 600,
  left: number = 0,
  top: number = 0
) => {
  return {
    getBoundingClientRect: vi.fn(() => ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: vi.fn(),
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
};

/**
 * Performance testing for canvas operations
 */
export const measureCanvasPerformance = async (
  canvasOperation: (ctx: MockCanvasRenderingContext2D) => void,
  iterations: number = 100
): Promise<{
  averageTime: number;
  operationsPerSecond: number;
  totalOperations: number;
}> => {
  const context = createMockCanvasContext();
  const startTime = performance.now();

  for (let i = 0; i < iterations; i++) {
    canvasOperation(context);
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;
  const averageTime = totalTime / iterations;
  const operationsPerSecond = 1000 / averageTime;

  return {
    averageTime,
    operationsPerSecond,
    totalOperations: context.__drawCalls.length,
  };
};

/**
 * Utility to simulate canvas interaction events
 */
export const simulateCanvasInteraction = (
  canvas: HTMLElement,
  interaction: {
    type: 'click' | 'mousedown' | 'mousemove' | 'mouseup' | 'wheel';
    x: number;
    y: number;
    button?: number;
    deltaY?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
  }
) => {
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + interaction.x;
  const clientY = rect.top + interaction.y;

  let event: Event;

  if (interaction.type === 'wheel') {
    event = new WheelEvent('wheel', {
      clientX,
      clientY,
      deltaY: interaction.deltaY || 0,
      ctrlKey: interaction.ctrlKey || false,
      shiftKey: interaction.shiftKey || false,
      bubbles: true,
      cancelable: true,
    });
  } else {
    event = new MouseEvent(interaction.type, {
      clientX,
      clientY,
      button: interaction.button || 0,
      ctrlKey: interaction.ctrlKey || false,
      shiftKey: interaction.shiftKey || false,
      bubbles: true,
      cancelable: true,
    });
  }

  canvas.dispatchEvent(event);
  return event;
};

/**
 * Mock SVG elements for testing
 */
export const createMockSVG = (width: number = 100, height: number = 100) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width.toString());
  svg.setAttribute('height', height.toString());

  // Mock SVG-specific methods
  (svg as any).createSVGPoint = vi.fn(() => {
    const point = {
      x: 0,
      y: 0,
      matrixTransform: vi.fn(function (this: { x: number; y: number }, matrix) {
        // Basic matrix transform computation for testing
        const x = this.x;
        const y = this.y;
        return {
          x: (matrix?.a || 1) * x + (matrix?.c || 0) * y + (matrix?.e || 0),
          y: (matrix?.b || 0) * x + (matrix?.d || 1) * y + (matrix?.f || 0),
        };
      }),
    };
    return point;
  });

  (svg as any).getScreenCTM = vi.fn(() => ({
    inverse: vi.fn(() => new DOMMatrix()),
  }));

  return svg;
};
