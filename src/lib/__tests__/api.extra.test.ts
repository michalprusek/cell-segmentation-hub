/**
 * api.ts — additional behavioral tests for branches not covered by the
 * three existing test files (api.test.ts, api.integration.test.ts, and the
 * basic API client test). Each test exercises a real code path and asserts
 * an observable outcome (return value shape, call arguments, or error thrown).
 *
 * Covered here:
 *  1.  uploadAvatar — no cropData: sends FormData without cropData field
 *  2.  uploadAvatar — with valid cropData: appends JSON cropData to FormData
 *  3.  uploadAvatar — invalid crop width (≤ 0) throws before network call
 *  4.  uploadAvatar — negative x position throws before network call
 *  5.  submitFeedback — no attachment: omits attachment from FormData
 *  6.  submitFeedback — with attachment: appends File to FormData
 *  7.  submitFeedback — progress callback invoked when total present
 *  8.  getProject — GET /projects/:id + mapProjectFields
 *  9.  updateProject — converts name→title, strips name
 * 10.  getFolders — returns array from extractData
 * 11.  createFolder — POST /folders with name + parentId
 * 12.  updateFolder — PATCH /folders/:id
 * 13.  deleteFolder — 200 response unwrapped via extractData
 * 14.  deleteFolder — 207 partial-failure branch: returns data.data
 * 15.  previewFolder — GET /folders/:id/preview
 * 16.  moveProjectsToFolder — folderId=null hits /folders/root/items
 * 17.  moveProjectsToFolder — folderId non-null hits /folders/:id/items
 * 18.  shareProjectByEmail — POST /projects/:id/share/email
 * 19.  shareProjectByLink — POST /projects/:id/share/link
 * 20.  getProjectShares — GET /projects/:id/shares
 * 21.  revokeProjectShare — DELETE /projects/:id/shares/:shareId
 * 22.  getSharedProjects — GET /shared/projects
 * 23.  validateShareToken — GET /share/validate/:token
 * 24.  acceptShareInvitation — POST /share/accept/:token
 * 25.  getProjectImages — pagination branch: pagination object extracted
 * 26.  getProjectImages — fallback: returns empty on unexpected shape
 * 27.  getProjectImagesWithThumbnails — returns response.data.data directly
 * 28.  reorderProjectImages — PATCH /projects/:id/images/reorder
 * 29.  getImage — handles { image: {...} } wrapper
 * 30.  deleteImage — DELETE /projects/:id/images/:imageId
 * 31.  getSegmentationResults — 404 returns null
 * 32.  getSegmentationResults — array response (backward compat) wrapped
 * 33.  getSegmentationResults — null/undefined data returns null
 * 34.  getBatchSegmentationResults — empty imageIds returns {}
 * 35.  getBatchSegmentationResults — normal batch: maps imageId→result
 * 36.  updateSegmentationResults — array-data backward compat branch
 * 37.  updateSegmentationResults — null-data fallback returns polygons
 * 38.  deleteSegmentationResults — DELETE /segmentation/images/:id/results
 * 39.  getUserProfile — GET /auth/profile
 * 40.  updateUserProfile — PUT /auth/profile
 * 41.  changePassword — POST /auth/change-password
 * 42.  getUserStorageStats — GET /auth/storage-stats
 * 43.  deleteAccount — clears tokens even when request throws
 * 44.  updateImageChannels — PATCH /images/:id/channels
 * 45.  addImageToQueue — POST /queue/images/:id
 * 46.  addBatchToQueue — POST /queue/batch (includes channel when provided)
 * 47.  deleteBatch — single chunk under FILE_LIMITS.CHUNK_SIZE_FILES
 * 48.  deleteBatch — chunk failure accumulates into failedIds/errors
 * 49.  getQueueStats — GET /queue/projects/:id/stats
 * 50.  getQueueItems — GET /queue/projects/:id/items
 * 51.  cancelAllUserSegmentations — POST /queue/cancel-all-user
 * 52.  getExportDownloadToken — POST /projects/:id/export/:jobId/download-token
 * 53.  buildExportDownloadUrl — constructs path with token + filename params
 * 54.  dtoToProjectImage — maps snake_case DTO to camelCase domain type
 * 55.  mapSegmentationStatus — 'no_polygons' → 'completed'
 * 56.  mapSegmentationStatus — unknown status → 'failed'
 * 57.  getProjects — fallback: array data (no pagination envelope)
 * 58.  getProjects — fallback: null data returns empty defaults
 * 59.  getImageWithSegmentation — no segmentation field returns image only
 * 60.  getImageWithSegmentation — segmentation mapped + invalid polygon filtered
 * 61.  requestBatchSegmentation — channel param included when provided
 * 62.  refreshAccessToken — deduplicates concurrent calls (second waits for first)
 * 63.  logout — swallows error (POST /auth/logout fails) but still clears tokens
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mock infrastructure ───────────────────────────────────────────────

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
  default: {
    create: vi.fn(() => mockAxiosInstance),
  },
}));

vi.mock('@/lib/api', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return { ...actual };
});

vi.mock('../config', () => ({
  default: { apiBaseUrl: 'http://localhost:3001/api' },
}));

vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/constants', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    FILE_LIMITS: { ...actual.FILE_LIMITS, CHUNK_SIZE_FILES: 100 },
    TIMEOUTS: { ...actual.TIMEOUTS },
  };
});

// ── helpers ───────────────────────────────────────────────────────────────────

function ok<T>(data: T) {
  return { data: { success: true, data } };
}

// Minimal shape for testing mapImageFields output
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

// ── test suite ────────────────────────────────────────────────────────────────

describe('api.ts — extra branch coverage', () => {
  let apiClient: import('@/lib/api').ApiClient;
  let dtoToProjectImage: typeof import('@/lib/api').dtoToProjectImage;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('@/lib/api');
    apiClient = mod.apiClient as any;
    dtoToProjectImage = mod.dtoToProjectImage;
    (apiClient as any).instance = mockAxiosInstance;
    (apiClient as any).accessToken = 'test-token';
    (apiClient as any).refreshToken = 'refresh-token';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── uploadAvatar ──────────────────────────────────────────────────────────

  it('uploadAvatar — no cropData omits cropData from FormData', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ avatarUrl: '/avatars/u1.png', message: 'ok' })
    );

    const file = new File(['data'], 'avatar.png', { type: 'image/png' });
    const result = await (apiClient as any).uploadAvatar(file);

    expect(result.avatarUrl).toBe('/avatars/u1.png');
    const [url, formData] = mockAxiosInstance.post.mock.calls[0];
    expect(url).toBe('/auth/avatar');
    expect(formData).toBeInstanceOf(FormData);
    // cropData should not have been appended (null/undefined per env)
    expect(formData.get('cropData')).toBeFalsy();
  });

  it('uploadAvatar — with valid cropData appends JSON string', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ avatarUrl: '/avatars/u2.png', message: 'ok' })
    );

    const file = new File(['data'], 'avatar.png', { type: 'image/png' });
    const crop = { x: 10, y: 20, width: 100, height: 100 };
    await (apiClient as any).uploadAvatar(file, crop);

    const [, formData] = mockAxiosInstance.post.mock.calls[0];
    expect(JSON.parse(formData.get('cropData'))).toEqual(crop);
  });

  it('uploadAvatar — width ≤ 0 throws without calling axios', async () => {
    const file = new File(['data'], 'avatar.png', { type: 'image/png' });
    await expect(
      (apiClient as any).uploadAvatar(file, {
        x: 0,
        y: 0,
        width: 0,
        height: 50,
      })
    ).rejects.toThrow('Invalid crop dimensions');
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('uploadAvatar — negative x throws without calling axios', async () => {
    const file = new File(['data'], 'avatar.png', { type: 'image/png' });
    await expect(
      (apiClient as any).uploadAvatar(file, {
        x: -1,
        y: 0,
        width: 50,
        height: 50,
      })
    ).rejects.toThrow('Invalid crop position');
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  // ── submitFeedback ────────────────────────────────────────────────────────

  it('submitFeedback — no attachment: FormData has no attachment field', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ id: 'fb-1', emailQueued: true })
    );

    await (apiClient as any).submitFeedback({
      type: 'bug',
      title: 'Bug',
      body: 'Details',
    });

    const [, fd] = mockAxiosInstance.post.mock.calls[0];
    expect(fd.get('type')).toBe('bug');
    expect(fd.get('title')).toBe('Bug');
    expect(fd.get('attachment')).toBeFalsy(); // not appended → null/undefined
  });

  it('submitFeedback — with attachment: appends File', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ id: 'fb-2', emailQueued: true, attachmentStored: true })
    );

    const attach = new File(['img'], 'screen.png', { type: 'image/png' });
    const result = await (apiClient as any).submitFeedback(
      { type: 'feature', title: 'Feat', body: 'Body' },
      attach
    );

    expect(result.attachmentStored).toBe(true);
    const [, fd] = mockAxiosInstance.post.mock.calls[0];
    expect(fd.get('attachment')).toBeTruthy();
  });

  it('submitFeedback — progress callback invoked with percentage', async () => {
    mockAxiosInstance.post.mockImplementation((_url, _fd, config) => {
      config?.onUploadProgress?.({ loaded: 60, total: 100 });
      return Promise.resolve(ok({ id: 'fb-3', emailQueued: false }));
    });

    const onProgress = vi.fn();
    await (apiClient as any).submitFeedback(
      { type: 'bug', title: 'T', body: 'B' },
      undefined,
      onProgress
    );

    expect(onProgress).toHaveBeenCalledWith(60);
  });

  // ── getProject / updateProject ────────────────────────────────────────────

  it('getProject — maps title→name from backend', async () => {
    mockAxiosInstance.get.mockResolvedValue(ok(baseProjectRaw));

    const proj = await (apiClient as any).getProject('proj-1');
    expect(proj.name).toBe('My Project');
    expect(proj.id).toBe('proj-1');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/projects/proj-1');
  });

  it('updateProject — converts name→title and removes name field', async () => {
    mockAxiosInstance.put.mockResolvedValue(
      ok({ ...baseProjectRaw, title: 'New Name' })
    );

    const result = await (apiClient as any).updateProject('proj-1', {
      name: 'New Name',
      description: 'desc',
    });

    const [url, body] = mockAxiosInstance.put.mock.calls[0];
    expect(url).toBe('/projects/proj-1');
    expect(body.title).toBe('New Name');
    expect(body.name).toBeUndefined();
    expect(result.name).toBe('New Name');
  });

  // ── Folder methods ────────────────────────────────────────────────────────

  it('getFolders — returns array from response', async () => {
    const folders = [{ id: 'f1', name: 'Science', parentId: null }];
    mockAxiosInstance.get.mockResolvedValue(ok(folders));

    const result = await (apiClient as any).getFolders();
    expect(result).toEqual(folders);
  });

  it('createFolder — POST /folders with name + parentId', async () => {
    const folder = { id: 'f2', name: 'Sub', parentId: 'f1' };
    mockAxiosInstance.post.mockResolvedValue(ok(folder));

    const result = await (apiClient as any).createFolder({
      name: 'Sub',
      parentId: 'f1',
    });
    expect(result).toEqual(folder);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/folders', {
      name: 'Sub',
      parentId: 'f1',
    });
  });

  it('updateFolder — PATCH /folders/:id', async () => {
    const updated = { id: 'f1', name: 'Renamed', parentId: null };
    mockAxiosInstance.patch.mockResolvedValue(ok(updated));

    const result = await (apiClient as any).updateFolder('f1', {
      name: 'Renamed',
    });
    expect(result).toEqual(updated);
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith('/folders/f1', {
      name: 'Renamed',
    });
  });

  it('deleteFolder — 200 response: extractData path', async () => {
    const payload = {
      folderDeleted: true,
      deletedProjectIds: [],
      unlinkedSharedProjectIds: [],
      failedProjectIds: [],
    };
    mockAxiosInstance.delete.mockResolvedValue({
      status: 200,
      data: { success: true, data: payload },
    });

    const result = await (apiClient as any).deleteFolder('f1');
    expect(result.folderDeleted).toBe(true);
  });

  it('deleteFolder — 207 partial failure: returns response.data.data', async () => {
    const partialPayload = {
      folderDeleted: false,
      deletedProjectIds: ['p1'],
      unlinkedSharedProjectIds: [],
      failedProjectIds: [{ id: 'p2', error: 'In use' }],
    };
    mockAxiosInstance.delete.mockResolvedValue({
      status: 207,
      data: { success: false, message: 'Partial', data: partialPayload },
    });

    const result = await (apiClient as any).deleteFolder('f1');
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

    const result = await (apiClient as any).previewFolder('f1');
    expect(result).toEqual(preview);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith('/folders/f1/preview');
  });

  it('moveProjectsToFolder — null folderId hits /folders/root/items', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ movedProjectIds: ['p1'], skippedProjectIds: [] })
    );

    await (apiClient as any).moveProjectsToFolder(null, ['p1']);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/folders/root/items', {
      projectIds: ['p1'],
    });
  });

  it('moveProjectsToFolder — string folderId hits /folders/:id/items', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ movedProjectIds: ['p1'], skippedProjectIds: [] })
    );

    await (apiClient as any).moveProjectsToFolder('f2', ['p1']);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/folders/f2/items', {
      projectIds: ['p1'],
    });
  });

  // ── Sharing methods ───────────────────────────────────────────────────────

  it('shareProjectByEmail — POST /projects/:id/share/email', async () => {
    const share = {
      id: 's1',
      email: 'b@example.com',
      status: 'pending',
      createdAt: '2026-01-01',
    };
    mockAxiosInstance.post.mockResolvedValue(ok(share));

    const result = await (apiClient as any).shareProjectByEmail('proj-1', {
      email: 'b@example.com',
    });
    expect(result.id).toBe('s1');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/projects/proj-1/share/email',
      { email: 'b@example.com' }
    );
  });

  it('shareProjectByLink — POST /projects/:id/share/link', async () => {
    const link = {
      id: 's2',
      shareToken: 'tok123',
      shareUrl: 'http://app/share/tok123',
      tokenExpiry: null,
      createdAt: '2026-01-01',
    };
    mockAxiosInstance.post.mockResolvedValue(ok(link));

    const result = await (apiClient as any).shareProjectByLink('proj-1', {
      expiryHours: 24,
    });
    expect(result.shareToken).toBe('tok123');
  });

  it('getProjectShares — GET /projects/:id/shares', async () => {
    const shares = [
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
    ];
    mockAxiosInstance.get.mockResolvedValue(ok(shares));

    const result = await (apiClient as any).getProjectShares('proj-1');
    expect(result).toHaveLength(1);
  });

  it('revokeProjectShare — DELETE /projects/:id/shares/:shareId', async () => {
    mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });

    await expect(
      (apiClient as any).revokeProjectShare('proj-1', 's1')
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
      '/projects/proj-1/shares/s1'
    );
  });

  it('getSharedProjects — GET /shared/projects', async () => {
    const shared = [
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
    ];
    mockAxiosInstance.get.mockResolvedValue(ok(shared));

    const result = await (apiClient as any).getSharedProjects();
    expect(result).toHaveLength(1);
    expect(result[0].isShared).toBe(true);
  });

  it('validateShareToken — GET /share/validate/:token', async () => {
    const info = {
      project: { id: 'p1', title: 'T', description: null },
      sharedBy: { email: 'o@t.com' },
      status: 'pending',
      email: 'u@t.com',
      needsLogin: false,
    };
    mockAxiosInstance.get.mockResolvedValue(ok(info));

    const result = await (apiClient as any).validateShareToken('abc123');
    expect(result.needsLogin).toBe(false);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/share/validate/abc123'
    );
  });

  it('acceptShareInvitation — POST /share/accept/:token', async () => {
    const acceptance = {
      project: { id: 'p1', title: 'T', description: null },
      needsLogin: false,
      accepted: true,
    };
    mockAxiosInstance.post.mockResolvedValue(ok(acceptance));

    const result = await (apiClient as any).acceptShareInvitation('tok123');
    expect(result.accepted).toBe(true);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/share/accept/tok123');
  });

  // ── Image methods ─────────────────────────────────────────────────────────

  it('getProjectImages — pagination branch extracts correctly', async () => {
    const response = {
      images: [baseImageRaw],
      pagination: { total: 1, page: 1, totalPages: 1 },
    };
    mockAxiosInstance.get.mockResolvedValue(ok(response));

    const result = await (apiClient as any).getProjectImages('proj-1', {
      page: 1,
      limit: 30,
    });
    expect(result.total).toBe(1);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].id).toBe('img-1');
  });

  it('getProjectImages — fallback returns empty on unexpected shape', async () => {
    // Unexpected shape: neither array nor { images, pagination }
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: 42 },
    });

    const result = await (apiClient as any).getProjectImages('proj-1');
    expect(result.images).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('getProjectImagesWithThumbnails — returns response.data.data directly', async () => {
    const payload = {
      images: [baseImageRaw],
      pagination: { page: 1, limit: 30, total: 1, pages: 1 },
      metadata: {
        levelOfDetail: 'low',
        totalImages: 1,
        imagesWithThumbnails: 1,
        projectChannels: [],
      },
    };
    mockAxiosInstance.get.mockResolvedValue({ data: { data: payload } });

    const result = await (apiClient as any).getProjectImagesWithThumbnails(
      'proj-1'
    );
    expect(result.metadata.levelOfDetail).toBe('low');
    expect(result.images).toHaveLength(1);
  });

  it('reorderProjectImages — PATCH /projects/:id/images/reorder', async () => {
    mockAxiosInstance.patch.mockResolvedValue({ data: { success: true } });

    await expect(
      (apiClient as any).reorderProjectImages('proj-1', ['img-2', 'img-1'])
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
      '/projects/proj-1/images/reorder',
      { imageIds: ['img-2', 'img-1'] }
    );
  });

  it('getImage — unwraps { image: {...} } wrapper from backend', async () => {
    mockAxiosInstance.get.mockResolvedValue(ok({ image: baseImageRaw }));

    const result = await (apiClient as any).getImage('proj-1', 'img-1');
    expect(result.id).toBe('img-1');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/projects/proj-1/images/img-1'
    );
  });

  it('deleteImage — DELETE /projects/:id/images/:imageId', async () => {
    mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });

    await expect(
      (apiClient as any).deleteImage('proj-1', 'img-1')
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
      '/projects/proj-1/images/img-1'
    );
  });

  // ── Segmentation results ──────────────────────────────────────────────────

  it('getSegmentationResults — 404 returns null without throwing', async () => {
    const err = Object.assign(new Error('Not Found'), {
      response: { status: 404 },
    });
    mockAxiosInstance.get.mockRejectedValue(err);

    const result = await (apiClient as any).getSegmentationResults('img-1');
    expect(result).toBeNull();
  });

  it('getSegmentationResults — array response wrapped in { polygons }', async () => {
    const polygons = [{ id: 'p1', points: [{ x: 0, y: 0 }], type: 'external' }];
    mockAxiosInstance.get.mockResolvedValue(ok(polygons));

    const result = await (apiClient as any).getSegmentationResults('img-1');
    expect(result!.polygons).toEqual(polygons);
  });

  it('getSegmentationResults — null/undefined data returns null', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: null },
    });

    const result = await (apiClient as any).getSegmentationResults('img-1');
    expect(result).toBeNull();
  });

  it('getBatchSegmentationResults — empty imageIds returns {}', async () => {
    const result = await (apiClient as any).getBatchSegmentationResults([]);
    expect(result).toEqual({});
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('getBatchSegmentationResults — maps imageId→result from batch response', async () => {
    const batchData = {
      'img-a': {
        polygons: [],
        imageWidth: 100,
        imageHeight: 100,
        createdAt: '2026',
        updatedAt: '2026',
      },
      'img-b': null,
    };
    mockAxiosInstance.post.mockResolvedValue(ok(batchData));

    const result = await (apiClient as any).getBatchSegmentationResults([
      'img-a',
      'img-b',
    ]);
    expect(result['img-a']).toMatchObject({ polygons: [] });
    expect(result['img-b']).toBeNull();
  });

  it('updateSegmentationResults — array-data backward compat branch', async () => {
    const polys = [{ id: 'p1', points: [{ x: 0, y: 0 }], type: 'external' }];
    mockAxiosInstance.put.mockResolvedValue(ok(polys));

    const result = await (apiClient as any).updateSegmentationResults(
      'img-1',
      polys
    );
    expect(result.polygons).toEqual(polys);
  });

  it('updateSegmentationResults — null/unexpected data returns sent polygons', async () => {
    mockAxiosInstance.put.mockResolvedValue({
      data: { success: true, data: null },
    });
    const polys = [{ id: 'p2', points: [], type: 'external' }];

    const result = await (apiClient as any).updateSegmentationResults(
      'img-1',
      polys
    );
    expect(result.polygons).toEqual(polys);
  });

  it('deleteSegmentationResults — DELETE /segmentation/images/:id/results', async () => {
    mockAxiosInstance.delete.mockResolvedValue({ data: { success: true } });

    await expect(
      (apiClient as any).deleteSegmentationResults('img-1')
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.delete).toHaveBeenCalledWith(
      '/segmentation/images/img-1/results'
    );
  });

  // ── getImageWithSegmentation ──────────────────────────────────────────────

  it('getImageWithSegmentation — no segmentation field returns image only', async () => {
    mockAxiosInstance.get.mockResolvedValue(ok(baseImageRaw));

    const result = await (apiClient as any).getImageWithSegmentation('img-1');
    expect(result.id).toBe('img-1');
    expect(result.segmentation).toBeUndefined();
  });

  it('getImageWithSegmentation — filters out polygon with < 3 valid points', async () => {
    const rawWithSeg = {
      ...baseImageRaw,
      segmentation: {
        id: 'seg-1',
        imageId: 'img-1',
        model: 'hrnet',
        threshold: 0.5,
        imageWidth: 800,
        imageHeight: 600,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        polygons: [
          { id: 'poly-bad', points: [{ x: 0, y: 0 }], type: 'external' }, // < 3 pts
          {
            id: 'poly-ok',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
            type: 'external',
          },
        ],
      },
    };
    mockAxiosInstance.get.mockResolvedValue(ok(rawWithSeg));

    const result = await (apiClient as any).getImageWithSegmentation('img-1');
    expect(result.segmentation!.polygons).toHaveLength(1);
    expect(result.segmentation!.polygons[0].id).toBe('poly-ok');
  });

  // ── User / profile methods ────────────────────────────────────────────────

  it('getUserProfile — GET /auth/profile', async () => {
    const profile = { id: 'u1', email: 'u@t.com', username: 'user1' };
    mockAxiosInstance.get.mockResolvedValue(ok(profile));

    const result = await (apiClient as any).getUserProfile();
    expect(result.email).toBe('u@t.com');
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/auth/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Cache-Control': 'no-cache' }),
      })
    );
  });

  it('updateUserProfile — PUT /auth/profile', async () => {
    const updated = { id: 'u1', email: 'u@t.com', username: 'newname' };
    mockAxiosInstance.put.mockResolvedValue(ok(updated));

    const result = await (apiClient as any).updateUserProfile({
      username: 'newname',
    });
    expect(result.username).toBe('newname');
    expect(mockAxiosInstance.put).toHaveBeenCalledWith('/auth/profile', {
      username: 'newname',
    });
  });

  it('changePassword — POST /auth/change-password', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ message: 'Password changed' })
    );

    const result = await (apiClient as any).changePassword({
      currentPassword: 'old',
      newPassword: 'new',
    });
    expect(result.message).toBe('Password changed');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/auth/change-password',
      { currentPassword: 'old', newPassword: 'new' }
    );
  });

  it('getUserStorageStats — GET /auth/storage-stats', async () => {
    const stats = {
      totalStorageBytes: 1000,
      totalStorageMB: 1,
      totalStorageGB: 0.001,
      totalImages: 5,
      averageImageSizeMB: 0.2,
    };
    mockAxiosInstance.get.mockResolvedValue(ok(stats));

    const result = await (apiClient as any).getUserStorageStats();
    expect(result.totalImages).toBe(5);
  });

  it('deleteAccount — clears tokens even when DELETE throws', async () => {
    mockAxiosInstance.delete.mockRejectedValue(new Error('Network error'));

    (apiClient as any).accessToken = 'tk';
    (apiClient as any).refreshToken = 'rtk';

    await expect((apiClient as any).deleteAccount()).rejects.toThrow(
      'Network error'
    );
    expect(apiClient.isAuthenticated()).toBe(false);
  });

  // ── updateImageChannels ───────────────────────────────────────────────────

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
      (apiClient as any).updateImageChannels('img-1', channels)
    ).resolves.toBeUndefined();
    expect(mockAxiosInstance.patch).toHaveBeenCalledWith(
      '/images/img-1/channels',
      { channels }
    );
  });

  // ── Queue methods ─────────────────────────────────────────────────────────

  it('addImageToQueue — POST /queue/images/:id', async () => {
    const response = { queueItem: { id: 'q1' }, message: 'Queued' };
    mockAxiosInstance.post.mockResolvedValue(ok(response));

    const result = await (apiClient as any).addImageToQueue(
      'img-1',
      'hrnet',
      0.5,
      1,
      false
    );
    expect(result.message).toBe('Queued');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/queue/images/img-1', {
      model: 'hrnet',
      threshold: 0.5,
      priority: 1,
      detectHoles: false,
    });
  });

  it('addBatchToQueue — includes channel when provided', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ queuedCount: 1, queueItems: [], message: 'ok' })
    );

    await (apiClient as any).addBatchToQueue(
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

  it('addBatchToQueue — omits channel key when channel=undefined', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ queuedCount: 1, queueItems: [], message: 'ok' })
    );

    await (apiClient as any).addBatchToQueue(['img-1'], 'proj-1');

    const [, body] = mockAxiosInstance.post.mock.calls[0];
    expect('channel' in body).toBe(false);
  });

  it('deleteBatch — single chunk: calls DELETE /images/batch once', async () => {
    const deleteResult = { deletedCount: 2, failedIds: [], errors: [] };
    mockAxiosInstance.delete.mockResolvedValue(ok(deleteResult));

    const result = await (apiClient as any).deleteBatch(
      ['img-1', 'img-2'],
      'proj-1'
    );
    expect(result.deletedCount).toBe(2);
    expect(mockAxiosInstance.delete).toHaveBeenCalledTimes(1);
  });

  it('deleteBatch — chunk failure: accumulates failedIds + errors', async () => {
    mockAxiosInstance.delete.mockRejectedValue(new Error('timeout'));

    const result = await (apiClient as any).deleteBatch(
      ['img-1', 'img-2'],
      'proj-1'
    );
    expect(result.failedIds).toEqual(
      expect.arrayContaining(['img-1', 'img-2'])
    );
    expect(result.errors[0]).toContain('timeout');
    expect(result.deletedCount).toBe(0);
  });

  it('getQueueStats — GET /queue/projects/:id/stats', async () => {
    const stats = {
      total: 5,
      queued: 3,
      processing: 1,
      completed: 1,
      failed: 0,
    };
    mockAxiosInstance.get.mockResolvedValue(ok(stats));

    const result = await (apiClient as any).getQueueStats('proj-1');
    expect(result.total).toBe(5);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/queue/projects/proj-1/stats'
    );
  });

  it('getQueueItems — GET /queue/projects/:id/items', async () => {
    const items = [
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
    ];
    mockAxiosInstance.get.mockResolvedValue(ok(items));

    const result = await (apiClient as any).getQueueItems('proj-1');
    expect(result).toHaveLength(1);
    expect(mockAxiosInstance.get).toHaveBeenCalledWith(
      '/queue/projects/proj-1/items'
    );
  });

  it('cancelAllUserSegmentations — POST /queue/cancel-all-user', async () => {
    const resp = {
      success: true,
      cancelledCount: 3,
      affectedProjects: ['p1'],
      affectedBatches: ['b1'],
    };
    mockAxiosInstance.post.mockResolvedValue(ok(resp));

    const result = await (apiClient as any).cancelAllUserSegmentations();
    expect(result.cancelledCount).toBe(3);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/queue/cancel-all-user'
    );
  });

  // ── Export download ───────────────────────────────────────────────────────

  it('getExportDownloadToken — POST and return token + expiresAt', async () => {
    const tokenResp = { token: 'dl-token', expiresAt: 9_999_999 };
    mockAxiosInstance.post.mockResolvedValue({ data: tokenResp });

    const result = await (apiClient as any).getExportDownloadToken(
      'proj-1',
      'job-1'
    );
    expect(result.token).toBe('dl-token');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/projects/proj-1/export/job-1/download-token'
    );
  });

  it('buildExportDownloadUrl — constructs path with token and optional filename', () => {
    const url = (apiClient as any).buildExportDownloadUrl(
      'proj-1',
      'job-1',
      'my-token',
      'export.zip'
    );
    expect(url).toContain('token=my-token');
    expect(url).toContain('filename=export.zip');
    expect(url).toContain('/projects/proj-1/export/job-1/download');
  });

  // ── dtoToProjectImage ─────────────────────────────────────────────────────

  it('dtoToProjectImage — maps snake_case DTO fields to camelCase domain type', () => {
    const dto = {
      id: 'img-1',
      name: 'test.png',
      project_id: 'proj-1',
      user_id: 'user-1',
      url: 'http://host/display',
      image_url: 'http://host/original.png',
      thumbnail_url: 'http://host/thumb.jpg',
      displayUrl: 'http://host/display',
      width: 800,
      height: 600,
      segmentation_status: 'completed' as const,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      segmentationThumbnailPath: '/path/seg.png',
      segmentationThumbnailUrl: 'http://host/seg.png',
    };

    const domain = dtoToProjectImage(dto);
    expect(domain.id).toBe('img-1');
    expect(domain.segmentationStatus).toBe('completed');
    expect(domain.createdAt).toBeInstanceOf(Date);
    expect(domain.updatedAt).toBeInstanceOf(Date);
    expect(domain.project_id).toBe('proj-1');
    expect(domain.segmentationThumbnailUrl).toBe('http://host/seg.png');
  });

  // ── mapSegmentationStatus via getProjectImages ────────────────────────────

  it('mapSegmentationStatus: no_polygons → completed', async () => {
    const imgRaw = {
      ...baseImageRaw,
      segmentationStatus: 'no_polygons',
      id: 'img-np',
    };
    mockAxiosInstance.get.mockResolvedValue(
      ok({ images: [imgRaw], pagination: { total: 1, page: 1, totalPages: 1 } })
    );

    const result = await (apiClient as any).getProjectImages('proj-1');
    expect(result.images[0].segmentation_status).toBe('completed');
  });

  it('mapSegmentationStatus: unknown string → failed', async () => {
    const imgRaw = {
      ...baseImageRaw,
      segmentationStatus: 'weird_unknown',
      id: 'img-unk',
    };
    mockAxiosInstance.get.mockResolvedValue(
      ok({ images: [imgRaw], pagination: { total: 1, page: 1, totalPages: 1 } })
    );

    const result = await (apiClient as any).getProjectImages('proj-1');
    expect(result.images[0].segmentation_status).toBe('failed');
  });

  // ── getProjects fallback paths ────────────────────────────────────────────

  it('getProjects — array data fallback (no pagination envelope)', async () => {
    // Backend returns data as a flat array
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: [baseProjectRaw] },
    });

    const result = await (apiClient as any).getProjects();
    expect(result.projects).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('getProjects — null data fallback returns empty defaults', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: null },
    });

    const result = await (apiClient as any).getProjects();
    expect(result.projects).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });

  // ── requestBatchSegmentation — channel param ──────────────────────────────

  it('requestBatchSegmentation — includes channel when provided', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ successful: 1, failed: 0, results: [] })
    );

    await (apiClient as any).requestBatchSegmentation(
      ['img-1'],
      'hrnet',
      0.5,
      false,
      'TIRF_640'
    );

    const [, body] = mockAxiosInstance.post.mock.calls[0];
    expect(body.channel).toBe('TIRF_640');
  });

  it('requestBatchSegmentation — omits channel key when channel=undefined', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      ok({ successful: 1, failed: 0, results: [] })
    );

    await (apiClient as any).requestBatchSegmentation(['img-1']);

    const [, body] = mockAxiosInstance.post.mock.calls[0];
    expect('channel' in body).toBe(false);
  });

  // ── Token refresh deduplication ───────────────────────────────────────────

  it('refreshAccessToken — concurrent calls share one in-flight promise', async () => {
    let resolveRefresh!: (v: unknown) => void;
    mockAxiosInstance.post.mockReturnValue(
      new Promise(res => {
        resolveRefresh = res;
      })
    );

    // Start two concurrent refreshes
    const p1 = (apiClient as any).refreshAccessToken();
    const p2 = (apiClient as any).refreshAccessToken();

    resolveRefresh({
      data: {
        success: true,
        data: { accessToken: 'new-tok', refreshToken: 'new-ref' },
      },
    });
    await Promise.all([p1, p2]);

    // Despite two callers, only one POST was made
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    expect((apiClient as any).accessToken).toBe('new-tok');
  });

  // ── logout error swallowing ───────────────────────────────────────────────

  it('logout — clears tokens even when POST /auth/logout throws', async () => {
    mockAxiosInstance.post.mockRejectedValue(new Error('Server down'));

    (apiClient as any).accessToken = 'tk';
    (apiClient as any).refreshToken = 'rtk';

    await (apiClient as any).logout();

    expect(apiClient.isAuthenticated()).toBe(false);
    expect(apiClient.getAccessToken()).toBeNull();
  });
});
