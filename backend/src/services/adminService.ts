/**
 * The admin support tool: list the registered accounts, and mint a session
 * for one of them so a bug can be reproduced from the user's own side.
 *
 * The token mechanics are the whole of the security story here, so they are
 * spelled out rather than left to be inferred:
 *
 *   * An impersonated session is a NORMAL session for the target user. Its
 *     JWT's `userId` is the target's, which is what makes every ownership
 *     check, every query filter and every WebSocket room work unchanged.
 *     `impersonatorId` rides alongside as an extra claim, never in place of
 *     `userId`.
 *
 *   * That claim is ALSO written to the Redis refresh record, because
 *     `authService.refreshToken` rebuilds the access-token payload from the
 *     database row and the frontend refreshes every 13 minutes. A claim that
 *     lived only in the JWT would be gone by then.
 *
 *   * Stopping does NOT restore the admin's original tokens — we never had
 *     them. The refresh cookie is path-scoped to `/api/auth`, so the browser
 *     does not even send it to `/api/admin`, and storing a copy would put a
 *     working credential back into Redis, which `sessionService` went out of
 *     its way to stop doing. Instead a FRESH session is minted for the
 *     impersonator, whose id comes off the signed token. The admin's original
 *     session stays valid until its own TTL — the same state as being logged
 *     in from two browsers.
 */

import crypto from 'crypto';
import { prisma } from '../db';
import { generateTokenPair } from '../auth/jwt';
import { ApiError } from '../middleware/error';
import { logger } from '../utils/logger';
import { sessionService } from './sessionService';
import { recordImpersonationEvent } from './impersonationAuditService';

const CTX = 'AdminService';

/** Hard ceiling on `limit`, so a caller cannot ask for the whole table. */
export const MAX_USER_PAGE_SIZE = 100;
export const DEFAULT_USER_PAGE_SIZE = 25;

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string | null;
  emailVerified: boolean;
  isAdmin: boolean;
  createdAt: string;
  projectCount: number;
}

export interface ListUsersResult {
  users: AdminUserSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * One page of registered accounts, newest first, optionally filtered by a
 * substring of the e-mail or the profile username.
 */
export async function listUsers(params: {
  page?: number;
  limit?: number;
  search?: string;
}): Promise<ListUsersResult> {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const limit = Math.min(
    MAX_USER_PAGE_SIZE,
    Math.max(1, Math.floor(params.limit ?? DEFAULT_USER_PAGE_SIZE))
  );
  const search = params.search?.trim();

  const where = search
    ? {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          {
            profile: {
              username: { contains: search, mode: 'insensitive' as const },
            },
          },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        email: true,
        emailVerified: true,
        isAdmin: true,
        createdAt: true,
        profile: { select: { username: true } },
        _count: { select: { projects: true } },
      },
    }),
  ]);

  return {
    users: rows.map(row => ({
      id: row.id,
      email: row.email,
      username: row.profile?.username ?? null,
      emailVerified: row.emailVerified,
      isAdmin: row.isAdmin,
      createdAt: row.createdAt.toISOString(),
      projectCount: row._count.projects,
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export interface ImpersonationTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
  };
  sessionId: string;
}

/** Where the request came from, for the audit row. */
export interface RequestOrigin {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Mint a session for `targetUserId`, acting as `admin`.
 *
 * Refuses to impersonate another admin. That is not paranoia about the
 * maintainer: it makes "an impersonated session never carries admin rights"
 * true at the SOURCE rather than only at the `requireAdmin` middleware, so the
 * two checks are genuine defence in depth instead of one check written twice.
 * (`requireAdmin` still refuses any impersonated session — see its docstring.)
 */
export async function startImpersonation(
  admin: { id: string; email: string },
  targetUserId: string,
  origin: RequestOrigin = {}
): Promise<ImpersonationTokens> {
  const sessionId = crypto.randomUUID();

  const deny = (detail: string, error: ApiError): never => {
    void recordImpersonationEvent({
      event: 'denied',
      adminId: admin.id,
      targetId: targetUserId,
      sessionId,
      ip: origin.ip,
      userAgent: origin.userAgent,
      detail,
    });
    throw error;
  };

  if (targetUserId === admin.id) {
    return deny(
      'self-impersonation',
      ApiError.badRequest('Nelze se přihlásit sám za sebe')
    );
  }

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, emailVerified: true, isAdmin: true },
  });

  if (!target) {
    return deny(
      'target-not-found',
      ApiError.notFound('Uživatel nenalezen')
    );
  }

  if (target.isAdmin) {
    return deny(
      'target-is-admin',
      ApiError.forbidden('Nelze se přihlásit za jiného administrátora')
    );
  }

  const { accessToken, refreshToken } = generateTokenPair(
    {
      userId: target.id,
      email: target.email,
      emailVerified: target.emailVerified,
      impersonatorId: admin.id,
      impersonationSessionId: sessionId,
    },
    // No rememberMe: an impersonated session gets the SHORT refresh window
    // (7d, not 30d). It is a debugging session, not a login.
    false
  );

  // Durable copy — see the module docstring. `storeRefreshToken` throws if
  // Redis is down, and it must: an impersonated session that cannot refresh
  // would silently revert to the target's own identity in 15 minutes.
  await sessionService.storeRefreshToken(target.id, refreshToken, undefined, {
    impersonatorId: admin.id,
    impersonationSessionId: sessionId,
  });

  void recordImpersonationEvent({
    event: 'start',
    adminId: admin.id,
    targetId: target.id,
    sessionId,
    ip: origin.ip,
    userAgent: origin.userAgent,
    detail: 'manual',
  });

  logger.info(
    `Impersonation started: ${admin.email} acting as ${target.email} (session ${sessionId})`,
    CTX
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: target.id,
      email: target.email,
      emailVerified: target.emailVerified,
    },
    sessionId,
  };
}

