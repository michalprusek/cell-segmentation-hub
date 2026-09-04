/**
 * The impersonation audit log.
 *
 * Two properties matter and both are easy to lose in a later refactor: the
 * row must SURVIVE the deletion of either account (which is why both e-mails
 * are denormalised at write time), and a failure to write it must never break
 * the support operation it is describing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() as ReturnType<typeof vi.fn> },
    impersonationLog: { create: vi.fn() as ReturnType<typeof vi.fn> },
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { recordImpersonationEvent } from '../impersonationAuditService';
import { logger } from '../../utils/logger';

const dataOf = () => prismaMock.impersonationLog.create.mock.calls[0][0].data;

describe('recordImpersonationEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.impersonationLog.create.mockResolvedValue({});
    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id: string } }) =>
        ({
          'admin-1': { email: 'admin@admin.com' },
          'user-1': { email: 'user@example.com' },
        })[args.where.id] ?? null
    );
  });

  it('denormalises BOTH e-mails, so the row stays readable when either account is deleted', async () => {
    await recordImpersonationEvent({
      event: 'start',
      adminId: 'admin-1',
      targetId: 'user-1',
      sessionId: 'sess-1',
    });

    expect(dataOf()).toMatchObject({
      event: 'start',
      adminId: 'admin-1',
      adminEmail: 'admin@admin.com',
      targetId: 'user-1',
      targetEmail: 'user@example.com',
      sessionId: 'sess-1',
    });
  });

  it('still writes the row when an e-mail lookup fails — the row is worth more than the e-mail', async () => {
    prismaMock.user.findUnique.mockRejectedValue(new Error('db down'));

    await recordImpersonationEvent({
      event: 'stop',
      adminId: 'admin-1',
      targetId: 'user-1',
      sessionId: 'sess-2',
    });

    expect(prismaMock.impersonationLog.create).toHaveBeenCalled();
    expect(dataOf()).toMatchObject({
      adminEmail: null,
      targetEmail: null,
      adminId: 'admin-1',
    });
  });

  it('never throws when the write itself fails, and warns instead', async () => {
    prismaMock.impersonationLog.create.mockRejectedValue(
      new Error('constraint violation')
    );

    await expect(
      recordImpersonationEvent({
        event: 'start',
        adminId: 'admin-1',
        targetId: 'user-1',
        sessionId: 'sess-3',
      })
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('sess-3'),
      'ImpersonationAuditService'
    );
  });

  it('truncates the attacker-controlled header fields', async () => {
    await recordImpersonationEvent({
      event: 'denied',
      adminId: 'admin-1',
      targetId: null,
      sessionId: 'sess-4',
      ip: 'x'.repeat(500),
      userAgent: 'y'.repeat(1000),
    });

    expect(dataOf().ip).toHaveLength(100);
    expect(dataOf().userAgent).toHaveLength(300);
  });

  it('normalises absent origin fields to null rather than undefined', async () => {
    await recordImpersonationEvent({
      event: 'denied',
      adminId: null,
      targetId: null,
      sessionId: 'sess-5',
    });

    expect(dataOf()).toMatchObject({
      ip: null,
      userAgent: null,
      detail: null,
      adminEmail: null,
      targetEmail: null,
    });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});
