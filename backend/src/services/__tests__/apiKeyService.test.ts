import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../db', () => ({
  __esModule: true,
  prisma: {
    apiKey: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '../../db';
import {
  ApiKeyLimitError,
  MAX_API_KEYS_PER_USER,
  crc32,
  createApiKey,
  deleteApiKey,
  generateApiKey,
  hashApiKey,
  isWellFormedApiKey,
  verifyApiKey,
} from '../apiKeyService';

const db = prisma.apiKey as unknown as Record<
  'findUnique' | 'count' | 'create' | 'update' | 'deleteMany',
  ReturnType<typeof vi.fn>
>;

const USER = { id: 'user-1', email: 'user@example.com', emailVerified: true };

const rowFor = (overrides: Record<string, unknown> = {}) => ({
  id: 'key-1',
  name: 'pipeline',
  prefix: 'sseg_abcd',
  expiresAt: null,
  lastUsedAt: null,
  user: USER,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.update.mockResolvedValue({});
});

describe('key format', () => {
  it('computes the standard CRC-32', () => {
    // The check value every CRC-32 (IEEE 802.3) implementation must produce.
    expect(crc32('123456789')).toBe(0xcbf43926);
  });

  it('mints sseg_ + 43 base62 + 6 base62 checksum characters', () => {
    const key = generateApiKey();
    expect(key).toMatch(/^sseg_[0-9A-Za-z]{49}$/);
    expect(isWellFormedApiKey(key)).toBe(true);
  });

  it('does not repeat', () => {
    const keys = new Set(Array.from({ length: 200 }, generateApiKey));
    expect(keys.size).toBe(200);
  });

  it('uses the whole alphabet about evenly', () => {
    // 8 600 random characters; an unbiased source puts ~139 on each of the 62
    // symbols. `byte % 62` without rejection sampling puts ~168 on the first
    // eight and ~134 on the rest, so the first eight would average well above
    // the others.
    const counts = new Map<string, number>();
    for (let i = 0; i < 200; i++) {
      for (const ch of generateApiKey().slice(5, 48)) {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(62);
    const mean = (chars: string) =>
      [...chars].reduce((sum, ch) => sum + counts.get(ch)!, 0) / chars.length;
    const favoured = mean('01234567');
    const rest = mean('89ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz');
    expect(favoured / rest).toBeLessThan(1.12);
  });

  it('rejects a key with any single character changed', () => {
    const key = generateApiKey();
    for (let i = 5; i < key.length; i++) {
      const swapped = key[i] === 'A' ? 'B' : 'A';
      const tampered = key.slice(0, i) + swapped + key.slice(i + 1);
      expect(isWellFormedApiKey(tampered)).toBe(false);
    }
  });

  it.each([
    '',
    'sseg_',
    'ghp_0123456789012345678901234567890123456789012345678',
    `sseg_${'a'.repeat(48)}`,
    `sseg_${'a'.repeat(50)}`,
    `sseg_${'a'.repeat(42)}-${'a'.repeat(6)}`,
  ])('rejects malformed input %j', input => {
    expect(isWellFormedApiKey(input)).toBe(false);
  });

  it('hashes to SHA-256 hex, deterministically', () => {
    // sha256("abc") — FIPS 180-2 test vector.
    expect(hashApiKey('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('createApiKey', () => {
  it('stores the hash and a display prefix, never the key', async () => {
    db.count.mockResolvedValue(0);
    db.create.mockImplementation(async ({ data }) => ({
      id: 'key-1',
      name: data.name,
      prefix: data.prefix,
      createdAt: new Date(),
      lastUsedAt: null,
      expiresAt: data.expiresAt,
    }));

    const created = await createApiKey('user-1', 'pipeline', null);

    const { data } = db.create.mock.calls[0][0];
    expect(data.keyHash).toBe(hashApiKey(created.key));
    expect(data.prefix).toBe(created.key.slice(0, 9));
    expect(JSON.stringify(data)).not.toContain(created.key);
    expect(isWellFormedApiKey(created.key)).toBe(true);
  });

  it('refuses once the account holds the maximum', async () => {
    db.count.mockResolvedValue(MAX_API_KEYS_PER_USER);
    await expect(createApiKey('user-1', 'one too many', null)).rejects.toThrow(
      ApiKeyLimitError
    );
    expect(db.create).not.toHaveBeenCalled();
  });
});

describe('deleteApiKey', () => {
  it('scopes the delete to the owner', async () => {
    db.deleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteApiKey('user-1', 'key-of-someone-else')).toBe(false);
    expect(db.deleteMany).toHaveBeenCalledWith({
      where: { id: 'key-of-someone-else', userId: 'user-1' },
    });
  });
});

describe('verifyApiKey', () => {
  it('rejects a malformed key without touching the database', async () => {
    expect(await verifyApiKey('sseg_not-a-key')).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(db.findUnique).not.toHaveBeenCalled();
  });

  it('looks the key up by its hash', async () => {
    const key = generateApiKey();
    db.findUnique.mockResolvedValue(null);
    expect(await verifyApiKey(key)).toEqual({ ok: false, reason: 'unknown' });
    expect(db.findUnique.mock.calls[0][0].where).toEqual({
      keyHash: hashApiKey(key),
    });
  });

  it('rejects an expired key and accepts one that expires later', async () => {
    const key = generateApiKey();
    db.findUnique.mockResolvedValue(
      rowFor({ expiresAt: new Date(Date.now() - 1000) })
    );
    expect(await verifyApiKey(key)).toEqual({ ok: false, reason: 'expired' });
    expect(db.update).not.toHaveBeenCalled();

    db.findUnique.mockResolvedValue(
      rowFor({ expiresAt: new Date(Date.now() + 60_000) })
    );
    expect((await verifyApiKey(key)).ok).toBe(true);
  });

  it('returns the owner and the key identity', async () => {
    db.findUnique.mockResolvedValue(rowFor());
    expect(await verifyApiKey(generateApiKey())).toEqual({
      ok: true,
      apiKey: { id: 'key-1', name: 'pipeline', prefix: 'sseg_abcd' },
      user: USER,
    });
  });

  it('records last use at most once a minute', async () => {
    const key = generateApiKey();

    db.findUnique.mockResolvedValue(rowFor({ lastUsedAt: null }));
    await verifyApiKey(key);
    expect(db.update).toHaveBeenCalledTimes(1);

    db.findUnique.mockResolvedValue(
      rowFor({ lastUsedAt: new Date(Date.now() - 5_000) })
    );
    await verifyApiKey(key);
    expect(db.update).toHaveBeenCalledTimes(1);

    db.findUnique.mockResolvedValue(
      rowFor({ lastUsedAt: new Date(Date.now() - 120_000) })
    );
    await verifyApiKey(key);
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('still authenticates when the last-use write fails', async () => {
    db.findUnique.mockResolvedValue(rowFor());
    db.update.mockRejectedValue(new Error('db down'));
    expect((await verifyApiKey(generateApiKey())).ok).toBe(true);
  });
});
