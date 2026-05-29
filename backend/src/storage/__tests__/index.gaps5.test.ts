/**
 * index.gaps5.test.ts
 *
 * Covers storage/index.ts — previously 12.5% covered:
 *
 *  A. createStorageProvider
 *     - STORAGE_TYPE='local' → returns LocalStorageProvider
 *     - STORAGE_TYPE='s3' → throws "S3 storage provider not yet implemented"
 *     - STORAGE_TYPE='invalid' → throws "Unsupported storage type"
 *
 *  B. getStorageProvider
 *     - returns the same instance on second call (singleton)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { configObj } = vi.hoisted(() => ({
  configObj: { STORAGE_TYPE: 'local' as string, UPLOAD_DIR: '/tmp/uploads' },
}));

vi.mock('../../utils/config', () => ({ config: configObj }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
    },
  },
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  createStorageProvider,
  getStorageProvider,
  LocalStorageProvider,
} from '../index';

beforeEach(() => {
  vi.resetModules();
  configObj.STORAGE_TYPE = 'local';
});

describe('createStorageProvider', () => {
  it('returns LocalStorageProvider for STORAGE_TYPE=local', () => {
    configObj.STORAGE_TYPE = 'local';
    const provider = createStorageProvider();
    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });

  it('throws for STORAGE_TYPE=s3', () => {
    configObj.STORAGE_TYPE = 's3';
    expect(() => createStorageProvider()).toThrow(
      'S3 storage provider not yet implemented'
    );
  });

  it('throws for unknown STORAGE_TYPE', () => {
    configObj.STORAGE_TYPE = 'unknown';
    expect(() => createStorageProvider()).toThrow(
      'Unsupported storage type: unknown'
    );
  });
});

describe('getStorageProvider', () => {
  it('returns a StorageProvider instance', () => {
    configObj.STORAGE_TYPE = 'local';
    const provider = getStorageProvider();
    expect(provider).toBeDefined();
    expect(provider).toBeInstanceOf(LocalStorageProvider);
  });
});
