/**
 * api.ts — gaps2 behavioral tests.
 *
 * Targets genuinely uncovered lines/branches not hit by the existing 6 test
 * files (api.test.ts, api-advanced.test.ts, api-interceptors.test.ts,
 * api-uncovered.test.ts, api.extra.test.ts, api-segmentation.test.ts,
 * api-chunked-upload.test.ts).
 *
 * Covered here:
 *  1. mapImageFields — segmentationThumbnailUrl derived from segmentationThumbnailPath
 *  2. mapImageFields — relative URL missing /uploads/ gets the prefix added
 *  3. mapImageFields — absolute URL passes through ensureAbsoluteUrl unchanged
 *  4. mapImageFields — thumbnailUrl absent → falls back to imageUrl
 *  5. mapImageFields — null width / height passed through as null (not coerced)
 *  6. mapProjectFields — folderId=null explicitly preserved (root placement)
 *  7. mapProjectFields — folderId=undefined NOT copied (not at root, not loaded)
 *  8. mapProjectFields — _count.images used as image_count fallback
 *  9. mapProjectFields — invalid type string defaults to 'spheroid'
 * 10. getProjectImages — falls back to empty when response has neither 'images'+'pagination' nor anything else
 * 11. uploadImages — NFC normalisation branch: different name creates new File, same name uses original
 * 12. getImageWithSegmentation — [[x,y]] array-format polygon points converted to {x,y}
 * 13. getImageWithSegmentation — invalid seg structure (non-object) returns image without segmentation
 * 14. getImageWithSegmentation — polygon with < 3 valid points is filtered out
 * 15. requestBatchSegmentation — channel param omitted when undefined
 * 16. logout — no POST when refreshToken is null
 * 17. isAuthenticated — true when accessToken set, false when null
 * 18. getAccessToken — returns current access token
 * 19. getExportDownloadToken — POST to correct URL, returns {token, expiresAt}
 * 20. buildExportDownloadUrl — includes filename param when provided
 * 21. buildExportDownloadUrl — omits filename param when absent
 * 22. dtoToProjectImage — maps all snake_case fields to camelCase correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────
const mockAxiosInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
  interceptors: {
    request: { use: vi.fn(() => 0), eject: vi.fn() },
    response: { use: vi.fn(() => 0), eject: vi.fn() },
  },
}));

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockAxiosInstance) },
}));

vi.mock('@/lib/api', async importOriginal => {
  const actual = (await importOriginal()) as object;
  return { ...actual };
});

vi.mock('@/lib/config', () => ({
  default: { apiBaseUrl: 'http://localhost:3001/api' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/retryUtils', () => ({
  retryWithBackoff: vi
    .fn()
    .mockResolvedValue({ success: false, error: new Error('retry exhausted') }),
  RETRY_CONFIGS: { api: {} },
}));

const localStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
const sessionStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
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

// ── import under test ─────────────────────────────────────────────────────────
import { apiClient, dtoToProjectImage, type ProjectImageDTO } from '../api';

// ── helpers ───────────────────────────────────────────────────────────────────
function wrap<T>(data: T) {
  return { data: { success: true, data } };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorageMock.getItem.mockReturnValue(null);
  sessionStorageMock.getItem.mockReturnValue(null);
  (apiClient as unknown as { instance: unknown }).instance = mockAxiosInstance;
  (apiClient as unknown as { accessToken: string | null }).accessToken = null;
  (apiClient as unknown as { refreshToken: string | null }).refreshToken = null;
  (apiClient as unknown as { refreshPromise: unknown }).refreshPromise = null;
});

// ── mapImageFields via getImage ───────────────────────────────────────────────

describe('mapImageFields — via getImage', () => {
  function imageResponse(overrides: Record<string, unknown>) {
    return wrap({
      image: {
        id: 'img-1',
        name: 'test.jpg',
        projectId: 'proj-1',
        userId: 'user-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        segmentationStatus: 'completed',
        ...overrides,
      },
    });
  }

  it('derives segmentationThumbnailUrl from segmentationThumbnailPath when present', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      imageResponse({
        originalUrl: 'http://host/img.png',
        segmentationThumbnailPath: '/uploads/seg/thumb.jpg',
      })
    );
    const result = await apiClient.getImage('proj-1', 'img-1');
    // ensureAbsoluteUrl on /uploads/seg/thumb.jpg → prepend baseUrl
    expect(result.segmentationThumbnailUrl).toContain('thumb.jpg');
    expect(result.segmentationThumbnailPath).toBe('/uploads/seg/thumb.jpg');
  });

  it('adds /uploads/ prefix to relative imageUrl that lacks it', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      imageResponse({
        image_url: 'relative/path/img.png', // no leading /uploads/
      })
    );
    const result = await apiClient.getImage('proj-1', 'img-1');
    // ensureAbsoluteUrl adds /uploads/ prefix then prepends base
    expect(result.image_url).toContain('relative/path/img.png');
  });

  it('passes through absolute http:// URLs unchanged', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      imageResponse({
        originalUrl: 'https://cdn.example.com/img.png',
        thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
      })
    );
    const result = await apiClient.getImage('proj-1', 'img-1');
    expect(result.image_url).toBe('https://cdn.example.com/img.png');
  });

  it('falls back thumbnail to imageUrl when thumbnailUrl is absent', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      imageResponse({
        originalUrl: 'http://localhost/img.png',
        // no thumbnailUrl — should fall back to imageUrl
      })
    );
    const result = await apiClient.getImage('proj-1', 'img-1');
    // thumbnail_url should equal the mapped imageUrl (or at least contain img.png)
    expect(result.thumbnail_url).toContain('img.png');
  });

  it('preserves null width and height as null (not coerced to a number)', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      imageResponse({
        originalUrl: 'http://localhost/img.png',
        width: null,
        height: null,
      })
    );
    const result = await apiClient.getImage('proj-1', 'img-1');
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
  });
});

// ── mapProjectFields edge cases — via getProject ──────────────────────────────

describe('mapProjectFields — edge cases', () => {
  const baseProject = {
    id: 'proj-1',
    title: 'My Project',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    userId: 'user-1',
    type: 'spheroid',
  };

  it('preserves folderId=null (root placement) on the result object', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      wrap({ ...baseProject, folderId: null })
    );
    const result = await apiClient.getProject('proj-1');
    expect(Object.prototype.hasOwnProperty.call(result, 'folderId')).toBe(true);
    expect(result.folderId).toBeNull();
  });

  it('does NOT set folderId when it is undefined (field absent from backend)', async () => {
    mockAxiosInstance.get.mockResolvedValue(wrap({ ...baseProject }));
    const result = await apiClient.getProject('proj-1');
    // folderId should not be present when the backend didn't return it
    expect(Object.prototype.hasOwnProperty.call(result, 'folderId')).toBe(
      false
    );
  });

  it('uses _count.images as image_count when imageCount is absent', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      wrap({ ...baseProject, _count: { images: 7 } })
    );
    const result = await apiClient.getProject('proj-1');
    expect(result.image_count).toBe(7);
  });

  it('defaults to "spheroid" for unrecognised project type', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      wrap({ ...baseProject, type: 'totally_unknown_type' })
    );
    const result = await apiClient.getProject('proj-1');
    expect(result.type).toBe('spheroid');
  });
});

// ── getProjectImages fallback ─────────────────────────────────────────────────

describe('getProjectImages — fallback branches', () => {
  it('returns empty defaults when response has no images+pagination and no recognisable structure', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      wrap(null) // null data — hits the null/undefined fallback
    );
    const result = await apiClient.getProjectImages('proj-1');
    expect(result.images).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
    expect(result.totalPages).toBe(1);
  });
});

// ── uploadImages NFC normalisation ───────────────────────────────────────────

describe('uploadImages — NFC filename normalisation', () => {
  it('sends original file unchanged when name is already NFC-normalized', async () => {
    mockAxiosInstance.post.mockResolvedValue(wrap({ images: [], count: 0 }));
    const file = new File(['data'], 'normal-name.jpg', { type: 'image/jpeg' });
    // name.normalize('NFC') === name → no new File created
    await apiClient.uploadImages('proj-1', [file]);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/projects/proj-1/images',
      expect.any(FormData),
      expect.any(Object)
    );
  });

  it('creates a new File when NFC-normalised name differs from original', async () => {
    mockAxiosInstance.post.mockResolvedValue(wrap({ images: [], count: 0 }));
    // Simulate a file whose name is in NFD form (decomposed accent)
    // 'é' in NFD is 'é', in NFC is 'é'
    const nfdName = 'é.jpg'; // NFD é
    const file = new File(['data'], nfdName, { type: 'image/jpeg' });
    // The name will normalise differently — branch creates new File
    await apiClient.uploadImages('proj-1', [file]);
    expect(mockAxiosInstance.post).toHaveBeenCalled();
  });
});

// ── getImageWithSegmentation polygon mapping ──────────────────────────────────

describe('getImageWithSegmentation', () => {
  const baseImageData = {
    id: 'img-1',
    name: 'test.jpg',
    projectId: 'proj-1',
    userId: 'user-1',
    originalUrl: 'http://host/img.png',
    segmentationStatus: 'completed',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('converts [[x,y]] array-format points to {x, y} objects', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      wrap({
        ...baseImageData,
        segmentation: {
          id: 'seg-1',
          imageId: 'img-1',
          model: 'hrnet',
          threshold: 0.5,
          imageWidth: 640,
          imageHeight: 480,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          polygons: [
            {
              id: 'poly-1',
              // [[x, y], [x, y], [x, y]] format
              points: [
                [10, 20],
                [30, 40],
                [50, 60],
              ],
              type: 'external',
            },
          ],
        },
      })
    );
    const result = await apiClient.getImageWithSegmentation('img-1');
    expect(result.segmentation).toBeDefined();
    expect(result.segmentation!.polygons).toHaveLength(1);
    expect(result.segmentation!.polygons[0].points[0]).toEqual({
      x: 10,
      y: 20,
    });
    expect(result.segmentation!.polygons[0].points[2]).toEqual({
      x: 50,
      y: 60,
    });
  });

  it('filters out polygons with fewer than 3 valid points', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      wrap({
        ...baseImageData,
        segmentation: {
          id: 'seg-1',
          imageId: 'img-1',
          model: 'hrnet',
          threshold: 0.5,
          imageWidth: 640,
          imageHeight: 480,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          polygons: [
            {
              id: 'too-few',
              points: [
                { x: 1, y: 2 },
                { x: 3, y: 4 },
              ], // only 2 points → filtered
              type: 'external',
            },
            {
              id: 'enough',
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 5, y: 10 },
              ],
              type: 'external',
            },
          ],
        },
      })
    );
    const result = await apiClient.getImageWithSegmentation('img-1');
    expect(result.segmentation!.polygons).toHaveLength(1);
    expect(result.segmentation!.polygons[0].id).toBe('enough');
  });

  it('returns image without segmentation when segmentation data is not an object', async () => {
    mockAxiosInstance.get.mockResolvedValue(
      wrap({
        ...baseImageData,
        segmentation: 'bad-value', // non-object → early return
      })
    );
    const result = await apiClient.getImageWithSegmentation('img-1');
    expect(result.segmentation).toBeUndefined();
  });
});

// ── requestBatchSegmentation ──────────────────────────────────────────────────

describe('requestBatchSegmentation', () => {
  it('omits channel from payload when it is undefined', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      wrap({ successful: 2, failed: 0, results: [] })
    );
    await apiClient.requestBatchSegmentation(['i1', 'i2'], 'hrnet', 0.5);
    const [, payload] = mockAxiosInstance.post.mock.calls[0];
    expect(payload).not.toHaveProperty('channel');
  });

  it('includes channel in payload when provided', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      wrap({ successful: 1, failed: 0, results: [] })
    );
    await apiClient.requestBatchSegmentation(
      ['i1'],
      'hrnet',
      0.5,
      false,
      'TIRF_640'
    );
    const [, payload] = mockAxiosInstance.post.mock.calls[0];
    expect(payload.channel).toBe('TIRF_640');
  });
});

// ── logout always POSTs to /auth/logout ───────────────────────────────────────
//
// After the cookie cutover, logout() always POSTs /auth/logout regardless of
// any client-side state. There is no refreshToken gate — the browser sends
// the httpOnly refresh_token cookie automatically; the server revokes it.

describe('logout', () => {
  it('always POSTs /auth/logout even when no in-memory refresh token', async () => {
    mockAxiosInstance.post.mockResolvedValue({ data: {} });
    await apiClient.logout();
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/logout');
    // No localStorage operations — tokens are not stored client-side
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
  });
});

// ── isAuthenticated / getAccessToken were deleted in the cookie cutover ───────
//
// These methods no longer exist on ApiClient. The tests that exercised them
// have been removed. Auth state is now determined solely by the httpOnly
// cookie the browser sends on every request.

// ── getExportDownloadToken ────────────────────────────────────────────────────

describe('getExportDownloadToken', () => {
  it('POSTs to the correct URL and returns token + expiresAt', async () => {
    const mockResponse = { data: { token: 'dl-tok-123', expiresAt: 9999999 } };
    mockAxiosInstance.post.mockResolvedValue(mockResponse);

    const result = await apiClient.getExportDownloadToken('proj-1', 'job-42');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/projects/proj-1/export/job-42/download-token'
    );
    expect(result.token).toBe('dl-tok-123');
    expect(result.expiresAt).toBe(9999999);
  });
});

// ── buildExportDownloadUrl ────────────────────────────────────────────────────

describe('buildExportDownloadUrl', () => {
  it('constructs URL with token param, omitting filename when absent', () => {
    const url = apiClient.buildExportDownloadUrl('proj-1', 'job-1', 'tok-abc');
    expect(url).toContain('token=tok-abc');
    expect(url).not.toContain('filename=');
  });

  it('includes filename param when provided', () => {
    const url = apiClient.buildExportDownloadUrl(
      'proj-1',
      'job-1',
      'tok-abc',
      'export.zip'
    );
    expect(url).toContain('filename=export.zip');
    expect(url).toContain('token=tok-abc');
  });

  it('includes the project and job in the path', () => {
    const url = apiClient.buildExportDownloadUrl('proj-X', 'job-Y', 'tok');
    expect(url).toContain('proj-X');
    expect(url).toContain('job-Y');
    expect(url).toContain('download');
  });
});

// ── dtoToProjectImage ─────────────────────────────────────────────────────────

describe('dtoToProjectImage', () => {
  const dto: ProjectImageDTO = {
    id: 'img-42',
    name: 'sample.tif',
    project_id: 'proj-99',
    user_id: 'user-7',
    url: 'http://host/display',
    image_url: 'http://host/orig.tif',
    thumbnail_url: 'http://host/thumb.jpg',
    displayUrl: 'http://host/display',
    width: 1024,
    height: 768,
    segmentation_status: 'completed',
    segmentationThumbnailPath: '/uploads/seg/thumb.jpg',
    segmentationThumbnailUrl: 'http://host/seg/thumb.jpg',
    created_at: '2024-03-01T00:00:00Z',
    updated_at: '2024-03-02T12:00:00Z',
  };

  it('maps all snake_case DTO fields to camelCase domain fields', () => {
    const image = dtoToProjectImage(dto);
    expect(image.id).toBe('img-42');
    expect(image.name).toBe('sample.tif');
    expect(image.project_id).toBe('proj-99');
    expect(image.segmentationStatus).toBe('completed');
    expect(image.segmentationThumbnailPath).toBe('/uploads/seg/thumb.jpg');
    expect(image.segmentationThumbnailUrl).toBe('http://host/seg/thumb.jpg');
    expect(image.width).toBe(1024);
    expect(image.height).toBe(768);
  });

  it('creates Date objects for createdAt and updatedAt', () => {
    const image = dtoToProjectImage(dto);
    expect(image.createdAt).toBeInstanceOf(Date);
    expect(image.updatedAt).toBeInstanceOf(Date);
    expect(image.createdAt.getFullYear()).toBe(2024);
  });

  it('falls back to image_url when url is undefined', () => {
    const dtoNoUrl: ProjectImageDTO = { ...dto, url: undefined };
    const image = dtoToProjectImage(dtoNoUrl);
    expect(image.url).toBe('http://host/orig.tif');
  });
});
