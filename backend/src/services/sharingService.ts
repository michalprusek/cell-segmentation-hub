import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import * as EmailService from './emailService';
import { User, ProjectShare, Project } from '@prisma/client';

export interface ShareByEmailData {
  email: string;
  message?: string;
}

export interface ShareByLinkData {
  expiryHours?: number; // null means no expiry
}

export interface ShareWithDetails extends ProjectShare {
  sharedWith?: User;
  project: Project;
  sharedBy: User;
}

/**
 * Share a project via email invitation
 */
export async function shareProjectByEmail(
  projectId: string,
  sharedById: string,
  data: ShareByEmailData
): Promise<ProjectShare> {
  try {
    // Check if project exists and user owns it
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: sharedById
      },
      include: {
        user: true
      }
    });

    if (!project) {
      throw new Error('Project not found or access denied');
    }

    // Check if user is trying to share with themselves
    if (project.user.email === data.email) {
      throw new Error('Cannot share project with yourself');
    }

    // Check if already shared with this email
    const existingShare = await prisma.projectShare.findFirst({
      where: {
        projectId,
        email: data.email,
        status: { in: ['pending', 'accepted'] }
      }
    });

    if (existingShare) {
      throw new Error('Project is already shared with this email');
    }

    // Generate unique share token
    const shareToken = uuidv4();

    // Create the share record
    const share = await prisma.projectShare.create({
      data: {
        projectId,
        sharedById,
        email: data.email,
        shareToken,
        status: 'pending'
      },
      include: {
        project: true,
        sharedBy: true
      }
    });

    // Send email invitation
    await sendShareInvitationEmail(share, data.message);

    logger.info(`Project shared via email: ${projectId} with ${data.email}`, 'SharingService', {
      projectId,
      sharedById,
      email: data.email,
      shareId: share.id
    });

    return share;
  } catch (error) {
    logger.error('Failed to share project by email:', error as Error, 'SharingService', {
      projectId,
      sharedById,
      email: data.email
    });
    throw error;
  }
}

/**
 * Generate a shareable link for a project
 */
export async function shareProjectByLink(
  projectId: string,
  sharedById: string,
  data: ShareByLinkData = {}
): Promise<ProjectShare> {
  try {
    // Check if project exists and user owns it
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: sharedById
      }
    });

    if (!project) {
      throw new Error('Project not found or access denied');
    }

    // Generate unique share token
    const shareToken = uuidv4();
    
    // Calculate expiry if specified
    let tokenExpiry = null;
    if (data.expiryHours) {
      tokenExpiry = new Date();
      tokenExpiry.setHours(tokenExpiry.getHours() + data.expiryHours);
    }

    // Create the share record
    const share = await prisma.projectShare.create({
      data: {
        projectId,
        sharedById,
        shareToken,
        tokenExpiry,
        status: 'accepted' // Link shares are immediately active
      }
    });

    logger.info(`Project shared via link: ${projectId}`, 'SharingService', {
      projectId,
      sharedById,
      shareId: share.id,
      expiryHours: data.expiryHours
    });

    return share;
  } catch (error) {
    logger.error('Failed to share project by link:', error as Error, 'SharingService', {
      projectId,
      sharedById
    });
    throw error;
  }
}

/**
 * Accept a share invitation via token
 */
