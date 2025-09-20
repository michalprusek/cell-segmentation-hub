import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

describe('Export Race Condition Scenarios - Frontend Tests', () => {
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

  describe('The Exact Bug Report Race Condition', () => {
    it('should prevent download of export f574e1b4-b0a5-4035-95d0-18fef944762d cancelled at 8 seconds', async () => {
      // This test recreates the exact scenario from the bug report
      vi.useFakeTimers();

      const bugReportJobId = 'f574e1b4-b0a5-4035-95d0-18fef944762d';

      mockApiClient.post = vi
        .fn()
        .mockResolvedValue({ data: { jobId: bugReportJobId } });
      mockApiClient.get = vi.fn().mockResolvedValue({
        data: new Blob(['test data']),
      });

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // T+0ms: Start export (16:45:42.470Z in logs)
      await act(async () => {
        await result.current.startExport();
      });

      // T+0ms: Set job to processing state
      act(() => {
        result.current.setCurrentJob({
          id: bugReportJobId,
          status: 'processing',
          progress: 10,
        } as any);
      });

      // T+7500ms: User clicks cancel (approximately 7.5 seconds after start)
      act(() => {
        vi.advanceTimersByTime(7500);
      });

      await act(async () => {
        await result.current.cancelExport();
      });

      // T+8000ms: Processing completes and tries to send completion event (16:45:50.387Z)
      act(() => {
        vi.advanceTimersByTime(500); // 500ms after cancellation
      });

      // Simulate late completion WebSocket event (the race condition)
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({
          jobId: bugReportJobId,
        });
      });

      // T+9000ms: Auto-download delay would trigger here
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: The critical bug should be fixed
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.completedJobId).toBeNull();
      expect(result.current.isDownloading).toBe(false);
      expect(mockApiClient.get).not.toHaveBeenCalledWith(
        `/projects/${mockProjectId}/export/${bugReportJobId}/download`,
        expect.anything()
      );
      expect(mockDownloadFromResponse).not.toHaveBeenCalled();

      // Should log the race condition prevention
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Export completion ignored - export was cancelled',
        { jobId: bugReportJobId }
      );

      vi.useRealTimers();
    });

    it('should handle the exact timing window: 500ms between cancel and completion', async () => {
      vi.useFakeTimers();

      const jobId = 'timing-window-test';
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup processing job
      act(() => {
        result.current.setCurrentJob({
          id: jobId,
          status: 'processing',
          progress: 90,
        } as any);
      });

      // Cancel at T+0
      await act(async () => {
        await result.current.cancelExport();
      });

      // Completion event arrives 500ms later (exact timing from logs)
      act(() => {
        vi.advanceTimersByTime(500);
      });

      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({ jobId });
      });

      // Auto-download would trigger another 1000ms later
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Should remain cancelled despite the timing window
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.completedJobId).toBeNull();
      expect(mockApiClient.get).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('Multi-Step Race Condition Scenarios', () => {
    it('should handle rapid start→cancel→complete→start sequence', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Step 1: Start export
      mockApiClient.post = vi
        .fn()
        .mockResolvedValue({ data: { jobId: 'rapid-job-1' } });

      await act(async () => {
        await result.current.startExport();
      });

      act(() => {
        result.current.setCurrentJob({
          id: 'rapid-job-1',
          status: 'processing',
          progress: 30,
        } as any);
      });

      // Step 2: Cancel quickly
      await act(async () => {
        await result.current.cancelExport();
      });

      // Step 3: Late completion event
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({ jobId: 'rapid-job-1' });
      });

      // Step 4: Start new export immediately
      mockApiClient.post = vi
        .fn()
        .mockResolvedValue({ data: { jobId: 'rapid-job-2' } });

      await act(async () => {
        await result.current.startExport();
      });

      act(() => {
        result.current.setCurrentJob({
          id: 'rapid-job-2',
          status: 'processing',
          progress: 0,
        } as any);
      });

      // Fast-forward through any auto-download attempts
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Should be working on new job, not affected by old race condition
      expect(result.current.currentJob?.id).toBe('rapid-job-2');
      expect(result.current.currentJob?.status).toBe('processing');
      expect(result.current.completedJobId).toBeNull();
      expect(mockDownloadFromResponse).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should handle concurrent WebSocket events for different jobs', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup current job
      act(() => {
        result.current.setCurrentJob({
          id: 'current-job',
          status: 'processing',
          progress: 60,
        } as any);
      });

      // Get WebSocket handlers
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];
      const cancelHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:cancelled'
      )?.[1];

      // Simulate events for different jobs arriving simultaneously
      act(() => {
        // Event for different job (should be ignored)
        completionHandler({ jobId: 'different-job' });

        // Event for current job (should be processed)
        cancelHandler({
          jobId: 'current-job',
          previousStatus: 'processing',
          cancelledAt: new Date().toISOString(),
        });

        // Another event for different job (should be ignored)
        completionHandler({ jobId: 'another-job' });
      });

      // Assert: Only the relevant event should be processed
      await waitFor(() => {
        expect(result.current.currentJob?.status).toBe('cancelled');
        expect(result.current.completedJobId).toBeNull();
      });

      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
    });

    it('should handle state persistence race conditions', async () => {
      vi.useFakeTimers();

      // Mock persistence initially returning a processing job
      mockExportStateManager.getExportState = vi.fn().mockReturnValue({
        jobId: 'persistent-job',
        status: 'processing',
        progress: 70,
        exportStatus: 'Processing...',
      });

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Job gets restored from persistence
      await act(async () => {
        await Promise.resolve();
      });

      // Simulate rapid cancellation before restoration completes
      await act(async () => {
        await result.current.cancelExport();
      });

      // Simulate late status check response (from checkResumedExportStatus)
      mockApiClient.get = vi.fn().mockResolvedValue({
        data: { status: 'completed', progress: 100 },
      });

      // Status check completes after cancellation
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Cancellation should take precedence over late status check
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.completedJobId).toBeNull();
      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );

      vi.useRealTimers();
    });
  });

  describe('Edge Case Race Conditions', () => {
    it('should handle completion event during cancellation API call', async () => {
      // Mock cancellation API to be slow
      let resolveCancellation: () => void;
      const cancellationPromise = new Promise<void>(resolve => {
        resolveCancellation = resolve;
      });

      mockApiClient.post = vi.fn().mockReturnValue(cancellationPromise);

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job
      act(() => {
        result.current.setCurrentJob({
          id: 'slow-cancel-job',
          status: 'processing',
          progress: 95,
        } as any);
      });

      // Start cancellation (but don't resolve yet)
      const cancelPromise = act(async () => {
        await result.current.cancelExport();
      });

      // Completion event arrives while cancellation is in flight
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({ jobId: 'slow-cancel-job' });
      });

      // Now resolve the cancellation
      act(() => {
        resolveCancellation!();
      });

      await cancelPromise;

      // Assert: Cancellation should win
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.completedJobId).toBeNull();
    });

    it('should handle multiple overlapping auto-download attempts', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup completed job
      act(() => {
        result.current.setCurrentJob({
          id: 'overlap-job',
          status: 'completed',
          progress: 100,
        } as any);
        result.current.setCompletedJobId('overlap-job');
      });

      // Trigger multiple completion events (race condition)
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({ jobId: 'overlap-job' });
        completionHandler({ jobId: 'overlap-job' });
        completionHandler({ jobId: 'overlap-job' });
      });

      // Cancel during auto-download delay
      act(() => {
        vi.advanceTimersByTime(500);
      });

      await act(async () => {
        await result.current.cancelExport();
      });

      // Complete the auto-download delays
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Only should prevent all downloads
      expect(mockApiClient.get).not.toHaveBeenCalled();
      expect(result.current.currentJob?.status).toBe('cancelled');

      vi.useRealTimers();
    });

    it('should handle cross-tab state synchronization race conditions', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Tab 1: Start export
      act(() => {
        result.current.setCurrentJob({
          id: 'cross-tab-job',
          status: 'processing',
          progress: 50,
        } as any);
      });

      // Tab 2: Cancel export (simulated via WebSocket)
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

      // Tab 1: Late completion event (race condition)
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({ jobId: 'cross-tab-job' });
      });

      // Assert: Cross-tab cancellation should take precedence
      await waitFor(() => {
        expect(result.current.currentJob?.status).toBe('cancelled');
        expect(result.current.completedJobId).toBeNull();
      });

      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
    });

    it('should handle WebSocket reconnection during export lifecycle', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job and disconnect WebSocket
      act(() => {
        result.current.setCurrentJob({
          id: 'reconnect-job',
          status: 'processing',
          progress: 80,
        } as any);
        mockSocket.connected = false;
      });

      // Cancel while disconnected
      await act(async () => {
        await result.current.cancelExport();
      });

      // WebSocket reconnects
      act(() => {
        mockSocket.connected = true;
      });

      // Late events arrive after reconnection
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({ jobId: 'reconnect-job' });
      });

      // Fast-forward auto-download delay
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Should maintain cancelled state despite reconnection
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(mockApiClient.get).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('Performance Under Race Conditions', () => {
    it('should handle rapid event bursts without memory leaks', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job
      act(() => {
        result.current.setCurrentJob({
          id: 'burst-job',
          status: 'processing',
          progress: 90,
        } as any);
      });

      // Get event handlers
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];
      const progressHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:progress'
      )?.[1];

      // Send burst of events
      act(() => {
        for (let i = 0; i < 100; i++) {
          progressHandler({ jobId: 'burst-job', progress: 90 + i * 0.1 });
          completionHandler({ jobId: 'burst-job' });
        }
      });

      // Cancel during burst
      await act(async () => {
        await result.current.cancelExport();
      });

      // Send more events after cancellation
      act(() => {
        for (let i = 0; i < 50; i++) {
          completionHandler({ jobId: 'burst-job' });
        }
      });

      // Assert: Should handle gracefully without errors
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.completedJobId).toBeNull();

      // Should log race condition prevention
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Export completion ignored - export was cancelled',
        { jobId: 'burst-job' }
      );
    });

    it('should maintain consistent state during concurrent operations', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup multiple overlapping operations
      const operations = [
        () =>
          result.current.setCurrentJob({
            id: 'concurrent-job',
            status: 'processing',
            progress: 60,
          } as any),
        () => result.current.cancelExport(),
        () => result.current.setCompletedJobId('concurrent-job'),
        () =>
          result.current.setCurrentJob(
            prev =>
              ({
                ...prev!,
                status: 'completed',
              }) as any
          ),
        () => result.current.triggerDownload(),
      ];

      // Execute all operations simultaneously
      await act(async () => {
        await Promise.all(
          operations.map(op =>
            typeof op === 'function' && op.constructor.name === 'AsyncFunction'
              ? op()
              : Promise.resolve(op())
          )
        );
      });

      // Assert: Should reach consistent final state
      const finalState = result.current;
      expect(finalState.currentJob?.status).toBe('cancelled');
      expect(finalState.completedJobId).toBeNull();
      expect(finalState.isDownloading).toBe(false);
    });

    it('should prevent state corruption from interleaved async operations', async () => {
      vi.useFakeTimers();

      // Mock async operations with different delays
      mockApiClient.post = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise(resolve =>
              setTimeout(() => resolve({ data: { jobId: 'async-job-1' } }), 100)
            )
        )
        .mockImplementationOnce(
          () => new Promise(resolve => setTimeout(() => resolve(undefined), 50))
        );

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Start export (100ms delay)
      const startPromise = act(async () => {
        await result.current.startExport();
      });

      // Setup job state
      act(() => {
        result.current.setCurrentJob({
          id: 'async-job-1',
          status: 'processing',
          progress: 30,
        } as any);
      });

      // Cancel export after 25ms (50ms delay, completes before start)
      act(() => {
        vi.advanceTimersByTime(25);
      });

      const cancelPromise = act(async () => {
        await result.current.cancelExport();
      });

      // Complete both operations
      act(() => {
        vi.advanceTimersByTime(100);
      });

      await Promise.all([startPromise, cancelPromise]);

      // Assert: Final state should be consistent (cancelled wins)
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.isExporting).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle user clicking cancel multiple times rapidly', async () => {
      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job
      act(() => {
        result.current.setCurrentJob({
          id: 'rapid-cancel-job',
          status: 'processing',
          progress: 75,
        } as any);
      });

      // User clicks cancel button rapidly
      await act(async () => {
        await Promise.all([
          result.current.cancelExport(),
          result.current.cancelExport(),
          result.current.cancelExport(),
          result.current.cancelExport(),
          result.current.cancelExport(),
        ]);
      });

      // Assert: Should handle gracefully without corruption
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(result.current.isExporting).toBe(false);
      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
    });

    it('should handle browser tab being backgrounded during export', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Setup job
      act(() => {
        result.current.setCurrentJob({
          id: 'background-job',
          status: 'processing',
          progress: 85,
        } as any);
      });

      // Simulate tab backgrounding (WebSocket might disconnect)
      act(() => {
        mockSocket.connected = false;
      });

      // Export completes while in background
      const completionHandler = mockSocket.on.mock.calls.find(
        (call: any) => call[0] === 'export:completed'
      )?.[1];

      act(() => {
        completionHandler({ jobId: 'background-job' });
      });

      // User returns and cancels
      act(() => {
        mockSocket.connected = true;
      });

      await act(async () => {
        await result.current.cancelExport();
      });

      // Auto-download delay
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Cancellation should prevent download
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(mockApiClient.get).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should handle page refresh during export with persistence', async () => {
      // Simulate page refresh by creating new hook instance with persisted state
      mockExportStateManager.getExportState = vi.fn().mockReturnValue({
        jobId: 'refresh-job',
        status: 'processing',
        progress: 65,
        exportStatus: 'Processing...',
      });

      // Mock status check after refresh
      mockApiClient.get = vi.fn().mockResolvedValue({
        data: { status: 'completed', progress: 100 },
      });

      const { result } = renderHook(() =>
        useAdvancedExport(mockProjectId, mockProjectName)
      );

      // Wait for restoration
      await act(async () => {
        await Promise.resolve();
      });

      // User cancels after page refresh
      await act(async () => {
        await result.current.cancelExport();
      });

      // Late status check completes
      await act(async () => {
        await Promise.resolve();
      });

      // Assert: Should respect cancellation over restored state
      expect(result.current.currentJob?.status).toBe('cancelled');
      expect(mockExportStateManager.clearExportState).toHaveBeenCalledWith(
        mockProjectId
      );
    });
  });
});
