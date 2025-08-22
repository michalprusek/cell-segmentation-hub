/**
 * React test component wrappers
 */

import * as React from 'react';
import { vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthContext } from '@/contexts/AuthContext';
import type { User, Profile } from '@/types';

// Mock contexts for testing
export const MockLanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <LanguageProvider>{children}</LanguageProvider>;

export const MockThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Mock window.matchMedia for tests
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  return <ThemeProvider>{children}</ThemeProvider>;
};

export const MockAuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
  };

  const mockProfile = {
    id: 'test-profile-id',
    userId: 'test-user-id',
    bio: 'Test bio',
    avatarUrl: 'https://example.com/avatar.jpg',
  };

  const mockAuthContext = {
    user: mockUser,
    profile: mockProfile,
    token: 'test-token',
    loading: false,
    isAuthenticated: true,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    deleteAccount: vi.fn(),
    refreshProfile: vi.fn(),
  };

  return (
    <AuthContext.Provider value={mockAuthContext}>
      {children}
    </AuthContext.Provider>
  );
};

// All providers wrapper for testing
export const AllProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <MockAuthProvider>
    <MockLanguageProvider>
      <MockThemeProvider>{children}</MockThemeProvider>
    </MockLanguageProvider>
  </MockAuthProvider>
);
