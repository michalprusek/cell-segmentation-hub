import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient, { AuthResponse } from '@/lib/api';
import { User, Profile, getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';
import { authEventEmitter } from '@/lib/authEvents';

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
          // Validate profileData before constructing user object
          if (
            profileData &&
            (profileData.user || (profileData.id && profileData.email))
          ) {
            const userData = profileData.user || {
              id: profileData.id,
              email: profileData.email,
              username: profileData.username,
            };

            // Validate required fields exist and are not empty
            if (userData.id && userData.email) {
              setUser(userData);
              setProfile(profileData);
              setIsAuthenticated(true);
            } else {
              logger.error('Missing required user fields:', {
                id: userData.id,
                email: userData.email,
              });
              // Clear state if required fields are missing
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
          } else {
            // Invalid profile data, clear state
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

      // Emit event for localized toast (handled by useAuthToasts hook)
      authEventEmitter.emit({ type: 'signin_success' });

      // Don't fetch profile immediately - let it happen naturally later
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error) || 'Sign in failed';
      authEventEmitter.emit({
        type: 'signin_error',
        data: { error: errorMessage },
      });
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

      // Emit event for localized toast (handled by useAuthToasts hook)
      authEventEmitter.emit({ type: 'signup_success' });

      navigate('/dashboard');

      // Don't fetch profile immediately - let it happen naturally later
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error) || 'Registration failed';
      authEventEmitter.emit({
        type: 'signup_error',
        data: { error: errorMessage },
      });
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
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
      setUser(null);
      setProfile(null);
      setToken(null);
      setIsAuthenticated(false);

      const errorMessage = getErrorMessage(error) || 'Sign out failed';
      authEventEmitter.emit({
        type: 'logout_error',
        data: { error: errorMessage },
      });
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
      authEventEmitter.emit({
        type: 'profile_error',
        data: { error: errorMessage },
      });
      throw error;
    } finally {
      setLoading(false);
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
