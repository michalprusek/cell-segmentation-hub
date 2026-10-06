import { Request, Response } from 'express';
import {
  ApiKeyLimitError,
  createApiKey,
  deleteApiKey,
  listApiKeys,
} from '../../services/apiKeyService';
import { ResponseHelper, asyncHandler } from '../../utils/response';
import type { CreateApiKeyData } from '../../types/validation';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every route here sits behind `authenticate`, so `req.user` is set. */
const userId = (req: Request): string => (req.user as { id: string }).id;

/**
 * Minting or revoking a credential is refused to an impersonated session.
 *
 * `req.user` is the TARGET while an admin is acting as them, so without this
 * a support session could leave behind a key to somebody else's account that
 * outlives the session and never appears in `impersonation_logs`. Listing
 * stays allowed: it shows no secret, and it is what support needs to see.
 */
const refuseWhenImpersonating = (req: Request, res: Response): boolean => {
  if (!req.impersonator) {
    return false;
  }
  ResponseHelper.error(
    res,
    {
      code: 'API_KEY_IMPERSONATION_FORBIDDEN',
      message: 'API keys cannot be created or revoked while impersonating',
    },
    403,
    undefined,
    'ApiKeys'
  );
  return true;
};

export const list = asyncHandler(async (req: Request, res: Response) => {
  ResponseHelper.success(res, await listApiKeys(userId(req)));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  if (refuseWhenImpersonating(req, res)) {
    return;
  }

  const { name, expiresInDays } = req.body as CreateApiKeyData;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * DAY_MS)
    : null;

  try {
    const created = await createApiKey(userId(req), name, expiresAt);
    // The one response that ever carries the key. Never cache it.
    res.setHeader('Cache-Control', 'no-store');
    ResponseHelper.success(res, created, undefined, 201);
  } catch (error) {
    if (error instanceof ApiKeyLimitError) {
      ResponseHelper.error(
        res,
        { code: 'API_KEY_LIMIT_REACHED', message: error.message },
        409,
        undefined,
        'ApiKeys'
      );
      return;
    }
    throw error;
  }
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  if (refuseWhenImpersonating(req, res)) {
    return;
  }

  const deleted = await deleteApiKey(userId(req), req.params.id);
  if (!deleted) {
    ResponseHelper.notFound(res, 'API key not found', 'ApiKeys');
    return;
  }
  ResponseHelper.success(res, { id: req.params.id });
});
