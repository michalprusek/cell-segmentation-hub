import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  MockedFunction,
} from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAdvancedExport } from '../useAdvancedExport';
import apiClient from '@/lib/api';
import { useWebSocket } from '@/contexts/useWebSocket';
import ExportStateManager from '@/lib/exportStateManager';
import { logger } from '@/lib/logger';
import { downloadFromResponse } from '@/lib/downloadUtils';

// Mock dependencies
vi.mock('@/lib/api');
vi.mock('@/contexts/useWebSocket');
vi.mock('@/lib/exportStateManager');
vi.mock('@/lib/logger');
vi.mock('@/lib/downloadUtils');

const mockApiClient = vi.mocked(apiClient);
const mockUseWebSocket = vi.mocked(useWebSocket);
const mockExportStateManager = vi.mocked(ExportStateManager);
const mockLogger = vi.mocked(logger);
const mockDownloadFromResponse = vi.mocked(downloadFromResponse);

describe('useAdvancedExport - Auto-Download Protection Tests', () => {
  let mockSocket: any;
  const mockProjectId = 'project-123';
  const mockProjectName = 'Test Project';

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock socket
    mockSocket = {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    mockUseWebSocket.mockReturnValue({
      socket: mockSocket,
      isConnected: true,
    });

    // Setup ExportStateManager mocks
    mockExportStateManager.getExportState = vi.fn().mockReturnValue(null);
    mockExportStateManager.saveExportState = vi.fn();
    mockExportStateManager.saveExportStateThrottled = vi.fn();
    mockExportStateManager.clearExportState = vi.fn();

    // Setup logger mocks
    mockLogger.info = vi.fn();
    mockLogger.error = vi.fn();
    mockLogger.warn = vi.fn();

    // Setup download utilities mock
    mockDownloadFromResponse.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Auto-Download Protection - Cancellation Checks', () => {
    it('should not auto-download cancelled exports', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup completed job that gets cancelled
      act(() => {
        result.current.setCurrentJob({
          id: 'test-job',
          status: 'completed',
          progress: 100,
          filePath: 'test.zip',
        } as any);
        result.current.setCompletedJobId('test-job');
      });

      // Simulate cancellation before auto-download
      act(() => {
        result.current.setCurrentJob(
          prev =>
            ({
              ...prev!,
              status: 'cancelled',
            }) as any
        );
      });

      // Fast-forward through the auto-download delay
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Wait for any promises to resolve
      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Download should not have been triggered
      expect(mockApiClient.get).not.toHaveBeenCalledWith(
        `/projects/${mockProjectId}/export/test-job/download`,
        expect.anything()
      );
      expect(mockDownloadFromResponse).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Export] Auto-download skipped - job was cancelled',
        { jobId: 'test-job' }
      );

      vi.useRealTimers();
    });

    it('should cancel auto-download if job becomes cancelled during delay', async () => {
      vi.useFakeTimers();

      mockApiClient.get = vi.fn().mockResolvedValue({
        data: new Blob(['test data']),
      });

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup completed job
      act(() => {
        result.current.setCurrentJob({
          id: 'test-delay-cancel',
          status: 'completed',
          progress: 100,
          filePath: 'test.zip',
        } as any);
        result.current.setCompletedJobId('test-delay-cancel');
      });

      // Fast-forward to halfway through the delay
      act(() => {
        vi.advanceTimersByTime(500);
      });

      // Cancel job during delay
      act(() => {
        result.current.setCurrentJob(
          prev =>
            ({
              ...prev!,
              status: 'cancelled',
            }) as any
        );
      });

      // Complete the delay
      act(() => {
        vi.advanceTimersByTime(500);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Download should be cancelled
      expect(mockApiClient.get).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Export] Auto-download cancelled during delay check',
        expect.objectContaining({
          jobId: 'test-delay-cancel',
          currentStatus: 'cancelled',
        })
      );

      vi.useRealTimers();
    });

    it('should clear completedJobId for cancelled exports', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup completed job
      act(() => {
        result.current.setCurrentJob({
          id: 'test-clear-job',
          status: 'completed',
          progress: 100,
        } as any);
        result.current.setCompletedJobId('test-clear-job');
      });

      // Cancel the job
      act(() => {
        result.current.setCurrentJob(
          prev =>
            ({
              ...prev!,
              status: 'cancelled',
            }) as any
        );
      });

      await waitFor(() => {
        expect(result.current.completedJobId).toBeNull();
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Clearing completedJobId for cancelled export'
      );
    });

    it('should handle WebSocket cancellation events correctly', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup processing job
      act(() => {
        result.current.setCurrentJob({
          id: 'websocket-cancel-job',
          status: 'processing',
          progress: 50,
        } as any);
      });

      // Get the WebSocket event handler for cancellation
      const cancelHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:cancelled'
      )?.[1];

      expect(cancelHandler).toBeDefined();

      // Simulate WebSocket cancellation event
      act(() => {
        cancelHandler({
          jobId: 'websocket-cancel-job',
          previousStatus: 'processing',
          cancelledAt: new Date().toISOString(),
        });
      });

      // Assert: All states should be cleared
      await waitFor(() => {
        expect(result.current.currentJob?.status).toBe('cancelled');
        expect(result.current.isExporting).toBe(false);
        expect(result.current.isDownloading).toBe(false);
        expect(result.current.completedJobId).toBeNull();
      });

      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Export] Job cancelled',
        expect.anything()
      );
    });
  });

  describe('Manual Download Protection', () => {
    it('should block manual download for cancelled jobs', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup cancelled job with completedJobId
      act(() => {
        result.current.setCurrentJob({
          id: 'manual-cancel-job',
          status: 'cancelled',
          progress: 100,
        } as any);
        result.current.setCompletedJobId('manual-cancel-job');
      });

      // Attempt manual download
      await act(async () => {
        await result.current.triggerDownload();
      });

      // Assert: Download should be blocked
      expect(mockApiClient.get).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Export] Manual download blocked - job was cancelled',
        { jobId: 'manual-cancel-job' }
      );

      // CompletedJobId should be cleared
      expect(result.current.completedJobId).toBeNull();
    });

    it('should allow manual download for completed non-cancelled jobs', async () => {
      mockApiClient.get = vi.fn().mockResolvedValue({
        data: new Blob(['test data']),
      });

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup completed job
      act(() => {
        result.current.setCurrentJob({
          id: 'manual-success-job',
          status: 'completed',
          progress: 100,
        } as any);
        result.current.setCompletedJobId('manual-success-job');
      });

      // Trigger manual download
      await act(async () => {
        await result.current.triggerDownload();
      });

      // Assert: Download should proceed
      expect(mockApiClient.get).toHaveBeenCalledWith(
        `/projects/${mockProjectId}/export/manual-success-job/download`,
        expect.objectContaining({
          responseType: 'blob',
          timeout: 300000,
        })
      );
      expect(mockDownloadFromResponse).toHaveBeenCalled();
    });
  });

  describe('Race Condition Scenarios', () => {
    it('should handle completion event arriving after cancellation', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup processing job
      act(() => {
        result.current.setCurrentJob({
          id: 'race-condition-job',
          status: 'processing',
          progress: 80,
        } as any);
      });

      // User cancels export
      await act(async () => {
        await result.current.cancelExport();
      });

      // WebSocket completion event arrives late (race condition)
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({
          jobId: 'race-condition-job',
        });
      });

      // Assert: Should not trigger download or change status
      expect(result.current.isDownloading).toBe(false);
      expect(result.current.completedJobId).toBeNull();
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Export completion ignored - export was cancelled',
        { jobId: 'race-condition-job' }
      );
    });

    it('should handle multiple rapid state changes', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Rapid sequence: start → complete → cancel → complete
      act(() => {
        result.current.setCurrentJob({
          id: 'rapid-changes-job',
          status: 'processing',
          progress: 0,
        } as any);
      });

      act(() => {
        result.current.setCurrentJob(
          prev =>
            ({
              ...prev!,
              status: 'completed',
              progress: 100,
            }) as any
        );
        result.current.setCompletedJobId('rapid-changes-job');
      });

      act(() => {
        result.current.setCurrentJob(
          prev =>
            ({
              ...prev!,
              status: 'cancelled',
            }) as any
        );
      });

      // Try to complete again (late event)
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({
          jobId: 'rapid-changes-job',
        });
      });

      // Fast-forward through auto-download delay
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Final state should be cancelled, no download
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.completedJobId).toBeNull();
      expect(mockApiClient.get).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should handle status check race condition during polling', async () => {
      // Mock API responses for polling
      mockApiClient.get = vi
        .fn()
        .mockResolvedValueOnce({
          data: { status: 'processing', progress: 90 },
        })
        .mockResolvedValueOnce({
          data: { status: 'completed', progress: 100 },
        });

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup processing job with WebSocket disconnected (to trigger polling)
      act(() => {
        mockSocket.connected = false;
        result.current.setCurrentJob({
          id: 'polling-race-job',
          status: 'processing',
          progress: 80,
        } as any);
        result.current.setIsExporting(true);
      });

      // Cancel job while polling is active
      await act(async () => {
        await result.current.cancelExport();
      });

      // Simulate polling response arriving after cancellation
      await act(async () => {
        await Promise.resolve(); // Let any pending promises resolve
      });

      // Assert: Job should remain cancelled despite polling response
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.completedJobId).toBeNull();
      expect(result.current.isExporting).toBe(false);
    });
  });

  describe('State Persistence During Cancellation', () => {
    it('should clear persisted state immediately on cancellation', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job
      act(() => {
        result.current.setCurrentJob({
          id: 'persistence-job',
          status: 'processing',
          progress: 50,
        } as any);
        result.current.setIsExporting(true);
      });

      // Cancel export
      await act(async () => {
        await result.current.cancelExport();
      });

      // Assert: Persistence should be cleared immediately
      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
    });

    it('should not restore cancelled jobs from persistence', async () => {
      // Mock persisted cancelled state
      mockExportStateManager.getExportState = vi.fn().mockReturnValue({
        jobId: 'cancelled-persisted-job',
        status: 'cancelled',
        progress: 100,
        exportStatus: 'Export was cancelled',
      });

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Wait for initialization
      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Should not restore cancelled job or trigger any downloads
      expect(result.current.currentJob).toBeNull();
      expect(result.current.isExporting).toBe(false);
      expect(result.current.completedJobId).toBeNull();
    });

    it('should handle cross-tab cancellation sync', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job
      act(() => {
        result.current.setCurrentJob({
          id: 'cross-tab-job',
          status: 'processing',
          progress: 70,
        } as any);
      });

      // Simulate cross-tab cancellation (storage event)
      const cancelHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:cancelled'
      )?.[1];

      act(() => {
        cancelHandler({
          jobId: 'cross-tab-job',
          previousStatus: 'processing',
          cancelledAt: new Date().toISOString(),
        });
      });

      // Assert: State should be synced across tabs
      await waitFor(() => {
        expect(result.current.currentJob?.status).toBe('cancelled');
        expect(result.current.isExporting).toBe(false);
        expect(result.current.completedJobId).toBeNull();
      });

      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
    });
  });

  describe('Error Handling During Cancellation', () => {
    it('should handle cancellation API errors gracefully', async () => {
      mockApiClient.post = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job
      act(() => {
        result.current.setCurrentJob({
          id: 'error-cancel-job',
          status: 'processing',
          progress: 30,
        } as any);
      });

      // Attempt cancellation (should not throw)
      await act(async () => {
        await result.current.cancelExport();
      });

      // Assert: Error should be logged but not crash
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to cancel export',
        expect.any(Error)
      );

      // State should still be updated locally for UI consistency
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.isExporting).toBe(false);
    });

    it('should handle download errors after cancellation', async () => {
      vi.useFakeTimers();

      mockApiClient.get = vi
        .fn()
        .mockRejectedValue(new Error('File not found'));

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup completed job
      act(() => {
        result.current.setCurrentJob({
          id: 'download-error-job',
          status: 'completed',
          progress: 100,
        } as any);
        result.current.setCompletedJobId('download-error-job');
      });

      // Cancel before auto-download but let it try to download
      act(() => {
        result.current.setCurrentJob(
          prev =>
            ({
              ...prev!,
              status: 'cancelled',
            }) as any
        );
      });

      // Fast-forward auto-download delay
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Should skip download due to cancellation, not error
      expect(mockApiClient.get).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[Export] Auto-download skipped - job was cancelled',
        { jobId: 'download-error-job' }
      );

      vi.useRealTimers();
    });
  });

  describe('Timing and Performance', () => {
    it('should respond to cancellation within reasonable time', async () => {
      const startTime = performance.now();

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job
      act(() => {
        result.current.setCurrentJob({
          id: 'timing-job',
          status: 'processing',
          progress: 60,
        } as any);
      });

      // Cancel export
      await act(async () => {
        await result.current.cancelExport();
      });

      const endTime = performance.now();
      const duration = endTime - startTime;

      // Assert: Cancellation should be fast (under 100ms in test environment)
      expect(duration).toBeLessThan(100);
      expect(result.current.currentJob?.status).toBe('cancelled');
    });

    it('should handle high-frequency state changes efficiently', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Rapid state changes
      const operations = Array.from({ length: 50 }, (_, i) => () => {
        act(() => {
          result.current.setCurrentJob({
            id: `rapid-job-${i}`,
            status: i % 2 === 0 ? 'processing' : 'cancelled',
            progress: i * 2,
          } as any);
        });
      });

      // Execute all operations
      operations.forEach(op => op());

      // Final cancellation
      await act(async () => {
        await result.current.cancelExport();
      });

      // Assert: Should handle all changes without issues
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle cancellation with no current job', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Attempt cancellation with no job (should not throw)
      await act(async () => {
        await result.current.cancelExport();
      });

      // Assert: Should handle gracefully
      expect(result.current.currentJob).toBeNull();
      expect(mockApiClient.post).not.toHaveBeenCalled();
    });

    it('should handle auto-download with no current job', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Set completedJobId without currentJob
      act(() => {
        result.current.setCompletedJobId('orphaned-job');
      });

      // Fast-forward auto-download delay
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Should not attempt download
      expect(mockApiClient.get).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should handle WebSocket disconnection during cancellation', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job and disconnect WebSocket
      act(() => {
        result.current.setCurrentJob({
          id: 'disconnect-cancel-job',
          status: 'processing',
          progress: 40,
        } as any);
        mockSocket.connected = false;
      });

      // Cancel export with disconnected WebSocket
      await act(async () => {
        await result.current.cancelExport();
      });

      // Assert: Cancellation should still work
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.isExporting).toBe(false);
      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
    });
  });
});
