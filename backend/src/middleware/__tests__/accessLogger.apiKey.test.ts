/**
 * Who access.log names for a request made with an API key: the account, plus
 * WHICH key — the part someone needs when deciding what to revoke.
 */

import { describe, it, expect, vi } from 'vitest';
import { testExports } from '../accessLogger';
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
