// Shared authentication types
import { Request } from 'express';

export interface UserProfile {
  id: number;
  email: string;
  username: string;
  avatar: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    emailVerified: boolean;
  };
  profile?: UserProfile;
}