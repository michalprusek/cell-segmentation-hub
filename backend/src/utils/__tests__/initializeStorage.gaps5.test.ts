/**
 * initializeStorage.gaps5.test.ts
 *
 * Full coverage of utils/initializeStorage.ts:
 *
 *  A. initializeStorageDirectories — creates directories
 *     - success path → mkdir called for each directory
 *     - mkdir failure → error logged but function doesn't throw
 */

import { describe, it, expect, vi } from 'vitest';

const { mockMkdir } = vi.hoisted(() => ({
  mockMkdir: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { mkdir: mockMkdir },
  mkdir: mockMkdir,
}));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeStorageDirectories } from '../initializeStorage';
import { logger } from '../logger';

describe('initializeStorageDirectories', () => {
  it('creates all required directories on success', async () => {
    mockMkdir.mockResolvedValue(undefined);

    await initializeStorageDirectories();

    // Should have tried to create at least 4 directories
    expect(mockMkdir).toHaveBeenCalledTimes(4);
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('uploads'), {
      recursive: true,
    });
  });

  it('logs error but does not throw when mkdir fails', async () => {
    mockMkdir.mockRejectedValue(new Error('Permission denied'));

    // Should not throw even if mkdir fails
    await expect(initializeStorageDirectories()).resolves.toBeUndefined();
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });
});
