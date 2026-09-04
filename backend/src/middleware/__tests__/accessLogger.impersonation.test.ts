/**
 * Who access.log names when an admin is acting as someone else.
 *
 * This is the one log the project keeps "for IT security requirements", and
 * during impersonation `req.user` is deliberately the TARGET — that is what
 * makes every ownership check downstream work. So without an explicit rule
 * here, every request an admin makes on a user's behalf is written into the
 * security log under the USER's name, which is the exact opposite of what the
 * log is for.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import { accessLogger, testExports } from '../accessLogger';
import type { AuthRequest } from '../../types/auth';

vi.mock('fs');
vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const TARGET = {
  id: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
  isAdmin: false,
};

const IMPERSONATOR = {
  id: 'admin-1',
  email: 'admin@admin.com',
  sessionId: 'sess-1',
};

describe('access.log attribution during impersonation', () => {
  let finish: (() => void) | null;
  let req: Partial<AuthRequest>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    finish = null;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.appendFileSync).mockReturnValue(undefined);
    // The middleware de-duplicates identical entries within a 5 s window;
    // give every test its own URL so nothing is swallowed.
    const url = `/api/test/${Math.random()}`;
    req = {
      originalUrl: url,
      url,
      method: 'GET',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'test-agent' },
      get: vi.fn(() => 'test-agent') as unknown as Request['get'],
    };
    res = {
      statusCode: 200,
      on: vi.fn((event: string, cb: () => void) => {
        if (event === 'finish') {
          finish = cb;
        }
        return res as Response;
      }),
    };
    next = vi.fn();
  });

  const written = (): string =>
    (vi.mocked(fs.appendFileSync).mock.calls[0]?.[1] as string) ?? '';

  it('names the REAL actor, not the account being acted on', () => {
    req.user = TARGET;
    req.impersonator = IMPERSONATOR;

    accessLogger(req as AuthRequest, res as Response, next);
    finish?.();

    const line = written();
    expect(line).toContain('admin@admin.com(as:user@example.com)');
  });

  it('keeps the composed name whitespace-free, so the log format is unchanged', () => {
    // The format is space-separated: `[ts] IP USERNAME METHOD URL ...`, so a
    // username with a space in it would silently shift every later column.
    const name = testExports.getUsername({
      user: TARGET,
      impersonator: IMPERSONATOR,
    } as AuthRequest);

    expect(name).not.toMatch(/\s/);
  });

  it('is greppable by the impersonated account', () => {
    // "everything anyone did on this account" has to stay one grep.
    const name = testExports.getUsername({
      user: TARGET,
      impersonator: IMPERSONATOR,
    } as AuthRequest);

    expect(name).toContain('as:user@example.com');
  });

  it('is unchanged for an ordinary authenticated request', () => {
    req.user = TARGET;

    accessLogger(req as AuthRequest, res as Response, next);
    finish?.();

    const line = written();
    expect(line).toContain('user@example.com');
    expect(line).not.toContain('(as:');
  });

  it('stays anonymous when there is no user at all', () => {
    accessLogger(req as AuthRequest, res as Response, next);
    finish?.();
    expect(written()).toContain('anonymous');
  });

  it('falls back to anonymous rather than naming the admin alone', () => {
    // A half-populated request (impersonator resolved, user not) must not
    // produce a line claiming the admin acted on their own account.
    const name = testExports.getUsername({
      impersonator: IMPERSONATOR,
    } as AuthRequest);

    expect(name).toBe('anonymous');
  });
});
