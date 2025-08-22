import { ReactElement } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { vi } from 'vitest';
import { AllProviders } from './test-providers';

// Mock user for tests
export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
  createdAt: new Date('2023-01-01'),
  updatedAt: new Date('2023-01-01'),
};

// Mock auth context value
export const mockAuthContext = {
  user: mockUser,
  isAuthenticated: true,
  login: vi.fn(),
  logout: vi.fn(),
  register: vi.fn(),
  refreshToken: vi.fn(),
  isLoading: false,
};

// Custom render function
export const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
): RenderResult => render(ui, { wrapper: AllProviders, ...options });

// Mock API responses
export const mockApiResponse = <T>(data: T) => ({
  success: true,
  data,
  message: 'Success',
});

export const mockApiError = (message: string = 'Error occurred') => ({
  success: false,
  error: message,
  message,
});

// Mock project data
export const mockProject = {
  id: 'test-project-id',
  name: 'Test Project',
  description: 'Test project description',
  userId: 'test-user-id',
  createdAt: new Date('2023-01-01'),
  updatedAt: new Date('2023-01-01'),
  images: [],
};

// Mock image data
export const mockProjectImage = {
  id: 'test-image-id',
  filename: 'test-image.jpg',
  originalName: 'test-image.jpg',
  mimeType: 'image/jpeg',
  size: 1024000,
  width: 1920,
  height: 1080,
  thumbnailPath: '/thumbnails/test-image-thumb.jpg',
  projectId: 'test-project-id',
  processingStatus: 'completed' as const,
  uploadedAt: new Date('2023-01-01'),
  processedAt: new Date('2023-01-01'),
  segmentationResults: [],
};

// Mock segmentation result
export const mockSegmentationResult = {
  id: 'test-segmentation-id',
  projectImageId: 'test-image-id',
  modelName: 'hrnet',
  status: 'completed' as const,
  polygons: [
    {
      points: [
        [100, 100],
        [200, 100],
        [200, 200],
        [100, 200],
      ],
      confidence: 0.95,
      area: 10000,
      centroid: [150, 150],
    },
  ],
  processingTime: 1500,
  createdAt: new Date('2023-01-01'),
  completedAt: new Date('2023-01-01'),
};

// Helper function to wait for async operations
export const waitForAsync = () =>
  new Promise(resolve => setTimeout(resolve, 0));

// Mock file for testing file uploads
export const createMockFile = (
  name: string = 'test.jpg',
  type: string = 'image/jpeg'
) => {
  const file = new File(['test content'], name, { type });
  Object.defineProperty(file, 'size', { value: 1024000 });
  return file;
};

// Mock drag and drop events
export const createMockDragEvent = (files: File[]) => {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      files,
      items: files.map(file => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
      types: ['Files'],
    },
  };
};

// Mock intersection observer
export const mockIntersectionObserver = () => {
  const mockIntersectionObserver = vi.fn();
  mockIntersectionObserver.mockReturnValue({
    observe: () => null,
    unobserve: () => null,
    disconnect: () => null,
  });
  window.IntersectionObserver = mockIntersectionObserver;
};

// Mock resize observer
export const mockResizeObserver = () => {
  const mockResizeObserver = vi.fn();
  mockResizeObserver.mockReturnValue({
    observe: () => null,
    unobserve: () => null,
    disconnect: () => null,
  });
  window.ResizeObserver = mockResizeObserver;
};
