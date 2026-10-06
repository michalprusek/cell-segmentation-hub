/**
 * Refresh-token rotation, end to end against an in-memory Redis.
 *
 * `sessionService.test.ts` checks the calls the service makes. This suite
 * checks what is TRUE afterwards - which token works, which does not, how
 * many live records a session has - because every property rotation exists
 * for is a property of the store's state, and a mock that returns what the
 * test told it to cannot contradict the code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

const { store, failNextSetEx } = vi.hoisted(() => ({
  store: new Map<string, { value: string; ttl: number }>(),
  failNextSetEx: { keys: new Set<string>() },
}));

/** The subset of node-redis the service uses, over a Map. */
const fakeRedis = {
  get: async (key: string) => store.get(key)?.value ?? null,
  setEx: async (key: string, ttl: number, value: string) => {
    if (failNextSetEx.keys.delete(key)) {
      throw new Error('simulated Redis write failure');
    }
    store.set(key, { value, ttl });
    return 'OK';
  },
  del: async (key: string) => (store.delete(key) ? 1 : 0),
};

vi.mock('../../config/redis', () => ({
  executeRedisCommand: async (
    command: (client: typeof fakeRedis) => Promise<unknown>,
    fallback?: unknown
  ) => {
    try {
      return await command(fakeRedis);
    } catch {
      // Same contract as the real wrapper: a failed command is the fallback.
      return fallback;
    }
  },
}));

vi.mock('../../utils/config', () => ({
  config: { JWT_REFRESH_SECRET: 'rotation-test-secret-0123456789abcdef' },
}));

vi.mock('../../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../middleware/error', () => ({
  ApiError: {
    serviceUnavailable: (message: string) =>
      Object.assign(new Error(message), { statusCode: 503 }),
  },
}));

import { sessionService } from '../sessionService';

const USER = 'user-1';
const sha = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');
const recordKey = (token: string) => `refresh:${sha(token)}`;

/** Keys that are live refresh records - not tombstones, not pointers. */
const liveRecordKeys = () =>
  [...store.keys()].filter(
    key => key.startsWith('refresh:') && !key.startsWith('refresh-')
  );

const isLive = async (token: string) =>
  (await sessionService.verifyRefreshToken(token)) !== null;

beforeEach(() => {
  store.clear();
  failNextSetEx.keys.clear();
  // Only the clock: the service waits on real timers for a concurrent
  // rotation to finish, and those must actually elapse.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('rotation consumes the presented token', () => {
  it('issues a different token and leaves exactly one live record', async () => {
    await sessionService.storeRefreshToken(USER, 'first');

    const rotated = await sessionService.rotateRefreshToken('first');

    expect(rotated?.userId).toBe(USER);
    expect(rotated?.token).not.toBe('first');
    expect(await isLive('first')).toBe(false);
    expect(await isLive(rotated!.token)).toBe(true);
    expect(liveRecordKeys()).toEqual([recordKey(rotated!.token)]);
  });

  it('answers null for a token it has never seen, and revokes nothing', async () => {
    await sessionService.storeRefreshToken(USER, 'mine');

    expect(await sessionService.rotateRefreshToken('never-issued')).toBeNull();
    expect(await isLive('mine')).toBe(true);
  });

  it('reports when the PRESENTED record was written, for the session cut-off', async () => {
    await sessionService.storeRefreshToken(USER, 'first');
    vi.advanceTimersByTime(60_000);

    const rotated = await sessionService.rotateRefreshToken('first');

    // The presented record's time, not the successor's (a minute later).
    expect(rotated?.presentedCreatedAt).toBe('2026-10-07T12:00:00.000Z');
  });
});