export async function acceptShareInvitation(
  token: string,
  userId?: string
): Promise<{ share: ProjectShare; needsLogin: boolean }> {
  try {
    // Find the share by token
    const share = await prisma.projectShare.findFirst({
      where: {
        shareToken: token,
        status: 'pending'
      },
      include: {
        project: true,
        sharedBy: true
      }
    });

    if (!share) {
      throw new Error('Invalid or expired share link');
    }

    // Check if token is expired
    if (share.tokenExpiry && new Date() > share.tokenExpiry) {
      await prisma.projectShare.update({
        where: { id: share.id },
        data: { status: 'expired' }
      });
      throw new Error('Share link has expired');
    }

    // If user is not logged in, return the share info but don't accept yet
    if (!userId) {
      return { share, needsLogin: true };
    }

    // Find user by email if this was an email invitation
    let targetUser = null;
    if (share.email) {
      targetUser = await prisma.user.findUnique({
        where: { email: share.email }
      });

      if (!targetUser || targetUser.id !== userId) {
        throw new Error('This invitation is for a different email address');
      }
    }

    // Update the share to accepted
    const updatedShare = await prisma.projectShare.update({
      where: { id: share.id },
      data: {
        status: 'accepted',
        sharedWithId: userId
      }
    });

    logger.info(`Share invitation accepted: ${share.id}`, 'SharingService', {
      shareId: share.id,
      projectId: share.projectId,
      userId
    });

    return { share: updatedShare, needsLogin: false };
  } catch (error) {
    logger.error('Failed to accept share invitation:', error as Error, 'SharingService', {
      token
    });
    throw error;
  }
}

/**
 * Get all projects shared with a user
 */
export async function getSharedProjects(userId: string): Promise<ShareWithDetails[]> {
  try {
    const shares = await prisma.projectShare.findMany({
      where: {
        OR: [
          { sharedWithId: userId, status: 'accepted' },
          { 
            email: (await prisma.user.findUnique({ where: { id: userId } }))?.email,
            status: { in: ['pending', 'accepted'] }
          }
        ]
      },
      include: {
        project: true,
        sharedBy: true,
        sharedWith: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return shares as ShareWithDetails[];
  } catch (error) {
    logger.error('Failed to get shared projects:', error as Error, 'SharingService', {
      userId
    });
    throw error;
  }
}

/**
 * Get all shares for a specific project
 */
export async function getProjectShares(
  projectId: string,
  ownerId: string
): Promise<ShareWithDetails[]> {
  try {
    // Verify the user owns the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId: ownerId
      }
    });

    if (!project) {
      throw new Error('Project not found or access denied');
    }

    const shares = await prisma.projectShare.findMany({
      where: {
        projectId,
        status: { not: 'revoked' }
      },
      include: {
        project: true,
        sharedBy: true,
        sharedWith: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return shares as ShareWithDetails[];
  } catch (error) {
    logger.error('Failed to get project shares:', error as Error, 'SharingService', {
      projectId,
      ownerId
    });
    throw error;
  }
}

/**
 * Revoke a project share
 */
export async function revokeShare(
  shareId: string,
  ownerId: string
): Promise<void> {
  try {
    // Verify the user owns the project
    const share = await prisma.projectShare.findFirst({
      where: {
        id: shareId,
        project: {
          userId: ownerId
        }
      }
    });

    if (!share) {
      throw new Error('Share not found or access denied');
    }

    // Update share status to revoked
    await prisma.projectShare.update({
      where: { id: shareId },
      data: { status: 'revoked' }
    });

    logger.info(`Share revoked: ${shareId}`, 'SharingService', {
      shareId,
      ownerId
    });
  } catch (error) {
    logger.error('Failed to revoke share:', error as Error, 'SharingService', {
      shareId,
      ownerId
    });
    throw error;
  }
}

/**
 * Check if user has access to a project (owner or shared with)
 */
export async function hasProjectAccess(
  projectId: string,
  userId: string
): Promise<{ hasAccess: boolean; isOwner: boolean; shareId?: string }> {
  try {
    // Check if user is the owner
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId
      }
    });

    if (project) {
      return { hasAccess: true, isOwner: true };
    }

    // Check if project is shared with user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return { hasAccess: false, isOwner: false };
    }

    const share = await prisma.projectShare.findFirst({
      where: {
        projectId,
        status: 'accepted',
        OR: [
          { sharedWithId: userId },
          { email: user.email }
        ]
      }
    });

    if (share) {
      return { hasAccess: true, isOwner: false, shareId: share.id };
    }

    return { hasAccess: false, isOwner: false };
  } catch (error) {
    logger.error('Failed to check project access:', error as Error, 'SharingService', {
      projectId,
      userId
    });
    return { hasAccess: false, isOwner: false };
  }
}

