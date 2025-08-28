/**
 * Test data factories for consistent mock data across tests
 */

import { vi } from 'vitest';

// User data factory
export const createMockUser = (overrides: any = {}) => ({
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  emailVerified: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// User profile factory
export const createMockUserProfile = (overrides: any = {}) => ({
  userId: 'user-1',
  preferredModel: 'hrnet_v2',
  modelThreshold: 0.5,
  preferredLang: 'en',
  preferredTheme: 'light',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// Project data factory
export const createMockProject = (overrides: any = {}) => ({
  id: 'project-1',
  name: 'Test Project',
  description: 'A test project for cell segmentation',
  userId: 'user-1',
  imageCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// Project image factory
export const createMockProjectImage = (overrides: any = {}) => ({
  id: 'image-1',
  projectId: 'project-1',
  filename: 'test-image.jpg',
  originalName: 'test-image.jpg',
  fileSize: 1024000,
  mimeType: 'image/jpeg',
  width: 1000,
  height: 800,
  thumbnailPath: '/thumbnails/thumb-1.jpg',
  imagePath: '/images/image-1.jpg',
  uploadedAt: new Date().toISOString(),
  status: 'uploaded',
  ...overrides,
});

// Segmentation result factory
export const createMockSegmentationResult = (overrides: any = {}) => ({
  id: 'segmentation-1',
  imageId: 'image-1',
  modelUsed: 'hrnet_v2',
  modelThreshold: 0.5,
  polygons: [],
  status: 'completed',
  processingStartedAt: new Date().toISOString(),
  processingCompletedAt: new Date().toISOString(),
  segmentCount: 0,
  ...overrides,
});

// Polygon data factory
export const createMockPolygon = (overrides: any = {}) => ({
  id: `polygon-${Math.floor(Math.random() * 1000)}`,
  points: [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ],
  confidence: 0.95,
  area: 10000,
  color: '#ff0000',
  ...overrides,
});

// Queue item factory
export const createMockQueueItem = (overrides: any = {}) => ({
  id: 'queue-1',
  projectId: 'project-1',
  imageId: 'image-1',
  userId: 'user-1',
  status: 'queued',
  modelName: 'hrnet_v2',
  modelThreshold: 0.5,
  priority: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// API response factories
export const createMockPaginatedResponse = <T>(
  data: T[],
  overrides: any = {}
) => ({
  data: data,
  total: data.length,
  page: 1,
  totalPages: 1,
  limit: 10,
  ...overrides,
});

export const createMockProjectsResponse = (projects: any[] = []) =>
  createMockPaginatedResponse(projects, { projects });

export const createMockImagesResponse = (images: any[] = []) =>
  createMockPaginatedResponse(images, { images });

// Auth context mock data
export const createMockAuthContextValue = (overrides: any = {}) => ({
  user: createMockUser(),
  login: vi.fn().mockResolvedValue(true),
  logout: vi.fn().mockResolvedValue(undefined),
  register: vi.fn().mockResolvedValue(true),
  updateProfile: vi.fn().mockResolvedValue(true),
  deleteAccount: vi.fn().mockResolvedValue(true),
  changePassword: vi.fn().mockResolvedValue(true),
  isAuthenticated: true,
  isLoading: false,
  isCheckingAuth: false,
  ...overrides,
});

// WebSocket mock data
export const createMockWebSocketUpdate = (overrides: any = {}) => ({
  type: 'segmentationStatus',
  data: {
    imageId: 'image-1',
    status: 'completed',
    progress: 100,
    polygonCount: 5,
    ...overrides.data,
  },
  ...overrides,
});

// Theme context mock data
export const createMockThemeContextValue = (overrides: any = {}) => ({
  theme: 'light' as const,
  setTheme: vi.fn(),
  ...overrides,
});

// Language context mock data
export const createMockLanguageContextValue = (overrides: any = {}) => ({
  language: 'en',
  setLanguage: vi.fn(),
  t: (key: string) => {
    const translations: Record<string, string> = {
      'toast.unexpectedError': 'An unexpected error occurred',
      'toast.somethingWentWrong': 'Something went wrong',
      'toast.returnToHome': 'Return to Home',
      'dashboard.projects': 'Projects',
      'dashboard.totalImages': 'Total Images',
      'dashboard.storageUsed': 'Storage Used',
      'settings.account': 'Account',
      'settings.deleteAccount': 'Delete Account',
      'settings.profile': 'Profile',
      'common.delete': 'Delete',
      'common.cancel': 'Cancel',
      'common.confirm': 'Confirm',
      'auth.login': 'Login',
      'auth.logout': 'Logout',
      'auth.register': 'Register',
      'projects.create': 'Create Project',
      'projects.name': 'Project Name',
      'images.upload': 'Upload Images',
      ...overrides.translations,
    };
    return translations[key] || key;
  },
  ...overrides,
});

// File system mock data
export const createMockFile = (
  name = 'test.jpg',
  size = 1024,
  type = 'image/jpeg'
): File => {
  const content = new Array(size).fill('a').join('');
  const blob = new Blob([content], { type });
  return new File([blob], name, {
    type,
    lastModified: Date.now(),
  });
};

// Canvas mock data
export const createMockCanvasImageData = (width = 100, height = 100) => ({
  data: new Uint8ClampedArray(width * height * 4).fill(255),
  width,
  height,
});

// Model context mock data
export const createMockModelContextValue = (overrides: any = {}) => ({
  selectedModel: 'hrnet_v2',
  setSelectedModel: vi.fn(),
  modelThreshold: 0.5,
  setModelThreshold: vi.fn(),
  availableModels: [
    {
      id: 'hrnet_v2',
      name: 'HRNet V2',
      description: 'High-resolution network',
    },
    {
      id: 'resunet_small',
      name: 'ResUNet Small',
      description: 'Fast inference',
    },
    {
      id: 'resunet_advanced',
      name: 'ResUNet Advanced',
      description: 'High precision',
    },
  ],
  ...overrides,
});

// Storage stats mock data
export const createMockStorageStats = (overrides: any = {}) => ({
  totalSize: 0,
  imageCount: 0,
  projectCount: 0,
  formattedSize: '0 B',
  ...overrides,
});

// Error boundary mock data
export const createMockError = (message = 'Test error', name = 'TestError') => {
  const error = new Error(message);
  error.name = name;
  return error;
};

// Navigation mock data
export const createMockLocation = (overrides: any = {}) => ({
  pathname: '/',
  search: '',
  hash: '',
  state: null,
  key: 'default',
  ...overrides,
});

// Form validation mock data
export const createMockFormErrors = (fields: string[] = []) => {
  const errors: Record<string, string> = {};
  fields.forEach(field => {
    errors[field] = `${field} is required`;
  });
  return errors;
};

// Performance metrics mock data
export const createMockPerformanceMetrics = (overrides: any = {}) => ({
  renderTime: 16.7,
  memoryUsage: 1024,
  componentCount: 10,
  reRenderCount: 1,
  ...overrides,
});

// Export helper function to create mock providers
export const createMockProviders = (overrides: any = {}) => ({
  auth: createMockAuthContextValue(overrides.auth),
  theme: createMockThemeContextValue(overrides.theme),
  language: createMockLanguageContextValue(overrides.language),
  model: createMockModelContextValue(overrides.model),
});

// Default export with all factories
export default {
  createMockUser,
  createMockUserProfile,
  createMockProject,
  createMockProjectImage,
  createMockSegmentationResult,
  createMockPolygon,
  createMockQueueItem,
  createMockPaginatedResponse,
  createMockProjectsResponse,
  createMockImagesResponse,
  createMockAuthContextValue,
  createMockWebSocketUpdate,
  createMockThemeContextValue,
  createMockLanguageContextValue,
  createMockFile,
  createMockCanvasImageData,
  createMockModelContextValue,
  createMockStorageStats,
  createMockError,
  createMockLocation,
  createMockFormErrors,
  createMockPerformanceMetrics,
  createMockProviders,
};
