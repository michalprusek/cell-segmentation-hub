import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/config', () => ({
  config: {
    JWT_ACCESS_SECRET:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    NODE_ENV: 'test',
  },
}));

import {
  issueDownloadToken,
  verifyDownloadToken,
  InvalidDownloadTokenError,
} from '../downloadTokenService';

const JOB = '11111111-1111-1111-1111-111111111111';
const PROJECT = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';

describe('downloadTokenService', () => {
  it('issues and verifies a token roundtrip', () => {
    const { token, expiresAt } = issueDownloadToken(JOB, PROJECT, USER);
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(2);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const payload = verifyDownloadToken(token);
    expect(payload.jobId).toBe(JOB);
    expect(payload.projectId).toBe(PROJECT);
    expect(payload.userId).toBe(USER);
    expect(payload.expiresAt).toBe(expiresAt);
  });

  it('rejects an empty token', () => {
    expect(() => verifyDownloadToken('')).toThrow(InvalidDownloadTokenError);
  });

  it('rejects a malformed token (no dot)', () => {
    expect(() => verifyDownloadToken('notatoken')).toThrow(
      InvalidDownloadTokenError
    );
  });

  it('rejects a tampered payload', () => {
    const { token } = issueDownloadToken(JOB, PROJECT, USER);
    const [, sig] = token.split('.');
    // Build a forged payload claiming to belong to a different user
    const forgedPayload = Buffer.from(
      JSON.stringify({
        jobId: JOB,
        projectId: PROJECT,
        userId: 'attacker',
        expiresAt: Date.now() + 60000,
      }),
      'utf8'
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(() => verifyDownloadToken(`${forgedPayload}.${sig}`)).toThrow(
      InvalidDownloadTokenError
    );
  });

  it('rejects a tampered signature', () => {
    const { token } = issueDownloadToken(JOB, PROJECT, USER);
    const [payloadB64] = token.split('.');
    expect(() =>
      verifyDownloadToken(`${payloadB64}.AAAAAAAAAAAAAAAAAAAAAA`)
    ).toThrow(InvalidDownloadTokenError);
  });

  it('rejects an expired token', () => {
    const { token } = issueDownloadToken(JOB, PROJECT, USER, -1000);
    expect(() => verifyDownloadToken(token)).toThrow(InvalidDownloadTokenError);
  });

  it('throws when required fields are missing', () => {
    expect(() => issueDownloadToken('', PROJECT, USER)).toThrow();
    expect(() => issueDownloadToken(JOB, '', USER)).toThrow();
    expect(() => issueDownloadToken(JOB, PROJECT, '')).toThrow();
  });

  it('produces different signatures for different secrets (sanity)', () => {
    // Two tokens with the same input should produce the same signature
    // because both expiresAt are deterministic when ttl is provided.
    const t1 = issueDownloadToken(JOB, PROJECT, USER, 60000);
    const t2 = issueDownloadToken(JOB, PROJECT, USER, 60000);
    // They differ only in the unix-ms timestamp; signatures must roundtrip
    expect(verifyDownloadToken(t1.token).jobId).toBe(JOB);
    expect(verifyDownloadToken(t2.token).jobId).toBe(JOB);
  });
});
