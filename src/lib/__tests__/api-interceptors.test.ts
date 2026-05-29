/**
 * api-interceptors.test.ts — covers branches still missing from api-advanced.test.ts
 * and api-uncovered.test.ts after inspecting the 77% coverage report:
 *
 *   • login: sessionStorage branch (rememberMe=false), rememberMe=true path
 *   • register: basic happy path + token storage
 *   • refreshAccessToken: deduplication (two concurrent callers share one promise)
 *   • _doRefresh: no-refresh-token guard
 *   • saveTokensToStorage: sessionStorage branch (rememberMe=false)
 *   • getExportDownloadToken: happy path
 *   • buildExportDownloadUrl: with and without filename, relative-baseURL fallback
 *   • dtoToProjectImage: field mapping (all camelCase fields)
 *   • response interceptor: 401 with no refreshToken present (no-refresh branch)
 *   • response interceptor: 502/503/504 retry paths + success/failure outcomes
 *
 * Not re-tested (already green in api-advanced.test.ts):
 *   • request interceptor auth header
 *   • 401 + refresh + retry
 *   • logout token clearing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const { mockAxiosInstance, _requestInterceptorRef, responseErrorHandlerRef } =
  vi.hoisted(() => {
    const _requestInterceptorRef: { value: (c: any) => any } = {
      value: (c: any) => c,
    };
    const responseErrorHandlerRef: { value: (e: any) => Promise<any> } = {
      value: async (e: any) => Promise.reject(e),
    };

    const inst = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
      interceptors: {
        request: {
          use: vi.fn((success: any) => {
            _requestInterceptorRef.value = success;
            return 0;
          }),
          eject: vi.fn(),
        },
        response: {
          use: vi.fn((_success: any, error: any) => {
            responseErrorHandlerRef.value = error;
            return 0;
          }),
          eject: vi.fn(),
        },
      },
    };

    return {
      mockAxiosInstance: inst,
      _requestInterceptorRef,
      responseErrorHandlerRef,
    };
  });

vi.mock('axios', () => ({
  default: { create: vi.fn(() => mockAxiosInstance) },
}));

// Allow the real ApiClient to be constructed
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

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

// ── storage mocks ─────────────────────────────────────────────────────────────
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

// ── import real singleton ──────────────────────────────────────────────────────
import { apiClient, dtoToProjectImage } from '../api';

// ── helpers ───────────────────────────────────────────────────────────────────
function wrap<T>(data: T) {
  return { data: { success: true, data } };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorageMock.getItem.mockReturnValue(null);
  sessionStorageMock.getItem.mockReturnValue(null);
  (apiClient as any).instance = mockAxiosInstance;
  (apiClient as any).accessToken = null;
  (apiClient as any).refreshToken = null;
  (apiClient as any).refreshPromise = null;
});

// ── login ─────────────────────────────────────────────────────────────────────

describe('login', () => {
  const authData = {
    accessToken: 'at',
    refreshToken: 'rt',
    user: { id: '1', email: 'a@b.com', username: 'ab' },
  };

  it('stores tokens in localStorage when rememberMe=true (default)', async () => {
    mockAxiosInstance.post.mockResolvedValue(wrap(authData));

    await apiClient.login('a@b.com', 'pw');

    expect(localStorageMock.setItem).toHaveBeenCalledWith('accessToken', 'at');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('refreshToken', 'rt');
    expect(apiClient.isAuthenticated()).toBe(true);
    expect(apiClient.getAccessToken()).toBe('at');
  });

  it('stores tokens in sessionStorage when rememberMe=false', async () => {
    mockAxiosInstance.post.mockResolvedValue(wrap(authData));

    await apiClient.login('a@b.com', 'pw', false);

    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'accessToken',
      'at'
    );
    expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
      'refreshToken',
      'rt'
    );
    // localStorage should NOT have been used for storage
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
      'accessToken',
      expect.anything()
    );
  });

  it('returns AuthResponse with user, accessToken, refreshToken', async () => {
    mockAxiosInstance.post.mockResolvedValue(wrap(authData));

    const result = await apiClient.login('a@b.com', 'pw');

    expect(result.user).toEqual(authData.user);
    expect(result.accessToken).toBe('at');
    expect(result.refreshToken).toBe('rt');
  });

  it('handles flat (non-nested) backend response', async () => {
    // Some older backends return data directly without .data wrapper
    mockAxiosInstance.post.mockResolvedValue({ data: authData });

    const result = await apiClient.login('a@b.com', 'pw');

    expect(result.accessToken).toBe('at');
  });
});

// ── register ─────────────────────────────────────────────────────────────────

describe('register', () => {
  const authData = {
    accessToken: 'reg-at',
    refreshToken: 'reg-rt',
    user: { id: '2', email: 'new@example.com', username: 'newu' },
  };

  it('posts to /auth/register and stores tokens', async () => {
    mockAxiosInstance.post.mockResolvedValue(wrap(authData));

    const result = await apiClient.register(
      'new@example.com',
      'pw123',
      'newu',
      { consentToMLTraining: true, consentToAlgorithmImprovement: false }
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
    expect(apiClient.isAuthenticated()).toBe(true);
  });

  it('works without username or consent options', async () => {
    mockAxiosInstance.post.mockResolvedValue(wrap(authData));

    const result = await apiClient.register('new@example.com', 'pw123');

    expect(result.accessToken).toBe('reg-at');
  });
});

// ── refreshAccessToken deduplication ──────────────────────────────────────────

describe('refreshAccessToken deduplication', () => {
  it('two concurrent calls share a single in-flight request', async () => {
    (apiClient as any).refreshToken = 'shared-rt';

    let resolveRefresh!: (v: any) => void;
    const refreshPromise = new Promise<void>(res => {
      resolveRefresh = res;
    });

    mockAxiosInstance.post.mockReturnValue(
      new Promise(r => {
        refreshPromise.then(() => {
          r(wrap({ accessToken: 'new-at', refreshToken: 'new-rt' }));
        });
      })
    );

    // Fire two concurrent refresh calls
    const p1 = apiClient.refreshAccessToken();
    const p2 = apiClient.refreshAccessToken();

    resolveRefresh();

    await Promise.all([p1, p2]);

    // Backend was only called once despite two concurrent callers
    expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    expect(apiClient.getAccessToken()).toBe('new-at');
  });
});

// ── _doRefresh: no refresh token guard ───────────────────────────────────────

describe('_doRefresh – no refresh token', () => {
  it('throws "No refresh token available" when refreshToken is null', async () => {
    (apiClient as any).refreshToken = null;

    await expect((apiClient as any)._doRefresh()).rejects.toThrow(
      'No refresh token available'
    );
  });
});

// ── response interceptor: 401 without refreshToken ───────────────────────────

describe('response interceptor – 401 with no refreshToken', () => {
  it('clears storage and rejects when there is no refresh token', async () => {
    (apiClient as any).refreshToken = null;
    (apiClient as any).accessToken = null;

    const error = {
      response: { status: 401 },
      config: { url: '/protected', headers: {} },
    };

    await expect(responseErrorHandlerRef.value(error)).rejects.toEqual(error);

    expect(localStorageMock.removeItem).toHaveBeenCalledWith('accessToken');
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('refreshToken');
  });
});

// ── response interceptor: retryable status codes ──────────────────────────────

describe('response interceptor – retryable 502/503/504', () => {
  it('retries on 502 and returns successful response', async () => {
    const originalRequest = { url: '/flaky', headers: {} };
    const error = { response: { status: 502 }, config: originalRequest };
    const successResponse = { data: 'ok', status: 200 };

    // The interceptor calls this.instance(originalRequest) for the retry
    const callableMock = vi.fn().mockResolvedValueOnce(successResponse);
    Object.assign(callableMock, mockAxiosInstance);
    (apiClient as any).instance = callableMock;

    const result = await responseErrorHandlerRef.value(error);

    expect(result).toEqual(successResponse);

    (apiClient as any).instance = mockAxiosInstance;
  }, 15000);

  it('throws after max retries when 503 persists', async () => {
    const originalRequest = { url: '/down', headers: {} };
    const error = { response: { status: 503 }, config: originalRequest };

    const callableMock = vi.fn().mockRejectedValue(error);
    Object.assign(callableMock, mockAxiosInstance);
    (apiClient as any).instance = callableMock;

    await expect(responseErrorHandlerRef.value(error)).rejects.toBeDefined();

    (apiClient as any).instance = mockAxiosInstance;
  }, 30000);
});

// ── getExportDownloadToken ─────────────────────────────────────────────────────

describe('getExportDownloadToken', () => {
  it('posts to the download-token endpoint and returns token + expiresAt', async () => {
    const tokenPayload = { token: 'signed-tok', expiresAt: 9999999 };
    mockAxiosInstance.post.mockResolvedValue({ data: tokenPayload });

    const result = await apiClient.getExportDownloadToken('proj-1', 'job-abc');

    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/projects/proj-1/export/job-abc/download-token'
    );
    expect(result).toEqual(tokenPayload);
  });
});

// ── buildExportDownloadUrl ────────────────────────────────────────────────────

describe('buildExportDownloadUrl', () => {
  it('includes token in query string', () => {
    const url = apiClient.buildExportDownloadUrl('proj-1', 'job-1', 'my-tok');
    expect(url).toContain('token=my-tok');
    expect(url).toContain('/projects/proj-1/export/job-1/download');
  });

  it('includes filename in query string when provided', () => {
    const url = apiClient.buildExportDownloadUrl(
      'proj-1',
      'job-1',
      'my-tok',
      'export.zip'
    );
    expect(url).toContain('filename=export.zip');
  });

  it('returns raw path when URL construction fails (no window)', () => {
    // Simulate an environment where new URL() throws
    const origURL = globalThis.URL;
    // @ts-expect-error -- intentional polyfill override for test
    globalThis.URL = class {
      constructor() {
        throw new Error('no URL');
      }
    };

    const url = apiClient.buildExportDownloadUrl('p', 'j', 'tok');
    expect(url).toContain('/projects/p/export/j/download');

    globalThis.URL = origURL;
  });
});

// ── dtoToProjectImage ─────────────────────────────────────────────────────────

describe('dtoToProjectImage', () => {
  it('maps all snake_case DTO fields to camelCase domain shape', () => {
    const dto = {
      id: 'img-1',
      name: 'test.jpg',
      project_id: 'proj-1',
      user_id: 'user-1',
      url: 'http://example.com/img.jpg',
      image_url: 'http://example.com/img.jpg',
      thumbnail_url: 'http://example.com/thumb.jpg',
      displayUrl: 'http://example.com/display.jpg',
      width: 800,
      height: 600,
      segmentation_status: 'completed' as const,
      segmentationThumbnailPath: '/seg/thumb.jpg',
      segmentationThumbnailUrl: 'http://example.com/seg/thumb.jpg',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    };

    const domain = dtoToProjectImage(dto);

    expect(domain.id).toBe('img-1');
    expect(domain.name).toBe('test.jpg');
    expect(domain.project_id).toBe('proj-1');
    expect(domain.user_id).toBe('user-1');
    expect(domain.segmentationStatus).toBe('completed');
    expect(domain.createdAt).toBeInstanceOf(Date);
    expect(domain.updatedAt).toBeInstanceOf(Date);
    expect(domain.segmentationThumbnailPath).toBe('/seg/thumb.jpg');
    expect(domain.segmentationThumbnailUrl).toBe(
      'http://example.com/seg/thumb.jpg'
    );
  });

  it('falls back to image_url when url is undefined', () => {
    const dto = {
      id: 'img-2',
      name: 'img.jpg',
      project_id: 'p',
      user_id: 'u',
      image_url: 'http://fallback.com/img.jpg',
      // url is undefined
      segmentation_status: 'pending' as const,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const domain = dtoToProjectImage(dto as any);

    expect(domain.url).toBe('http://fallback.com/img.jpg');
  });
});

// ── uploadAvatar – crop validation ────────────────────────────────────────────

describe('uploadAvatar – crop validation', () => {
  it('throws when cropData has zero or negative width', async () => {
    const file = new File(['img'], 'avatar.jpg', { type: 'image/jpeg' });

    await expect(
      apiClient.uploadAvatar(file, { x: 0, y: 0, width: 0, height: 100 })
    ).rejects.toThrow('Invalid crop dimensions');
  });

  it('throws when cropData has negative x', async () => {
    const file = new File(['img'], 'avatar.jpg', { type: 'image/jpeg' });

    await expect(
      apiClient.uploadAvatar(file, { x: -1, y: 0, width: 100, height: 100 })
    ).rejects.toThrow('Invalid crop position');
  });

  it('posts to /auth/avatar without cropData when not provided', async () => {
    mockAxiosInstance.post.mockResolvedValue(
      wrap({ avatarUrl: 'http://cdn/avatar.jpg', message: 'OK' })
    );
    const file = new File(['img'], 'avatar.jpg', { type: 'image/jpeg' });

    const result = await apiClient.uploadAvatar(file);

    expect(result.avatarUrl).toBe('http://cdn/avatar.jpg');
    expect(mockAxiosInstance.post).toHaveBeenCalledWith(
      '/auth/avatar',
      expect.any(Object), // FormData
      expect.objectContaining({
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    );
  });
});
