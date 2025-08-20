import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { AuthResponse } from '@/lib/api';
import { User, Profile, getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';
import { authEventEmitter } from '@/lib/authEvents';
import { tokenRefreshManager } from '@/lib/tokenRefresh';

interface ConsentOptions {
  consentToMLTraining?: boolean;
  consentToAlgorithmImprovement?: boolean;
  consentToFeatureDevelopment?: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
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

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextType | undefined>(
  undefined
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Check if user is authenticated by checking if we have tokens
        if (apiClient.isAuthenticated()) {
          // Get the current access token
          const accessToken = apiClient.getAccessToken();
          setToken(accessToken);

          // Try to fetch user profile to verify token is still valid
          const profileData = await apiClient.getUserProfile();
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

            // Start token refresh management
            tokenRefreshManager.startTokenRefreshManager();
          } else {
            logger.error('Invalid profile data received:', {
              hasProfileData: !!profileData,
              hasId: !!(profileData && profileData.id),
              hasEmail: !!(profileData && profileData.email),
            });
            // Stop token refresh management
            tokenRefreshManager.stopTokenRefreshManager();
            // Clear state if profile data is invalid
            setUser(null);
            setProfile(null);
            setToken(null);
            setIsAuthenticated(false);
            try {
              await apiClient.logout();
            } catch (logoutError) {
              logger.error('Error during logout:', logoutError);
            }
          }
        }
      } catch (error) {
        logger.error('Error initializing auth:', error);
        // Stop token refresh management
        tokenRefreshManager.stopTokenRefreshManager();
        // If token is invalid, clear it
        try {
          await apiClient.logout();
        } catch (logoutError) {
          logger.error('Error during logout:', logoutError);
        }
        setUser(null);
        setProfile(null);
        setToken(null);
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
        const updateData: {
          preferred_theme?: string;
          preferredLang?: string;
        } = {};

        if (localTheme && ['light', 'dark', 'system'].includes(localTheme)) {
          updateData.preferred_theme = localTheme;
        }

        if (
          localLanguage &&
          ['en', 'cs', 'es', 'de', 'fr', 'zh'].includes(localLanguage)
        ) {
          updateData.preferredLang = localLanguage;
        }

        if (Object.keys(updateData).length > 0) {
          await apiClient.updateUserProfile(updateData);
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

      // Set user state immediately
      setUser(authResponse.user);
      setIsAuthenticated(true);

      // Get and set the access token
      const accessToken = apiClient.getAccessToken();
      setToken(accessToken);

      // Start token refresh management
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
      const authResponse: AuthResponse = await apiClient.register(
        email,
        password,
        username,
        consentOptions
      );

      setUser(authResponse.user);
      setIsAuthenticated(true);

      // Get and set the access token
      const accessToken = apiClient.getAccessToken();
      setToken(accessToken);

      // Start token refresh management
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
      setToken(null);
      setIsAuthenticated(false);

      // Toast message will be shown by the calling component
      navigate('/sign-in');
    } catch (error: unknown) {
      logger.error('Error signing out:', error);
      // Even if logout fails on server, clear local state
      tokenRefreshManager.stopTokenRefreshManager();
      setUser(null);
      setProfile(null);
      setToken(null);
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

  const deleteAccount = async (confirmationText?: string) => {
    // Validate confirmation text is provided and matches expected value
    if (!confirmationText || confirmationText !== user?.email) {
      throw new Error(
        'Confirmation text is required and must match your email address'
      );
    }

    try {
      setLoading(true);

      // Stop token refresh management
      tokenRefreshManager.stopTokenRefreshManager();

      await apiClient.deleteAccount();

      setUser(null);
      setProfile(null);
      setToken(null);
      setIsAuthenticated(false);

      // Toast message will be shown by the calling component
      navigate('/');
    } catch (error: unknown) {
      logger.error('Error deleting account:', error);
      const errorMessage = getErrorMessage(error) || 'Failed to delete account';
      setTimeout(
        () =>
          authEventEmitter.emit({
            type: 'profile_error',
            data: { error: errorMessage },
          }),
        0
      );
      throw error;
    } finally {
      setLoading(false);
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

  // Update isAuthenticated and token when user state changes
  useEffect(() => {
    const isAuth = apiClient.isAuthenticated() && !!user;
    setIsAuthenticated(isAuth);
    if (isAuth) {
      const currentToken = apiClient.getAccessToken();
      setToken(currentToken);
    }
  }, [user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        token,
        loading,
        isAuthenticated,
        signIn,
        signUp,
        signOut,
        deleteAccount,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
