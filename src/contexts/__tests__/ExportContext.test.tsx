import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { ExportProvider, useExportContext } from '@/contexts/ExportContext';

vi.mock('@/lib/api', () => ({
  default: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
  },
  apiClient: {
    isAuthenticated: vi.fn(() => false),
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
  },
}));

vi.mock('@/lib/authEvents', () => ({
  authEventEmitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/lib/tokenRefresh', () => ({
  tokenRefreshManager: {
    startTokenRefreshManager: vi.fn(),
    stopTokenRefreshManager: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('ExportContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ExportProvider>{children}</ExportProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('error boundaries', () => {
    it('throws when useExportContext is used outside provider', () => {
      expect(() => {
        renderHook(() => useExportContext());
      }).toThrow('useExportContext must be used within an ExportProvider');
    });
  });

  describe('getExportState', () => {
    it('returns null for an unknown projectId', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });

      const state = result.current.getExportState('nonexistent-project');
      expect(state).toBeNull();
    });
  });

  describe('updateExportState', () => {
    it('creates new state for a project when none exists', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });

      act(() => {
        result.current.updateExportState('project-1', { isExporting: true });
      });

      const state = result.current.getExportState('project-1');
      expect(state).not.toBeNull();
      expect(state!.isExporting).toBe(true);
      expect(state!.projectId).toBe('project-1');
    });

    it('merges partial updates into existing state', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });

      act(() => {
        result.current.updateExportState('project-1', {
          isExporting: true,
          exportProgress: 25,
        });
      });

      act(() => {
        result.current.updateExportState('project-1', { exportProgress: 75 });
      });

      const state = result.current.getExportState('project-1');
      expect(state!.isExporting).toBe(true);
      expect(state!.exportProgress).toBe(75);
    });

    it('initializes new state with correct defaults from defaultExportState', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });

      act(() => {
        result.current.updateExportState('project-new', {
          exportStatus: 'queued',
        });
      });

      const state = result.current.getExportState('project-new');
      expect(state!.isExporting).toBe(false);
      expect(state!.isDownloading).toBe(false);
      expect(state!.exportProgress).toBe(0);
      expect(state!.completedJobId).toBeNull();
      expect(state!.currentJob).toBeNull();
      expect(state!.exportStatus).toBe('queued');
    });
  });

  describe('clearExportState', () => {
    it('removes the state for the specified projectId', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });

      act(() => {
        result.current.updateExportState('project-1', { isExporting: true });
      });

      expect(result.current.getExportState('project-1')).not.toBeNull();

      act(() => {
        result.current.clearExportState('project-1');
      });

      expect(result.current.getExportState('project-1')).toBeNull();
    });

    it('does not affect other projects when clearing one', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });

      act(() => {
        result.current.updateExportState('project-1', { exportProgress: 50 });
        result.current.updateExportState('project-2', { exportProgress: 80 });
      });

      act(() => {
        result.current.clearExportState('project-1');
      });

      expect(result.current.getExportState('project-1')).toBeNull();
      expect(result.current.getExportState('project-2')).not.toBeNull();
      expect(result.current.getExportState('project-2')!.exportProgress).toBe(
        80
      );
    });
  });

  describe('multiple project state coexistence', () => {
    it('maintains independent state for multiple projects simultaneously', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });

      act(() => {
        result.current.updateExportState('alpha', {
          isExporting: true,
          exportProgress: 10,
        });
        result.current.updateExportState('beta', {
          isDownloading: true,
          exportProgress: 90,
        });
        result.current.updateExportState('gamma', {
          completedJobId: 'job-xyz',
        });
      });

      const alphaState = result.current.getExportState('alpha');
      const betaState = result.current.getExportState('beta');
      const gammaState = result.current.getExportState('gamma');

      expect(alphaState!.isExporting).toBe(true);
      expect(alphaState!.isDownloading).toBe(false);
      expect(alphaState!.exportProgress).toBe(10);

      expect(betaState!.isExporting).toBe(false);
      expect(betaState!.isDownloading).toBe(true);
      expect(betaState!.exportProgress).toBe(90);

      expect(gammaState!.completedJobId).toBe('job-xyz');
      expect(gammaState!.isExporting).toBe(false);
    });

    it('exportStates record contains all active project entries', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });

      act(() => {
        result.current.updateExportState('p1', { isExporting: true });
        result.current.updateExportState('p2', { isExporting: true });
      });

      expect(Object.keys(result.current.exportStates)).toHaveLength(2);
      expect(result.current.exportStates).toHaveProperty('p1');
      expect(result.current.exportStates).toHaveProperty('p2');
    });
  });

  describe('state transitions', () => {
    it('transitions through idle -> exporting -> downloading -> completed', () => {
      const { result } = renderHook(() => useExportContext(), { wrapper });
      const projectId = 'workflow-project';

      // idle — no state yet
      expect(result.current.getExportState(projectId)).toBeNull();

      // exporting
      act(() => {
        result.current.updateExportState(projectId, {
          isExporting: true,
          exportProgress: 0,
          exportStatus: 'exporting',
        });
      });
      let state = result.current.getExportState(projectId)!;
      expect(state.isExporting).toBe(true);
      expect(state.isDownloading).toBe(false);
      expect(state.exportProgress).toBe(0);

      // mid-export progress update
      act(() => {
        result.current.updateExportState(projectId, { exportProgress: 60 });
      });
      state = result.current.getExportState(projectId)!;
      expect(state.exportProgress).toBe(60);
      expect(state.isExporting).toBe(true);

      // downloading
      act(() => {
        result.current.updateExportState(projectId, {
          isExporting: false,
          isDownloading: true,
          exportProgress: 100,
          completedJobId: 'job-42',
          exportStatus: 'downloading',
        });
      });
      state = result.current.getExportState(projectId)!;
      expect(state.isExporting).toBe(false);
      expect(state.isDownloading).toBe(true);
      expect(state.completedJobId).toBe('job-42');

      // completed
      act(() => {
        result.current.updateExportState(projectId, {
          isDownloading: false,
          exportStatus: 'completed',
        });
      });
      state = result.current.getExportState(projectId)!;
      expect(state.isExporting).toBe(false);
      expect(state.isDownloading).toBe(false);
      expect(state.exportStatus).toBe('completed');
    });
  });
});
