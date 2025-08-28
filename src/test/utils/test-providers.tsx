import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';

// Mock all context providers with proper values
const MockAuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const mockContext = {
    user: null,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    refreshToken: vi.fn(),
    updateProfile: vi.fn(),
    deleteAccount: vi.fn(),
    isLoading: false,
  };

  return React.createElement(React.Fragment, null, children);
};

const MockThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const mockContext = {
    theme: 'system' as const,
    setTheme: vi.fn(),
    resolvedTheme: 'light' as const,
  };

  return React.createElement(React.Fragment, null, children);
};

const MockLanguageProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const mockContext = {
    language: 'en',
    setLanguage: vi.fn(),
    t: (key: string) => key,
  };

  return React.createElement(React.Fragment, null, children);
};

const MockWebSocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const mockContext = {
    socket: {
      connected: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
    isConnected: false,
    connectionStatus: 'disconnected' as const,
    lastUpdate: null,
    queueStats: {
      total: 0,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
    },
  };

  return React.createElement(React.Fragment, null, children);
};

const MockModelProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const mockContext = {
    selectedModel: 'hrnet_v2' as const,
    setSelectedModel: vi.fn(),
    threshold: 0.5,
    setThreshold: vi.fn(),
    modelConfig: {
      hrnet_v2: { name: 'HRNet V2', threshold: 0.5 },
      resunet_small: { name: 'ResUNet Small', threshold: 0.5 },
      resunet_advanced: { name: 'ResUNet Advanced', threshold: 0.5 },
    },
  };

  return React.createElement(React.Fragment, null, children);
};

// Create a test query client with proper configuration
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

// All providers wrapper for testing
export const AllProviders: React.FC<{
  children: React.ReactNode;
  queryClient?: QueryClient;
}> = ({ children, queryClient }) => {
  const testQueryClient = queryClient || createTestQueryClient();

  return (
    <BrowserRouter>
      <QueryClientProvider client={testQueryClient}>
        <MockAuthProvider>
          <MockThemeProvider>
            <MockLanguageProvider>
              <MockWebSocketProvider>
                <MockModelProvider>{children}</MockModelProvider>
              </MockWebSocketProvider>
            </MockLanguageProvider>
          </MockThemeProvider>
        </MockAuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};
