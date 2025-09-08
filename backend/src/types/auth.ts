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
}

// Properly typed AuthRequest with all Express Request properties
export interface AuthRequest<
  P = ParamsDictionary,
  ResBody = any,
  ReqBody = any,
  ReqQuery = qs.ParsedQs,
  Locals extends Record<string, any> = Record<string, any>
> extends Request<P, ResBody, ReqBody, ReqQuery, Locals> {
  user?: AuthUser;
  profile?: UserProfile;
}