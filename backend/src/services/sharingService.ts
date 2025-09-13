import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db';
import { logger } from '../utils/logger';
import * as EmailService from './emailService';
import { User, ProjectShare, Project } from '@prisma/client';
import { ShareByEmailData, ShareByLinkData } from '../types/validation';

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(str: string | null | undefined): string {
  if (!str) {return '';}
  
  const htmlEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };
  
  return str.replace(/[&<>"'/]/g, char => htmlEscapeMap[char] || char);
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

    // Check if already accepted by this email (allow resending pending invitations)
    const existingAcceptedShare = await prisma.projectShare.findFirst({
      where: {
        projectId,
        email: data.email,
        status: 'accepted'
      }
    });

    if (existingAcceptedShare) {
      throw new Error('Project is already shared with this user');
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
        status: 'pending' // Link shares start as pending until someone accepts them
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
): Promise<{ share: unknown; needsLogin: boolean }> {
  try {
    // Find the share by token
    const share = await prisma.projectShare.findFirst({
      where: {
        shareToken: token,
        status: 'pending'
      },
      include: {
        project: {
          include: {
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        },
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

    // Check if user already has access to this project
    const existingAcceptedShare = await prisma.projectShare.findFirst({
      where: {
        projectId: share.projectId,
        sharedWithId: userId,
        status: 'accepted'
      },
      include: {
        project: {
          include: {
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        },
        sharedBy: true,
        sharedWith: true
      }
    });

    if (existingAcceptedShare) {
      // User already has access, return the existing share with full data
      return { share: existingAcceptedShare, needsLogin: false };
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

    // Update the share to accepted and fetch complete data
    const updatedShare = await prisma.projectShare.update({
      where: { id: share.id },
      data: {
        status: 'accepted',
        sharedWithId: userId
      },
      include: {
        project: {
          include: {
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        },
        sharedBy: true,
        sharedWith: true
      }
    });

    logger.info(`Share invitation accepted: ${share.id}`, 'SharingService', {
      shareId: share.id,
      projectId: share.projectId,
      userId,
      status: updatedShare.status,
      sharedWithId: updatedShare.sharedWithId
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
    // Fetch user email once
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    // Only fetch ACCEPTED shares where the user is the recipient
    // Removed the email condition as it was causing confusion
    const whereConditions = {
      sharedWithId: userId,
      status: 'accepted'
    };
    
    logger.debug(`Fetching shared projects for user ${userId}`, 'SharingService', {
      userId,
      userEmail: user?.email,
      conditions: whereConditions
    });
    
    const shares = await prisma.projectShare.findMany({
      where: whereConditions,
      include: {
        project: {
          include: {
            _count: {
              select: { images: true }
            },
            images: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                name: true,
                thumbnailPath: true,
                originalPath: true
              }
            },
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        },
        sharedBy: true,
        sharedWith: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
    
    logger.debug(`Found ${shares.length} shares for user`, 'SharingService', {
      userId,
      shareCount: shares.length,
      shares: shares.map(s => ({ 
        id: s.id, 
        projectId: s.projectId, 
        hasProject: !!s.project,
        projectTitle: s.project?.title,
        sharedById: s.sharedById,
        sharedWithId: s.sharedWithId,
        status: s.status
      }))
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
 * Get all shares for a specific project with enhanced details
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
        status: { in: ['pending', 'accepted'] }
      },
      include: {
        project: true,
        sharedBy: true,
        sharedWith: true
      },
      orderBy: [
        { status: 'asc' }, // accepted first, then pending
        { createdAt: 'desc' }
      ]
    });

    // Add share URL to each share for frontend display
    const sharesWithUrls = shares.map(share => ({
      ...share,
      shareUrl: `${process.env.FRONTEND_URL}/share/accept/${share.shareToken}`
    }));

    return sharesWithUrls as ShareWithDetails[];
  } catch (error) {
    logger.error('Failed to get project shares:', error as Error, 'SharingService', {
      projectId,
      ownerId
    });
    throw error;
  }
}

/**
 * Revoke a project share (called by project owner)
 */
export async function revokeShare(
  shareId: string,
  ownerId: string
): Promise<void> {
  try {
    // Check if this is actually a request from the shared user to remove the project
    // First, try to find if the user is the one the project is shared with
    const shareAsRecipient = await prisma.projectShare.findFirst({
      where: {
        id: shareId,
        sharedWithId: ownerId,
        status: 'accepted'
      }
    });

    if (shareAsRecipient) {
      // User wants to remove a shared project from their list
      // Mark it as removed/declined by the recipient
      await prisma.projectShare.update({
        where: { id: shareId },
        data: { status: 'revoked' }
      });

      logger.info(`User removed shared project from their list: ${shareId}`, 'SharingService', {
        shareId,
        userId: ownerId
      });
      return;
    }

    // Otherwise, verify the user owns the project (original revoke logic)
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

    logger.info(`Share revoked by owner: ${shareId}`, 'SharingService', {
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
    logger.debug('hasProjectAccess called', 'SharingService', {
      projectId,
      userId
    });

    // Check if user is the owner
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        userId
      }
    });

    logger.debug('Owner check result', 'SharingService', {
      projectId,
      userId,
      isOwner: !!project
    });

    if (project) {
      logger.debug('User is project owner - granting access', 'SharingService', {
        projectId,
        userId
      });
      return { hasAccess: true, isOwner: true };
    }

    // Check if project is shared with user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    logger.debug('User lookup result', 'SharingService', {
      projectId,
      userId,
      foundUser: !!user
    });

    if (!user) {
      logger.debug('User not found in database', 'SharingService', {
        projectId,
        userId
      });
      return { hasAccess: false, isOwner: false };
    }

    // Check direct shares first
    logger.debug('Checking for project shares', 'SharingService', {
      projectId,
      userId,
      userEmail: user.email
    });

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

    logger.debug('Share lookup result', 'SharingService', {
      projectId,
      userId,
      foundShare: !!share,
      shareId: share?.id
    });

    if (share) {
      logger.debug('Found accepted share - granting access', 'SharingService', {
        projectId,
        userId,
        shareId: share.id
      });
      return { hasAccess: true, isOwner: false, shareId: share.id };
    }

    // Let's also check all shares for this project to see what exists
    const allShares = await prisma.projectShare.findMany({
      where: {
        projectId
      }
    });

    logger.debug('All shares for this project', 'SharingService', {
      projectId,
      totalShares: allShares.length
    });

    // No need for separate ShareLink check - all accepted shares are already checked above
    logger.debug('No access granted - no ownership or accepted shares found', 'SharingService', {
      projectId,
      userId
    });

    return { hasAccess: false, isOwner: false };
  } catch (error) {
    logger.error('Exception in hasProjectAccess:', error as Error, 'SharingService', {
      projectId,
      userId
    });
    return { hasAccess: false, isOwner: false };
  }
}

/**
 * Validate a share token and return share info
 */
export async function validateShareToken(token: string): Promise<unknown | null> {
  try {
    const share = await prisma.projectShare.findFirst({
      where: {
        shareToken: token,
        status: { in: ['pending', 'accepted'] }
      },
      include: {
        project: {
          include: {
            user: {
              select: {
                id: true,
                email: true
              }
            }
          }
        },
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
    // Validate FRONTEND_URL is configured
    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl || frontendUrl.trim() === '') {
      throw new Error('FRONTEND_URL environment variable is not configured');
    }
    
    // Normalize frontend URL and encode token
    const normalizedUrl = frontendUrl.trim().replace(/\/+$/, '');
    const encodedToken = encodeURIComponent(share.shareToken);
    const acceptUrl = `${normalizedUrl}/share/accept/${encodedToken}`;
    
    // Check if email exists (link shares may not have email)
    if (!share.email) {
      logger.warn('Cannot send email for link-only share', 'SharingService', {
        shareId: share.id,
        isLinkShare: true
      });
      return; // Skip email sending for link-only shares
    }
    
    const emailOptions: EmailService.EmailServiceOptions = {
      to: share.email,
      subject: `${share.sharedBy.email} shared a project with you - Cell Segmentation Platform`,
      html: generateShareInvitationHTML(share, acceptUrl, message),
      text: generateShareInvitationText(share, acceptUrl, message)
    };

    EmailService.sendEmail(emailOptions)
      .then(() => {
        logger.info('Share invitation email sent successfully', 'SharingService', { shareId: share.id, email: share.email });
      })
      .catch((emailError) => {
        logger.error('Failed to send share invitation email:', emailError as Error, 'SharingService', { shareId: share.id, email: share.email });
      });
  } catch (error) {
    logger.error('Failed to prepare share invitation email:', error as Error, 'SharingService', {
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #1a202c;
                background-color: #f7fafc;
                margin: 0;
                padding: 0;
            }
            .wrapper {
                background-color: #f7fafc;
                padding: 40px 20px;
            }
            .container { 
                max-width: 600px;
                margin: 0 auto;
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
                overflow: hidden;
            }
            .header { 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 40px 30px;
                text-align: center;
            }
            .header h1 {
                margin: 0;
                font-size: 28px;
                font-weight: 600;
                text-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .header p {
                margin: 10px 0 0 0;
                opacity: 0.95;
                font-size: 16px;
            }
            .content { 
                padding: 40px 30px;
            }
            .greeting {
                font-size: 18px;
                color: #2d3748;
                margin-bottom: 20px;
            }
            .project-card {
                background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 25px;
                margin: 30px 0;
            }
            .project-title {
                font-size: 22px;
                font-weight: 600;
                color: #2d3748;
                margin: 0 0 10px 0;
            }
            .project-description {
                color: #4a5568;
                margin: 10px 0;
                line-height: 1.5;
            }
            .shared-by {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 25px;
                padding: 15px;
                background: #f8fafc;
                border-radius: 8px;
            }
            .avatar {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 600;
                font-size: 20px;
            }
            .shared-by-text {
                flex: 1;
            }
            .shared-by-name {
                font-weight: 600;
                color: #2d3748;
                font-size: 16px;
            }
            .shared-by-label {
                color: #718096;
                font-size: 14px;
                margin-top: 2px;
            }
            .message-box {
                background: #fef5e7;
                border-left: 4px solid #f39c12;
                padding: 20px;
                margin: 25px 0;
                border-radius: 6px;
            }
            .message-quote {
                color: #2d3748;
                font-style: italic;
                font-size: 16px;
                line-height: 1.6;
            }
            .button-container {
                text-align: center;
                margin: 35px 0;
            }
            .button { 
                display: inline-block;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white !important;
                padding: 14px 32px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                font-size: 16px;
                box-shadow: 0 4px 14px rgba(102, 126, 234, 0.4);
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .button:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(102, 126, 234, 0.5);
            }
            .url-box {
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                padding: 12px;
                border-radius: 6px;
                word-break: break-all;
                font-family: 'Monaco', 'Menlo', monospace;
                font-size: 13px;
                color: #4a5568;
                margin: 15px 0;
            }
            .footer { 
                border-top: 2px solid #f0f4f8;
                padding: 30px;
                text-align: center;
                background: #fafbfc;
            }
            .footer-logo {
                font-size: 20px;
                font-weight: 600;
                color: #667eea;
                margin-bottom: 10px;
            }
            .footer-text {
                font-size: 14px;
                color: #718096;
                line-height: 1.5;
            }
            .footer-links {
                margin-top: 20px;
            }
            .footer-link {
                color: #667eea;
                text-decoration: none;
                margin: 0 10px;
                font-size: 14px;
            }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="container">
                <div class="header">
                    <h1>🔬 Project Invitation</h1>
                    <p>You've been invited to collaborate!</p>
                </div>
                <div class="content">
                    <div class="greeting">Hello there! 👋</div>
                    
                    <div class="shared-by">
                        <div class="avatar">${escapeHtml(share.sharedBy.email).charAt(0).toUpperCase()}</div>
                        <div class="shared-by-text">
                            <div class="shared-by-name">${escapeHtml(share.sharedBy.email)}</div>
                            <div class="shared-by-label">invited you to collaborate</div>
                        </div>
                    </div>
                    
                    <div class="project-card">
                        <div class="project-title">📁 ${escapeHtml(share.project.title)}</div>
                        ${share.project.description ? `<div class="project-description">${escapeHtml(share.project.description)}</div>` : ''}
                    </div>
                    
                    ${message ? `
                    <div class="message-box">
                        <div class="message-quote">"${escapeHtml(message)}"</div>
                    </div>
                    ` : ''}
                    
                    <p style="color: #4a5568; text-align: center; margin: 30px 0;">
                        Join the Cell Segmentation Platform to start analyzing and collaborating on this project.
                    </p>
                    
                    <div class="button-container">
                        <a href="${acceptUrl}" class="button">Accept Invitation</a>
                    </div>
                    
                    <p style="color: #718096; font-size: 14px; text-align: center;">
                        Can't click the button? Copy this link to your browser:
                    </p>
                    <div class="url-box">${acceptUrl}</div>
                    
                    <p style="color: #a0aec0; font-size: 13px; text-align: center; margin-top: 25px;">
                        This invitation link will remain active until you accept it or it's revoked by the sender.
                    </p>
                </div>
                <div class="footer">
                    <div class="footer-logo">Cell Segmentation Platform</div>
                    <div class="footer-text">
                        Advancing cell analysis through collaboration
                    </div>
                    <div class="footer-links">
                        <a href="${process.env.FRONTEND_URL}" class="footer-link">Visit Platform</a>
                        <a href="${process.env.FRONTEND_URL}/help" class="footer-link">Get Help</a>
                    </div>
                </div>
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