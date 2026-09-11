import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
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
    getUserProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUserProfile: vi.fn(),
    deleteAccount: vi.fn(),
    getProject: vi.fn(),
    getProjectImages: vi.fn(),
    getProjectImagesWithThumbnails: vi.fn(),
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
    vi.mocked(apiClient.getProjectImagesWithThumbnails).mockReset();
    vi.mocked(apiClient.getProjectImagesWithThumbnails).mockReset();
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

      // LOD 'low' response — images include lightweight segmentationResult with polygon counts
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
            segmentationResult: {
              polygons: [],
              imageWidth: 800,
              imageHeight: 600,
            },
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

      vi.mocked(apiClient.getProject).mockResolvedValueOnce(mockProject);
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValueOnce(
        mockImagesResponse
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
      expect(
        vi.mocked(apiClient.getProjectImagesWithThumbnails)
      ).toHaveBeenCalledWith('project-1', { limit: 100, page: 1, lod: 'low' });

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
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValueOnce(
        {
          images: [],
          total: 0,
          page: 1,
          totalPages: 1,
        }
      );

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
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValueOnce(
        {
          images: mockImages,
          total: 1,
          page: 1,
          totalPages: 1,
        }
      );

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
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockRejectedValueOnce(
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
      // The new implementation does not eagerly fetch segmentation during load;
      // segmentation data comes embedded in the LOD response from getProjectImagesWithThumbnails.
      // A segmentation refresh error (from refreshImageSegmentation) is handled gracefully.
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
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValueOnce(
        {
          images: mockImages,
          total: 1,
          page: 1,
          totalPages: 1,
        }
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
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue({
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
      result.current.updateImages(newImages as any);

      await waitFor(() => {
        expect(result.current.images).toEqual(newImages);
      });
    });
  });

  describe('multiple project support', () => {
    it('should fetch data for different project IDs', async () => {
      const mockProject1 = { id: 'project-1', name: 'Project 1' };
      const mockProject2 = { id: 'project-2', name: 'Project 2' };

      vi.mocked(apiClient.getProject)
        .mockResolvedValueOnce(mockProject1)
        .mockResolvedValueOnce(mockProject2);
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue({
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
      vi.mocked(
        apiClient.getProjectImagesWithThumbnails
      ).mockImplementationOnce(
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
    // The hook uses getProjectImagesWithThumbnails (LOD 'low') which returns segmentation
    // data embedded in the image response. Segmentation enrichment happens via
    // refreshImageSegmentation, not during initial load.

    it('should load images with embedded segmentation from LOD response', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };
      const mockImages = [
        {
          id: 'img-1',
          name: 'test1.jpg',
          url: '/uploads/test1.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
          segmentationResult: {
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
              },
            ],
            imageWidth: 800,
            imageHeight: 600,
          },
        },
        {
          id: 'img-2',
          name: 'test2.jpg',
          url: '/uploads/test2.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
          // No embedded segmentationResult (null from server)
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue({
        images: mockImages,
        total: 2,
        page: 1,
        totalPages: 1,
      });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.images).toHaveLength(2);

      // First image has embedded segmentation data
      expect(result.current.images[0].segmentationResult).toBeDefined();
      expect(
        result.current.images[0].segmentationResult?.polygons
      ).toHaveLength(1);

      // Second image has no embedded segmentation
      expect(result.current.images[1].segmentationResult).toBeUndefined();
    });

    it('should handle images without segmentation data gracefully', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };
      const mockImages = [
        {
          id: 'img-1',
          name: 'test1.jpg',
          url: '/uploads/test1.jpg',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
          segmentationStatus: 'completed',
          // No segmentationResult in LOD response
        },
      ];

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Images still load even if no segmentation is embedded
      expect(result.current.images).toHaveLength(1);
      expect(result.current.images[0].segmentationResult).toBeUndefined();
    });

    it('should handle getProjectImagesWithThumbnails error gracefully', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };

      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      // Error in images fetch causes the while loop to break
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockRejectedValue(
        new Error('Images fetch failed')
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Should return empty images on error
      expect(result.current.images).toHaveLength(0);
    });

    it('should handle pagination — multiple pages of images', async () => {
      const mockProject = { id: 'project-1', name: 'Test Project' };

      // First page returns 1 image, total is 2 → triggers second page fetch
      vi.mocked(apiClient.getProject).mockResolvedValue(mockProject);
      vi.mocked(apiClient.getProjectImagesWithThumbnails)
        .mockResolvedValueOnce({
          images: [
            {
              id: 'img-1',
              name: 'test1.jpg',
              created_at: '2023-01-01T00:00:00Z',
              updated_at: '2023-01-01T00:00:00Z',
              segmentationStatus: 'pending',
            },
          ],
          total: 101, // More than one page (limit=100)
          page: 1,
          totalPages: 2,
        })
        .mockResolvedValueOnce({
          images: [
            {
              id: 'img-2',
              name: 'test2.jpg',
              created_at: '2023-01-01T00:00:00Z',
              updated_at: '2023-01-01T00:00:00Z',
              segmentationStatus: 'pending',
            },
          ],
          total: 101,
          page: 2,
          totalPages: 2,
        });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.images).toHaveLength(2);
      expect(
        vi.mocked(apiClient.getProjectImagesWithThumbnails)
      ).toHaveBeenCalledTimes(2);
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
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock single image API returning null — refresh should do nothing
      vi.mocked(apiClient.getSegmentationResults).mockResolvedValue(null);

      // Call refreshImageSegmentation — should not throw
      await result.current.refreshImageSegmentation('img-1');

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
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue({
        images: mockImages,
        total: 1,
        page: 1,
        totalPages: 1,
      });

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Mock API error on all 4 attempts (1 initial + 3 retries)
      const refreshError = new Error('API refresh failed');
      vi.mocked(apiClient.getSegmentationResults).mockRejectedValue(
        refreshError
      );

      // Call refreshImageSegmentation - should not throw
      await result.current.refreshImageSegmentation('img-1');

      // Should handle error gracefully — image remains with no segmentationResult
      expect(result.current.images[0].segmentationResult).toBeUndefined();
    });
  });

  describe('paging across an unstable order', () => {
    // "Select All 300 images" selected 216. Offset pagination cannot survive a
    // row being INSERTED or DELETED between two page fetches — an upload
    // finishing mid-load does exactly that — so pages can overlap however
    // stable the ORDER BY is. A duplicate inflates `filteredImages.length`
    // while `selectedImageIds` (a Set) collapses it, and the two numbers then
    // disagree on screen.
    //
    // The hook pages in hundreds, so a fixture small enough to read would
    // never reach a second request — `hasMore` is `page * 100 < total`. These
    // use real 100-row pages for that reason.
    const page = (ids: string[], total: number) => ({
      images: ids.map(id => ({
        id,
        name: `${id}.png`,
        segmentationStatus: 'no_segmentation',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })),
      pagination: { total, page: 1, limit: 100, totalPages: 2 },
    });
    const ids = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => `img-${from + i}`);

    it('keeps one entry per image when two pages overlap', async () => {
      vi.mocked(apiClient.getProject).mockResolvedValue({
        id: 'project-9',
        name: 'Overlapping',
      } as never);
      // 200 rows claimed. `img-99` comes back on BOTH pages and `img-199` on
      // neither — the exact shape a shifted page boundary produces.
      vi.mocked(apiClient.getProjectImagesWithThumbnails)
        .mockResolvedValueOnce(page(ids(0, 100), 200) as never)
        .mockResolvedValueOnce(page(ids(99, 100), 200) as never);

      const { result } = renderHook(
        () => useProjectData('project-9', 'user-1'),
        { wrapper }
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      const got = result.current.images.map(i => i.id);
      // Without the dedupe this is 200 entries with 199 unique — the array
      // length the label shows, against the Set size the selection holds.
      expect(got.length).toBe(199);
      expect(new Set(got).size).toBe(got.length);
      expect(got.filter(id => id === 'img-99')).toHaveLength(1);
    });

    it('does not drop a legitimately distinct image', async () => {
      // The control: the dedupe must key on the id, not collapse rows that
      // merely look alike. Same name shape, same timestamps, different ids.
      vi.mocked(apiClient.getProject).mockResolvedValue({
        id: 'project-10',
        name: 'Distinct',
      } as never);
      vi.mocked(apiClient.getProjectImagesWithThumbnails)
        .mockResolvedValueOnce(page(ids(0, 100), 200) as never)
        .mockResolvedValueOnce(page(ids(100, 100), 200) as never);

      const { result } = renderHook(
        () => useProjectData('project-10', 'user-1'),
        { wrapper }
      );
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.images).toHaveLength(200);
    });
  });

  // `/project/:id` is not a keyed route, so React Router keeps ProjectDetail
  // mounted when only the param changes and every piece of hook state survives
  // the switch. For the folder that matters more than for the title: Back
  // navigates on it, so a stale value carries the user into the folder of the
  // project they just left.
  describe('projectFolderId', () => {
    const projectAt = (id: string, folderId: string | null) => ({
      id,
      name: id,
      description: '',
      created_at: '2023-01-01T00:00:00.000Z',
      updated_at: '2023-01-01T00:00:00.000Z',
      user_id: 'user-1',
      folderId,
    });
    const noImages = { images: [], total: 0, page: 1, totalPages: 0 };

    it('reports the folder the project is filed in', async () => {
      vi.mocked(apiClient.getProject).mockResolvedValue(
        projectAt('project-1', 'folder-7') as never
      );
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue(
        noImages as never
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.projectFolderId).toBe('folder-7');
    });

    it('keeps the folder across a same-project refresh', async () => {
      // `refreshProjectData()` re-runs the same effect, and the effect opens by
      // forgetting the folder so a PROJECT SWITCH cannot show a stale one.
      // Firing that reset on a same-project refresh is a different thing
      // entirely: nothing changed except the data, and blanking the folder
      // sends Back to the dashboard root instead of the folder the user came
      // from. Introduced with the refresh nonce; caught in review.
      vi.mocked(apiClient.getProject).mockResolvedValue(
        projectAt('project-1', 'folder-7') as never
      );
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue(
        noImages as never
      );

      const { result } = renderHook(
        () => useProjectData('project-1', 'user-1'),
        { wrapper }
      );
      await waitFor(() =>
        expect(result.current.projectFolderId).toBe('folder-7')
      );

      // The refetch never settles, so the assertion lands in the window the
      // reset would have blanked.
      vi.mocked(apiClient.getProject).mockImplementation(
        () => new Promise(() => {}) as never
      );
      act(() => result.current.refreshProjectData());

      expect(result.current.projectFolderId).toBe('folder-7');
    });

    it('forgets the previous project’s folder while the next one loads', async () => {
      vi.mocked(apiClient.getProjectImagesWithThumbnails).mockResolvedValue(
        noImages as never
      );
      vi.mocked(apiClient.getProject).mockResolvedValue(
        projectAt('project-1', 'folder-7') as never
      );

      const { result, rerender } = renderHook(
        ({ id }: { id: string }) => useProjectData(id, 'user-1'),
        { wrapper, initialProps: { id: 'project-1' } }
      );
      await waitFor(() =>
        expect(result.current.projectFolderId).toBe('folder-7')
      );

      // The next project's fetch never settles, so the hook stays in exactly
      // the window this is about: a new projectId with no answer yet.
      vi.mocked(apiClient.getProject).mockImplementation(
        () => new Promise(() => {}) as never
      );
      rerender({ id: 'project-2' });

      expect(result.current.projectFolderId).toBeUndefined();
    });
  });
});
