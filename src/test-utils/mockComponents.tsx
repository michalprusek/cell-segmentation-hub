import React from 'react';
import { vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';

// Mock contexts for testing
export const MockLanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <LanguageProvider>{children}</LanguageProvider>;

export const MockThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <ThemeProvider>{children}</ThemeProvider>;

export const MockAuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    username: 'testuser',
  };

  const mockProfile = {
    id: 'test-profile-id',
    userId: 'test-user-id',
    consentToMLTraining: true,
    consentToAlgorithmImprovement: true,
    consentToDataProcessing: true,
    emailVerified: true,
    fullName: 'Test User',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return (
    <AuthProvider
      value={{
        user: mockUser,
        profile: mockProfile,
        login: vi.fn(),
        logout: vi.fn(),
        register: vi.fn(),
        isLoading: false,
        error: null,
        refreshProfile: vi.fn(),
        updateProfile: vi.fn(),
      }}
    >
      {children}
    </AuthProvider>
  );
};

export const MockSegmentationProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  return <div data-testid="mock-segmentation-provider">{children}</div>;
};
