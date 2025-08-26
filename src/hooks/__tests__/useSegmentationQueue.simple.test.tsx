import { renderHook } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useSegmentationQueue } from '../useSegmentationQueue';
import React from 'react';
import { AuthProvider } from '@/contexts/AuthContext';
import { WebSocketProvider } from '@/contexts/WebSocketContext';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

// Mock the webSocketManager
vi.mock('@/services/webSocketManager', () => ({
  default: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(() => ({ off: vi.fn() })),
    off: vi.fn(),
    emit: vi.fn(),
    isConnected: vi.fn(() => false),
  },
}));

// Create a test wrapper with all required providers
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <LanguageProvider>
            <WebSocketProvider>{children}</WebSocketProvider>
          </LanguageProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

describe('useSegmentationQueue - Simple Tests', () => {
  const mockProjectId = 'test-project-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize without throwing', () => {
    expect(() => {
      renderHook(() => useSegmentationQueue(mockProjectId), {
        wrapper: createWrapper(),
      });
    }).not.toThrow();
  });

  it('should handle undefined projectId without throwing', () => {
    expect(() => {
      renderHook(() => useSegmentationQueue(undefined), {
        wrapper: createWrapper(),
      });
    }).not.toThrow();
  });

  it('should return expected hook interface', () => {
    const { result } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    // Check that hook returns expected properties
    expect(result.current).toHaveProperty('lastUpdate');
    expect(result.current).toHaveProperty('queueStats');
    expect(result.current).toHaveProperty('isConnected');

    // Check initial values
    expect(result.current.lastUpdate).toBe(null);
    expect(result.current.queueStats).toBe(null);
    expect(typeof result.current.isConnected).toBe('boolean');
  });

  it('should handle disabled mode correctly', () => {
    const { result } = renderHook(
      () => useSegmentationQueue('DISABLE_GLOBAL'),
      {
        wrapper: createWrapper(),
      }
    );

    expect(result.current.lastUpdate).toBe(null);
    expect(result.current.queueStats).toBe(null);
    expect(result.current.isConnected).toBe(false);
  });

  it('should clean up properly on unmount', () => {
    const { unmount } = renderHook(() => useSegmentationQueue(mockProjectId), {
      wrapper: createWrapper(),
    });

    expect(() => unmount()).not.toThrow();
  });
});
