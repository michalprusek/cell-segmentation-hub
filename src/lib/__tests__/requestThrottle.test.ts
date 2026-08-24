/**
 * The property under test is the one production violated: no matter how many
 * requests are handed to the limiter at once, only a small constant number are
 * ever OUTSTANDING, and every one of them still eventually runs.
 *
 * Tests use deferred tasks rather than a mocked `fetch` on purpose — the
 * invariant is about slots, not about HTTP, and driving the tasks by hand is
 * what makes the concurrency high-water mark observable.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  MAX_SPECULATIVE_REQUESTS,
  RequestThrottle,
  speculativeFrameRequests,
} from '../requestThrottle';

/** A task whose completion the test controls, plus a record of whether it ever
 *  started. `started === false` at the end is how "never issued" is proven. */
function deferred() {
  let resolve!: (v?: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res as (v?: unknown) => void;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Runs `task` through the throttle while tracking peak concurrency. */
function concurrencyProbe() {
  let active = 0;
  let peak = 0;
  return {
    get peak() {
      return peak;
    },
    wrap<T>(inner: () => Promise<T>) {
      return async () => {
        active++;
        if (active > peak) peak = active;
        try {
          return await inner();
        } finally {
          active--;
        }
      };
    },
  };
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('RequestThrottle', () => {
  it('caps in-flight work at the limit and still completes everything', async () => {
    // The production shape: a 16-frame window x 3 channels, handed over in one
    // synchronous burst. Before the limiter, all 48 hit the network at once.
    const throttle = new RequestThrottle(4);
    const probe = concurrencyProbe();
    const gates = Array.from({ length: 48 }, () => deferred());

    const all = gates.map((g, i) =>
      throttle.schedule(probe.wrap(() => g.promise.then(() => i)))
    );

    await flush();
    expect(throttle.inFlight).toBe(4);
    expect(throttle.queued).toBe(44);

    // Release them one at a time; each release must admit exactly one more.
    for (const g of gates) {
      g.resolve();
      await flush();
    }

    const done = await Promise.all(all);
    expect(done).toHaveLength(48);
    expect(done).toEqual(gates.map((_, i) => i));
    // The whole point: never more than 4 at once, at any moment.
    expect(probe.peak).toBe(4);
    expect(throttle.inFlight).toBe(0);
    expect(throttle.queued).toBe(0);
  });

  it('holds a slot for the whole task, not just its first await', async () => {
    // A limiter that released at response-headers would bound nothing: the
    // issue rate is limit / cycle-time, and time-to-first-byte is milliseconds.
    const throttle = new RequestThrottle(1);
    const first = deferred();
    let secondStarted = false;

    void throttle.schedule(async () => {
      await Promise.resolve(); // "headers arrived"
      await first.promise; // "body still transferring"
    });
    void throttle.schedule(async () => {
      secondStarted = true;
    });

    await flush();
    expect(secondStarted).toBe(false);
    first.resolve();
    await flush();
    expect(secondStarted).toBe(true);
  });

  it('never invokes a queued task whose signal aborts', async () => {
    // The window shifted; this URL is gone. It must not reach the server at
    // all — cancelling it after issue would still have cost nginx a request.
    const throttle = new RequestThrottle(1);
    const blocker = deferred();
    const doomed = vi.fn().mockResolvedValue('never');
    const controller = new AbortController();

    const held = throttle.schedule(() => blocker.promise);
    const dropped = throttle.schedule(doomed, controller.signal);

    await flush();
    expect(throttle.queued).toBe(1);
    expect(doomed).not.toHaveBeenCalled();

    controller.abort();
    await expect(dropped).rejects.toMatchObject({ name: 'AbortError' });
    expect(throttle.queued).toBe(0);

    // Freeing the slot must NOT resurrect it.
    blocker.resolve();
    await held;
    await flush();
    expect(doomed).not.toHaveBeenCalled();
  });

  it('drops a whole abandoned window without issuing any of it', async () => {
    const throttle = new RequestThrottle(4);
    const gates = Array.from({ length: 4 }, () => deferred());
    const inFlight = gates.map(g => throttle.schedule(() => g.promise));
    const queuedTasks = Array.from({ length: 44 }, () =>
      vi.fn().mockResolvedValue(null)
    );
    const windowSignal = new AbortController();
    const queued = queuedTasks.map(t =>
      throttle.schedule(t, windowSignal.signal).catch(() => 'aborted')
    );

    await flush();
    expect(throttle.queued).toBe(44);

    windowSignal.abort();
    expect(await Promise.all(queued)).toEqual(Array(44).fill('aborted'));
    // Not one of the 44 was ever handed to the network.
    for (const t of queuedTasks) expect(t).not.toHaveBeenCalled();

    gates.forEach(g => g.resolve());
    await Promise.all(inFlight);
    expect(throttle.inFlight).toBe(0);
  });

  it('rejects without queueing when the signal is already aborted', async () => {
    const throttle = new RequestThrottle(4);
    const task = vi.fn();
    const controller = new AbortController();
    controller.abort();

    await expect(
      throttle.schedule(task, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(task).not.toHaveBeenCalled();
    expect(throttle.queued).toBe(0);
    expect(throttle.inFlight).toBe(0);
  });

  it('frees the slot when a task rejects, and when it throws synchronously', async () => {
    // In the browser an aborted `fetch` rejects, so this is the normal way an
    // in-flight speculative request gives its slot back. A leaked slot here
    // would wedge the prefetcher for the rest of the session.
    const throttle = new RequestThrottle(1);

    await expect(
      throttle.schedule(() => Promise.reject(new Error('offline')))
    ).rejects.toThrow('offline');
    expect(throttle.inFlight).toBe(0);

    await expect(
      throttle.schedule(() => {
        throw new Error('sync boom');
      })
    ).rejects.toThrow('sync boom');
    expect(throttle.inFlight).toBe(0);

    await expect(throttle.schedule(async () => 'ok')).resolves.toBe('ok');
  });

  describe('the displayed frame', () => {
    it('runs immediately even with every speculative slot taken', async () => {
      // The user is waiting for this one. Queueing it behind a saturated
      // window of warms is the latency the exemption exists to avoid.
      const throttle = new RequestThrottle(4);
      const gates = Array.from({ length: 4 }, () => deferred());
      gates.forEach(g => void throttle.schedule(() => g.promise));
      const starved = deferred();
      const speculative = vi.fn().mockReturnValue(starved.promise);
      void throttle.schedule(speculative);

      await flush();
      expect(throttle.queued).toBe(1);
      expect(speculative).not.toHaveBeenCalled();

      let displayedStarted = false;
      const displayed = throttle.runImmediate(async () => {
        displayedStarted = true;
        return 'frame';
      });
      // Synchronously started — it did not even wait for a microtask.
      expect(displayedStarted).toBe(true);
      await expect(displayed).resolves.toBe('frame');

      gates.forEach(g => g.resolve());
      starved.resolve();
      await flush();
    });

    it('still occupies a slot, so speculative work backs off while it runs', async () => {
      // Exempt from WAITING, not from the budget: the shared cap has to mean
      // something or three channels of displayed frame would sit on top of a
      // full speculative window.
      const throttle = new RequestThrottle(2);
      const displayed = [deferred(), deferred()];
      displayed.forEach(d => void throttle.runImmediate(() => d.promise));
      expect(throttle.inFlight).toBe(2);

      const warm = vi.fn().mockResolvedValue(null);
      void throttle.schedule(warm);
      await flush();
      expect(warm).not.toHaveBeenCalled();

      displayed[0].resolve();
      await flush();
      expect(warm).toHaveBeenCalledTimes(1);
      displayed[1].resolve();
      await flush();
    });
  });

  it('exports one shared instance with a small cap', async () => {
    // One limiter for both prefetch hooks: two independent ones would each
    // honour their own cap and jointly bust the zone.
    expect(speculativeFrameRequests).toBeInstanceOf(RequestThrottle);
    expect(speculativeFrameRequests.limit).toBe(MAX_SPECULATIVE_REQUESTS);
    // nginx's `segmentation` zone allows 100 r/s; the burst that broke it was
    // 48 wide. Anything much above single digits stops being a fix.
    expect(MAX_SPECULATIVE_REQUESTS).toBeGreaterThanOrEqual(4);
    expect(MAX_SPECULATIVE_REQUESTS).toBeLessThanOrEqual(6);
  });
});
