import crypto from 'crypto';
import { config } from '../../utils/config';

/**
 * Short-lived, HMAC-signed download tokens for export ZIP downloads.
 *
 * These tokens let the browser fetch a (potentially huge) export file
 * directly via a native <a href> click, bypassing the axios JSON client
 * entirely. That avoids:
 *   - loading the whole ZIP into a browser Blob (memory blowup),
 *   - the 5-minute axios timeout,
 *   - the JWT auth interceptor force-logging the user out on download
 *     errors.
 *
 * The token is bound to (jobId, projectId, userId) and a short expiry
 * (10 minutes by default), and is signed with HMAC-SHA256 using the
 * existing JWT_ACCESS_SECRET. A purpose-string prefix in the signing
 * input keeps these signatures cryptographically distinct from JWTs.
 */

const PURPOSE = 'export-download';
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface DownloadTokenPayload {
  jobId: string;
  projectId: string;
  userId: string;
  expiresAt: number; // unix epoch ms
}

export interface IssuedDownloadToken {
  token: string;
  expiresAt: number;
}

export class InvalidDownloadTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDownloadTokenError';
  }
}

const base64url = (buf: Buffer): string =>
  buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64url = (s: string): Buffer => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
};

const sign = (payloadB64: string): string => {
  const h = crypto.createHmac('sha256', config.JWT_ACCESS_SECRET);
  h.update(`${PURPOSE}.${payloadB64}`);
  return base64url(h.digest());
};

export const issueDownloadToken = (
  jobId: string,
  projectId: string,
  userId: string,
  ttlMs: number = DEFAULT_TTL_MS
): IssuedDownloadToken => {
  if (!jobId || !projectId || !userId) {
    throw new Error('jobId, projectId, and userId are required');
  }
  const expiresAt = Date.now() + ttlMs;
  const payload: DownloadTokenPayload = {
    jobId,
    projectId,
    userId,
    expiresAt,
  };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = sign(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt };
};

export const verifyDownloadToken = (token: string): DownloadTokenPayload => {
  if (!token || typeof token !== 'string') {
    throw new InvalidDownloadTokenError('missing token');
  }
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new InvalidDownloadTokenError('malformed token');
  }
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) {
    throw new InvalidDownloadTokenError('malformed token');
  }

  const expectedSig = sign(payloadB64);
  const a = Buffer.from(sigB64, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new InvalidDownloadTokenError('bad signature');
  }

  let payload: DownloadTokenPayload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString('utf8'));
  } catch {
    throw new InvalidDownloadTokenError('malformed payload');
  }

  if (
    !payload ||
    typeof payload.jobId !== 'string' ||
    typeof payload.projectId !== 'string' ||
    typeof payload.userId !== 'string' ||
    typeof payload.expiresAt !== 'number'
  ) {
    throw new InvalidDownloadTokenError('invalid payload shape');
  }

  if (payload.expiresAt < Date.now()) {
    throw new InvalidDownloadTokenError('token expired');
  }

  return payload;
};
