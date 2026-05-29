/**
 * api.ts – uncovered branches (72 % → higher).
 *
 * Targets NOT covered by existing api.test.ts / api-advanced.test.ts:
 *  • mapSegmentationStatus: 'no_polygons' → 'completed'
 *  • getSegmentationResults: 404 → null, array branch, object branch
 *  • updateSegmentationResults: full-object, array, and unexpected-response branches
 *  • getBatchSegmentationResults: empty-array guard, null entry handling
 *  • deleteAccount: clears tokens even when request fails
 *  • deleteFolder: 207 partial-failure envelope
 *  • moveProjectsToFolder: null folderId → /folders/root/items
 *  • addImageToQueue / addBatchToQueue: happy paths
 *  • getQueueStats / getQueueItems / removeFromQueue: happy paths
 *  • cancelAllUserSegmentations: happy path
 *  • getUserStorageStats: happy path
 *  • changePassword: happy path
 *  • updateImageChannels: happy path
 *  • reorderProjectImages: happy path
 *  • generic get / post / put methods pass through
 *  • getProjects: null data / array / object-with-projects fallbacks
 *  • submitFeedback with and without attachment
 *
 * Setup pattern mirrors api-advanced.test.ts: vi.hoisted + vi.mock axios.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== HOIST MOCK STATE =====
const { mockAxiosInstance, responseErrorHandlerRef: _responseErrorHandlerRef } =
  vi.hoisted(() => {
    const mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
      interceptors: {
        request: {
          use: vi.fn((_s: any) => 0),
          eject: vi.fn(),
        },
        response: {
          use: vi.fn((_s: any, _e: any) => 0),
          eject: vi.fn(),
        },
      },
    };
    return {
      mockAxiosInstance,
      responseErrorHandlerRef: { value: undefined as any },
    };
  });

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockAxiosInstance) },
}));

vi.mock('@/lib/api', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return { ...actual };
});

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});
Object.defineProperty(window, 'sessionStorage', {
  value: sessionStorageMock,
  writable: true,
});

vi.mock('@/lib/config', () => ({
  default: { apiBaseUrl: 'http://localhost:3001/api' },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// ===== IMPORT API CLIENT =====
import { apiClient } from '../api';

// ===== HELPERS =====
function wrap<T>(data: T) {
  return { data: { success: true, data } };
}

function direct<T>(data: T) {
  return { data };
}

describe('API Client – uncovered branches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    sessionStorageMock.getItem.mockReturnValue(null);
    (apiClient as any).instance = mockAxiosInstance;
  });

  // --------------------------------------------------------------------------
  // mapSegmentationStatus: 'no_polygons' branch
  // --------------------------------------------------------------------------

  describe('mapSegmentationStatus – no_polygons', () => {
    it('maps no_polygons to completed', async () => {
      mockAxiosInstance.get.mockResolvedValue(
        wrap({
          image: {
            id: '1',
            name: 'x.jpg',
            projectId: 'p1',
            userId: 'u1',
            originalUrl: '/x.jpg',
            segmentationStatus: 'no_polygons',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        })
      );
      const result = await apiClient.getImage('p1', '1');
      expect(result.segmentation_status).toBe('completed');
    });
  });

  // --------------------------------------------------------------------------
  // getSegmentationResults branches
  // --------------------------------------------------------------------------

  describe('getSegmentationResults', () => {
    it('returns null when the endpoint responds with 404', async () => {
      const notFoundError = { response: { status: 404 } };
      mockAxiosInstance.get.mockRejectedValue(notFoundError);
      const result = await apiClient.getSegmentationResults('img-404');
      expect(result).toBeNull();
    });

    it('re-throws non-404 errors', async () => {
      const serverError = {
        response: { status: 500 },
        message: 'Server error',
      };
      mockAxiosInstance.get.mockRejectedValue(serverError);
      await expect(apiClient.getSegmentationResults('img-500')).rejects.toEqual(
        serverError
      );
    });

    it('returns SegmentationResultData from an object response', async () => {
      mockAxiosInstance.get.mockResolvedValue(
        wrap({
          polygons: [{ id: 'p1', points: [{ x: 0, y: 0 }], type: 'external' }],
          imageWidth: 800,
          imageHeight: 600,
          modelUsed: 'hrnet',
          updatedAt: '2024-01-01T00:00:00Z',
        })
      );
      const result = await apiClient.getSegmentationResults('img-1');
      expect(result).not.toBeNull();
      expect(result!.polygons).toHaveLength(1);
      expect(result!.imageWidth).toBe(800);
      expect(result!.updatedAt).toBe('2024-01-01T00:00:00Z');
    });

    it('wraps a bare polygon array into SegmentationResultData', async () => {
      const polygons = [
        { id: 'p1', points: [{ x: 0, y: 0 }], type: 'external' },
      ];
      mockAxiosInstance.get.mockResolvedValue(wrap(polygons));
      const result = await apiClient.getSegmentationResults('img-2');
      expect(result).not.toBeNull();
      expect(result!.polygons).toEqual(polygons);
    });

    it('returns null when data is null / falsy', async () => {
      mockAxiosInstance.get.mockResolvedValue(wrap(null));
      const result = await apiClient.getSegmentationResults('img-3');
      expect(result).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // updateSegmentationResults branches
  // --------------------------------------------------------------------------

  describe('updateSegmentationResults', () => {
    const testPolygons = [
      { id: 'p1', points: [{ x: 0, y: 0 }], type: 'external' as const },
    ];

    it('returns full SegmentationResultData from an object response', async () => {
      mockAxiosInstance.put.mockResolvedValue(
        wrap({
          polygons: testPolygons,
          imageWidth: 640,
          imageHeight: 480,
          modelUsed: 'cbam',
        })
      );
      const result = await apiClient.updateSegmentationResults(
        'img-1',
        testPolygons,
        640,
        480
      );
      expect(result.polygons).toEqual(testPolygons);
      expect(result.imageWidth).toBe(640);
    });

    it('returns array branch when response is a bare array', async () => {
      mockAxiosInstance.put.mockResolvedValue(wrap(testPolygons));
      const result = await apiClient.updateSegmentationResults(
        'img-2',
        testPolygons
      );
      expect(result.polygons).toEqual(testPolygons);
    });

    it('falls back to sent polygons when response is unexpected', async () => {
      // null data from backend
      mockAxiosInstance.put.mockResolvedValue(wrap(null));
      const result = await apiClient.updateSegmentationResults(
        'img-3',
        testPolygons
      );
      expect(result.polygons).toEqual(testPolygons);
    });

    it('omits dimensions from payload when they are falsy', async () => {
      mockAxiosInstance.put.mockResolvedValue(wrap({ polygons: [] }));
      await apiClient.updateSegmentationResults('img-4', testPolygons);
      // Called without imageWidth/imageHeight in the payload
      expect(mockAxiosInstance.put).toHaveBeenCalledWith(
        '/segmentation/images/img-4/results',
        { polygons: testPolygons } // no imageWidth/imageHeight keys
      );
    });
  });

  // --------------------------------------------------------------------------
  // getBatchSegmentationResults
  // --------------------------------------------------------------------------

  describe('getBatchSegmentationResults', () => {
    it('returns {} when called with an empty array', async () => {
      const result = await apiClient.getBatchSegmentationResults([]);
      expect(result).toEqual({});
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });

    it('maps null entries to null in the result map', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({
          'img-null': null,
          'img-ok': {
            polygons: [],
            imageWidth: 100,
            imageHeight: 100,
          },
        })
      );
      const result = await apiClient.getBatchSegmentationResults([
        'img-null',
        'img-ok',
      ]);
      expect(result['img-null']).toBeNull();
      expect(result['img-ok']).not.toBeNull();
    });

    it('re-throws errors from the batch endpoint', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('server boom'));
      await expect(
        apiClient.getBatchSegmentationResults(['img-1'])
      ).rejects.toThrow('server boom');
    });
  });

  // --------------------------------------------------------------------------
  // deleteAccount
  // --------------------------------------------------------------------------

  describe('deleteAccount', () => {
    it('clears tokens after successful deletion', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});
      await apiClient.deleteAccount();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('refreshToken');
    });

    it('clears tokens even when the request fails', async () => {
      mockAxiosInstance.delete.mockRejectedValue(new Error('network error'));
      await expect(apiClient.deleteAccount()).rejects.toThrow('network error');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
    });
  });

  // --------------------------------------------------------------------------
  // deleteFolder – 207 partial-failure envelope
  // --------------------------------------------------------------------------

  describe('deleteFolder – 207 response', () => {
    it('returns data from response.data.data for 207 status', async () => {
      const partialResult = {
        folderDeleted: false,
        deletedProjectIds: ['p1'],
        unlinkedSharedProjectIds: [],
        failedProjectIds: [{ id: 'p2', error: 'locked' }],
      };
      mockAxiosInstance.delete.mockResolvedValue({
        status: 207,
        data: {
          success: false,
          message: 'partial',
          data: partialResult,
        },
      });
      const result = await apiClient.deleteFolder('folder-1');
      expect(result.folderDeleted).toBe(false);
      expect(result.failedProjectIds).toHaveLength(1);
    });

    it('returns data from extractData for 200 status', async () => {
      const fullSuccess = {
        folderDeleted: true,
        deletedProjectIds: ['p1', 'p2'],
        unlinkedSharedProjectIds: [],
        failedProjectIds: [],
      };
      mockAxiosInstance.delete.mockResolvedValue({
        status: 200,
        data: { success: true, data: fullSuccess },
      });
      const result = await apiClient.deleteFolder('folder-2');
      expect(result.folderDeleted).toBe(true);
      expect(result.deletedProjectIds).toEqual(['p1', 'p2']);
    });
  });

  // --------------------------------------------------------------------------
  // moveProjectsToFolder – null folderId goes to /root/items
  // --------------------------------------------------------------------------

  describe('moveProjectsToFolder', () => {
    it('posts to /folders/root/items when folderId is null', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({ movedProjectIds: ['p1'], skippedProjectIds: [] })
      );
      await apiClient.moveProjectsToFolder(null, ['p1']);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/folders/root/items',
        { projectIds: ['p1'] }
      );
    });

    it('posts to /folders/:id/items when folderId is a string', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({ movedProjectIds: ['p2'], skippedProjectIds: [] })
      );
      await apiClient.moveProjectsToFolder('folder-abc', ['p2']);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/folders/folder-abc/items',
        { projectIds: ['p2'] }
      );
    });
  });

  // --------------------------------------------------------------------------
  // Queue helpers
  // --------------------------------------------------------------------------

  describe('queue methods', () => {
    it('addImageToQueue posts to /queue/images/:id and returns data', async () => {
      const queueItem = {
        id: 'q1',
        imageId: 'img-1',
        projectId: 'proj-1',
        model: 'hrnet',
        threshold: 0.5,
        priority: 0,
        status: 'queued',
        createdAt: '2024-01-01T00:00:00Z',
      };
      mockAxiosInstance.post.mockResolvedValue(
        wrap({ queueItem, message: 'Added' })
      );
      const result = await apiClient.addImageToQueue('img-1', 'hrnet', 0.5);
      expect(result.queueItem).toEqual(queueItem);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/queue/images/img-1',
        expect.objectContaining({ model: 'hrnet', threshold: 0.5 })
      );
    });

    it('addBatchToQueue posts to /queue/batch and returns data', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({ queuedCount: 2, queueItems: [], message: 'Queued' })
      );
      const result = await apiClient.addBatchToQueue(
        ['i1', 'i2'],
        'proj-1',
        'hrnet'
      );
      expect(result.queuedCount).toBe(2);
    });

    it('addBatchToQueue includes channel when provided', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({ queuedCount: 1, queueItems: [], message: 'Queued' })
      );
      await apiClient.addBatchToQueue(
        ['i1'],
        'proj-1',
        'hrnet',
        0.5,
        0,
        false,
        false,
        'TIRF_640'
      );
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/queue/batch',
        expect.objectContaining({ channel: 'TIRF_640' })
      );
    });

    it('getQueueStats returns stats', async () => {
      const stats = {
        total: 5,
        queued: 2,
        processing: 1,
        completed: 2,
        failed: 0,
      };
      mockAxiosInstance.get.mockResolvedValue(wrap(stats));
      const result = await apiClient.getQueueStats('proj-1');
      expect(result).toEqual(stats);
    });

    it('getQueueItems returns array of items', async () => {
      mockAxiosInstance.get.mockResolvedValue(wrap([{ id: 'q1' }]));
      const result = await apiClient.getQueueItems('proj-1');
      expect(result).toEqual([{ id: 'q1' }]);
    });

    it('removeFromQueue deletes the queue item', async () => {
      mockAxiosInstance.delete.mockResolvedValue({});
      await apiClient.removeFromQueue('q1');
      expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/queue/items/q1');
    });

    it('cancelAllUserSegmentations posts and returns result', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({
          success: true,
          cancelledCount: 3,
          affectedProjects: ['p1'],
          affectedBatches: [],
        })
      );
      const result = await apiClient.cancelAllUserSegmentations();
      expect(result.cancelledCount).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // Profile / account helpers
  // --------------------------------------------------------------------------

  describe('profile helpers', () => {
    it('getUserStorageStats returns storage data', async () => {
      const stats = {
        totalStorageBytes: 1_000_000,
        totalStorageMB: 1,
        totalStorageGB: 0.001,
        totalImages: 42,
        averageImageSizeMB: 0.024,
      };
      mockAxiosInstance.get.mockResolvedValue(wrap(stats));
      const result = await apiClient.getUserStorageStats();
      expect(result.totalImages).toBe(42);
    });

    it('changePassword posts to /auth/change-password', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({ message: 'Password changed' })
      );
      const result = await apiClient.changePassword({
        currentPassword: 'old',
        newPassword: 'new123',
      });
      expect(result.message).toBe('Password changed');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/change-password',
        { currentPassword: 'old', newPassword: 'new123' }
      );
    });

    it('updateImageChannels patches /images/:id/channels', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});
      await apiClient.updateImageChannels('img-1', [
        {
          name: 'TIRF_640',
          type: 'fluorescent',
          isSegmentationSource: true,
        },
      ]);
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/images/img-1/channels',
        expect.objectContaining({ channels: expect.any(Array) })
      );
    });
  });

  // --------------------------------------------------------------------------
  // reorderProjectImages
  // --------------------------------------------------------------------------

  describe('reorderProjectImages', () => {
    it('patches /projects/:id/images/reorder with imageIds', async () => {
      mockAxiosInstance.patch.mockResolvedValue({});
      await apiClient.reorderProjectImages('proj-1', ['i1', 'i2', 'i3']);
      expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
        '/projects/proj-1/images/reorder',
        { imageIds: ['i1', 'i2', 'i3'] }
      );
    });
  });

  // --------------------------------------------------------------------------
  // submitFeedback
  // --------------------------------------------------------------------------

  describe('submitFeedback', () => {
    it('posts to /feedback without attachment', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({ id: 'fb-1', emailQueued: true })
      );
      const result = await apiClient.submitFeedback({
        type: 'bug',
        title: 'Test bug',
        body: 'Details here',
      });
      expect(result.id).toBe('fb-1');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/feedback',
        expect.any(FormData),
        expect.objectContaining({ timeout: 0 })
      );
    });

    it('includes attachment in FormData when provided', async () => {
      mockAxiosInstance.post.mockResolvedValue(
        wrap({ id: 'fb-2', emailQueued: true, attachmentStored: true })
      );
      const file = new File(['image data'], 'screenshot.png', {
        type: 'image/png',
      });
      const result = await apiClient.submitFeedback(
        { type: 'feature', title: 'New idea', body: 'Details' },
        file
      );
      expect(result.attachmentStored).toBe(true);
    });

    it('calls onUploadProgress with percentage', async () => {
      const progressSpy = vi.fn();
      mockAxiosInstance.post.mockImplementation(
        (_url: string, _data: unknown, config: any) => {
          config?.onUploadProgress?.({ loaded: 50, total: 100 });
          return Promise.resolve(wrap({ id: 'fb-3', emailQueued: true }));
        }
      );
      await apiClient.submitFeedback(
        { type: 'bug', title: 'Bug', body: 'Body' },
        undefined,
        progressSpy
      );
      expect(progressSpy).toHaveBeenCalledWith(50);
    });
  });

  // --------------------------------------------------------------------------
  // getProjects – fallback response shapes
  // --------------------------------------------------------------------------

  describe('getProjects – fallback shapes', () => {
    it('returns empty set when data is null', async () => {
      mockAxiosInstance.get.mockResolvedValue(wrap(null));
      const result = await apiClient.getProjects();
      expect(result.projects).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('wraps a direct array response in the expected shape', async () => {
      const projects = [
        {
          id: '1',
          title: 'Proj A',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          userId: 'u1',
          type: 'spheroid',
        },
      ];
      // respond with a bare array (not wrapped in .data)
      mockAxiosInstance.get.mockResolvedValue(direct(projects));
      const result = await apiClient.getProjects();
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('Proj A');
    });

    it('handles object response with .projects key', async () => {
      const projects = [
        {
          id: '2',
          title: 'Proj B',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          userId: 'u2',
          type: 'spheroid',
        },
      ];
      mockAxiosInstance.get.mockResolvedValue(
        direct({ projects, total: 1, page: 1, totalPages: 1 })
      );
      const result = await apiClient.getProjects();
      expect(result.projects).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Generic pass-through methods
  // --------------------------------------------------------------------------

  describe('generic HTTP methods', () => {
    it('post() delegates to instance.post', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: 'resp' });
      const result = await apiClient.post('/custom', { key: 'val' });
      expect(result).toEqual({ data: 'resp' });
    });

    it('get() delegates to instance.get', async () => {
      mockAxiosInstance.get.mockResolvedValue({ data: 'resp' });
      const result = await apiClient.get('/custom');
      expect(result).toEqual({ data: 'resp' });
    });

    it('put() delegates to instance.put', async () => {
      mockAxiosInstance.put.mockResolvedValue({ data: 'resp' });
      const result = await apiClient.put('/custom', { x: 1 });
      expect(result).toEqual({ data: 'resp' });
    });
  });

  // --------------------------------------------------------------------------
  // deleteBatch – chunking and partial-failure aggregation
  // --------------------------------------------------------------------------

  describe('deleteBatch', () => {
    it('aggregates results from a single-chunk batch', async () => {
      mockAxiosInstance.delete.mockResolvedValueOnce(
        wrap({ deletedCount: 2, failedIds: [], errors: [] })
      );

      const result = await apiClient.deleteBatch(['i1', 'i2'], 'proj-1');
      expect(result.deletedCount).toBe(2);
      expect(result.failedIds).toHaveLength(0);
    });

    it('captures failed chunks in failedIds/errors without throwing', async () => {
      mockAxiosInstance.delete.mockRejectedValueOnce(
        new Error('network error')
      );
      const result = await apiClient.deleteBatch(['i1'], 'proj-1');
      expect(result.failedIds).toContain('i1');
      expect(result.errors[0]).toContain('network error');
    });
  });
});
