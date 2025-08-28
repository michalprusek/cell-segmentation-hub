import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { AllProviders } from './test-providers';

export const renderWithProviders = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => render(ui, { wrapper: AllProviders, ...options });

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
