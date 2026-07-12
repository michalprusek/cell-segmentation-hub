/**
 * api.ts — ApiClient resource methods.
 *
 * One method-per-endpoint coverage grouped by concern: projects, folders,
 * sharing, images (incl. upload NFC + AbortSignal forwarding), segmentation,
 * queue, batch delete (chunk aggregation), upload extras (avatar / feedback),
 * export download, and user profile.
 *
 * Cross-cutting client behaviour (interceptors, token refresh, retry/backoff,
 * field mapping, auth) lives in api.test.ts; chunked upload lives in
 * api-chunked-upload.test.ts. All three share ./helpers/apiClientTestKit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ok } from './helpers/apiClientTestKit';

// ── hoisted axios mock ──────────────────────────────────────────────────────
const mockAxiosInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockAxiosInstance) },
}));

vi.mock('@/lib/api', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return { ...actual };
});

vi.mock('@/lib/config', () => ({
  default: { apiBaseUrl: 'http://localhost:3001/api' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Force a known chunk size so deleteBatch's single-chunk assertions are stable.
vi.mock('@/lib/constants', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    FILE_LIMITS: { ...actual.FILE_LIMITS, CHUNK_SIZE_FILES: 100 },
    TIMEOUTS: { ...actual.TIMEOUTS },
  };
});

import { apiClient } from '../api';

// ── fixtures ────────────────────────────────────────────────────────────────
const baseImageRaw = {
  id: 'img-1',
  name: 'test.png',
  projectId: 'proj-1',
  userId: 'user-1',
  originalUrl: 'http://localhost:3001/api/../uploads/test.png',
  thumbnailUrl: undefined,
  width: 800,
  height: 600,
  segmentationStatus: 'pending',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const baseProjectRaw = {
  id: 'proj-1',
  title: 'My Project',
  description: 'A test project',
  type: 'spheroid',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  userId: 'user-1',
};

const c = () => apiClient as any;

beforeEach(() => {
  vi.clearAllMocks();
  (apiClient as any).instance = mockAxiosInstance;
  (apiClient as any).accessToken = 'test-token';
  (apiClient as any).refreshToken = 'refresh-token';
});

afterEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════════
describe('projects', () => {
  it('getProjects — unwraps a paginated envelope', async () => {
    const projects = [
      { id: '1', title: 'Project 1', description: 'one' },
      { id: '2', title: 'Project 2', description: 'two' },
    ];
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        data: { projects, total: 2, page: 1, totalPages: 1 },
      },
    });

    const result = await c().getProjects();
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects', {
      params: undefined,
    });
    expect(result.projects).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('getProjects — array data fallback (no pagination envelope)', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: [baseProjectRaw] },
    });

    const result = await c().getProjects();
    expect(result.projects).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('getProjects — null data fallback returns empty defaults', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: null },
    });

    const result = await c().getProjects();
    expect(result.projects).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('getProject — maps title→name from the backend', async () => {
    mockAxiosInstance.get.mockResolvedValue(ok(baseProjectRaw));

    const proj = await c().getProject('proj-1');
    expect(proj.name).toBe('My Project');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects/proj-1');
  });

  it('createProject — converts name→title', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ ...baseProjectRaw, id: '3', title: 'New Project' })
    );

    const result = await c().createProject({
      name: 'New Project',
      description: 'A new test project',
    });

    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/projects', {
      title: 'New Project',
      description: 'A new test project',
    });
    expect(result).toMatchObject({ id: '3', name: 'New Project' });
  });

  it('updateProject — converts name→title and strips name', async () => {
    mockAxiosInstance.put.mockResolvedValue(
      ok({ ...baseProjectRaw, title: 'New Name' })
    );

    const result = await c().updateProject('proj-1', {
      name: 'New Name',
      description: 'desc',
    });

    const [url, body] = mockAxiosInstance.put.mock.calls[0];
    expect(url).toBe('/projects/proj-1');
    expect(body.title).toBe('New Name');
    expect(body.name).toBeUndefined();
    expect(result.name).toBe('New Name');
  });

  it('deleteProject — DELETE /projects/:id', async () => {
    mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });

    await expect(c().deleteProject('1')).resolves.toBeUndefined();
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/projects/1');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('folders', () => {
  it('getFolders — returns the array from the response', async () => {
    const folders = [{ id: 'f1', name: 'Science', parentId: null }];
    mockAxiosInstance.get.mockResolvedValue(ok(folders));

    expect(await c().getFolders()).toEqual(folders);
  });

  it('createFolder — POST /folders with name + parentId', async () => {
    const folder = { id: 'f2', name: 'Sub', parentId: 'f1' };
    mockAxiosInstance.post.mockResolvedValue(ok(folder));

    const result = await c().createFolder({ name: 'Sub', parentId: 'f1' });
    expect(result).toEqual(folder);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/folders', {
      name: 'Sub',
      parentId: 'f1',
    });
  });

  it('updateFolder — PATCH /folders/:id', async () => {
    const updated = { id: 'f1', name: 'Renamed', parentId: null };
    mockAxiosInstance.patch.mockResolvedValue(ok(updated));

    const result = await c().updateFolder('f1', { name: 'Renamed' });
    expect(result).toEqual(updated);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/folders/f1', {
      name: 'Renamed',
    });
  });

  it('deleteFolder — 200 unwraps via extractData', async () => {
    mockAxiosInstance.delete.mockResolvedValue({
      status: 200,
      data: {
        success: true,
        data: {
          folderDeleted: true,
          deletedProjectIds: [],
          unlinkedSharedProjectIds: [],
          failedProjectIds: [],
        },
      },
    });

    const result = await c().deleteFolder('f1');
    expect(result.folderDeleted).toBe(true);
  });

  it('deleteFolder — 207 partial failure returns response.data.data', async () => {
    mockAxiosInstance.delete.mockResolvedValue({
      status: 207,
      data: {
        success: false,
        message: 'Partial',
        data: {
          folderDeleted: false,
          deletedProjectIds: ['p1'],
          unlinkedSharedProjectIds: [],
          failedProjectIds: [{ id: 'p2', error: 'In use' }],
        },
      },
    });

    const result = await c().deleteFolder('f1');
    expect(result.folderDeleted).toBe(false);
    expect(result.failedProjectIds).toHaveLength(1);
  });

  it('previewFolder — GET /folders/:id/preview', async () => {
    const preview = {
      folderId: 'f1',
      ownedProjectCount: 3,
      sharedProjectCount: 1,
      subfolderCount: 0,
    };
    mockAxiosInstance.get.mockResolvedValue(ok(preview));

    expect(await c().previewFolder('f1')).toEqual(preview);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/folders/f1/preview');
  });

  it('moveProjectsToFolder — null folderId hits /folders/root/items', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ movedProjectIds: ['p1'], skippedProjectIds: [] })
    );

    await c().moveProjectsToFolder(null, ['p1']);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/folders/root/items', {
      projectIds: ['p1'],
    });
  });

  it('moveProjectsToFolder — string folderId hits /folders/:id/items', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ movedProjectIds: ['p1'], skippedProjectIds: [] })
    );

    await c().moveProjectsToFolder('f2', ['p1']);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/folders/f2/items', {
      projectIds: ['p1'],
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('sharing', () => {
  it('shareProjectByEmail — POST /projects/:id/share/email', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({
        id: 's1',
        email: 'b@example.com',
        status: 'pending',
        createdAt: '2026',
      })
    );

    const result = await c().shareProjectByEmail('proj-1', {
      email: 'b@example.com',
    });
    expect(result.id).toBe('s1');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/projects/proj-1/share/email',
      { email: 'b@example.com' }
    );
  });

  it('shareProjectByLink — POST /projects/:id/share/link', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({
        id: 's2',
        shareToken: 'tok123',
        shareUrl: 'http://app/share/tok123',
        tokenExpiry: null,
        createdAt: '2026',
      })
    );

    const result = await c().shareProjectByLink('proj-1', { expiryHours: 24 });
    expect(result.shareToken).toBe('tok123');
  });

  it('getProjectShares — GET /projects/:id/shares', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok([
        {
          id: 's1',
          email: 'a@test.com',
          sharedWith: null,
          status: 'accepted',
          shareToken: 't',
          shareUrl: 'u',
          tokenExpiry: null,
          createdAt: '2026',
        },
      ])
    );

    expect(await c().getProjectShares('proj-1')).toHaveLength(1);
  });

  it('revokeProjectShare — DELETE /projects/:id/shares/:shareId', async () => {
    mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });

    await expect(
      c().revokeProjectShare('proj-1', 's1')
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
      '/projects/proj-1/shares/s1'
    );
  });

  it('getSharedProjects — GET /shared/projects', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok([
        {
          id: 'sp1',
          title: 'Remote',
          description: null,
          createdAt: '',
          updatedAt: '',
          owner: { id: 'u2', email: 'o@t.com' },
          share: { id: 'x', status: 'accepted', sharedAt: '' },
          isShared: true,
        },
      ])
    );

    const result = await c().getSharedProjects();
    expect(result).toHaveLength(1);
    expect(result[0].isShared).toBe(true);
  });

  it('validateShareToken — GET /share/validate/:token', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({
        project: { id: 'p1', title: 'T', description: null },
        sharedBy: { email: 'o@t.com' },
        status: 'pending',
        email: 'u@t.com',
        needsLogin: false,
      })
    );

    const result = await c().validateShareToken('abc123');
    expect(result.needsLogin).toBe(false);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/share/validate/abc123'
    );
  });

  it('acceptShareInvitation — POST /share/accept/:token', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({
        project: { id: 'p1', title: 'T', description: null },
        needsLogin: false,
        accepted: true,
      })
    );

    const result = await c().acceptShareInvitation('tok123');
    expect(result.accepted).toBe(true);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/share/accept/tok123');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('images', () => {
  it('getImage — unwraps the { image: {...} } wrapper', async () => {
    mockAxiosInstance.get.mockResolvedValue(ok({ image: baseImageRaw }));

    const result = await c().getImage('proj-1', 'img-1');
    expect(result.id).toBe('img-1');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/projects/proj-1/images/img-1'
    );
  });

  it('deleteImage — DELETE /projects/:id/images/:imageId', async () => {
    mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });

    await expect(c().deleteImage('proj-1', 'img-1')).resolves.toBeUndefined();
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
      '/projects/proj-1/images/img-1'
    );
  });

  it('getProjectImages — pagination branch extracts correctly', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({
        images: [baseImageRaw],
        pagination: { total: 1, page: 1, totalPages: 1 },
      })
    );

    const result = await c().getProjectImages('proj-1', { page: 1, limit: 30 });
    expect(result.total).toBe(1);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].id).toBe('img-1');
  });

  it('getProjectImages — unexpected shape falls back to empty', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: 42 },
    });

    const result = await c().getProjectImages('proj-1');
    expect(result.images).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('getProjectImages — null data falls back to empty defaults', async () => {
    mockAxiosInstance.get.mockResolvedValue(ok(null));

    const result = await c().getProjectImages('proj-1');
    expect(result.images).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  it('getProjectImagesWithThumbnails — returns response.data.data directly', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        data: {
          images: [baseImageRaw],
          pagination: { page: 1, limit: 30, total: 1, pages: 1 },
          metadata: {
            levelOfDetail: 'low',
            totalImages: 1,
            imagesWithThumbnails: 1,
            projectChannels: [],
          },
        },
      },
    });

    const result = await c().getProjectImagesWithThumbnails('proj-1');
    expect(result.metadata.levelOfDetail).toBe('low');
    expect(result.images).toHaveLength(1);
  });

  it('getProjectImagesWithThumbnails — forwards the requested lod + pagination', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          images: [baseImageRaw],
          pagination: { page: 1, limit: 10, total: 1, pages: 1 },
          metadata: {
            levelOfDetail: 'low',
            totalImages: 1,
            imagesWithThumbnails: 1,
          },
        },
      },
    });

    await c().getProjectImagesWithThumbnails('proj1', {
      page: 1,
      limit: 10,
      lod: 'medium',
    });

    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/projects/proj1/images-with-thumbnails',
      { params: { lod: 'medium', page: 1, limit: 10 } }
    );
  });

  it('getProjectImagesWithThumbnails — defaults lod to "low"', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        data: { images: [], pagination: {}, metadata: {} },
      },
    });

    await c().getProjectImagesWithThumbnails('proj1');

    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/projects/proj1/images-with-thumbnails',
      { params: { lod: 'low' } }
    );
  });

  it('reorderProjectImages — PATCH /projects/:id/images/reorder', async () => {
    mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

    await expect(
      c().reorderProjectImages('proj-1', ['img-2', 'img-1'])
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
      '/projects/proj-1/images/reorder',
      { imageIds: ['img-2', 'img-1'] }
    );
  });

  it('updateImageChannels — PATCH /images/:id/channels', async () => {
    mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

    const channels = [
      {
        name: 'TIRF_640',
        type: 'fluorescent' as const,
        isSegmentationSource: true,
      },
    ];
    await expect(
      c().updateImageChannels('img-1', channels)
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
      '/images/img-1/channels',
      {
        channels,
      }
    );
  });

  it('uploadImages — reports progress via onUploadProgress', async () => {
    const progressCallback = vi.fn();
    mockAxiosInstance.post.mockImplementation((_url, _data, config) => {
      config?.onUploadProgress?.({ loaded: 25, total: 100 });
      config?.onUploadProgress?.({ loaded: 50, total: 100 });
      config?.onUploadProgress?.({ loaded: 100, total: 100 });
      return Promise.resolve(
        ok({ images: [{ id: '1', name: 'uploaded.jpg' }], count: 1 })
      );
    });

    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
    await c().uploadImages('project1', [file], progressCallback);

    expect(progressCallback).toHaveBeenCalledWith(25);
    expect(progressCallback).toHaveBeenCalledWith(50);
    expect(progressCallback).toHaveBeenCalledWith(100);
  });

  it('uploadImages — resolves without a progress callback', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ images: [{ id: '1', name: 'uploaded.jpg' }], count: 1 })
    );

    const file = new File(['test'], 'test.jpg');
    const result = await c().uploadImages('project1', [file]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('uploaded.jpg');
  });

  it('uploadImages — sends the original file when the name is already NFC', async () => {
    mockAxiosInstance.post.mockResolvedValue(ok({ images: [], count: 0 }));
    const file = new File(['data'], 'normal-name.jpg', { type: 'image/jpeg' });

    await c().uploadImages('proj-1', [file]);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/projects/proj-1/images',
      expect.any(FormData),
      expect.any(Object)
    );
  });

  it('uploadImages — normalises an NFD filename to NFC before upload', async () => {
    mockAxiosInstance.post.mockResolvedValue(ok({ images: [], count: 0 }));
    // 'é' decomposed (NFD) vs composed (NFC) — the differing name creates a new File.
    const file = new File(['data'], 'é.jpg', { type: 'image/jpeg' });

    await c().uploadImages('proj-1', [file]);
    expect(mockAxiosInstance.post).toHaveBeenCalled();
  });

  it('uploadVideo — forwards the AbortSignal into the axios config', async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { data: { videoContainerId: 'v', frameCount: 1, channels: [] } },
    });
    const controller = new AbortController();
    const file = new File([new Blob(['x'])], 'v.mp4', { type: 'video/mp4' });

    await c()
      .uploadVideo('p1', file, undefined, false, controller.signal)
      .catch(() => {});

    const cfg = mockAxiosInstance.post.mock.calls.at(-1)?.[2] as {
      signal?: AbortSignal;
    };
    expect(cfg?.signal).toBe(controller.signal);
  });

  it('uploadImages — forwards the AbortSignal into the axios config', async () => {
    mockAxiosInstance.post.mockResolvedValue(ok([]));
    const controller = new AbortController();
    const file = new File([new Blob(['x'])], 'i.jpg', { type: 'image/jpeg' });

    await c()
      .uploadImages('p1', [file], undefined, controller.signal)
      .catch(() => {});

    const cfg = mockAxiosInstance.post.mock.calls.at(-1)?.[2] as {
      signal?: AbortSignal;
    };
    expect(cfg?.signal).toBe(controller.signal);
  });

  it('uploadVideo — leaves config.signal undefined without a signal', async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { data: { videoContainerId: 'v', frameCount: 1, channels: [] } },
    });
    const file = new File([new Blob(['x'])], 'v.mp4', { type: 'video/mp4' });

    await c()
      .uploadVideo('p1', file)
      .catch(() => {});

    const cfg = mockAxiosInstance.post.mock.calls.at(-1)?.[2] as {
      signal?: AbortSignal;
    };
    expect(cfg?.signal).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('segmentation', () => {
  it('getSegmentationResults — maps a full object response', async () => {
    const mockPolygons = [
      {
        id: 'poly1',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
        type: 'external',
      },
    ];
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          polygons: mockPolygons,
          imageWidth: 800,
          imageHeight: 600,
          modelUsed: 'hrnet',
          thresholdUsed: 0.5,
          confidence: 0.95,
          processingTime: 3.2,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      },
    });

    const result = await c().getSegmentationResults('image1');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/segmentation/images/image1/results',
      { signal: undefined }
    );
    expect(result).toMatchObject({
      polygons: mockPolygons,
      imageWidth: 800,
      modelUsed: 'hrnet',
    });
  });

  it('getSegmentationResults — 404 returns null without throwing', async () => {
    mockAxiosInstance.get.mockRejectedValue(
      Object.assign(new Error('Not Found'), { response: { status: 404 } })
    );

    expect(await c().getSegmentationResults('img-1')).toBeNull();
  });

  it('getSegmentationResults — re-throws non-404 errors', async () => {
    mockAxiosInstance.get.mockRejectedValue(
      Object.assign(new Error('Server error'), { response: { status: 500 } })
    );

    await expect(c().getSegmentationResults('img-1')).rejects.toThrow(
      'Server error'
    );
  });

  it('getSegmentationResults — wraps a bare polygon array', async () => {
    const polygons = [{ id: 'p1', points: [{ x: 0, y: 0 }], type: 'external' }];
    mockAxiosInstance.get.mockResolvedValue(ok(polygons));

    const result = await c().getSegmentationResults('img-1');
    expect(result!.polygons).toEqual(polygons);
  });

  it('getSegmentationResults — null data returns null', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: null },
    });

    expect(await c().getSegmentationResults('img-1')).toBeNull();
  });

  it('updateSegmentationResults — sends dimensions and maps the object response', async () => {
    const inputPolygons = [
      { id: 'poly1', points: [{ x: 0, y: 0 }], type: 'external' as const },
    ];
    mockAxiosInstance.put.mockResolvedValue(
      ok({
        polygons: inputPolygons,
        imageWidth: 800,
        imageHeight: 600,
        modelUsed: 'manual',
        updatedAt: '2024-01-01T01:00:00Z',
      })
    );

    const result = await c().updateSegmentationResults(
      'image1',
      inputPolygons,
      800,
      600
    );
    expect(mockAxiosInstance.put).toHaveBeenCalledWith(
      '/segmentation/images/image1/results',
      { polygons: inputPolygons, imageWidth: 800, imageHeight: 600 }
    );
    expect(result.modelUsed).toBe('manual');
  });

  it('updateSegmentationResults — omits dimensions when not provided', async () => {
    const inputPolygons = [
      { id: 'poly1', points: [{ x: 0, y: 0 }], type: 'external' as const },
    ];
    mockAxiosInstance.put.mockResolvedValue(ok({ polygons: inputPolygons }));

    await c().updateSegmentationResults('image1', inputPolygons);
    expect(mockAxiosInstance.put).toHaveBeenCalledWith(
      '/segmentation/images/image1/results',
      { polygons: inputPolygons }
    );
  });

  it('updateSegmentationResults — omits non-positive dimensions', async () => {
    mockAxiosInstance.put.mockResolvedValue(ok({ polygons: [] }));

    await c().updateSegmentationResults('image1', [], 0, 600);
    expect(mockAxiosInstance.put).toHaveBeenCalledWith(
      '/segmentation/images/image1/results',
      { polygons: [] }
    );

    await c().updateSegmentationResults('image1', [], -100, 600);
    expect(mockAxiosInstance.put).toHaveBeenLastCalledWith(
      '/segmentation/images/image1/results',
      { polygons: [] }
    );
  });

  it('updateSegmentationResults — array data backward-compat branch', async () => {
    const polys = [{ id: 'p1', points: [{ x: 0, y: 0 }], type: 'external' }];
    mockAxiosInstance.put.mockResolvedValue(ok(polys));

    const result = await c().updateSegmentationResults('img-1', polys);
    expect(result.polygons).toEqual(polys);
  });

  it('updateSegmentationResults — unexpected data returns the sent polygons', async () => {
    mockAxiosInstance.put.mockResolvedValue({
      data: { success: true, data: null },
    });
    const polys = [{ id: 'p2', points: [], type: 'external' }];

    const result = await c().updateSegmentationResults('img-1', polys);
    expect(result.polygons).toEqual(polys);
  });

  it('deleteSegmentationResults — DELETE /segmentation/images/:id/results', async () => {
    mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });

    await expect(
      c().deleteSegmentationResults('img-1')
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
      '/segmentation/images/img-1/results'
    );
  });

  it('getImageWithSegmentation — converts [[x,y]] + {x,y} points', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({
        image: {
          id: '1',
          name: 'test.jpg',
          projectId: 'proj1',
          userId: 'user1',
          originalUrl: '/test.jpg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        segmentation: {
          id: 'seg1',
          imageId: '1',
          polygons: [
            {
              id: 'poly1',
              points: [
                [10, 20],
                [30, 40],
                [50, 60],
              ],
              type: 'external',
            },
            {
              id: 'poly2',
              points: [
                { x: 100, y: 200 },
                { x: 300, y: 400 },
                { x: 200, y: 500 },
              ],
              type: 'internal',
            },
          ],
          model: 'hrnet',
          threshold: 0.5,
          imageWidth: 800,
          imageHeight: 600,
        },
      })
    );

    const result = await c().getImageWithSegmentation('1');
    expect(result.segmentation!.polygons).toHaveLength(2);
    expect(result.segmentation!.polygons[0].points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ]);
    expect(result.segmentation!.polygons[1].points).toEqual([
      { x: 100, y: 200 },
      { x: 300, y: 400 },
      { x: 200, y: 500 },
    ]);
  });

  it('getImageWithSegmentation — filters out polygons with < 3 valid points', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({
        image: {
          id: '1',
          name: 'test.jpg',
          projectId: 'proj1',
          userId: 'user1',
          originalUrl: '/test.jpg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        segmentation: {
          polygons: [
            {
              id: 'valid',
              points: [
                [0, 0],
                [10, 0],
                [5, 10],
              ],
              type: 'external',
            },
            {
              id: 'invalid-points',
              points: [
                [0, 0],
                [10, 0],
              ],
              type: 'external',
            },
            { id: 'no-points', points: [], type: 'external' },
            null,
            { id: 'invalid-structure', type: 'external' },
          ],
        },
      })
    );

    const result = await c().getImageWithSegmentation('1');
    expect(result.segmentation!.polygons).toHaveLength(1);
    expect(result.segmentation!.polygons[0].id).toBe('valid');
  });

  it('getImageWithSegmentation — null segmentation returns image only', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({
        image: {
          id: '1',
          name: 'test.jpg',
          projectId: 'proj1',
          userId: 'user1',
          originalUrl: '/test.jpg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
        segmentation: null,
      })
    );

    const result = await c().getImageWithSegmentation('1');
    expect(result.segmentation).toBeUndefined();
  });

  it('getImageWithSegmentation — non-object segmentation returns image only', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({ ...baseImageRaw, segmentation: 'bad-value' })
    );

    const result = await c().getImageWithSegmentation('img-1');
    expect(result.segmentation).toBeUndefined();
  });

  it('getImageWithSegmentation — no segmentation field returns image only', async () => {
    mockAxiosInstance.get.mockResolvedValue(ok(baseImageRaw));

    const result = await c().getImageWithSegmentation('img-1');
    expect(result.id).toBe('img-1');
    expect(result.segmentation).toBeUndefined();
  });

  it('getBatchSegmentationResults — empty imageIds short-circuits to {}', async () => {
    const result = await c().getBatchSegmentationResults([]);
    expect(result).toEqual({});
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('getBatchSegmentationResults — maps imageId→result (null preserved)', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({
        'img-a': {
          polygons: [],
          imageWidth: 100,
          imageHeight: 100,
          createdAt: '2026',
          updatedAt: '2026',
        },
        'img-b': null,
      })
    );

    const result = await c().getBatchSegmentationResults(['img-a', 'img-b']);
    expect(result['img-a']).toMatchObject({ polygons: [] });
    expect(result['img-b']).toBeNull();
  });

  it('requestBatchSegmentation — includes channel when provided', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ successful: 1, failed: 0, results: [] })
    );

    await c().requestBatchSegmentation(
      ['img-1'],
      'hrnet',
      0.5,
      false,
      'TIRF_640'
    );
    const [, body] = mockAxiosInstance.post.mock.calls[0];
    expect(body.channel).toBe('TIRF_640');
  });

  it('requestBatchSegmentation — omits channel when undefined', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ successful: 1, failed: 0, results: [] })
    );

    await c().requestBatchSegmentation(['img-1']);
    const [, body] = mockAxiosInstance.post.mock.calls[0];
    expect('channel' in body).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('queue', () => {
  it('addImageToQueue — POST /queue/images/:id', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ queueItem: { id: 'q1' }, message: 'Queued' })
    );

    const result = await c().addImageToQueue('img-1', 'hrnet', 0.5, 1, false);
    expect(result.message).toBe('Queued');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/queue/images/img-1', {
      model: 'hrnet',
      threshold: 0.5,
      priority: 1,
      detectHoles: false,
    });
  });

  it('addBatchToQueue — sends the full batch body', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({
        queuedCount: 3,
        queueItems: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
        message: 'Batch queued',
      })
    );

    const result = await c().addBatchToQueue(
      ['img1', 'img2', 'img3'],
      'project1',
      'hrnet',
      0.5,
      1,
      false,
      true
    );

    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/queue/batch', {
      imageIds: ['img1', 'img2', 'img3'],
      projectId: 'project1',
      model: 'hrnet',
      threshold: 0.5,
      priority: 1,
      forceResegment: false,
      detectHoles: true,
    });
    expect(result.queuedCount).toBe(3);
  });

  it('addBatchToQueue — includes channel when provided', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ queuedCount: 1, queueItems: [], message: 'ok' })
    );

    await c().addBatchToQueue(
      ['img-1'],
      'proj-1',
      'hrnet',
      0.5,
      1,
      false,
      false,
      'TIRF_640'
    );
    const [, body] = mockAxiosInstance.post.mock.calls[0];
    expect(body.channel).toBe('TIRF_640');
  });

  it('addBatchToQueue — omits channel when undefined', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ queuedCount: 1, queueItems: [], message: 'ok' })
    );

    await c().addBatchToQueue(['img-1'], 'proj-1');
    const [, body] = mockAxiosInstance.post.mock.calls[0];
    expect('channel' in body).toBe(false);
  });

  it('getQueueStats — GET /queue/projects/:id/stats', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({ total: 5, queued: 3, processing: 1, completed: 1, failed: 0 })
    );

    const result = await c().getQueueStats('proj-1');
    expect(result.total).toBe(5);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/queue/projects/proj-1/stats'
    );
  });

  it('getQueueItems — GET /queue/projects/:id/items', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok([
        {
          id: 'q1',
          imageId: 'img-1',
          projectId: 'proj-1',
          model: 'hrnet',
          threshold: 0.5,
          priority: 1,
          status: 'queued',
          createdAt: '2026',
        },
      ])
    );

    const result = await c().getQueueItems('proj-1');
    expect(result).toHaveLength(1);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/queue/projects/proj-1/items'
    );
  });

  it('removeFromQueue — DELETE /queue/items/:id', async () => {
    mockAxiosInstance.delete.mockResolvedValue({});

    await c().removeFromQueue('queue1');
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
      '/queue/items/queue1'
    );
  });

  it('cancelAllUserSegmentations — POST /queue/cancel-all-user', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({
        success: true,
        cancelledCount: 3,
        affectedProjects: ['p1'],
        affectedBatches: ['b1'],
      })
    );

    const result = await c().cancelAllUserSegmentations();
    expect(result.cancelledCount).toBe(3);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/queue/cancel-all-user'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('deleteBatch (chunk aggregation)', () => {
  it('single chunk: calls DELETE /images/batch once', async () => {
    mockAxiosInstance.delete.mockResolvedValue(
      ok({ deletedCount: 2, failedIds: [], errors: [] })
    );

    const result = await c().deleteBatch(['img-1', 'img-2'], 'proj-1');
    expect(result.deletedCount).toBe(2);
    expect(mockAxiosInstance.delete).toHaveBeenCalledTimes(1);
  });

  it('reports server-side partial failures from the payload', async () => {
    mockAxiosInstance.delete.mockResolvedValue(
      ok({
        deletedCount: 2,
        failedIds: ['img3'],
        errors: ['Image img3 not found'],
      })
    );

    const result = await c().deleteBatch(['img1', 'img2', 'img3'], 'project1');
    expect(result.deletedCount).toBe(2);
    expect(result.failedIds).toEqual(['img3']);
    expect(result.errors).toEqual(['Image img3 not found']);
  });

  it('chunk request failure accumulates into failedIds + errors', async () => {
    mockAxiosInstance.delete.mockRejectedValue(new Error('timeout'));

    const result = await c().deleteBatch(['img-1', 'img-2'], 'proj-1');
    expect(result.failedIds).toEqual(
      expect.arrayContaining(['img-1', 'img-2'])
    );
    expect(result.errors[0]).toContain('timeout');
    expect(result.deletedCount).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('upload extras (avatar / feedback)', () => {
  it('uploadAvatar — omits cropData from FormData when not provided', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ avatarUrl: '/avatars/u1.png', message: 'ok' })
    );

    const file = new File(['data'], 'avatar.png', { type: 'image/png' });
    const result = await c().uploadAvatar(file);

    expect(result.avatarUrl).toBe('/avatars/u1.png');
    const [url, formData] = mockAxiosInstance.post.mock.calls[0];
    expect(url).toBe('/auth/avatar');
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get('cropData')).toBeFalsy();
  });

  it('uploadAvatar — appends valid cropData as JSON', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ avatarUrl: '/avatars/u2.png', message: 'ok' })
    );

    const file = new File(['data'], 'avatar.png', { type: 'image/png' });
    const crop = { x: 10, y: 20, width: 100, height: 100 };
    await c().uploadAvatar(file, crop);

    const [, formData] = mockAxiosInstance.post.mock.calls[0];
    expect(JSON.parse(formData.get('cropData'))).toEqual(crop);
  });

  it('uploadAvatar — throws on non-positive width before any request', async () => {
    const file = new File(['data'], 'avatar.png', { type: 'image/png' });
    await expect(
      c().uploadAvatar(file, { x: 0, y: 0, width: 0, height: 50 })
    ).rejects.toThrow('Invalid crop dimensions');
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('uploadAvatar — throws on negative x before any request', async () => {
    const file = new File(['data'], 'avatar.png', { type: 'image/png' });
    await expect(
      c().uploadAvatar(file, { x: -1, y: 0, width: 50, height: 50 })
    ).rejects.toThrow('Invalid crop position');
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('submitFeedback — no attachment: FormData omits the attachment field', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ id: 'fb-1', emailQueued: true })
    );

    await c().submitFeedback({ type: 'bug', title: 'Bug', body: 'Details' });

    const [, fd] = mockAxiosInstance.post.mock.calls[0];
    expect(fd.get('type')).toBe('bug');
    expect(fd.get('title')).toBe('Bug');
    expect(fd.get('attachment')).toBeFalsy();
  });

  it('submitFeedback — appends the attachment File when provided', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ id: 'fb-2', emailQueued: true, attachmentStored: true })
    );

    const attach = new File(['img'], 'screen.png', { type: 'image/png' });
    const result = await c().submitFeedback(
      { type: 'feature', title: 'Feat', body: 'Body' },
      attach
    );

    expect(result.attachmentStored).toBe(true);
    const [, fd] = mockAxiosInstance.post.mock.calls[0];
    expect(fd.get('attachment')).toBeTruthy();
  });

  it('submitFeedback — invokes the progress callback', async () => {
    mockAxiosInstance.post.mockImplementation((_url, _fd, config) => {
      config?.onUploadProgress?.({ loaded: 60, total: 100 });
      return Promise.resolve(ok({ id: 'fb-3', emailQueued: false }));
    });

    const onProgress = vi.fn();
    await c().submitFeedback(
      { type: 'bug', title: 'T', body: 'B' },
      undefined,
      onProgress
    );
    expect(onProgress).toHaveBeenCalledWith(60);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('export download', () => {
  it('getExportDownloadToken — POST returns token + expiresAt', async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { token: 'dl-token', expiresAt: 9_999_999 },
    });

    const result = await c().getExportDownloadToken('proj-1', 'job-1');
    expect(result.token).toBe('dl-token');
    expect(result.expiresAt).toBe(9_999_999);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/projects/proj-1/export/job-1/download-token'
    );
  });

  it('buildExportDownloadUrl — includes token, omits filename when absent', () => {
    const url = c().buildExportDownloadUrl('proj-1', 'job-1', 'my-tok');
    expect(url).toContain('token=my-tok');
    expect(url).toContain('/projects/proj-1/export/job-1/download');
    expect(url).not.toContain('filename=');
  });

  it('buildExportDownloadUrl — includes filename when provided', () => {
    const url = c().buildExportDownloadUrl(
      'proj-1',
      'job-1',
      'my-tok',
      'export.zip'
    );
    expect(url).toContain('filename=export.zip');
    expect(url).toContain('token=my-tok');
  });

  it('buildExportDownloadUrl — returns the raw path when URL construction fails', () => {
    const origURL = globalThis.URL;
    // @ts-expect-error -- intentional polyfill override for the test
    globalThis.URL = class {
      constructor() {
        throw new Error('no URL');
      }
    };

    const url = c().buildExportDownloadUrl('p', 'j', 'tok');
    expect(url).toContain('/projects/p/export/j/download');

    globalThis.URL = origURL;
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('user profile', () => {
  it('getUserProfile — GET /auth/profile with no-cache header', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({ id: 'u1', email: 'u@t.com', username: 'user1' })
    );

    const result = await c().getUserProfile();
    expect(result.email).toBe('u@t.com');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/auth/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Cache-Control': 'no-cache' }),
      })
    );
  });

  it('updateUserProfile — PUT /auth/profile', async () => {
    mockAxiosInstance.put.mockResolvedValue(
      ok({ id: 'u1', email: 'u@t.com', username: 'newname' })
    );

    const result = await c().updateUserProfile({ username: 'newname' });
    expect(result.username).toBe('newname');
    expect(mockAxiosInstance.put).toHaveBeenCalledWith('/auth/profile', {
      username: 'newname',
    });
  });

  it('changePassword — POST /auth/change-password', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ message: 'Password changed' })
    );

    const result = await c().changePassword({
      currentPassword: 'old',
      newPassword: 'new',
    });
    expect(result.message).toBe('Password changed');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/auth/change-password',
      {
        currentPassword: 'old',
        newPassword: 'new',
      }
    );
  });

  it('getUserStorageStats — GET /auth/storage-stats', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      ok({
        totalStorageBytes: 1000,
        totalStorageMB: 1,
        totalStorageGB: 0.001,
        totalImages: 5,
        averageImageSizeMB: 0.2,
      })
    );

    const result = await c().getUserStorageStats();
    expect(result.totalImages).toBe(5);
  });

  it('deleteAccount — propagates a DELETE error and still calls the endpoint', async () => {
    mockAxiosInstance.delete.mockRejectedValue(new Error('Network error'));

    await expect(c().deleteAccount()).rejects.toThrow('Network error');
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith('/auth/profile');
  });
});