describe('two requests with the same token', () => {
  it('at the same instant agree on ONE successor - the session does not fork', async () => {
    await sessionService.storeRefreshToken(USER, 'shared');

    const [a, b] = await Promise.all([
      sessionService.rotateRefreshToken('shared'),
      sessionService.rotateRefreshToken('shared'),
    ]);

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.token).toBe(b!.token);
    // Read-then-delete rotation minted two successors here: two live
    // records, one of them in no cookie jar and good for 30 days.
    expect(liveRecordKeys()).toHaveLength(1);
  });

  it('seconds apart, within the grace period, the second gets the same successor', async () => {
    await sessionService.storeRefreshToken(USER, 'shared');
    const first = await sessionService.rotateRefreshToken('shared');

    vi.advanceTimersByTime(29_000);
    const second = await sessionService.rotateRefreshToken('shared');

    expect(second?.token).toBe(first!.token);
    expect(second?.userId).toBe(USER);
    expect(second?.presentedCreatedAt).toBe(first!.presentedCreatedAt);
    expect(liveRecordKeys()).toHaveLength(1);
  });

  it('after the grace period it is REUSE: refused, and the session is revoked', async () => {
    await sessionService.storeRefreshToken(USER, 'copied');
    const legit = await sessionService.rotateRefreshToken('copied');
    expect(await isLive(legit!.token)).toBe(true);

    vi.advanceTimersByTime(31_000);
    const replay = await sessionService.rotateRefreshToken('copied');

    expect(replay).toBeNull();
    // Whoever holds the successor loses it too: one of the two holders of
    // 'copied' is not the user, and the server cannot tell which.
    expect(await isLive(legit!.token)).toBe(false);
    expect(liveRecordKeys()).toEqual([]);
  });

  it('revokes only the reused session, not the user’s other sessions', async () => {
    await sessionService.storeRefreshToken(USER, 'laptop');
    await sessionService.storeRefreshToken(USER, 'phone');
    await sessionService.rotateRefreshToken('laptop');

    vi.advanceTimersByTime(31_000);
    await sessionService.rotateRefreshToken('laptop');

    expect(await isLive('phone')).toBe(true);
  });

  it('within the grace period, does not hand out a successor that has itself moved on', async () => {
    await sessionService.storeRefreshToken(USER, 'gen0');
    const gen1 = await sessionService.rotateRefreshToken('gen0');
    const gen2 = await sessionService.rotateRefreshToken(gen1!.token);

    const late = await sessionService.rotateRefreshToken('gen0');

    // gen1 is no longer the live token, so replaying gen0 yields nothing -
    // and, being inside the grace period, costs the session nothing either.
    expect(late).toBeNull();
    expect(await isLive(gen2!.token)).toBe(true);
  });
});

describe('reuse detection lasts as long as the session can', () => {
  it('still catches a copy replayed on day two of a 30-day session', async () => {
    await sessionService.storeRefreshToken(USER, 'copied');
    const legit = await sessionService.rotateRefreshToken('copied');

    // A used token was remembered for 24 h at first. On day two a replay
    // was merely "unknown", while the session it was copied from lived on.
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    expect(await sessionService.rotateRefreshToken('copied')).toBeNull();

    expect(await isLive(legit!.token)).toBe(false);
  });

  it.each([
    ['a remembered session', { rememberMe: true }, 30 * 24 * 60 * 60],
    ['a short session', { rememberMe: false }, 7 * 24 * 60 * 60],
    [
      'an impersonated session',
      {
        impersonation: {
          impersonatorId: 'admin-1',
          impersonationSessionId: 's-1',
        },
      },
      24 * 60 * 60,
    ],
  ])('remembers the used token of %s for that session’s lifetime', async (_n, options, ttl) => {
    await sessionService.storeRefreshToken(USER, 'tok', options);
    await sessionService.rotateRefreshToken('tok');

    expect(store.get(`refresh-used:${recordKey('tok')}`)?.ttl).toBe(ttl);
  });
});

