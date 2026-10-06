import crypto from 'crypto';
import { prisma } from '../db';
import { logger } from '../utils/logger';

/**
 * API keys for the public `/api/v1` surface.
 *
 * FORMAT: `sseg_` + 43 base62 characters + 6 base62 characters of CRC32.
 *
 * It is GitHub's token format (github.blog, "Behind GitHub's new
 * authentication token formats", 2021), for the same three reasons:
 *
 *  - The PREFIX makes a leaked key recognisable — to a secret scanner, and to
 *    a person reading a log. `_` is the separator because it is not a base62
 *    character and a double-click still selects the whole key.
 *  - The RANDOM part is 43 base62 characters: 43 * log2(62) = 256.03 bits.
 *  - The CHECKSUM lets anything reject a mistyped or invented key offline.
 *    Here that is `authenticateApiKey`, which refuses a malformed key without
 *    a database read. It is NOT a security control — anyone can compute a
 *    valid checksum for a random string. The 256 bits are the security.
 */
export const API_KEY_PREFIX = 'sseg_';
const RANDOM_LENGTH = 43;
const CHECKSUM_LENGTH = 6;
const BASE62 =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const API_KEY_PATTERN = new RegExp(
  `^${API_KEY_PREFIX}([0-9A-Za-z]{${RANDOM_LENGTH}})([0-9A-Za-z]{${CHECKSUM_LENGTH}})$`
);

/** `sseg_` plus the first four random characters: enough to tell keys apart. */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 4;

/** A person has a handful of integrations, not hundreds. */
export const MAX_API_KEYS_PER_USER = 10;

/**
 * `lastUsedAt` is written at most this often per key. Without the bound every
 * API request would carry a database write; with it the column is accurate to
 * a minute, which is all "when was this key last used" needs.
 */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

const CRC32_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

// `zlib.crc32` only exists from Node 20.15 / 22.2, and the checksum of a key
// must not depend on which runtime minted it.
export function crc32(input: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checksumFor(randomPart: string): string {
  let value = crc32(randomPart);
  let out = '';
  for (let i = 0; i < CHECKSUM_LENGTH; i++) {
    out = BASE62[value % 62] + out;
    value = Math.floor(value / 62);
  }
  return out;
}

function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of crypto.randomBytes(length)) {
      // Rejection sampling: 248 is the largest multiple of 62 below 256, so
      // every character is equally likely. `byte % 62` alone would make the
      // first eight characters of the alphabet 25 % more common.
      if (byte < 248 && out.length < length) {
        out += BASE62[byte % 62];
      }
    }
  }
  return out;
}

export function generateApiKey(): string {
  const randomPart = randomBase62(RANDOM_LENGTH);
  return `${API_KEY_PREFIX}${randomPart}${checksumFor(randomPart)}`;
}

/** Right shape AND right checksum. Says nothing about whether the key exists. */
export function isWellFormedApiKey(key: string): boolean {
  const match = API_KEY_PATTERN.exec(key);
  return match !== null && checksumFor(match[1]) === match[2];
}

/**
 * Unsalted SHA-256, deliberately — see the note on the `ApiKey` model. The
 * hash is the database lookup, so it has to be deterministic and cheap.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function displayPrefix(key: string): string {
  return key.slice(0, DISPLAY_PREFIX_LENGTH);
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

const SUMMARY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
} as const;

export class ApiKeyLimitError extends Error {
  constructor() {
    super(`An account can hold at most ${MAX_API_KEYS_PER_USER} API keys`);
    this.name = 'ApiKeyLimitError';
  }
}

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  return prisma.apiKey.findMany({
    where: { userId },
    select: SUMMARY_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Mint a key. The returned `key` is the only copy that will ever exist —
 * the row keeps its hash.
 */
export async function createApiKey(
  userId: string,
  name: string,
  expiresAt: Date | null
): Promise<ApiKeySummary & { key: string }> {
  const existing = await prisma.apiKey.count({ where: { userId } });
  if (existing >= MAX_API_KEYS_PER_USER) {
    throw new ApiKeyLimitError();
  }

  const key = generateApiKey();
  const created = await prisma.apiKey.create({
    data: {
      userId,
      name,
      keyHash: hashApiKey(key),
      prefix: displayPrefix(key),
      expiresAt,
    },
    select: SUMMARY_SELECT,
  });

  logger.info(
    `API key ${created.prefix} created for user ${userId}`,
    'ApiKeyService'
  );
  return { ...created, key };
}

/** @returns false when the key does not exist OR belongs to somebody else. */
export async function deleteApiKey(
  userId: string,
  id: string
): Promise<boolean> {
  const { count } = await prisma.apiKey.deleteMany({ where: { id, userId } });
  if (count > 0) {
    logger.info(`API key ${id} revoked by user ${userId}`, 'ApiKeyService');
  }
  return count > 0;
}

export type ApiKeyVerification =
  | {
      ok: true;
      apiKey: { id: string; name: string; prefix: string };
      user: { id: string; email: string; emailVerified: boolean };
    }
  | { ok: false; reason: 'malformed' | 'unknown' | 'expired' };

export async function verifyApiKey(
  presented: string
): Promise<ApiKeyVerification> {
  if (!isWellFormedApiKey(presented)) {
    return { ok: false, reason: 'malformed' };
  }

  const row = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(presented) },
    select: {
      id: true,
      name: true,
      prefix: true,
      expiresAt: true,
      lastUsedAt: true,
      user: { select: { id: true, email: true, emailVerified: true } },
    },
  });

  if (!row) {
    return { ok: false, reason: 'unknown' };
  }

  const now = Date.now();
  if (row.expiresAt && row.expiresAt.getTime() <= now) {
    return { ok: false, reason: 'expired' };
  }

  if (
    !row.lastUsedAt ||
    now - row.lastUsedAt.getTime() >= LAST_USED_WRITE_INTERVAL_MS
  ) {
    // Not awaited: a slow or failed bookkeeping write must not delay or fail
    // the request it describes.
    prisma.apiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(now) } })
      .catch((error: unknown) => {
        logger.warn(
          `Could not record last use of API key ${row.prefix}`,
          'ApiKeyService',
          { error: error instanceof Error ? error.message : String(error) }
        );
      });
  }

  return {
    ok: true,
    apiKey: { id: row.id, name: row.name, prefix: row.prefix },
    user: row.user,
  };
}