/**
 * Validate a share token and return share info
 */
export async function validateShareToken(token: string): Promise<ProjectShare | null> {
  try {
    const share = await prisma.projectShare.findFirst({
      where: {
        shareToken: token,
        status: { in: ['pending', 'accepted'] }
      },
      include: {
        project: true,
        sharedBy: true
      }
    });

    if (!share) {
      return null;
    }

    // Check if token is expired
    if (share.tokenExpiry && new Date() > share.tokenExpiry) {
      await prisma.projectShare.update({
        where: { id: share.id },
        data: { status: 'expired' }
      });
      return null;
    }

    return share;
  } catch (error) {
    logger.error('Failed to validate share token:', error as Error, 'SharingService', {
      token
    });
    return null;
  }
}

/**
 * Send share invitation email
 */
async function sendShareInvitationEmail(
  share: ProjectShare & { project: Project; sharedBy: User },
  message?: string
): Promise<void> {
  try {
    const acceptUrl = `${process.env.FRONTEND_URL}/share/accept/${share.shareToken}`;
    
    const emailOptions: EmailService.EmailServiceOptions = {
      to: share.email!,
      subject: `${share.sharedBy.email} shared a project with you - Cell Segmentation Platform`,
      html: generateShareInvitationHTML(share, acceptUrl, message),
      text: generateShareInvitationText(share, acceptUrl, message)
    };

    await EmailService.sendEmail(emailOptions);
  } catch (error) {
    logger.error('Failed to send share invitation email:', error as Error, 'SharingService', {
      shareId: share.id,
      email: share.email
    });
    throw error;
  }
}

/**
 * Generate HTML content for share invitation email
 */
function generateShareInvitationHTML(
  share: ProjectShare & { project: Project; sharedBy: User },
  acceptUrl: string,
  message?: string
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
            .content { padding: 30px 20px; }
            .project-info { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { border-top: 1px solid #e2e8f0; padding: 20px; font-size: 14px; color: #64748b; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Project Shared With You</h1>
            </div>
            <div class="content">
                <p>Hello!</p>
                <p><strong>${share.sharedBy.email}</strong> has shared a project with you on the Cell Segmentation Platform.</p>
                
                <div class="project-info">
                    <h3>${share.project.title}</h3>
                    ${share.project.description ? `<p>${share.project.description}</p>` : ''}
                </div>
                
                ${message ? `
                <div style="border-left: 4px solid #2563eb; padding-left: 15px; margin: 20px 0;">
                    <p><em>"${message}"</em></p>
                </div>
                ` : ''}
                
                <p>Click the button below to accept the invitation and start collaborating:</p>
                
                <a href="${acceptUrl}" class="button">Accept Invitation</a>
                
                <p>Or copy and paste this link in your browser:</p>
                <p style="word-break: break-all; background: #f1f5f9; padding: 10px; border-radius: 4px;">${acceptUrl}</p>
                
                <p>This invitation will remain valid until you accept it.</p>
            </div>
            <div class="footer">
                <p>Best regards,<br>Cell Segmentation Platform Team</p>
            </div>
        </div>
    </body>
    </html>
  `;
}

/**
 * Generate text content for share invitation email
 */
function generateShareInvitationText(
  share: ProjectShare & { project: Project; sharedBy: User },
  acceptUrl: string,
  message?: string
): string {
  return `
Project Shared With You

Hello!

${share.sharedBy.email} has shared a project with you on the Cell Segmentation Platform.

Project: ${share.project.title}
${share.project.description ? `Description: ${share.project.description}` : ''}

${message ? `Message: "${message}"` : ''}

Click this link to accept the invitation:
${acceptUrl}

Best regards,
Cell Segmentation Platform Team
  `.trim();
}