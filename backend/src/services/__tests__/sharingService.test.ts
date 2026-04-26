import { describe, it, expect, beforeEach, vi } from 'vitest';

// `vi.hoisted` so the mock factory below can reference these.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    project: {
      findFirst: vi.fn() as any,
    },
    projectShare: {
      findFirst: vi.fn() as any,
      findMany: vi.fn() as any,
      create: vi.fn() as any,
      update: vi.fn() as any,
      delete: vi.fn() as any,
    },
    user: {
      findUnique: vi.fn() as any,
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
vi.mock('uuid', () => ({ v4: vi.fn(() => 'mock-uuid-1234') }));
vi.mock('../../templates/shareInvitationEmailSimple', () => ({
  generateShareInvitationSimpleHTML: vi.fn(() => '<html>invite</html>'),
  generateShareInvitationSimpleText: vi.fn(() => 'invite text'),
  getShareInvitationSimpleSubject: vi.fn(() => 'Project shared with you'),
}));

import * as sharingService from '../sharingService';
import * as EmailService from '../../services/emailService';
import { v4 as uuidv4 } from 'uuid';

const mockSendEmail = EmailService.sendEmail as ReturnType<typeof vi.fn>;
const mockUuidV4 = uuidv4 as ReturnType<typeof vi.fn>;

describe('SharingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // resetMocks:true clears implementations — re-establish uuid mock
    mockUuidV4.mockReturnValue('mock-uuid-1234');
    mockSendEmail.mockResolvedValue(undefined);
  });

  describe('shareProjectByEmail', () => {
    it('creates share record and sends email', async () => {
      const mockProject = {
        id: 'project-1',
        userId: 'owner-1',
        title: 'Test Project',
        user: { id: 'owner-1', email: 'owner@example.com' },
      };
      const mockShare = {
        id: 'share-1',
        projectId: 'project-1',
        sharedById: 'owner-1',
        email: 'recipient@example.com',
        shareToken: 'mock-uuid-1234',
        status: 'pending',
        tokenExpiry: null,
        project: { ...mockProject, title: 'Test Project' },
        sharedBy: { id: 'owner-1', email: 'owner@example.com', profile: null },
      };

      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
      prismaMock.projectShare.findFirst.mockResolvedValueOnce(null); // no existing accepted share
      prismaMock.projectShare.create.mockResolvedValueOnce(mockShare);
      // sendEmail is mocked to return a resolved promise with a .catch method
      mockSendEmail.mockResolvedValueOnce(undefined);

      const result = await sharingService.shareProjectByEmail(
        'project-1',
        'owner-1',
        { email: 'recipient@example.com' }
      );

      expect(result).toEqual(mockShare);
      expect(prismaMock.projectShare.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'project-1',
            sharedById: 'owner-1',
            email: 'recipient@example.com',
            shareToken: 'mock-uuid-1234',
            status: 'pending',
          }),
        })
      );
      // Allow fire-and-forget microtask to settle
      await new Promise(resolve => setImmediate(resolve));
    });

    it('throws when project not found', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      await expect(
        sharingService.shareProjectByEmail('project-999', 'owner-1', {
          email: 'recipient@example.com',
        })
      ).rejects.toThrow('Project not found or access denied');
    });

    it('throws when sharing with yourself', async () => {
      const mockProject = {
        id: 'project-1',
        userId: 'owner-1',
        title: 'My Project',
        user: { id: 'owner-1', email: 'owner@example.com' },
      };
      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);

      await expect(
        sharingService.shareProjectByEmail('project-1', 'owner-1', {
          email: 'owner@example.com',
        })
      ).rejects.toThrow('Cannot share project with yourself');
    });

    it('throws when project is already shared with user (accepted)', async () => {
      const mockProject = {
        id: 'project-1',
        userId: 'owner-1',
        title: 'My Project',
        user: { id: 'owner-1', email: 'owner@example.com' },
      };
      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
      prismaMock.projectShare.findFirst.mockResolvedValueOnce({
        id: 'existing-share',
        status: 'accepted',
      });

      await expect(
        sharingService.shareProjectByEmail('project-1', 'owner-1', {
          email: 'recipient@example.com',
        })
      ).rejects.toThrow('Project is already shared with this user');
    });
  });

  describe('shareProjectByLink', () => {
    it('generates a share token and creates share record', async () => {
      const mockProject = { id: 'project-1', userId: 'owner-1', title: 'Test' };
      const mockShare = {
        id: 'share-2',
        projectId: 'project-1',
        sharedById: 'owner-1',
        shareToken: 'mock-uuid-1234',
        tokenExpiry: null,
        status: 'pending',
      };

      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
      prismaMock.projectShare.create.mockResolvedValueOnce(mockShare);

      const result = await sharingService.shareProjectByLink('project-1', 'owner-1');

      expect(result).toEqual(mockShare);
      expect(prismaMock.projectShare.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            projectId: 'project-1',
          }),
        })
      );
    });

    it('throws when project not found', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      await expect(
        sharingService.shareProjectByLink('project-999', 'owner-1')
      ).rejects.toThrow('Project not found or access denied');
    });
  });

  describe('getProjectShares', () => {
    it('returns all pending and accepted shares for a project', async () => {
      const mockProject = { id: 'project-1', userId: 'owner-1' };
      const mockShares = [
        {
          id: 'share-1',
          projectId: 'project-1',
          status: 'accepted',
          shareToken: 'tok-1',
          project: mockProject,
          sharedBy: {},
          sharedWith: {},
        },
        {
          id: 'share-2',
          projectId: 'project-1',
          status: 'pending',
          shareToken: 'tok-2',
          project: mockProject,
          sharedBy: {},
          sharedWith: null,
        },
      ];

      prismaMock.project.findFirst.mockResolvedValueOnce(mockProject);
      prismaMock.projectShare.findMany.mockResolvedValueOnce(mockShares);
      process.env.FRONTEND_URL = 'http://localhost:3000';

      const result = await sharingService.getProjectShares('project-1', 'owner-1');

      expect(result).toHaveLength(2);
      expect(prismaMock.projectShare.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            projectId: 'project-1',
            status: { in: ['pending', 'accepted'] },
          },
        })
      );
    });

    it('throws when owner does not own project', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null);

      await expect(
        sharingService.getProjectShares('project-1', 'other-user')
      ).rejects.toThrow('Project not found or access denied');
    });
  });

  describe('revokeShare', () => {
    it('revokes share as owner by updating status to revoked', async () => {
      prismaMock.projectShare.findFirst
        .mockResolvedValueOnce(null) // not a recipient share
        .mockResolvedValueOnce({ id: 'share-1', projectId: 'project-1' }); // owner's share
      prismaMock.projectShare.update.mockResolvedValueOnce({ id: 'share-1', status: 'revoked' });

      await sharingService.revokeShare('share-1', 'owner-1');

      expect(prismaMock.projectShare.update).toHaveBeenCalledWith({
        where: { id: 'share-1' },
        data: { status: 'revoked' },
      });
    });

    it('throws when share not found or user has no access', async () => {
      prismaMock.projectShare.findFirst
        .mockResolvedValueOnce(null) // not recipient
        .mockResolvedValueOnce(null); // not owner

      await expect(
        sharingService.revokeShare('share-999', 'random-user')
      ).rejects.toThrow('Share not found or access denied');
    });
  });

  describe('acceptShareInvitation', () => {
    it('updates share status to accepted for valid token', async () => {
      const mockShare = {
        id: 'share-1',
        projectId: 'project-1',
        shareToken: 'valid-token',
        status: 'pending',
        tokenExpiry: null,
        email: null,
        project: { id: 'project-1', user: { id: 'owner-1', email: 'owner@example.com' } },
        sharedBy: { id: 'owner-1', email: 'owner@example.com' },
      };
      const updatedShare = { ...mockShare, status: 'accepted', sharedWithId: 'user-2' };

      prismaMock.projectShare.findFirst
        .mockResolvedValueOnce(mockShare) // token lookup
        .mockResolvedValueOnce(null); // no existing accepted share for this user
      prismaMock.projectShare.update.mockResolvedValueOnce({
        ...updatedShare,
        project: mockShare.project,
        sharedBy: mockShare.sharedBy,
        sharedWith: { id: 'user-2' },
      });

      const result = await sharingService.acceptShareInvitation('valid-token', 'user-2');

      expect(result.needsLogin).toBe(false);
      expect(prismaMock.projectShare.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'share-1' },
          data: { status: 'accepted', sharedWithId: 'user-2' },
        })
      );
    });

    it('throws for invalid or already-accepted token', async () => {
      prismaMock.projectShare.findFirst.mockResolvedValueOnce(null);

      await expect(
        sharingService.acceptShareInvitation('bad-token', 'user-2')
      ).rejects.toThrow('Invalid or expired share link');
    });

    it('returns needsLogin true when no userId provided', async () => {
      const mockShare = {
        id: 'share-1',
        projectId: 'project-1',
        shareToken: 'valid-token',
        status: 'pending',
        tokenExpiry: null,
        email: null,
        project: { id: 'project-1', user: { id: 'owner-1', email: 'owner@example.com' } },
        sharedBy: { id: 'owner-1' },
      };
      prismaMock.projectShare.findFirst.mockResolvedValueOnce(mockShare);

      const result = await sharingService.acceptShareInvitation('valid-token');

      expect(result.needsLogin).toBe(true);
      expect(result.share).toEqual(mockShare);
    });
  });

  describe('hasProjectAccess', () => {
    it('returns hasAccess true and isOwner true for project owner', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'project-1', userId: 'owner-1' });

      const result = await sharingService.hasProjectAccess('project-1', 'owner-1');

      expect(result).toEqual({ hasAccess: true, isOwner: true });
    });

    it('returns hasAccess true and isOwner false for shared user', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null); // not owner
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'user-2',
        email: 'user2@example.com',
      });
      prismaMock.projectShare.findFirst.mockResolvedValueOnce({
        id: 'share-1',
        projectId: 'project-1',
        status: 'accepted',
      });

      const result = await sharingService.hasProjectAccess('project-1', 'user-2');

      expect(result).toEqual({
        hasAccess: true,
        isOwner: false,
        shareId: 'share-1',
      });
    });

    it('returns hasAccess false for unauthorized user', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null);
      prismaMock.user.findUnique.mockResolvedValueOnce({
        id: 'user-3',
        email: 'user3@example.com',
      });
      prismaMock.projectShare.findFirst.mockResolvedValueOnce(null);
      prismaMock.projectShare.findMany.mockResolvedValueOnce([]);

      const result = await sharingService.hasProjectAccess('project-1', 'user-3');

      expect(result).toEqual({ hasAccess: false, isOwner: false });
    });

    it('returns hasAccess false when user not found in database', async () => {
      prismaMock.project.findFirst.mockResolvedValueOnce(null);
      prismaMock.user.findUnique.mockResolvedValueOnce(null);

      const result = await sharingService.hasProjectAccess('project-1', 'ghost-user');

      expect(result).toEqual({ hasAccess: false, isOwner: false });
    });
  });
});
