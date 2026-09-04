/**
 * `adminService.listUsers` — paging, clamping and the shape the page renders.
 *
 * The clamps are the interesting part: `limit` reaches this function from a
 * query string, so an unbounded one would let a single admin request pull the
 * whole user table in one round-trip.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/config', () => ({
  config: {
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-for-testing-only-32-characters-long',
    JWT_REFRESH_SECRET:
      'test-refresh-secret-for-testing-only-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_REFRESH_EXPIRY_REMEMBER: '30d',
  },
  isDevelopment: false,
  isProduction: false,
  isTest: true,
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findMany: vi.fn() as ReturnType<typeof vi.fn>,
      count: vi.fn() as ReturnType<typeof vi.fn>,
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
    },
    impersonationLog: { create: vi.fn() as ReturnType<typeof vi.fn> },
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../config/redis', () => ({
  executeRedisCommand: vi.fn(async () => true),
  getRedisClient: vi.fn(() => null),
}));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  listUsers,
  MAX_USER_PAGE_SIZE,
  DEFAULT_USER_PAGE_SIZE,
} from '../adminService';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'u1@example.com',
  emailVerified: true,
  isAdmin: false,
  createdAt: new Date('2026-03-04T05:06:07Z'),
  profile: { username: 'one' },
  _count: { projects: 2 },
  ...over,
});

const argsOf = () => prismaMock.user.findMany.mock.calls[0][0];

describe('listUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.findMany.mockResolvedValue([row()]);
  });

  it('flattens the profile and project count onto each row', async () => {
    const result = await listUsers({});
    expect(result.users[0]).toEqual({
      id: 'u1',
      email: 'u1@example.com',
      username: 'one',
      emailVerified: true,
      isAdmin: false,
      createdAt: '2026-03-04T05:06:07.000Z',
      projectCount: 2,
    });
  });

  it('tolerates a legacy account with no profile row', async () => {
    prismaMock.user.findMany.mockResolvedValue([row({ profile: null })]);
    const result = await listUsers({});
    expect(result.users[0].username).toBeNull();
  });

  it('defaults to page 1 at the default page size', async () => {
    await listUsers({});
    expect(argsOf()).toMatchObject({ skip: 0, take: DEFAULT_USER_PAGE_SIZE });
  });

  it('offsets by page', async () => {
    await listUsers({ page: 3, limit: 10 });
    expect(argsOf()).toMatchObject({ skip: 20, take: 10 });
  });

  it('clamps an oversized limit to the ceiling', async () => {
    await listUsers({ limit: 100000 });
    expect(argsOf().take).toBe(MAX_USER_PAGE_SIZE);
  });

  it('clamps nonsense paging rather than passing it to Prisma', async () => {
    // A negative `skip` throws in Prisma; a zero `take` returns nothing and
    // looks like an empty database.
    await listUsers({ page: -5, limit: 0 });
    expect(argsOf().skip).toBe(0);
    expect(argsOf().take).toBeGreaterThanOrEqual(1);
  });

  it('searches e-mail and username case-insensitively, and only when asked', async () => {
    await listUsers({ search: '  Novak ' });
    expect(argsOf().where).toEqual({
      OR: [
        { email: { contains: 'Novak', mode: 'insensitive' } },
        { profile: { username: { contains: 'Novak', mode: 'insensitive' } } },
      ],
    });

    prismaMock.user.findMany.mockClear();
    await listUsers({});
    expect(argsOf().where).toEqual({});
  });

  it('counts with the SAME filter it lists with', async () => {
    // Otherwise the pager reports the whole table's page count while showing
    // a filtered list.
    await listUsers({ search: 'abc' });
    expect(prismaMock.user.count.mock.calls[0][0].where).toEqual(
      argsOf().where
    );
  });

  it('reports at least one page even when nothing matches', async () => {
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockResolvedValue([]);
    const result = await listUsers({ search: 'zzz' });
    expect(result.totalPages).toBe(1);
    expect(result.users).toEqual([]);
  });

  it('computes totalPages from the total and the clamped limit', async () => {
    prismaMock.user.count.mockResolvedValue(101);
    const result = await listUsers({ limit: 10 });
    expect(result.totalPages).toBe(11);
  });

  it('lists newest first', async () => {
    await listUsers({});
    expect(argsOf().orderBy).toEqual({ createdAt: 'desc' });
  });

  it('never selects the password column', async () => {
    await listUsers({});
    expect(argsOf().select).not.toHaveProperty('password');
    expect(argsOf().select.email).toBe(true);
  });
});
