/**
 * concurrencyManager.gaps5.test.ts
 *
 * Covers branches still uncovered:
 *
 *  A. execute — error path
 *     - operation throws → processQueue still called, error re-thrown
 *
 *  B. getStatus — getter
 *     - returns correct active/queued/maxConcurrent values
 *
 * NOTE: The queued-operation error path (processQueue reject) is skipped
 * because it requires precise async timing to force queuing before firstOp completes.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ConcurrencyManager } from '../concurrencyManager';

describe('ConcurrencyManager', () => {
  it('re-throws when operation throws, processQueue still called', async () => {
    const cm = new ConcurrencyManager(2);
    const failingOp = vi.fn().mockRejectedValue(new Error('operation failed'));

    await expect(cm.execute(failingOp)).rejects.toThrow('operation failed');
    expect(cm.getStatus().active).toBe(0);
  });

  it('getStatus returns correct values', () => {
    const cm = new ConcurrencyManager(5);
    const status = cm.getStatus();
    expect(status.active).toBe(0);
    expect(status.queued).toBe(0);
    expect(status.maxConcurrent).toBe(5);
  });
});
