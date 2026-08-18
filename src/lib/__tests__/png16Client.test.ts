/**
 * The pooled decoder's job is to be invisible: same answers as decodeGrayPng,
 * just not on the main thread. So the tests are mostly about the ways it is
 * allowed to fail — every one of them must end in a decoded frame, never in a
 * rejected promise, because the caller renders a video frame from it.
 *
 * jsdom has no Worker, which is the default environment here and therefore the
 * main-thread fallback is exercised by simply not defining one.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  decodeGrayPngPooled,
  __resetDecodePoolForTests,
  __setDecodeWorkerFactoryForTests,
} from '../png16Client';
import * as png16 from '../png16';
import type { DecodeRequest } from '../png16Protocol';

const DECODED: png16.DecodedGray = {
  width: 2,
  height: 1,
  bitDepth: 16,
  data: new Uint16Array([7, 9]),
  min: 7,
  max: 9,
};

/** Minimal Worker double: records what was posted and answers on demand. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static constructorThrows = false;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  posted: DecodeRequest[] = [];
  terminated = false;

  constructor() {
    if (FakeWorker.constructorThrows) throw new Error('no workers here');
    FakeWorker.instances.push(this);
  }
  postMessage(msg: DecodeRequest) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  /** Answer the i-th request as a successful 16-bit decode. */
  answer(i = 0) {
    const { id } = this.posted[i];
    const buffer = new Uint16Array([7, 9]).buffer;
    this.onmessage?.({
      data: {
        id,
        ok: true,
        width: 2,
        height: 1,
        bitDepth: 16,
        min: 7,
        max: 9,
        is16: true,
        buffer,
      },
    } as MessageEvent);
  }
}

function installWorker() {
  FakeWorker.instances = [];
  FakeWorker.constructorThrows = false;
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  __setDecodeWorkerFactoryForTests(() => new FakeWorker() as unknown as Worker);
}

afterEach(() => {
  delete (globalThis as unknown as { Worker?: unknown }).Worker;
  __setDecodeWorkerFactoryForTests(null);
  __resetDecodePoolForTests();
  vi.restoreAllMocks();
});

describe('decodeGrayPngPooled', () => {
  it('decodes on the main thread when the platform has no Worker', async () => {
    // The jsdom default, and the floor this must never fall below.
    const spy = vi.spyOn(png16, 'decodeGrayPng').mockResolvedValue(DECODED);
    const out = await decodeGrayPngPooled(new Blob(['x']));
    expect(out).toEqual(DECODED);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('uses a worker when one is available, and does not decode inline', async () => {
    installWorker();
    const spy = vi.spyOn(png16, 'decodeGrayPng');

    const promise = decodeGrayPngPooled(new Blob(['x']));
    expect(FakeWorker.instances.length).toBeGreaterThanOrEqual(2);
    FakeWorker.instances[0].answer();

    await expect(promise).resolves.toEqual(DECODED);
    expect(spy).not.toHaveBeenCalled();
  });

  it('spreads concurrent decodes across workers instead of queueing one', async () => {
    // The reason the pool exists: a frame's two channels must decode at the
    // same time, or the wall clock is the sum rather than the max.
    installWorker();
    const a = decodeGrayPngPooled(new Blob(['a']));
    const b = decodeGrayPngPooled(new Blob(['b']));

    const busy = FakeWorker.instances.filter(w => w.posted.length > 0);
    expect(busy).toHaveLength(2);

    busy[0].answer();
    busy[1].answer();
    await expect(Promise.all([a, b])).resolves.toHaveLength(2);
  });

  it('falls back to the main thread when the worker cannot be constructed', async () => {
    installWorker();
    FakeWorker.constructorThrows = true;
    const spy = vi.spyOn(png16, 'decodeGrayPng').mockResolvedValue(DECODED);

    await expect(decodeGrayPngPooled(new Blob(['x']))).resolves.toEqual(
      DECODED
    );
    expect(spy).toHaveBeenCalled();
  });

  it('resolves null — not a rejection — for a PNG the decoder does not handle', async () => {
    // The caller has an 8-bit createImageBitmap fallback keyed on exactly this.
    installWorker();
    const promise = decodeGrayPngPooled(new Blob(['x']));
    const worker = FakeWorker.instances.find(w => w.posted.length > 0)!;
    worker.onmessage?.({
      data: { id: worker.posted[0].id, ok: false, reason: 'unsupported' },
    } as MessageEvent);
    await expect(promise).resolves.toBeNull();
  });

  it('completes the decode inline when a worker dies mid-flight', async () => {
    // A dead worker must cost a frame its latency, never its content.
    installWorker();
    const spy = vi.spyOn(png16, 'decodeGrayPng').mockResolvedValue(DECODED);

    const promise = decodeGrayPngPooled(new Blob(['x']));
    const worker = FakeWorker.instances.find(w => w.posted.length > 0)!;
    worker.onerror?.(new Error('worker exploded'));

    await expect(promise).resolves.toEqual(DECODED);
    expect(spy).toHaveBeenCalled();
  });

  it('stays on the main thread after a worker failure', async () => {
    installWorker();
    vi.spyOn(png16, 'decodeGrayPng').mockResolvedValue(DECODED);
    const first = decodeGrayPngPooled(new Blob(['x']));
    FakeWorker.instances[0].onerror?.(new Error('boom'));
    await first;

    const countAfterFailure = FakeWorker.instances.length;
    await decodeGrayPngPooled(new Blob(['y']));
    // No new pool was spun up to fail again on the next frame.
    expect(FakeWorker.instances.length).toBe(countAfterFailure);
  });
});
