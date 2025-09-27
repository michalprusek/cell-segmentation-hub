/**
 * Test utilities - re-exports from separated files
 */

// Re-export all utilities
export {
  mockUser,
  mockAuthContext,
  customRender as render,
  mockApiResponse,
  mockApiError,
  mockProject,
  mockProjectImage,
  mockSegmentationResult,
  waitForAsync,
  createMockFile,
  createMockDragEvent,
  mockIntersectionObserver,
  mockResizeObserver,
} from './test-utilities';

// Re-export everything from React Testing Library
export * from '@testing-library/react';
