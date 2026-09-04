import { createContext } from 'react';
import { User, Profile } from '@/types';

export interface ConsentOptions {
  consentToMLTraining?: boolean;
  consentToAlgorithmImprovement?: boolean;
  consentToFeatureDevelopment?: boolean;
}

export interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAuthenticated: boolean;
  /**
   * Whether the signed-in account carries the platform-admin flag. Derived
   * from the profile the server returned — a rendering hint only; every admin
   * endpoint re-checks it server-side.
   */
  isAdmin: boolean;
  /**
   * The admin really behind this session, or null in the normal case.
   *
   * When it is set, `user` and `profile` describe SOMEONE ELSE: the whole app
   * is deliberately showing the impersonated user's data. Anything that must
   * name the real actor has to read this.
   */
  impersonatedBy: { id: string; email: string } | null;
  signIn: (
    email: string,
    password: string,
    rememberMe?: boolean
  ) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    consentOptions?: ConsentOptions,
    username?: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);