export interface StopImpersonationResult {
  accessToken: string;
  refreshToken: string;
  admin: {
    id: string;
    email: string;
    emailVerified: boolean;
  };
}

/**
 * Return to the admin's own session.
 *
 * `impersonator` comes off the SIGNED access token, so a user who was never
 * impersonated has nothing to present here and a non-admin cannot forge one.
 * The admin flag is re-checked anyway: a session must not outlive the
 * privilege that created it.
 */
export async function stopImpersonation(
  impersonator: { id: string; sessionId: string },
  target: { id: string; email: string },
  origin: RequestOrigin = {}
): Promise<StopImpersonationResult> {
  const admin = await prisma.user.findUnique({
    where: { id: impersonator.id },
    select: { id: true, email: true, emailVerified: true, isAdmin: true },
  });

  if (!admin?.isAdmin) {
    // Still revoked: a de-admined operator must not be left holding a live
    // impersonated session just because they cannot be handed their own back.
    await sessionService.revokeImpersonatedSession(impersonator.sessionId);
    void recordImpersonationEvent({
      event: 'stop',
      adminId: impersonator.id,
      targetId: target.id,
      sessionId: impersonator.sessionId,
      ip: origin.ip,
      userAgent: origin.userAgent,
      detail: 'admin-revoked',
    });
    throw ApiError.forbidden(
      'Účet již nemá práva administrátora; relace byla ukončena'
    );
  }

  // Kill the impersonated refresh token server-side, not just the browser's
  // copy of it. Best-effort by design (see `revokeImpersonatedSession`): a
  // Redis blip must not strand the admin inside the user's account.
  await sessionService.revokeImpersonatedSession(impersonator.sessionId);

  const { accessToken, refreshToken } = generateTokenPair(
    {
      userId: admin.id,
      email: admin.email,
      emailVerified: admin.emailVerified,
    },
    false
  );

  await sessionService.storeRefreshToken(admin.id, refreshToken);

  void recordImpersonationEvent({
    event: 'stop',
    adminId: admin.id,
    targetId: target.id,
    sessionId: impersonator.sessionId,
    ip: origin.ip,
    userAgent: origin.userAgent,
    detail: 'manual',
  });

  logger.info(
    `Impersonation stopped: ${admin.email} was acting as ${target.email} (session ${impersonator.sessionId})`,
    CTX
  );

  return {
    accessToken,
    refreshToken,
    admin: {
      id: admin.id,
      email: admin.email,
      emailVerified: admin.emailVerified,
    },
  };
}
