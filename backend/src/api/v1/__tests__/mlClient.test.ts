import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/config', () => ({
  config: { SEGMENTATION_SERVICE_URL: 'http://ml.test:8000' },
}));

const post = vi.fn();
vi.mock('axios', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));

import {
  ML_QUEUE_LIMIT,
  MlBusyError,
  MlRejectedError,
  MlTimeoutError,
  MlUnavailableError,
  mlQueueDepth,
  segmentWithMl,
} from '../mlClient';

const request = (overrides = {}) => ({
  image: Buffer.from('bytes'),
  filename: 'upload.tif',
  model: 'segformer',
  page: 0,
  maxPixels: 1000,
  timeoutMs: 5000,
  ...overrides,
});

/** The multipart body as text, to see which parts were sent. */
const bodyOf = (call: unknown[]): string =>
  (call[1] as { getBuffer(): Buffer }).getBuffer().toString('latin1');

beforeEach(() => {
  post.mockReset();
});

describe('what is sent to the ML service', () => {
  it('posts to /api/v1/segment with the caller timeout', async () => {
    post.mockResolvedValue({ data: { polygons: [] } });
    await segmentWithMl(request({ timeoutMs: 1234 }));
    expect(post.mock.calls[0][0]).toBe('http://ml.test:8000/api/v1/segment');
    expect(post.mock.calls[0][2].timeout).toBe(1234);
  });

  it('sends the file under the sniffed name, the page and the pixel ceiling', async () => {
    post.mockResolvedValue({ data: {} });
    await segmentWithMl(request({ page: 3, maxPixels: 4096 }));
    const body = bodyOf(post.mock.calls[0]);
    expect(body).toContain('name="file"; filename="upload.tif"');
    expect(body).toMatch(/name="model"\r\n\r\nsegformer/);
    expect(body).toMatch(/name="page"\r\n\r\n3/);
    expect(body).toMatch(/name="max_pixels"\r\n\r\n4096/);
  });

  it('omits threshold and detect_holes unless given', async () => {
    post.mockResolvedValue({ data: {} });
    await segmentWithMl(request());
    expect(bodyOf(post.mock.calls[0])).not.toContain('name="threshold"');
    expect(bodyOf(post.mock.calls[0])).not.toContain('name="detect_holes"');

    await segmentWithMl(request({ threshold: 0.7, detectHoles: false }));
    const body = bodyOf(post.mock.calls[1]);
    expect(body).toMatch(/name="threshold"\r\n\r\n0\.7/);
    expect(body).toMatch(/name="detect_holes"\r\n\r\nfalse/);
  });
});

describe('failures', () => {
  it.each([
    [{ code: 'ECONNABORTED' }, MlTimeoutError],
    [{ response: { status: 504, data: {} } }, MlTimeoutError],
    [{ code: 'ECONNREFUSED' }, MlUnavailableError],
    [{ response: { status: 500, data: { detail: 'Internal error' } } }, MlUnavailableError],
    [{ response: { status: 503, data: {} } }, MlUnavailableError],
  ])('maps %j', async (failure, expected) => {
    post.mockRejectedValue(failure);
    await expect(segmentWithMl(request())).rejects.toBeInstanceOf(expected);
  });

  it('keeps the ML service own detail on a 4xx', async () => {
    post.mockRejectedValue({
      response: { status: 413, data: { detail: { pixels: 9, max_pixels: 4 } } },
    });
    const error = await segmentWithMl(request()).catch(e => e);
    expect(error).toBeInstanceOf(MlRejectedError);
    expect(error.status).toBe(413);
    expect(error.detail).toEqual({ pixels: 9, max_pixels: 4 });
  });
});

describe('one inference at a time', () => {
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    const promise = new Promise(r => (resolve = r));
    return { promise, resolve };
  };

  it('runs requests strictly one after another, in arrival order', async () => {
    const gates = [deferred(), deferred(), deferred()];
    let call = 0;
    post.mockImplementation(() => gates[call++].promise);

    const results = [0, 1, 2].map(i => segmentWithMl(request({ page: i })));
    await Promise.resolve();
    await Promise.resolve();
    expect(post).toHaveBeenCalledTimes(1);
    expect(mlQueueDepth()).toBe(2);

    gates[0].resolve({ data: { page: 0 } });
    await results[0];
    await new Promise(r => setImmediate(r));
    expect(post).toHaveBeenCalledTimes(2);
    expect(bodyOf(post.mock.calls[1])).toMatch(/name="page"\r\n\r\n1/);

    gates[1].resolve({ data: { page: 1 } });
    gates[2].resolve({ data: { page: 2 } });
    expect(await Promise.all(results)).toEqual([
      { page: 0 },
      { page: 1 },
      { page: 2 },
    ]);
    expect(mlQueueDepth()).toBe(0);
  });

  it('frees the slot when a request fails', async () => {
    post.mockRejectedValueOnce({ code: 'ECONNREFUSED' });
    await expect(segmentWithMl(request())).rejects.toBeInstanceOf(
      MlUnavailableError
    );
    post.mockResolvedValue({ data: { ok: true } });
    expect(await segmentWithMl(request())).toEqual({ ok: true });
  });

  it('refuses outright once the queue is full, without calling the service', async () => {
    const gate = deferred();
    post.mockImplementation(() => gate.promise);

    const running = segmentWithMl(request());
    const queued = Array.from({ length: ML_QUEUE_LIMIT }, () =>
      segmentWithMl(request())
    );
    await Promise.resolve();
    expect(mlQueueDepth()).toBe(ML_QUEUE_LIMIT);

    await expect(segmentWithMl(request())).rejects.toBeInstanceOf(MlBusyError);
    expect(post).toHaveBeenCalledTimes(1);

    gate.resolve({ data: {} });
    await Promise.all([running, ...queued]);
    expect(post).toHaveBeenCalledTimes(1 + ML_QUEUE_LIMIT);
  });
});
