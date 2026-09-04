// Shared authentication types
import { Request } from 'express';
import { ParamsDictionary } from 'express-serve-static-core';
import * as qs from 'qs';

export interface UserProfile {
  id: number;
  email: string;
  username: string;
  avatar: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  /**
   * Platform administrator, read fresh from the row on every request by
   * `authenticate`. Required, not optional: this interface describes what is
   * on the request AFTER authentication, and every code path that sets
   * `req.user` knows the answer. Leaving it optional would have let a
   * `req.user.isAdmin` check silently read `undefined` in any handler that
   * builds its own request object.
   *
   * It also has to be here rather than only on the global express
   * augmentation, because `AuthRequest` re-declares `user` and would
   * otherwise no longer extend `Request` (TS2430) — which surfaces as a pile
   * of unrelated-looking `params` errors in every router that uses a typed
   * request.
   */
  isAdmin: boolean;
}

// Properly typed AuthRequest with all Express Request properties
export interface AuthRequest<
  P = ParamsDictionary,
  ResBody = unknown,
  ReqBody = unknown,
  ReqQuery = qs.ParsedQs,
  Locals extends Record<string, unknown> = Record<string, unknown>,
> extends Request<P, ResBody, ReqBody, ReqQuery, Locals> {
  user?: AuthUser;
  profile?: UserProfile;
}
