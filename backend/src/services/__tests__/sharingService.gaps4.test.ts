/**
 * sharingService.gaps4.test.ts
 *
 * Covers branches still uncovered after sharingService.test.ts:
 *
 *  A. validateShareToken
 *     - returns null when no share found
 *     - returns null and sets status=expired when tokenExpiry is in the past
 *     - returns the share when token is valid and not expired
 *     - returns null (and logs error) when prisma throws
 *
 *  B. acceptShareInvitation
 *     - sets status=expired and throws when tokenExpiry is in the past
 *     - returns existing accepted share when user already has access
 *     - throws "different email address" when email share does not match userId
 *     - creates accepted share when email share matches userId's email
 *
 *  C. getSharedProjects
 *     - returns empty list when user not found in DB
 *     - returns accepted shares for the user (sharedWithId)
 *     - propagates DB error
 *
 *  D. revokeShare — recipient path
 *     - marks share as revoked when user is the recipient (sharedWithId)
 *
 *  E. hasProjectAccess — exception path
 *     - returns { hasAccess: false, isOwner: false } when prisma throws
 *
 *  F. shareProjectByLink — with expiryHours
 *     - sets tokenExpiry when expiryHours is provided
 *
 * All DB interactions are mocked via prismaMock.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    project: {
      findFirst: vi.fn() as ReturnType<typeof vi.fn>,
    },
    projectShare: {
      findFirst: vi.fn() as ReturnType<typeof vi.fn>,
      findMany: vi.fn() as ReturnType<typeof vi.fn>,
      create: vi.fn() as ReturnType<typeof vi.fn>,
      update: vi.fn() as ReturnType<typeof vi.fn>,
      delete: vi.fn() as ReturnType<typeof vi.fn>,
    },
    user: {
      findUnique: vi.fn() as ReturnType<typeof vi.fn>,
    },
  },
}));

vi.mock('../../db', () => ({ prisma: prismaMock }));
vi.mock('../../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));
vi.mock('../../services/emailService', () => ({
  sendEmail: vi.fn(() => Promise.resolve()),
}));
vi.mock('uuid', () => ({ v4: vi.fn(() => 'mock-uuid-share') }));
vi.mock('../../templates/shareInvitationEmailSimple', () => ({
  generateShareInvitationSimpleHTML: vi.fn(() => '<html>invite</html>'),
  generateShareInvitationSimpleText: vi.fn(() => 'invite text'),
  getShareInvitationSimpleSubject: vi.fn(() => 'You have been invited'),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as sharingService from '../sharingService';
import { logger } from '../../utils/logger';

// ─── A. validateShareToken ────────────────────────────────────────────────────

describe('validateShareToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when no share found', async () => {
    prismaMock.projectShare.findFirst.mockResolvedValueOnce(null);
    const result = await sharingService.validateShareToken('bad-token');
    expect(result).toBeNull();
  });

  it('returns null and updates status to expired when tokenExpiry is in the past', async () => {
    const expiredShare = {
      id: 'share-exp',
      shareToken: 'expired-tok',
      status: 'pending',
      tokenExpiry: new Date(Date.now() - 1000), // 1 s ago
      project: { user: { id: 'u', email: 'u@t.com' } },
      sharedBy: { id: 'u' },
    };
    prismaMock.projectShare.findFirst.mockResolvedValueOnce(expiredShare);
    prismaMock.projectShare.update.mockResolvedValueOnce({
      ...expiredShare,
      status: 'expired',
    });

    const result = await sharingService.validateShareToken('expired-tok');
    expect(result).toBeNull();
    expect(prismaMock.projectShare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'share-exp' },
        data: { status: 'expired' },
      })
    );
  });

  it('returns the share when token is valid and not expired', async () => {
    const validShare = {
      id: 'share-ok',
      shareToken: 'valid-tok',
      status: 'pending',
      tokenExpiry: new Date(Date.now() + 86400000), // 24 h in future
      project: { user: { id: 'u', email: 'u@t.com' } },
      sharedBy: { id: 'u' },
    };
    prismaMock.projectShare.findFirst.mockResolvedValueOnce(validShare);

    const result = await sharingService.validateShareToken('valid-tok');
    expect(result).toEqual(validShare);
  });

  it('returns null and logs error when prisma throws', async () => {
    prismaMock.projectShare.findFirst.mockRejectedValueOnce(
      new Error('DB error')
    );

    const result = await sharingService.validateShareToken('crash-tok');
    expect(result).toBeNull();
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });
});

// ─── B. acceptShareInvitation — additional branches ───────────────────────────

describe('acceptShareInvitation — additional branches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets status=expired and throws when tokenExpiry is in the past', async () => {
    const expiredShare = {
      id: 'sh-exp2',
      projectId: 'p-1',
      shareToken: 'exp-tok2',
      status: 'pending',
      email: null,
      tokenExpiry: new Date(Date.now() - 1),
      project: { id: 'p-1', user: { id: 'owner', email: 'o@t.com' } },
      sharedBy: { id: 'owner' },
    };
    prismaMock.projectShare.findFirst.mockResolvedValueOnce(expiredShare);
    prismaMock.projectShare.update.mockResolvedValueOnce({
      ...expiredShare,
      status: 'expired',
    });

    await expect(
      sharingService.acceptShareInvitation('exp-tok2', 'user-1')
    ).rejects.toThrow('Share link has expired');
  });

  it('returns existing accepted share when user already has access (second findFirst)', async () => {
    const pendingShare = {
      id: 'sh-dup',
      projectId: 'p-1',
      shareToken: 'dup-tok',
      status: 'pending',
      email: null,
      tokenExpiry: null,
      project: { id: 'p-1', user: { id: 'owner', email: 'o@t.com' } },
      sharedBy: { id: 'owner' },
    };
    const existingAccepted = {
      ...pendingShare,
      id: 'sh-already-accepted',
      status: 'accepted',
      sharedWithId: 'user-dup',
      sharedBy: { id: 'owner' },
      sharedWith: { id: 'user-dup' },
    };

    prismaMock.projectShare.findFirst
      .mockResolvedValueOnce(pendingShare) // token lookup
      .mockResolvedValueOnce(existingAccepted); // existing accepted share check

    const result = await sharingService.acceptShareInvitation(
      'dup-tok',
      'user-dup'
    );
    expect(result.needsLogin).toBe(false);
    expect((result.share as { id: string }).id).toBe('sh-already-accepted');
    // No update should have been called
    expect(prismaMock.projectShare.update).not.toHaveBeenCalled();
  });

  it('throws "different email address" when email-bound share does not match requesting user email', async () => {
    const emailShare = {
      id: 'sh-email',
      projectId: 'p-1',
      shareToken: 'email-tok',
      status: 'pending',
      email: 'invited@test.com',
      tokenExpiry: null,
      project: { id: 'p-1', user: { id: 'owner', email: 'o@t.com' } },
      sharedBy: { id: 'owner' },
    };

    prismaMock.projectShare.findFirst
      .mockResolvedValueOnce(emailShare) // token lookup
      .mockResolvedValueOnce(null); // no existing accepted share for this user

    // The requesting user's email is different from the invite
    // (user.findUnique is called to look up the invite target user by email)
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'invited-user',
      email: 'invited@test.com',
    });
    // 'other-user' !== 'invited-user' → throws

    await expect(
      sharingService.acceptShareInvitation('email-tok', 'other-user')
    ).rejects.toThrow('different email address');
  });

  it('accepts the share when email matches the requesting user', async () => {
    const emailShare = {
      id: 'sh-match',
      projectId: 'p-1',
      shareToken: 'match-tok',
      status: 'pending',
      email: 'match@test.com',
      tokenExpiry: null,
      project: { id: 'p-1', user: { id: 'owner', email: 'o@t.com' } },
      sharedBy: { id: 'owner' },
    };
    const accepted = {
      ...emailShare,
      status: 'accepted',
      sharedWithId: 'user-match',
      sharedBy: { id: 'owner' },
      sharedWith: { id: 'user-match' },
    };

    prismaMock.projectShare.findFirst
      .mockResolvedValueOnce(emailShare) // token lookup
      .mockResolvedValueOnce(null); // no existing accepted share

    // User's email matches the invite
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'user-match',
      email: 'match@test.com',
    });
    prismaMock.projectShare.update.mockResolvedValueOnce(accepted);

    const result = await sharingService.acceptShareInvitation(
      'match-tok',
      'user-match'
    );
    expect(result.needsLogin).toBe(false);
    expect(prismaMock.projectShare.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sh-match' },
        data: { status: 'accepted', sharedWithId: 'user-match' },
      })
    );
  });
});

// ─── C. getSharedProjects ─────────────────────────────────────────────────────

describe('getSharedProjects', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty list when user not found in DB', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.projectShare.findMany.mockResolvedValueOnce([]);

    // getSharedProjects should still succeed — user is only used for debug log
    const result = await sharingService.getSharedProjects('ghost-user');
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns accepted shares for the user', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u-1',
      email: 'u@t.com',
    });
    const share = {
      id: 'share-gsp',
      projectId: 'p-gsp',
      status: 'accepted',
      sharedWithId: 'u-1',
      project: {
        id: 'p-gsp',
        title: 'GSP',
        _count: { images: 5 },
        images: [],
        user: { id: 'owner', email: 'o@t.com' },
      },
      sharedBy: { id: 'owner', email: 'o@t.com' },
      sharedWith: { id: 'u-1', email: 'u@t.com' },
    };
    prismaMock.projectShare.findMany.mockResolvedValueOnce([share]);

    const result = await sharingService.getSharedProjects('u-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('share-gsp');
  });

  it('propagates DB error', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u-err',
      email: 'err@t.com',
    });
    prismaMock.projectShare.findMany.mockRejectedValueOnce(
      new Error('DB gone')
    );

    await expect(sharingService.getSharedProjects('u-err')).rejects.toThrow(
      'DB gone'
    );
  });
});

// ─── D. revokeShare — recipient path ─────────────────────────────────────────

describe('revokeShare — recipient self-removal path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks share as revoked when caller is the share recipient', async () => {
    const recipientShare = {
      id: 'sh-rcpt',
      sharedWithId: 'user-rcpt',
      status: 'accepted',
    };
    prismaMock.projectShare.findFirst.mockResolvedValueOnce(recipientShare);
    prismaMock.projectShare.update.mockResolvedValueOnce({
      ...recipientShare,
      status: 'revoked',
    });

    await sharingService.revokeShare('sh-rcpt', 'user-rcpt');

    expect(prismaMock.projectShare.update).toHaveBeenCalledWith({
      where: { id: 'sh-rcpt' },
      data: { status: 'revoked' },
    });
  });
});

// ─── E. hasProjectAccess — exception path ─────────────────────────────────────

describe('hasProjectAccess — exception path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns { hasAccess: false, isOwner: false } when prisma.project.findFirst throws', async () => {
    prismaMock.project.findFirst.mockRejectedValueOnce(new Error('DB error'));

    const result = await sharingService.hasProjectAccess('p-1', 'u-1');
    expect(result).toEqual({ hasAccess: false, isOwner: false });
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
  });
});

// ─── F. shareProjectByLink — with expiryHours ─────────────────────────────────

describe('shareProjectByLink — with expiryHours', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets tokenExpiry when expiryHours is provided', async () => {
    const mockProject = { id: 'p-exp', userId: 'owner', title: 'T' };
    const mockShare = {
      id: 'sh-expiry',
      projectId: 'p-exp',
      sharedById: 'owner',
      shareToken: 'mock-uuid-share',
      tokenExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'pending',
    };

    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    prismaMock.projectShare.create.mockResolvedValueOnce(mockShare);

    const result = await sharingService.shareProjectByLink('p-exp', 'owner', {
      expiryHours: 24,
    });

    expect(result).toEqual(mockShare);
    const createCall = prismaMock.projectShare.create.mock.calls[0][0];
    expect(createCall.data.tokenExpiry).toBeInstanceOf(Date);
    // tokenExpiry should be ~24h from now
    const diff = createCall.data.tokenExpiry.getTime() - Date.now();
    expect(diff).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(25 * 60 * 60 * 1000);
  });

  it('sets tokenExpiry to null when expiryHours is not provided', async () => {
    const mockProject = { id: 'p-noexp', userId: 'owner', title: 'T' };
    const mockShare = {
      id: 'sh-noexpiry',
      projectId: 'p-noexp',
      sharedById: 'owner',
      shareToken: 'mock-uuid-share',
      tokenExpiry: null,
      status: 'pending',
    };

    prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
    prismaMock.projectShare.create.mockResolvedValueOnce(mockShare);

    await sharingService.shareProjectByLink('p-noexp', 'owner', {});

    const createCall = prismaMock.projectShare.create.mock.calls[0][0];
    expect(createCall.data.tokenExpiry).toBeNull();
  });
});
