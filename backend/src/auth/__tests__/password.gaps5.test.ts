/**
 * password.gaps5.test.ts
 *
 * Full coverage of auth/password.ts — previously nearly 0% covered:
 *
 *  - hashPassword: success, bcrypt error
 *  - verifyPassword: success (match/no match), bcrypt error
 *  - generateSecureToken: returns hex string of correct length
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// We need bcryptjs to work for most tests, but mock it for error-path tests
const { mockBcryptHash, mockBcryptCompare } = vi.hoisted(() => ({
  mockBcryptHash: vi.fn(),
  mockBcryptCompare: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    hash: mockBcryptHash,
    compare: mockBcryptCompare,
  },
  hash: mockBcryptHash,
  compare: mockBcryptCompare,
}));

import {
  hashPassword,
  verifyPassword,
  generateSecureToken,
} from '../password';

beforeEach(() => {
  vi.clearAllMocks();
  mockBcryptHash.mockResolvedValue('$2b$12$hashedpassword');
  mockBcryptCompare.mockResolvedValue(true);
});

// ─── hashPassword ─────────────────────────────────────────────────────────────

describe('hashPassword', () => {
  it('returns hashed string on success', async () => {
    const result = await hashPassword('myPassword123');
    expect(result).toBe('$2b$12$hashedpassword');
    expect(mockBcryptHash).toHaveBeenCalledWith('myPassword123', 12);
  });

  it('throws "Password hashing failed" when bcrypt throws', async () => {
    mockBcryptHash.mockRejectedValueOnce(new Error('bcrypt error'));

    await expect(hashPassword('myPassword')).rejects.toThrow(
      'Password hashing failed'
    );
  });
});

// ─── verifyPassword ───────────────────────────────────────────────────────────

describe('verifyPassword', () => {
  it('returns true when password matches hash', async () => {
    mockBcryptCompare.mockResolvedValueOnce(true);
    const result = await verifyPassword('password', '$2b$hash');
    expect(result).toBe(true);
  });

  it('returns false when password does not match hash', async () => {
    mockBcryptCompare.mockResolvedValueOnce(false);
    const result = await verifyPassword('wrong', '$2b$hash');
    expect(result).toBe(false);
  });

  it('throws "Password verification failed" when bcrypt throws', async () => {
    mockBcryptCompare.mockRejectedValueOnce(new Error('bcrypt error'));

    await expect(verifyPassword('password', '$2b$hash')).rejects.toThrow(
      'Password verification failed'
    );
  });
});

// ─── generateSecureToken ──────────────────────────────────────────────────────

describe('generateSecureToken', () => {
  it('returns a 64-char hex string', () => {
    const token = generateSecureToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens on each call', () => {
    const t1 = generateSecureToken();
    const t2 = generateSecureToken();
    expect(t1).not.toBe(t2);
  });
});
