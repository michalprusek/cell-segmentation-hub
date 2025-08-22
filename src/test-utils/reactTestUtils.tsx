/**
 * React testing utilities - re-exports from separated files
 */

// Re-export components from test-components
export {
  MockLanguageProvider,
  MockThemeProvider,
  MockAuthProvider,
  AllProviders,
} from './test-components';

// Re-export all utilities from test-helpers
export {
  customRender as render,
  customRenderHook as renderHook,
  createMockTransform,
  createMockInteractionState,
  createMockCanvas,
  createMockRef,
  measureComponentPerformance,
  mockBrowserAPIs,
  mockToast,
  createMockKeyboardEvent,
  createMockPointerEvent,
  createMockWheelEvent,
  waitForAsync,
  triggerMultipleRenders,
  createMockFile,
} from './test-helpers';

// Re-export everything from React Testing Library
export * from '@testing-library/react';
