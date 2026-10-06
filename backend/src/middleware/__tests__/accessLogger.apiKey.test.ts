/**
 * Who access.log names for a request made with an API key: the account, plus
 * WHICH key — the part someone needs when deciding what to revoke.
 */

import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import { accessLogger, testExports } from '../accessLogger';
import type { AuthRequest } from '../../types/auth';

vi.mock('fs');
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const USER = {
  id: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
  isAdmin: false,
};

describe('access.log attribution for API-key requests', () => {
  it('names the account and the key prefix as one whitespace-free token', () => {
    const name = testExports.getUsername({
      user: USER,
      apiKey: { id: 'key-1', name: 'my pipeline', prefix: 'sseg_AbCd' },
    } as AuthRequest);

    expect(name).toBe('user@example.com(key:sseg_AbCd)');
    expect(name).not.toMatch(/\s/);
  });

  it('leaves a cookie-authenticated request as the bare e-mail', () => {
    expect(testExports.getUsername({ user: USER } as AuthRequest)).toBe(
      'user@example.com'
    );
  });
});

describe('access.log never records a credential sent in the URL', () => {
  it('redacts the value of a key in the query string', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined);
    const secret = `sseg_${'x'.repeat(49)}`;
    const url = `/api/v1/models?n=${Math.random()}&api_key=${secret}`;
    let finish: (() => void) | undefined;
    const req = {
      originalUrl: url,
      url,
      method: 'GET',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
      get: vi.fn(() => 'test-agent') as unknown as Request['get'],
    } as unknown as AuthRequest;
    const res = {
      statusCode: 400,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') finish = cb;
        return res;
      }),
    } as unknown as Response;

    accessLogger(req, res, vi.fn() as NextFunction);
    finish?.();

    const line = vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string;
    expect(line).toContain('/api/v1/models?');
    expect(line).toContain('api_key=REDACTED');
    expect(line).not.toContain(secret);
  });
});
