import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useProjectData } from '@/hooks/useProjectData';
import apiClient from '@/lib/api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { ReactNode } from 'react';

// Mock apiClient as default export
vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    getAccessToken: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
    getProject: vi.fn(),
    getProjectImages: vi.fn(),
    getSegmentationResults: vi.fn(),
    getBatchSegmentationResults: vi.fn(),
  },
}));

// Mock other required modules for AuthProvider
vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useProjectData', () => {
  let queryClient: QueryClient;

  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <LanguageProvider>{children}</LanguageProvider>
        </QueryClientProvider>
      </AuthProvider>
    </MemoryRouter>
  );

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    vi.clearAllMocks();

    // Reset API client mocks to default values
    vi.mocked(apiClient.getProject).mockReset();
    vi.mocked(apiClient.getProjectImages).mockReset();
    vi.mocked(apiClient.getSegmentationResults).mockReset();
    vi.mocked(apiClient.getBatchSegmentationResults).mockReset();
  });

  describe('successful data fetching', () => {
    it('should fetch project data successfully', async () => {
      const mockProject = {
        id: 'project-1',
        name: 'Test Project',
        description: 'Test Description',
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-01T00:00:00.000Z',
        user_id: 'user-1',
      };

      const mockImagesResponse = {
        images: [
          {
            id: 'image-1',
            name: 'test1.jpg',
            url: 'http://localhost:3001/images/test1.jpg',
            thumbnail_url: 'http://localhost:3001/thumbnails/test1.jpg',
            width: 800,
            height: 600,
            created_at: '2023-01-01T00:00:00.000Z',
            updated_at: '2023-01-01T00:00:00.000Z',
            segmentationStatus: 'completed',
          },
          {
            id: 'image-2',
            name: 'test2.jpg',
            url: 'http://localhost:3001/images/test2.jpg',
            thumbnail_url: 'http://localhost:3001/thumbnails/test2.jpg',
            width: 800,
            height: 600,
            created_at: '2023-01-01T00:00:00.000Z',
            updated_at: '2023-01-01T00:00:00.000Z',
            segmentationStatus: 'pending',
          },
        ],
        total: 2,
        page: 1,
        totalPages: 1,
      };

      // Mock segmentation results for completed images
      const mockSegmentationData = {
        polygons: [
          {
            id: 'poly-1',
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
            ],
          },
        ],
        imageWidth: 800,
        imageHeight: 600,
        modelUsed: 'hrnet',
        confidence: 0.95,
      };

      vi.mocked(apiClient.getProject).mockResolvedValueOnce(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValueOnce(
        mockImagesResponse
      );
      vi.mocked(apiClient.getSegmentationResults).mockResolvedValueOnce(
        mockSegmentationData
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      // Wait for the async operations to complete
      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Check that the API calls were made
      expect(vi.mocked(apiClient.getProject)).toHaveBeenCalledWith('project-1');
      expect(vi.mocked(apiClient.getProjectImages)).toHaveBeenCalledWith(
        'project-1',
        { limit: 50, page: 1 }
      );
      expect(vi.mocked(apiClient.getSegmentationResults)).toHaveBeenCalledWith(
        'image-1'
      );

      // Check the final state
      expect(result.current.projectTitle).toBe('Test Project');
      expect(result.current.images).toHaveLength(2);
      expect(result.current.images[0].id).toBe('image-1');
      expect(result.current.images[0].segmentationResult).toBeDefined();
      expect(result.current.images[1].segmentationResult).toBeUndefined(); // Pending image
    });

    it('should handle empty images and segmentations', async () => {
      const mockProject = {
        id: 'project-2',
        name: 'Empty Project',
        description: 'No images',
      };

      vi.mocked(apiClient.getProject).mockResolvedValueOnce(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValueOnce({
        images: [],
        total: 0,
        page: 1,
        totalPages: 1,
      });

      const { result } = renderHook(
        () => useProjectData('project-2', 'user-1'),
        {
          wrapper,
        }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.projectTitle).toBe('Empty Project');
      expect(result.current.images).toEqual([]);
    });

    it('should enable dependent queries only when project is loaded', async () => {
      const mockProject = { id: 'project-1', name: 'Test' };
      const mockImages = [
        {
          id: 'image-1',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValueOnce(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValueOnce({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        {
          wrapper,
        }
      );

      // Initially, project query should be called
      expect(vi.mocked(apiClient.getProject)).toHaveBeenCalledWith('project-1');

      await waitFor(() => {
        expect(result.current.projectTitle).toBe('Test');
      });
    });
  });

  describe('error handling', () => {
    it('should handle project fetch error', async () => {
      const error = new Error('Project not found');
      vi.mocked(apiClient.getProject).mockRejectedValueOnce(error);

      const { result } = renderHook(
        () => useProjectData('invalid-id', 'user-1'),
        {
          wrapper,
        }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.projectTitle).toBe('');
      expect(result.current.images).toEqual([]);
    });

    it('should handle images fetch error gracefully', async () => {
      const mockProject = { id: 'project-1', name: 'Test' };
      vi.mocked(apiClient.getProject).mockResolvedValueOnce(mockProject);
      vi.mocked(apiClient.getProjectImages).mockRejectedValueOnce(
        new Error('Images fetch failed')
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        {
          wrapper,
        }
      );

      await waitFor(() => {
        expect(result.current.projectTitle).toBe('Test');
      });
    });

    it('should handle segmentation fetch error gracefully', async () => {
      const mockProject = { id: 'project-1', name: 'Test' };
      const mockImages = [
        {
          id: 'image-1',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
          segmentationStatus: 'completed',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValueOnce(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValueOnce({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      vi.mocked(apiClient.getSegmentationResults).mockRejectedValueOnce(
        new Error('Segmentation fetch failed')
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        {
          wrapper,
        }
      );

      await waitFor(() => {
        expect(result.current.projectTitle).toBe('Test');
        expect(result.current.images).toHaveLength(1);
      });
    });
  });

  describe('image management', () => {
    it('should support updating images', async () => {
      const mockProject = { id: 'project-1', name: 'Test' };
      const mockImages = [
        {
          id: 'image-1',
          name: 'test.jpg',
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-01T00:00:00.000Z',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        {
          wrapper,
        }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.projectTitle).toBe('Test');
      expect(result.current.images).toHaveLength(1);

      // Test updateImages function
      const newImages = [{ ...mockImages[0], name: 'updated.jpg' }];
      result.current.updateImages(newImages);

      expect(result.current.images).toEqual(newImages);
    });
  });

  describe('multiple project support', () => {
    it('should fetch data for different project IDs', async () => {
      const mockProject1 = { id: 'project-1', name: 'Project 1' };
      const mockProject2 = { id: 'project-2', name: 'Project 2' };

      vi.mocked(apiClient.getProject)
        .mockResolvedValueOnce(mockProject1)
        .mockResolvedValueOnce(mockProject2);
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: [],
        total: 0,
        page: 1,
        totalPages: 1,
      });

      const { result: result1 } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.projectTitle).toBe('Project 1');
      });

      const { result: result2 } = renderHook(
        () => useProjectData('project-2', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result2.current.projectTitle).toBe('Project 2');
      });

      expect(vi.mocked(apiClient.getProject)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(apiClient.getProject)).toHaveBeenCalledWith('project-1');
      expect(vi.mocked(apiClient.getProject)).toHaveBeenCalledWith('project-2');
    });
  });

  describe('loading states', () => {
    it('should track loading state', async () => {
      const mockProject = { id: 'project-1', name: 'Test' };

      let projectResolve: any;
      let imagesResolve: any;

      vi.mocked(apiClient.getProject).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            projectResolve = resolve;
          })
      );
      vi.mocked(apiClient.getProjectImages).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            imagesResolve = resolve;
          })
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        {
          wrapper,
        }
      );

      expect(result.current.loading).toBe(true);

      // Resolve project
      projectResolve(mockProject);

      await waitFor(() => {
        expect(result.current.projectTitle).toEqual('Test');
      });

      // Resolve images
      imagesResolve({ images: [], total: 0, page: 1, totalPages: 1 });

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.images).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined projectId', () => {
      const { result } = renderHook(() => useProjectData(undefined, 'user-1'), {
        wrapper,
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.projectTitle).toBe('');
      expect(result.current.images).toEqual([]);
      expect(vi.mocked(apiClient.getProject)).not.toHaveBeenCalled();
    });

    it('should handle null projectId', () => {
      const { result } = renderHook(
        () => useProjectData(null as any, 'user-1'),
        {
          wrapper,
        }
      );

      expect(result.current.loading).toBe(false);
      expect(result.current.projectTitle).toBe('');
      expect(vi.mocked(apiClient.getProject)).not.toHaveBeenCalled();
    });

    it('should handle empty string projectId', () => {
      const { result } = renderHook(() => useProjectData('', 'user-1'), {
        wrapper,
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.projectTitle).toBe('');
      expect(vi.mocked(apiClient.getProject)).not.toHaveBeenCalled();
    });
  });

  describe('batch segmentation result fetching', () => {
    it('should handle null response from batch API gracefully', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };
      const mockImages = [
        {
          id: 'img-1',
          name: 'test1.jpg',
          url: '/uploads/test1.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
        },
        {
          id: 'img-2',
          name: 'test2.jpg',
          url: '/uploads/test2.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: mockImages,
        total: 2,
        page: 1,
        totalPages: 1,
      });

      // Mock batch API returning null for some images
      vi.mocked(apiClient.getBatchSegmentationResults).mockResolvedValue({
        'img-1': {
          polygons: [
            {
              id: 'poly-1',
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
              ],
              type: 'external',
              confidence: 0.9,
              area: 100,
            },
          ],
          imageWidth: 800,
          imageHeight: 600,
          modelUsed: 'hrnet',
          confidence: 0.9,
        },
        'img-2': null, // Null response for this image
      });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1', { fetchAll: true }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.images).toHaveLength(2);

      // First image should have segmentation data
      expect(result.current.images[0].segmentationResult).toBeDefined();
      expect(
        result.current.images[0].segmentationResult?.polygons
      ).toHaveLength(1);

      // Second image should handle null gracefully
      expect(result.current.images[1].segmentationResult).toBeUndefined();
    });

    it('should handle invalid batch response format', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };
      const mockImages = [
        {
          id: 'img-1',
          name: 'test1.jpg',
          url: '/uploads/test1.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });

      // Mock invalid batch response
      vi.mocked(apiClient.getBatchSegmentationResults).mockResolvedValue(
        null as any
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1', { fetchAll: true }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should fall back to original images without enrichment
      expect(result.current.images).toHaveLength(1);
      expect(result.current.images[0].segmentationResult).toBeUndefined();
    });

    it('should handle batch API errors gracefully', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };
      const mockImages = [
        {
          id: 'img-1',
          name: 'test1.jpg',
          url: '/uploads/test1.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });

      // Mock batch API error
      const batchError = new Error('Batch API failed');
      vi.mocked(apiClient.getBatchSegmentationResults).mockRejectedValue(
        batchError
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1', { fetchAll: true }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should return original images without enrichment
      expect(result.current.images).toHaveLength(1);
      expect(result.current.images[0].segmentationResult).toBeUndefined();
    });

    it('should handle missing polygons in segmentation data', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };
      const mockImages = [
        {
          id: 'img-1',
          name: 'test1.jpg',
          url: '/uploads/test1.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });

      // Mock batch response with missing polygons
      vi.mocked(apiClient.getBatchSegmentationResults).mockResolvedValue({
        'img-1': {
          // Missing polygons property
          imageWidth: 800,
          imageHeight: 600,
          modelUsed: 'hrnet',
          confidence: 0.9,
        },
      });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1', { fetchAll: true }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.images).toHaveLength(1);
      // Should handle missing polygons gracefully
      expect(result.current.images[0].segmentationResult).toBeUndefined();
    });

    it('should handle refreshImageSegmentation null response', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };
      const mockImages = [
        {
          id: 'img-1',
          name: 'test1.jpg',
          url: '/uploads/test1.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      vi.mocked(apiClient.getBatchSegmentationResults).mockResolvedValue({});

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock single image API returning null
      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue(null);

      // Call refreshImageSegmentation
      await waitFor(() => {
        result.current.refreshImageSegmentation('img-1');
      });

      // Should handle null response gracefully without throwing
      expect(result.current.images[0].segmentationResult).toBeUndefined();
    });

    it('should handle refreshImageSegmentation API errors', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };
      const mockImages = [
        {
          id: 'img-1',
          name: 'test1.jpg',
          url: '/uploads/test1.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImages).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });
      vi.mocked(apiClient.getBatchSegmentationResults).mockResolvedValue({});

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock API error
      const refreshError = new Error('API refresh failed');
      vi.mocked(apiClient.getSegmentationResults).mockRejectedValue(
        refreshError
      );

      // Call refreshImageSegmentation - should not throw
      await waitFor(() => {
        result.current.refreshImageSegmentation('img-1');
      });

      // Should handle error gracefully
      expect(result.current.images[0].segmentationResult).toBeUndefined();
    });
  });
});