describe('a revoked session stays revoked', () => {
  const reuse = async (token: string) => {
    await sessionService.rotateRefreshToken(token);
    vi.advanceTimersByTime(31_000);
    await sessionService.rotateRefreshToken(token);
  };

  it('whatever order its records were written in', async () => {
    // The race a "pointer to the family's current token" loses: a delayed
    // A->B rotation finishes AFTER B->C, the pointer ends on B (deleted), and
    // revoking through it leaves C alive. Here C is written after the
    // revocation - the worst ordering there is - and is dead all the same.
    await sessionService.storeRefreshToken(USER, 'A', { family: 'fam' });
    await reuse('A');

    await sessionService.storeRefreshToken(USER, 'C', { family: 'fam' });
    await sessionService.storeRefreshToken(USER, 'D', { family: 'fam' });

    expect(await isLive('C')).toBe(false);
    // 'D' goes straight to a rotation, with no verification before it to
    // have cleared the record away: the rotation must refuse by itself, and
    // must not leave a successor behind.
    const before = liveRecordKeys().length;
    expect(await sessionService.rotateRefreshToken('D')).toBeNull();
    // D's own record is gone and nothing was written in its place. (Other
    // records of the dead family may still sit in the store until something
    // asks for them; the flag is what makes them void.)
    expect(store.has(recordKey('D'))).toBe(false);
    expect(liveRecordKeys()).toHaveLength(before - 1);
  });

  it('and does not take the user’s other sessions with it', async () => {
    await sessionService.storeRefreshToken(USER, 'A', { family: 'fam' });
    await sessionService.storeRefreshToken(USER, 'other', { family: 'fam-2' });
    await reuse('A');

    expect(await isLive('other')).toBe(true);
    expect((await sessionService.rotateRefreshToken('other'))?.userId).toBe(
      USER
    );
  });
});

describe('what a rotation carries over', () => {
  it('keeps the session in its family, with its lifetime', async () => {
    await sessionService.storeRefreshToken(USER, 'short', {
      rememberMe: false,
    });
    const family = JSON.parse(store.get(recordKey('short'))!.value).family;

    const rotated = await sessionService.rotateRefreshToken('short');

    const successor = store.get(recordKey(rotated!.token))!;
    expect(JSON.parse(successor.value).family).toBe(family);
    expect(rotated?.rememberMe).toBe(false);
    expect(successor.ttl).toBe(7 * 24 * 60 * 60);
  });

  it('carries an impersonation through the grace-period path too', async () => {
    await sessionService.storeRefreshToken(USER, 'imp', {
      impersonation: {
        impersonatorId: 'admin-1',
        impersonationSessionId: 'session-9',
      },
    });
    await sessionService.rotateRefreshToken('imp');

    const second = await sessionService.rotateRefreshToken('imp');

    // Dropping these on the replay would hand the admin a token whose
    // refresh then lands them in the target's account with no way back.
    expect(second).toMatchObject({
      impersonatorId: 'admin-1',
      impersonationSessionId: 'session-9',
    });
  });
});

describe('what Redis holds', () => {
  it('never contains a refresh token, in a key or in a value', async () => {
    await sessionService.storeRefreshToken(USER, 'plain-old-token');
    const rotated = await sessionService.rotateRefreshToken('plain-old-token');
    const again = await sessionService.rotateRefreshToken('plain-old-token');
    expect(again?.token).toBe(rotated!.token);

    const everything = [...store.entries()]
      .map(([key, entry]) => `${key} ${entry.value}`)
      .join('\n');
    expect(everything).not.toContain('plain-old-token');
    expect(everything).not.toContain(rotated!.token);
    // The grace period works without it: the successor is re-derived.
    expect(store.has(`refresh-used:${recordKey('plain-old-token')}`)).toBe(
      true
    );
  });
});

describe('a Redis failure in the middle of a rotation', () => {
  it('leaves the old record in place, so the user is not signed out and can retry', async () => {
    await sessionService.storeRefreshToken(USER, 'fragile');
    const before = store.get(recordKey('fragile'))!.value;
    const successor = crypto
      .createHmac('sha256', 'rotation-test-secret-0123456789abcdef')
      .update('rotate:fragile')
      .digest('hex');
    failNextSetEx.keys.add(recordKey(successor));

    const rotated = await sessionService.rotateRefreshToken('fragile');

    expect(rotated).toBeNull();
    expect(store.get(recordKey('fragile'))?.value).toBe(before);
    expect(await isLive('fragile')).toBe(true);

    // And the next attempt, with Redis back, succeeds normally.
    const retry = await sessionService.rotateRefreshToken('fragile');
    expect(retry?.token).toBe(successor);
  });
});
