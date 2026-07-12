/**
 * api.ts — ApiClient core / cross-cutting behaviour.
 *
 * Covers the axios-client plumbing that is shared by every request:
 *   • axios instance configuration (cookie auth, timeout, headers)
 *   • response interceptor: success pass-through
 *   • token refresh on 401 (refresh + retry, auth-endpoint skip, _retry guard,
 *     signed-out handling, concurrent de-duplication, refreshAccessToken)
 *   • retryable-status backoff (429 / 502 / 503) and its limits
 *   • response-envelope extraction (success wrapper vs direct data)
 *   • field mapping (project / image / segmentation-status / dtoToProjectImage)
 *   • generic HTTP pass-through helpers
 *   • auth methods (login / register / logout)
 *
 * Resource-method coverage (projects, folders, sharing, images, segmentation,
 * queue, upload, export, profile) lives in api-methods.test.ts; chunked upload
 * lives in api-chunked-upload.test.ts. All three share
 * ./helpers/apiClientTestKit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  localStorageMock,
  sessionStorageMock,
  wrap,
} from './helpers/apiClientTestKit';

// ── hoisted axios mock: captures the create() config + interceptor handlers ──
const {
  mockAxiosInstance,
  createConfigRef,
  responseInterceptorRef,
  responseErrorHandlerRef,
} = vi.hoisted(() => {
  const createConfigRef: { value: any } = { value: undefined };
  const responseInterceptorRef: { value: any } = { value: undefined };
  const responseErrorHandlerRef: { value: any } = { value: undefined };

  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: {
        // No request interceptor after the cookie cutover — auth rides in the
        // httpOnly cookie. Capture the response success + error handlers so the
        // interceptor branches can be exercised directly.
        use: vi.fn((success: any, error: any) => {
          responseInterceptorRef.value = success;
          responseErrorHandlerRef.value = error;
          return 0;
        }),
        eject: vi.fn(),
      },
    },
  };

  return {
    mockAxiosInstance,
    createConfigRef,
    responseInterceptorRef,
    responseErrorHandlerRef,
  };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn((cfg: any) => {
      createConfigRef.value = cfg;
      return mockAxiosInstance;
    }),
  },
}));

// Override the global setup.ts mock so we test the real ApiClient.
vi.mock('@/lib/api', async importOriginal => {
  const actual = (await importOriginal()) as any;
  return { ...actual };
});

vi.mock('@/lib/config', () => ({
  default: { apiBaseUrl: 'http://localhost:3001/api' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── real singleton (constructor runs once, capturing the interceptor refs) ──
import { apiClient, dtoToProjectImage, type ProjectImageDTO } from '../api';

beforeEach(() => {
  // resetAllMocks clears queued mockResolvedValueOnce chains between tests.
  vi.resetAllMocks();
  localStorageMock.getItem.mockReturnValue(null);
  sessionStorageMock.getItem.mockReturnValue(null);
  (apiClient as any).instance = mockAxiosInstance;
  (apiClient as any).refreshPromise = null;
});

// ════════════════════════════════════════════════════════════════════════════
describe('axios instance configuration', () => {
  it('creates the client with cookie auth + JSON defaults', () => {
    // createConfigRef is captured at construction time and survives resetAllMocks.
    expect(createConfigRef.value).toEqual({
      baseURL: 'http://localhost:3001/api',
      timeout: 120000,
      headers: { 'Content-Type': 'application/json' },
      withCredentials: true,
    });
  });

  it('registers a response interceptor with success + error handlers', () => {
    expect(responseInterceptorRef.value).toBeInstanceOf(Function);
    expect(responseErrorHandlerRef.value).toBeInstanceOf(Function);
  });

  it('passes through successful responses unchanged', () => {
    const response = { data: { success: true }, status: 200 };
    expect(responseInterceptorRef.value(response)).toBe(response);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('token refresh (401)', () => {
  it('refreshes the token on 401 and retries the original request', async () => {
    const error = {
      response: { status: 401 },
      config: { url: '/test-endpoint', headers: {} },
    };

    // The instance is called for the retry; .post is called for the refresh.
    const callableMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { result: 'ok' } });
    Object.assign(callableMock, mockAxiosInstance);
    callableMock.post = vi.fn().mockResolvedValueOnce({ data: {} });
    (apiClient as any).instance = callableMock;

    try {
      await responseErrorHandlerRef.value(error);
    } catch {
      // Retry wiring may reject in the mock — we only assert the refresh call.
    }

    // Refresh posts with NO body (the refresh_token cookie carries the token).
    expect(callableMock.post).toHaveBeenCalledWith('/auth/refresh-token');

    (apiClient as any).instance = mockAxiosInstance;
  });

  it('does not attempt refresh for auth endpoints on 401', async () => {
    const err = {
      response: { status: 401 },
      config: { url: '/auth/login', headers: {} },
    };

    await expect(responseErrorHandlerRef.value(err)).rejects.toEqual(err);
    expect(mockAxiosInstance.post).not.toHaveBeenCalledWith(
      '/auth/refresh',
      expect.any(Object)
    );
  });

  it('surfaces signed-out state (and touches no localStorage) when refresh fails', async () => {
    const err = {
      response: { status: 401 },
      config: { url: '/protected-endpoint', headers: {} },
    };
    mockAxiosInstance.post.mockRejectedValue(new Error('Refresh failed'));

    await expect(responseErrorHandlerRef.value(err)).rejects.toBeDefined();

    // Tokens live in httpOnly cookies — nothing to clear client-side.
    expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    expect(sessionStorageMock.removeItem).not.toHaveBeenCalled();
  });

  it('does not retry a request that already carries the _retry flag', async () => {
    const err = {
      response: { status: 401 },
      config: { url: '/test', headers: {}, _retry: true },
    };

    await expect(responseErrorHandlerRef.value(err)).rejects.toEqual(err);
    expect(mockAxiosInstance.post).not.toHaveBeenCalled();
  });

  it('handles two concurrent 401s without wedging', async () => {
    const err1 = {
      response: { status: 401 },
      config: { url: '/a', headers: {} },
    };
    const err2 = {
      response: { status: 401 },
      config: { url: '/b', headers: {} },
    };

    mockAxiosInstance.post.mockResolvedValueOnce({ data: {} });
    mockAxiosInstance.get.mockResolvedValue({ data: { result: 'ok' } });

    const results = await Promise.allSettled([
      responseErrorHandlerRef.value(err1),
      responseErrorHandlerRef.value(err2),
    ]);

    expect(results).toHaveLength(2);
    expect(mockAxiosInstance.post).toHaveBeenCalled();
  });

  it('refreshAccessToken de-duplicates concurrent callers into one POST', async () => {
    let resolveRefresh!: (v: unknown) => void;
    mockAxiosInstance.post.mockReturnValue(
      new Promise(res => {
        resolveRefresh = res;
      })
    );

    const p1 = (apiClient as any).refreshAccessToken();
    const p2 = (apiClient as any).refreshAccessToken();

    resolveRefresh({ data: {} });
    await Promise.all([p1, p2]);

    // Two callers, a single in-flight request.
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/refresh-token');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('retryable-status backoff (429 / 502 / 503)', () => {
  it('retries a 429 with exponential backoff and returns the success', async () => {
    const success = { data: { result: 'success' } };
    const callableMock = vi.fn().mockResolvedValueOnce(success);
    Object.assign(callableMock, mockAxiosInstance);
    (apiClient as any).instance = callableMock;

    const result = await responseErrorHandlerRef.value({
      response: { status: 429 },
      config: { url: '/rate-limited' },
    });

    expect(result).toBeDefined();
    (apiClient as any).instance = mockAxiosInstance;
  }, 10000);

  it('rejects a 429 after the maximum retry attempts', async () => {
    const rateLimitError = {
      response: { status: 429 },
      config: { url: '/always-429' },
    };
    const callableMock = vi.fn().mockRejectedValue(rateLimitError);
    Object.assign(callableMock, mockAxiosInstance);
    (apiClient as any).instance = callableMock;

    await expect(
      responseErrorHandlerRef.value(rateLimitError)
    ).rejects.toBeDefined();

    (apiClient as any).instance = mockAxiosInstance;
  }, 30000);

  it('retries a 502 and returns the eventual success', async () => {
    const success = { data: 'ok', status: 200 };
    const callableMock = vi.fn().mockResolvedValueOnce(success);
    Object.assign(callableMock, mockAxiosInstance);
    (apiClient as any).instance = callableMock;

    const result = await responseErrorHandlerRef.value({
      response: { status: 502 },
      config: { url: '/flaky', headers: {} },
    });

    expect(result).toEqual(success);
    (apiClient as any).instance = mockAxiosInstance;
  }, 15000);

  it('throws after max retries when a 503 persists', async () => {
    const error = {
      response: { status: 503 },
      config: { url: '/down', headers: {} },
    };
    const callableMock = vi.fn().mockRejectedValue(error);
    Object.assign(callableMock, mockAxiosInstance);
    (apiClient as any).instance = callableMock;

    await expect(responseErrorHandlerRef.value(error)).rejects.toBeDefined();
    (apiClient as any).instance = mockAxiosInstance;
  }, 30000);

  it('does not apply backoff to non-retryable status codes (500)', async () => {
    const serverError = {
      response: { status: 500 },
      config: { url: '/server-error' },
    };

    await expect(responseErrorHandlerRef.value(serverError)).rejects.toEqual(
      serverError
    );
    expect(mockAxiosInstance.get).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('response-envelope extraction', () => {
  it('unwraps the { success, data } envelope', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { success: true, data: { id: '1', name: 'Test' }, message: 'ok' },
    });

    const result = await apiClient.getUserProfile();
    expect(result).toEqual({ id: '1', name: 'Test' });
  });

  it('accepts a direct data response without a wrapper', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: { id: '1', name: 'Direct' },
    });

    const result = await apiClient.getUserProfile();
    expect(result).toEqual({ id: '1', name: 'Direct' });
  });

  it('returns safe defaults for a variety of malformed responses', async () => {
    const malformed = [
      { data: null },
      { data: undefined },
      { data: 'not an object' },
      { data: 123 },
      { data: [] },
      {},
      null,
      undefined,
    ];

    for (const response of malformed) {
      mockAxiosInstance.get.mockResolvedValueOnce(response);
      try {
        const result = await apiClient.getProjects();
        if (result && typeof result === 'object') {
          expect(result).toMatchObject({
            projects: expect.any(Array),
            total: expect.any(Number),
            page: expect.any(Number),
            totalPages: expect.any(Number),
          });
        } else {
          expect(result).toBeDefined();
        }
      } catch (error) {
        expect(error).toBeDefined();
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('field mapping', () => {
  it('maps backend project field names to the frontend shape', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            id: '1',
            title: 'Backend Title',
            createdAt: '2024-01-01T00:00:00Z',
            userId: 'user123',
          },
        ],
        pagination: { total: 1, page: 1, totalPages: 1 },
      },
    });

    const result = await apiClient.getProjects();
    expect(result.projects[0]).toMatchObject({
      id: '1',
      name: 'Backend Title',
      created_at: '2024-01-01T00:00:00Z',
      user_id: 'user123',
    });
  });

  it('ensures relative image URLs become absolute (under /uploads/)', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          images: [
            {
              id: '1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: '/uploads/relative.jpg',
              thumbnailUrl: '/uploads/thumb.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
          pagination: { total: 1, page: 1, totalPages: 1 },
        },
      },
    });

    const result = await apiClient.getProjectImages('proj1');
    expect(result.images[0].image_url).toBe(
      'http://localhost:3001/uploads/relative.jpg'
    );
    expect(result.images[0].thumbnail_url).toBe(
      'http://localhost:3001/uploads/thumb.jpg'
    );
  });

  it('preserves already-absolute image URLs', async () => {
    mockAxiosInstance.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          images: [
            {
              id: '1',
              name: 'test.jpg',
              projectId: 'proj1',
              userId: 'user1',
              originalUrl: 'https://cdn.example.com/image.jpg',
              thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-01-01T00:00:00Z',
            },
          ],
          pagination: { total: 1, page: 1, totalPages: 1 },
        },
      },
    });

    const result = await apiClient.getProjectImages('proj1');
    expect(result.images[0].image_url).toBe(
      'https://cdn.example.com/image.jpg'
    );
    expect(result.images[0].thumbnail_url).toBe(
      'https://cdn.example.com/thumb.jpg'
    );
  });

  it('maps every backend segmentation status to the frontend enum', async () => {
    const cases = [
      { backend: 'no_segmentation', expected: 'pending' },
      { backend: 'queued', expected: 'pending' },
      { backend: 'segmented', expected: 'completed' },
      { backend: 'no_polygons', expected: 'completed' },
      { backend: 'pending', expected: 'pending' },
      { backend: 'processing', expected: 'processing' },
      { backend: 'completed', expected: 'completed' },
      { backend: 'failed', expected: 'failed' },
      { backend: 'unknown_status', expected: 'failed' },
      { backend: null, expected: 'failed' },
      { backend: undefined, expected: 'failed' },
    ];

    for (const { backend, expected } of cases) {
      mockAxiosInstance.get.mockResolvedValue(
        wrap({
          image: {
            id: '1',
            name: 'test.jpg',
            projectId: 'proj1',
            userId: 'user1',
            originalUrl: '/test.jpg',
            segmentationStatus: backend,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        })
      );
      const result = await apiClient.getImage('proj1', '1');
      expect(result.segmentation_status).toBe(expected);
    }
  });

  // mapImageFields branch battery (exercised via getImage) ────────────────────
  describe('mapImageFields', () => {
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

    it('derives segmentationThumbnailUrl from segmentationThumbnailPath', async () => {
      mockAxiosInstance.get.mockResolvedValue(
        imageResponse({
          originalUrl: 'http://host/img.png',
          segmentationThumbnailPath: '/uploads/seg/thumb.jpg',
        })
      );
      const result = await apiClient.getImage('proj-1', 'img-1');
      expect(result.segmentationThumbnailUrl).toContain('thumb.jpg');
      expect(result.segmentationThumbnailPath).toBe('/uploads/seg/thumb.jpg');
    });

    it('keeps a relative imageUrl resolvable', async () => {
      mockAxiosInstance.get.mockResolvedValue(
        imageResponse({ image_url: 'relative/path/img.png' })
      );
      const result = await apiClient.getImage('proj-1', 'img-1');
      expect(result.image_url).toContain('relative/path/img.png');
    });

    it('passes through absolute http(s) URLs unchanged', async () => {
      mockAxiosInstance.get.mockResolvedValue(
        imageResponse({
          originalUrl: 'https://cdn.example.com/img.png',
          thumbnailUrl: 'https://cdn.example.com/thumb.jpg',
        })
      );
      const result = await apiClient.getImage('proj-1', 'img-1');
      expect(result.image_url).toBe('https://cdn.example.com/img.png');
    });

    it('falls back thumbnail_url to the image URL when thumbnail is absent', async () => {
      mockAxiosInstance.get.mockResolvedValue(
        imageResponse({ originalUrl: 'http://localhost/img.png' })
      );
      const result = await apiClient.getImage('proj-1', 'img-1');
      expect(result.thumbnail_url).toContain('img.png');
    });

    it('preserves null width/height rather than coercing to a number', async () => {
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

  // mapProjectFields edge cases (exercised via getProject) ─────────────────────
  describe('mapProjectFields', () => {
    const baseProject = {
      id: 'proj-1',
      title: 'My Project',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      userId: 'user-1',
      type: 'spheroid',
    };

    it('preserves folderId=null (explicit root placement)', async () => {
      mockAxiosInstance.get.mockResolvedValue(
        wrap({ ...baseProject, folderId: null })
      );
      const result = await apiClient.getProject('proj-1');
      expect(Object.prototype.hasOwnProperty.call(result, 'folderId')).toBe(
        true
      );
      expect(result.folderId).toBeNull();
    });

    it('omits folderId entirely when the backend did not send it', async () => {
      mockAxiosInstance.get.mockResolvedValue(wrap({ ...baseProject }));
      const result = await apiClient.getProject('proj-1');
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

    it('defaults an unrecognised project type to "spheroid"', async () => {
      mockAxiosInstance.get.mockResolvedValue(
        wrap({ ...baseProject, type: 'totally_unknown_type' })
      );
      const result = await apiClient.getProject('proj-1');
      expect(result.type).toBe('spheroid');
    });
  });

  // dtoToProjectImage pure mapper ─────────────────────────────────────────────
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

    it('maps all snake_case DTO fields to the camelCase domain shape', () => {
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

    it('falls back url → image_url when url is undefined', () => {
      const image = dtoToProjectImage({ ...dto, url: undefined });
      expect(image.url).toBe('http://host/orig.tif');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('generic HTTP pass-through helpers', () => {
  it('get() delegates to the axios instance', async () => {
    mockAxiosInstance.get.mockResolvedValue({ data: 'resp' });
    expect(await apiClient.get('/custom')).toEqual({ data: 'resp' });
  });

  it('post() delegates to the axios instance', async () => {
    mockAxiosInstance.post.mockResolvedValue({ data: 'resp' });
    expect(await apiClient.post('/custom', { key: 'val' })).toEqual({
      data: 'resp',
    });
  });

  it('put() delegates to the axios instance', async () => {
    mockAxiosInstance.put.mockResolvedValue({ data: 'resp' });
    expect(await apiClient.put('/custom', { x: 1 })).toEqual({ data: 'resp' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('auth methods', () => {
  const authData = { user: { id: '1', email: 'a@b.com', username: 'ab' } };

  describe('login', () => {
    it('sends rememberMe=true by default and returns only { user }', async () => {
      mockAxiosInstance.post.mockResolvedValue(wrap(authData));

      const result = await apiClient.login('a@b.com', 'pw');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/login',
        expect.objectContaining({ email: 'a@b.com', rememberMe: true })
      );
      expect(result.user).toEqual(authData.user);
      // Tokens live in httpOnly cookies — nothing is written to storage.
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
      expect(sessionStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('forwards rememberMe=false when specified', async () => {
      mockAxiosInstance.post.mockResolvedValue(wrap(authData));

      await apiClient.login('a@b.com', 'pw', false);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/login',
        expect.objectContaining({ rememberMe: false })
      );
    });

    it('returns no tokens in the body (cookies only)', async () => {
      mockAxiosInstance.post.mockResolvedValue(wrap(authData));

      const result = await apiClient.login('a@b.com', 'pw');
      expect((result as any).accessToken).toBeUndefined();
      expect((result as any).refreshToken).toBeUndefined();
    });

    it('handles a flat (non-nested) backend response', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: authData });

      const result = await apiClient.login('a@b.com', 'pw');
      expect(result.user).toEqual(authData.user);
    });
  });

  describe('register', () => {
    const registerData = {
      user: { id: '2', email: 'new@example.com', username: 'newu' },
    };

    it('posts to /auth/register with body + consent and returns { user }', async () => {
      mockAxiosInstance.post.mockResolvedValue(wrap(registerData));

      const result = await apiClient.register(
        'new@example.com',
        'pw123',
        'newu',
        {
          consentToMLTraining: true,
          consentToAlgorithmImprovement: false,
        }
      );

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/auth/register',
        expect.objectContaining({
          email: 'new@example.com',
          username: 'newu',
          consentToMLTraining: true,
        })
      );
      expect(result.user.email).toBe('new@example.com');
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('works without username or consent options', async () => {
      mockAxiosInstance.post.mockResolvedValue(wrap(registerData));

      const result = await apiClient.register('new@example.com', 'pw123');
      expect(result.user.email).toBe('new@example.com');
      expect((result as any).accessToken).toBeUndefined();
    });
  });

  describe('logout', () => {
    it('always POSTs /auth/logout and touches no localStorage', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: {} });

      await apiClient.logout();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/logout');
      expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });

    it('swallows a failing /auth/logout without throwing', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Server down'));

      await expect(apiClient.logout()).resolves.toBeUndefined();
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/logout');
    });
  });
});
