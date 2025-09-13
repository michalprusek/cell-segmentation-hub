/**
 * Non-component test utilities
 */

import * as React from 'react';
import {
  render,
  RenderOptions,
  renderHook,
  RenderHookOptions,
} from '@testing-library/react';
import { vi } from 'vitest';
import type {
  _EditMode,
  TransformState,
  InteractionState,
} from '@/pages/segmentation/types';
import { AllProviders } from './test-components';

// Custom render function with providers
export const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllProviders, ...options });

// Custom renderHook function with providers
export const customRenderHook = <TProps, TResult>(
  callback: (props: TProps) => TResult,
  options?: Omit<RenderHookOptions<TProps>, 'wrapper'>
) => renderHook(callback, { wrapper: AllProviders, ...options });

// Mock implementations for segmentation editor dependencies
export const createMockTransform = (
  zoom = 1,
  translateX = 0,
  translateY = 0
): TransformState => ({
  zoom,
  translateX,
  translateY,
});

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

export const createMockCanvas = (): HTMLDivElement => {
  const canvas = document.createElement('div');
  canvas.style.width = '800px';
  canvas.style.height = '600px';
  Object.defineProperty(canvas, 'offsetWidth', {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(canvas, 'offsetHeight', {
    configurable: true,
    value: 600,
  });
  return canvas;
};

export const createMockRef = <T>(value: T): React.RefObject<T> => ({
  current: value,
});

export const measureComponentPerformance = async (
  component: React.ComponentType,
  props: Record<string, any> = {},
  iterations = 10
): Promise<{
  averageRenderTime: number;
  minRenderTime: number;
  maxRenderTime: number;
}> => {
  const renderTimes: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const { unmount } = customRender(React.createElement(component, props));
    const end = performance.now();
    renderTimes.push(end - start);
    unmount();
  }

  return {
    averageRenderTime:
      renderTimes.reduce((a, b) => a + b, 0) / renderTimes.length,
    minRenderTime: Math.min(...renderTimes),
    maxRenderTime: Math.max(...renderTimes),
  };
};

export const mockBrowserAPIs = () => {
  // Mock ResizeObserver
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));

  // Mock IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
    root: null,
    rootMargin: '0px',
    thresholds: [0],
  }));

  // Mock requestAnimationFrame
  global.requestAnimationFrame = vi
    .fn()
    .mockImplementation(cb => setTimeout(cb, 16));
  global.cancelAnimationFrame = vi.fn().mockImplementation(clearTimeout);

  // Mock performance.now
  performance.now = vi.fn().mockReturnValue(Date.now());

  // Mock canvas getContext
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    getImageData: vi.fn().mockReturnValue({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }),
    putImageData: vi.fn(),
    createImageData: vi.fn().mockReturnValue({
      data: new Uint8ClampedArray(4),
      width: 1,
      height: 1,
    }),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    fillText: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 10 }),
    transform: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  });
};

export const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  promise: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
  custom: vi.fn(),
};

export const createMockKeyboardEvent = (
  key: string,
  options: Partial<KeyboardEvent> = {}
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...options,
  });

  // Add missing properties that KeyboardEvent constructor doesn't set
  Object.defineProperties(event, {
    target: { value: document.body, writable: true },
    currentTarget: { value: document.body, writable: true },
    preventDefault: {
      value: vi.fn(),
      writable: true,
    },
    stopPropagation: {
      value: vi.fn(),
      writable: true,
    },
  });

  return event;
};

export const createMockPointerEvent = (
  type: string,
  options: Partial<PointerEvent> = {}
): PointerEvent => {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    pointerId: 1,
    pointerType: 'mouse',
    ...options,
  });

  Object.defineProperties(event, {
    target: { value: document.body, writable: true },
    currentTarget: { value: document.body, writable: true },
    preventDefault: {
      value: vi.fn(),
      writable: true,
    },
    stopPropagation: {
      value: vi.fn(),
      writable: true,
    },
  });

  return event;
};

export const createMockWheelEvent = (
  deltaY: number,
  options: Partial<WheelEvent> = {}
): WheelEvent => {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    deltaY,
    ...options,
  });

  Object.defineProperties(event, {
    target: { value: document.body, writable: true },
    currentTarget: { value: document.body, writable: true },
    preventDefault: {
      value: vi.fn(),
      writable: true,
    },
    stopPropagation: {
      value: vi.fn(),
      writable: true,
    },
  });

  return event;
};

export const waitForAsync = (ms = 0): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

export const triggerMultipleRenders = (
  component: React.ComponentType,
  props: Record<string, any> = {},
  count = 3
): void => {
  for (let i = 0; i < count; i++) {
    const { unmount } = customRender(React.createElement(component, props));
    unmount();
  }
};

export const createMockFile = (
  name = 'test.jpg',
  size = 1024,
  type = 'image/jpeg'
): File => {
  const blob = new Blob(['a'.repeat(size)], { type });
  return new File([blob], name, {
    type,
    lastModified: Date.now(),
  });
};
