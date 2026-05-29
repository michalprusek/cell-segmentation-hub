/**
 * prismaConfig.gaps6.test.ts
 *
 * Covers the production branch in getPrismaConfig() (line 12):
 *   - When NODE_ENV === 'production', returns log: ['warn', 'error']
 *   - When NODE_ENV !== 'production', returns log: ['query', 'info', 'warn', 'error']
 */

import { describe, it, expect, afterEach } from 'vitest';

// We import directly (no mocks needed — pure function)
import { getPrismaConfig } from '../prismaConfig';

describe('getPrismaConfig()', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('returns verbose log config when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'test';
    const config = getPrismaConfig();
    expect(config).toBeDefined();
    expect((config as { log: string[] }).log).toContain('query');
    expect((config as { log: string[] }).log).toContain('info');
  });

  it('returns minimal log config when NODE_ENV is production (line 12)', () => {
    process.env.NODE_ENV = 'production';
    const config = getPrismaConfig();
    expect(config).toBeDefined();
    const log = (config as { log: string[] }).log;
    expect(log).toContain('warn');
    expect(log).toContain('error');
    expect(log).not.toContain('query');
    expect(log).not.toContain('info');
  });
});
