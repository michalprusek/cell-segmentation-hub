import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { AuthResponse } from '@/lib/api';
import { User, Profile, getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';
import { authEventEmitter } from '@/lib/authEvents';
import { hardRedirect, ACCOUNT_DELETED_FLAG } from '@/lib/hardRedirect';
import { tokenRefreshManager } from '@/lib/tokenRefresh';
import { resolveClientLanguage } from './translationLoader';
import {
  AuthContext,
  // type AuthContextType,
  type ConsentOptions,
} from './AuthContext.types';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // The tokens are httpOnly cookies the client can't read. The non-secret
        // `authenticated` hint cookie (set/cleared by the server alongside the
        // tokens) tells us whether a session might exist — so a logged-out
        // visitor's cold load makes NO auth request at all (no guaranteed 401
        // / console error). Only probe when the hint is present.
        const hasSessionHint = document.cookie
          .split(';')
          .some(c => c.trim().startsWith('authenticated='));
        if (!hasSessionHint) {
          setUser(null);
          setProfile(null);
          setIsAuthenticated(false);
          return;
        }

        // A hint exists → verify the session. `suppressAuthErrors` keeps a
        // stale-hint 401 (session died server-side) a silent sign-out rather
        // than a "session expired" toast/redirect.
        const profileData = await apiClient.getUserProfile({
          suppressAuthErrors: true,
        });
        logger.debug('Profile data received in AuthContext:', profileData);

        // Validate profileData exists and has required fields
        if (profileData && profileData.id && profileData.email) {
          // Create user object from profile data
          const userData = {
            id: profileData.id,
            email: profileData.email,
            username: profileData.username,
            emailVerified: true, // Assume verified if we got profile
          };

          // Set both user and profile data
          setUser(userData);
          setProfile(profileData);
          setIsAuthenticated(true);

          // Start proactive refresh so the session (and the WS auth cookie)
          // stays alive during long idle periods.
          tokenRefreshManager.startTokenRefreshManager();
        } else {
          logger.error('Invalid profile data received:', {
            hasProfileData: !!profileData,
            hasId: !!(profileData && profileData.id),
            hasEmail: !!(profileData && profileData.email),
          });
          tokenRefreshManager.stopTokenRefreshManager();
          setUser(null);
          setProfile(null);
          setIsAuthenticated(false);
        }
      } catch (error) {
        // No valid session (401) or a transient error — render signed-out.
        logger.debug('No active session on init:', error);
        tokenRefreshManager.stopTokenRefreshManager();
        setUser(null);
        setProfile(null);
        setIsAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const syncLocalPreferencesToDatabase = async () => {
    try {
      const localTheme = localStorage.getItem('theme');
      const localLanguage = localStorage.getItem('language');

      if (localTheme || localLanguage) {
        // Wire field names per BE updateProfileSchema: `theme`, `language`.
        // TS UpdateProfile still uses DB column names (preferredTheme,
        // preferredLang) so we cast at the boundary.
        const updateData: { theme?: string; language?: string } = {};

        if (localTheme && ['light', 'dark', 'system'].includes(localTheme)) {
          updateData.theme = localTheme;
        }

        if (
          localLanguage &&
          ['en', 'cs', 'es', 'de', 'fr', 'zh'].includes(localLanguage)
        ) {
          updateData.language = localLanguage;
        }

        if (Object.keys(updateData).length > 0) {
          await apiClient.updateUserProfile(
            updateData as unknown as Parameters<
              typeof apiClient.updateUserProfile
            >[0]
          );
          logger.debug(
            'Successfully synced local preferences to database:',
            updateData
          );
        }
      }
    } catch (error) {
      logger.warn('Failed to sync local preferences to database:', error);
      // Don't throw error - this shouldn't block login
    }
  };

  const signIn = async (
    email: string,
    password: string,
    rememberMe: boolean = true
  ) => {
    try {
      setLoading(true);

      const authResponse: AuthResponse = await apiClient.login(
        email,
        password,
        rememberMe
      );

      // Set user state immediately (tokens were set as httpOnly cookies by
      // the server; the client never sees them).
      setUser(authResponse.user);
      setIsAuthenticated(true);

      // Start proactive refresh management
      tokenRefreshManager.startTokenRefreshManager();

      // Emit event for localized toast (handled by useAuthToasts hook)
      setTimeout(() => authEventEmitter.emit({ type: 'signin_success' }), 0);

      // Sync localStorage preferences to database
      await syncLocalPreferencesToDatabase();

      // Fetch full profile data including avatar
      try {
        const profileData = await apiClient.getUserProfile();
        if (profileData) {
          setProfile(profileData);
          logger.debug(
            'Profile loaded after sign in with avatarUrl:',
            profileData.avatarUrl
          );
        }
      } catch (profileError) {
        logger.error('Failed to load profile after sign in:', profileError);
        // Don't fail the sign in if profile loading fails
      }

      // NOTE: Share invitation processing moved to Dashboard component
      // to avoid race conditions and ensure proper data refresh.
      // Dashboard will handle the pending share token after navigation.

      navigate('/dashboard');
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error) || 'Sign in failed';
      setTimeout(
        () =>
          authEventEmitter.emit({
            type: 'signin_error',
            data: { error: errorMessage },
          }),
        0
      );
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (
    email: string,
    password: string,
    consentOptions?: ConsentOptions,
    username?: string
  ) => {
    try {
      setLoading(true);
      // Seed the new profile with the language the visitor is actually
      // reading (explicit pick, else browser preference). Registration is
      // the only chance to get this right: afterwards the profile-sync
      // effect in LanguageContext treats the server value as authoritative
      // and would overwrite the detected language with the column default.
      const authResponse: AuthResponse = await apiClient.register(
        email,
        password,
        username,
        consentOptions,
        resolveClientLanguage()
      );

      // The server requires a verified e-mail before sign-in: the account
      // exists, but there is no session. Treating this as signed in would
      // land on a dashboard whose every request is a 401.
      if (authResponse.requiresEmailVerification) {
        setTimeout(
          () => authEventEmitter.emit({ type: 'signup_verification_required' }),
          0
        );
        navigate('/sign-in');
        return;
      }

      setUser(authResponse.user);
      setIsAuthenticated(true);

      // Start proactive refresh management (tokens are httpOnly cookies).
      tokenRefreshManager.startTokenRefreshManager();

      // Emit event for localized toast (handled by useAuthToasts hook)
      setTimeout(() => authEventEmitter.emit({ type: 'signup_success' }), 0);

      // Sync localStorage preferences to database
      await syncLocalPreferencesToDatabase();

      // Fetch full profile data including avatar (new users won't have avatar yet)
      try {
        const profileData = await apiClient.getUserProfile();
        if (profileData) {
          setProfile(profileData);
          logger.debug(
            'Profile loaded after sign up with avatarUrl:',
            profileData.avatarUrl
          );
        }
      } catch (profileError) {
        logger.error('Failed to load profile after sign up:', profileError);
        // Don't fail the sign up if profile loading fails
      }

      // NOTE: Share invitation processing moved to Dashboard component
      // to avoid race conditions and ensure proper data refresh.
      // Dashboard will handle the pending share token after navigation.

      navigate('/dashboard');
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error) || 'Registration failed';
      setTimeout(
        () =>
          authEventEmitter.emit({
            type: 'signup_error',
            data: { error: errorMessage },
          }),
        0
      );
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);

      // Stop token refresh management
      tokenRefreshManager.stopTokenRefreshManager();

      await apiClient.logout();

      setUser(null);
      setProfile(null);
      setIsAuthenticated(false);

      // Toast message will be shown by the calling component
      navigate('/sign-in');
    } catch (error: unknown) {
      logger.error('Error signing out:', error);
      // Even if logout fails on server, clear local state
      tokenRefreshManager.stopTokenRefreshManager();
      setUser(null);
      setProfile(null);
      setIsAuthenticated(false);

      const errorMessage = getErrorMessage(error) || 'Sign out failed';
      setTimeout(
        () =>
          authEventEmitter.emit({
            type: 'logout_error',
            data: { error: errorMessage },
          }),
        0
      );
      navigate('/sign-in');
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async (confirmationEmail: string, password: string) => {
    // A convenience check only - the server verifies both for real.
    if (!confirmationEmail || confirmationEmail !== user?.email || !password) {
      throw new Error(
        'The confirmation e-mail must match your address and the password is required'
      );
    }

    // Deliberately NOT `setLoading(true)`: ProtectedRoute renders a spinner
    // in place of the page while `loading` is set, which unmounts Settings
    // and with it the dialog - so after a mistyped password the dialog, the
    // error and everything typed into it simply vanished. The dialog shows
    // its own progress.
    try {
      await apiClient.deleteAccount({ email: confirmationEmail, password });

      // Only once the account is really gone. Stopping the refresh timer
      // BEFORE the request, as this used to, left a user whose deletion was
      // refused (a mistyped password) signed in with a session that would
      // silently lapse 15 minutes later.
      tokenRefreshManager.stopTokenRefreshManager();

      // A full page load, not `navigate('/')`. Clearing the user here and
      // navigating raced with ProtectedRoute, which saw "no user" first and
      // sent the browser to /sign-in?returnTo=/settings - a login prompt for
      // an account that no longer exists - and remounted the toaster on the
      // way, swallowing the confirmation. A reload also drops every cached
      // query of the deleted account. The flag lets the landing page say
      // what happened (see useAuthToasts).
      try {
        sessionStorage.setItem(ACCOUNT_DELETED_FLAG, '1');
      } catch {
        // Private mode: the user lands on the home page without the toast.
      }
      hardRedirect('/');
    } catch (error: unknown) {
      // No toast from here: the dialog shows one, translated, and knows
      // whether the server refused the credentials or something else broke.
      logger.error('Error deleting account:', error);
      throw error;
    }
  };

  const refreshProfile = async () => {
    if (!user) return;

    try {
      const profileData = await apiClient.getUserProfile();
      logger.debug('Profile refresh data:', profileData);
      if (profileData) {
        setProfile(profileData);
        logger.debug(
          'Profile state updated with avatarUrl:',
          profileData.avatarUrl
        );
      }
    } catch (error: unknown) {
      logger.error('Error refreshing profile:', error);
      const errorMessage =
        getErrorMessage(error) || 'Failed to refresh profile';
      setTimeout(
        () =>
          authEventEmitter.emit({
            type: 'profile_error',
            data: { error: errorMessage },
          }),
        0
      );
      throw error;
    }
  };

  // isAuthenticated is derived purely from the user state now — there is no
  // client-readable token to consult (the access token is an httpOnly cookie).
  useEffect(() => {
    setIsAuthenticated(!!user);
  }, [user]);

  // signIn/signUp/signOut/deleteAccount/refreshProfile are not wrapped in
  // useCallback; their identities change every render. Listing them in the
  // dep array would defeat the memo. We exclude them deliberately because
  // their bodies reference only stable useState setters, react-router's
  // navigate, and module-level apiClient — no captured local state — so
  // stale-closure risk is bounded. A follow-up should wrap each callback
  // in useCallback so the dep list becomes complete.
  // Both are derived from the profile the server returned, never from
  // anything the client decided for itself. `isAdmin` only decides what to
  // render; `impersonatedBy` is the single signal that `user`/`profile`
  // describe someone the admin is acting AS rather than the person signed in.
  const isAdmin = profile?.isAdmin === true;
  const impersonatedBy = profile?.impersonatedBy ?? null;

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      isAuthenticated,
      isAdmin,
      impersonatedBy,
      signIn,
      signUp,
      signOut,
      deleteAccount,
      refreshProfile,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, profile, loading, isAuthenticated, isAdmin, impersonatedBy]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// useAuth is exported from './exports' to avoid Fast Refresh warnings
