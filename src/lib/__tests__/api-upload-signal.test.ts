import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient } from '@/lib/api';

// Mirrors the mock setup in api-chunked-upload.test.ts: point the singleton's
// axios instance at a mock so we can inspect the exact request config.
const mockAxiosInstance = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
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
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual };
});

vi.mock('../config', () => ({
  default: { apiBaseUrl: 'http://localhost:3001/api' },
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * Regression: the "Cancel" button did nothing for an in-flight video upload
 * because `uploadVideo` never forwarded an AbortSignal into the axios config,
 * so aborting the controller couldn't cancel the request. These pin the signal
 * through to axios for both the video and plain-image upload paths.
 */
describe('ApiClient upload — AbortSignal forwarding (cancel support)', () => {
  const lastPostConfig = () => {
    const call = mockAxiosInstance.post.mock.calls.at(-1);
    return call?.[2] as { signal?: AbortSignal } | undefined;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient as unknown as { instance: unknown }).instance =
      mockAxiosInstance;
    (apiClient as unknown as { accessToken: string }).accessToken = 'tok';
  });

  afterEach(() => vi.clearAllMocks());

  test('uploadVideo forwards the AbortSignal to the axios request config', async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { data: { videoContainerId: 'v', frameCount: 1, channels: [] } },
    });
    const controller = new AbortController();
    const file = new File([new Blob(['x'])], 'v.mp4', { type: 'video/mp4' });

    await apiClient
      .uploadVideo('p1', file, undefined, false, controller.signal)
      .catch(() => {});

    expect(lastPostConfig()?.signal).toBe(controller.signal);
  });

  test('uploadImages forwards the AbortSignal to the axios request config', async () => {
    mockAxiosInstance.post.mockResolvedValue({ data: { data: [] } });
    const controller = new AbortController();
    const file = new File([new Blob(['x'])], 'i.jpg', { type: 'image/jpeg' });

    await apiClient
      .uploadImages('p1', [file], undefined, controller.signal)
      .catch(() => {});

    expect(lastPostConfig()?.signal).toBe(controller.signal);
  });

  test('uploadVideo without a signal leaves config.signal undefined', async () => {
    mockAxiosInstance.post.mockResolvedValue({
      data: { data: { videoContainerId: 'v', frameCount: 1, channels: [] } },
    });
    const file = new File([new Blob(['x'])], 'v.mp4', { type: 'video/mp4' });

    await apiClient.uploadVideo('p1', file).catch(() => {});

    expect(lastPostConfig()?.signal).toBeUndefined();
  });
});
