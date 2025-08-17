/**
 * React testing utilities for hooks and components
 */

import * as React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { renderHook, RenderHookOptions } from '@testing-library/react';
import { vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthContext } from '@/contexts/AuthContext';
import type { EditMode, TransformState, InteractionState } from '@/pages/segmentation/types';

// Mock contexts for testing
// eslint-disable-next-line react-refresh/only-export-components
const MockLanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LanguageProvider>{children}</LanguageProvider>
);

// eslint-disable-next-line react-refresh/only-export-components
const MockThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

// eslint-disable-next-line react-refresh/only-export-components
const MockAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    username: 'testuser'
  };

  const mockProfile = {
    id: 'test-profile-id',
    userId: 'test-user-id',
    consentToMLTraining: true,
    consentToAlgorithmImprovement: true,
    consentToFeatureDevelopment: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const mockContextValue = {
    user: mockUser,
    profile: mockProfile,
    token: 'mock-token',
    loading: false,
    isAuthenticated: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    deleteAccount: vi.fn()
  };

  return (
    <AuthContext.Provider value={mockContextValue}>
      {children}
    </AuthContext.Provider>
  );
};

// All providers wrapper for testing
// eslint-disable-next-line react-refresh/only-export-components
const AllProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MockLanguageProvider>
    <MockThemeProvider>
      <MockAuthProvider>
        {children}
      </MockAuthProvider>
    </MockThemeProvider>
  </MockLanguageProvider>
);

// Custom render function with providers
const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllProviders, ...options });

// Custom renderHook function with providers
const customRenderHook = <TProps, TResult>(
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
  translateY
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
  ...overrides
});

// Mock canvas element for testing
export const createMockCanvas = (): HTMLDivElement => {
  const mockCanvas = document.createElement('div');
  mockCanvas.getBoundingClientRect = vi.fn().mockReturnValue({
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: vi.fn()
  });
  return mockCanvas;
};

// Mock ref object for testing
export const createMockRef = <T,>(value: T): React.RefObject<T> => ({
  current: value
});

// Performance testing utility for React components
export const measureComponentPerformance = async (
  renderComponent: () => void,
  iterations = 10
): Promise<{
  averageTime: number;
  minTime: number;
  maxTime: number;
  totalTime: number;
}> => {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    renderComponent();
    const end = performance.now();
    times.push(end - start);
  }

  const totalTime = times.reduce((sum, time) => sum + time, 0);
  const averageTime = totalTime / iterations;
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  return {
    averageTime,
    minTime,
    maxTime,
    totalTime
  };
};

// Mock window/browser APIs commonly used in segmentation editor
export const mockBrowserAPIs = () => {
  // Mock window.devicePixelRatio
  Object.defineProperty(window, 'devicePixelRatio', {
    writable: true,
    configurable: true,
    value: 1
  });

  // Mock requestAnimationFrame with proper ID generation and cancellation
  let rafIdCounter = 1;
  const rafTimeouts = new Map<number, NodeJS.Timeout>();
  
  global.requestAnimationFrame = vi.fn((cb) => {
    const id = rafIdCounter++;
    const timeoutHandle = setTimeout(cb, 16);
    rafTimeouts.set(id, timeoutHandle);
    return id;
  });

  // Mock cancelAnimationFrame
  global.cancelAnimationFrame = vi.fn((id: number) => {
    const timeoutHandle = rafTimeouts.get(id);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      rafTimeouts.delete(id);
    }
  });

  // Mock ResizeObserver
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn()
  }));

  // Mock IntersectionObserver
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn()
  }));
};

// Mock toast notifications
export const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn()
};

// Mock keyboard events
export const createMockKeyboardEvent = (
  key: string,
  options: {
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    preventDefault?: () => void;
  } = {}
): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: options.ctrlKey || false,
    shiftKey: options.shiftKey || false,
    altKey: options.altKey || false,
    metaKey: options.metaKey || false,
    bubbles: true,
    cancelable: true
  });

  if (options.preventDefault) {
    event.preventDefault = options.preventDefault;
  }

  return event;
};

// Mock pointer events
export const createMockPointerEvent = (
  type: string,
  options: {
    clientX?: number;
    clientY?: number;
    button?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {}
): PointerEvent => {
  return new PointerEvent(type, {
    clientX: options.clientX || 0,
    clientY: options.clientY || 0,
    button: options.button || 0,
    ctrlKey: options.ctrlKey || false,
    shiftKey: options.shiftKey || false,
    altKey: options.altKey || false,
    metaKey: options.metaKey || false,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse'
  });
};

// Mock wheel events
export const createMockWheelEvent = (
  deltaY: number,
  options: {
    clientX?: number;
    clientY?: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
  } = {}
): WheelEvent => {
  return new WheelEvent('wheel', {
    deltaY,
    clientX: options.clientX || 0,
    clientY: options.clientY || 0,
    ctrlKey: options.ctrlKey || false,
    shiftKey: options.shiftKey || false,
    altKey: options.altKey || false,
    metaKey: options.metaKey || false,
    bubbles: true,
    cancelable: true
  });
};

// Utility to wait for async operations in tests
export const waitForAsync = (ms = 0): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

// Utility to trigger multiple renders
export const triggerMultipleRenders = (
  rerender: (props?: any) => void,
  count = 5,
  delay = 0
): Promise<void> => {
  return new Promise(resolve => {
    let renderCount = 0;
    const triggerRender = () => {
      if (renderCount < count) {
        rerender();
        renderCount++;
        if (delay > 0) {
          setTimeout(triggerRender, delay);
        } else {
          triggerRender();
        }
      } else {
        resolve();
      }
    };
    triggerRender();
  });
};

// Mock file input for testing file uploads
export const createMockFile = (
  name: string,
  size: number,
  type: string
): File => {
  const file = new File(['test content'], name, { type });
  Object.defineProperty(file, 'size', {
    value: size,
    writable: false
  });
  return file;
};

export {
  customRender as render,
  customRenderHook as renderHook
};

// eslint-disable-next-line react-refresh/only-export-components
export * from '@testing-library/react';