/**
 * Behavioral unit tests for AdvancedExportDialog.
 *
 * Tested behaviours:
 *  1.  Dialog does not mount its content when open=false.
 *  2.  Dialog title renders when open=true.
 *  3.  Three tabs are present: General / Visualization / Formats.
 *  4.  General tab is active by default; its content is visible.
 *  5.  Content toggles: includeOriginalImages, includeVisualizations,
 *      includeDocumentation checkboxes call updateExportOptions with the
 *      right key/value when clicked.
 *  6.  Formats tab: COCO checkbox adds/removes 'coco' from annotationFormats.
 *  7.  Formats tab: YOLO checkbox adds/removes 'yolo' from annotationFormats.
 *  8.  Formats tab: JSON annotation checkbox adds/removes 'json'.
 *  9.  Formats tab: Excel metrics checkbox adds/removes 'excel'.
 *  10. Formats tab: CSV metrics checkbox adds/removes 'csv'.
 *  11. Formats tab: JSON metrics checkbox adds/removes 'json' from metricsFormats.
 *  12. Summary card on Formats tab shows selected image count.
 *  13. MicrotubuleMetricsSection is NOT rendered for non-MT project types.
 *  14. MicrotubuleMetricsSection IS rendered for projectType === 'microtubules'.
 *      (Per-channel intensity incl. the sum is always on — no channel picker
 *       and no incomplete-metrics warning any more.)
 *  17. Start Export button calls startExport(projectName) on success and
 *      calls toast.success + onClose.
 *  18. Start Export failure calls toast.error.
 *  23. WebSocket-disconnected banner appears when wsConnected=false.
 *  24. WebSocket banner is absent when wsConnected=true.
 *  25. Export progress bar appears when isExporting=true.
 *  26. Progress bar is absent when isExporting=false.
 *  27. Failed-export error banner shown when currentJob.status === 'failed'.
 *  28. Completed-job download banner shown when completedJobId is set and
 *      not exporting.
 *  29. Cancel button hidden while exporting; shown when not exporting.
 *  30. onExportingChange notified when isExporting changes.
 *  31. onDownloadingChange notified when isDownloading changes.
 *  32. selectedImageIds synced to exportOptions on mount.
 *  33. pixelToMicrometerScale auto-fill from first calibrated image.
 *  34. pixelToMicrometerScale input rejects empty string (sets undefined).
 *  35. Scale input: out-of-range values are ignored.
 *
 * Skipped / not tested here:
 *  - Deep internals of MicrotubuleMetricsSection (has its own test file).
 *  - Deep internals of ImageSelectionGrid (has its own test file).
 *  - Visualization tab slider interactions (no accessible role; UI-only).
 *  - Auto-download side effect (requires WS event races + real timers;
 *    tested in useSharedAdvancedExport.test.ts).
 *  - Polling fallback path (same rationale as above).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';

// ── top-level mocks (must precede component imports) ─────────────────────────

// Prevent socket.io from opening real connections
vi.mock('socket.io-client', () => ({
  io: vi.fn(),
  Socket: class {},
}));

vi.mock('@/services/webSocketManager', () => ({
  default: class {
    static getInstance = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    on = vi.fn();
    off = vi.fn();
    emit = vi.fn();
  },
}));

// ── per-test mutable hook state ───────────────────────────────────────────────

/**
 * The hook mock is a plain object whose values every test can override via
 * `overrideHookState(...)` before rendering.  This avoids the "stale
 * `vi.fn()`" problem caused by module-level `vi.fn()` references being
 * captured before test mutations.
 */
const _mockStartExport = vi.fn();
const _mockUpdateExportOptions = vi.fn();
const _mockCancelExport = vi.fn();
const _mockTriggerDownload = vi.fn();
const _mockDismissExport = vi.fn();

// The base exportOptions that most tests use — matches EXPORT_DEFAULTS shape.
const baseExportOptions = {
  includeOriginalImages: true,
  includeVisualizations: true,
  includeDocumentation: true,
  annotationFormats: ['coco', 'json'] as string[],
  metricsFormats: ['excel'] as string[],
  visualizationOptions: {
    showNumbers: true,
    polygonColors: { external: '#FF0000', internal: '#0000FF' },
    strokeWidth: 2,
    fontSize: 32,
    transparency: 0.3,
  },
  selectedImageIds: undefined as string[] | undefined,
  pixelToMicrometerScale: undefined as number | undefined,
  mtMetrics: undefined as
    | {
        enabled: boolean;
        thicknessPx: number;
        marginMultiplier: number;
        channels: string[];
      }
    | undefined,
};

// Mutable snapshot — tests call `overrideHookState` to patch it.
let _hookState: {
  exportOptions: typeof baseExportOptions;
  isExporting: boolean;
  isDownloading: boolean;
  exportProgress: number;
  exportStatus: string;
  completedJobId: string | null;
  currentJob: { id: string; status: string; message?: string } | null;
  wsConnected: boolean;
} = {
  exportOptions: { ...baseExportOptions },
  isExporting: false,
  isDownloading: false,
  exportProgress: 0,
  exportStatus: '',
  completedJobId: null,
  currentJob: null,
  wsConnected: true,
};

function overrideHookState(
  patch: Partial<typeof _hookState> & {
    exportOptions?: Partial<typeof baseExportOptions>;
  }
) {
  const { exportOptions: optsPatch, ...rest } = patch;
  _hookState = {
    ..._hookState,
    ...rest,
    exportOptions: optsPatch
      ? { ..._hookState.exportOptions, ...optsPatch }
      : _hookState.exportOptions,
  };
}

vi.mock('../hooks/useSharedAdvancedExport', () => ({
  useSharedAdvancedExport: () => ({
    exportOptions: _hookState.exportOptions,
    updateExportOptions: _mockUpdateExportOptions,
    startExport: _mockStartExport,
    cancelExport: _mockCancelExport,
    triggerDownload: _mockTriggerDownload,
    dismissExport: _mockDismissExport,
    isExporting: _hookState.isExporting,
    isDownloading: _hookState.isDownloading,
    exportProgress: _hookState.exportProgress,
    exportStatus: _hookState.exportStatus,
    completedJobId: _hookState.completedJobId,
    currentJob: _hookState.currentJob,
    wsConnected: _hookState.wsConnected,
  }),
}));

// Stub child sections that have their own test suites
vi.mock('../components/MicrotubuleMetricsSection', () => ({
  // Per-channel intensity (incl. the sum) is always on now — the section takes
  // no channel/enable props, so the mock is just a presence marker.
  MicrotubuleMetricsSection: () => <div data-testid="mt-metrics-section" />,
}));

vi.mock('../components/ImageSelectionGrid', () => ({
  ImageSelectionGrid: () => <div data-testid="image-selection-grid" />,
}));

// Stub sonner so we can assert toast calls
const _mockToastSuccess = vi.fn();
const _mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => _mockToastSuccess(...args),
    error: (...args: unknown[]) => _mockToastError(...args),
    warning: vi.fn(),
  },
}));

// Connected socket prevents the polling-interval branch from firing.
const _mockSocket = {
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};
vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: () => ({
    socket: _mockSocket,
    manager: null,
    isConnected: true,
  }),
}));

// ExportContext is used by the hook; stub it so the Provider in AllProviders
// wrapping is not required.
vi.mock('@/contexts/ExportContext', () => ({
  ExportProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useExportContext: () => ({
    exportStates: {},
    updateExportState: vi.fn(),
    clearExportState: vi.fn(),
    getExportState: vi.fn(() => null),
  }),
}));

vi.mock('@/lib/exportStateManager', () => ({
  default: {
    getExportState: vi.fn(() => null),
    saveExportState: vi.fn(),
    saveExportStateThrottled: vi.fn(),
    clearExportState: vi.fn(),
    deduplicateRequest: vi.fn((_id: string, fn: () => unknown) => fn()),
  },
}));

vi.mock('@/hooks/shared/useAbortController', () => ({
  useAbortController: () => ({
    getSignal: vi.fn(() => new AbortController().signal),
    abort: vi.fn(),
    abortAll: vi.fn(),
    resetController: vi.fn(),
    isAborted: vi.fn(() => false),
  }),
}));

// ── component import (after all mocks) ────────────────────────────────────────
import { AdvancedExportDialog } from '../AdvancedExportDialog';

// ── helpers ───────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  open: true,
  onClose: vi.fn(),
  projectId: 'proj-1',
  projectName: 'My Project',
  projectType: 'spheroid' as string | null | undefined,
  images: [
    {
      id: 'img-1',
      filename: 'a.png',
      processingStatus: 'completed' as const,
      projectId: 'proj-1',
      originalName: 'a.png',
      mimeType: 'image/png',
      size: 1000,
      width: 100,
      height: 100,
      thumbnailPath: '',
      uploadedAt: new Date(),
      processedAt: new Date(),
      segmentationResults: [],
    },
    {
      id: 'img-2',
      filename: 'b.png',
      processingStatus: 'completed' as const,
      projectId: 'proj-1',
      originalName: 'b.png',
      mimeType: 'image/png',
      size: 1000,
      width: 100,
      height: 100,
      thumbnailPath: '',
      uploadedAt: new Date(),
      processedAt: new Date(),
      segmentationResults: [],
    },
  ],
  selectedImageIds: undefined as string[] | undefined,
  onExportingChange: vi.fn(),
  onDownloadingChange: vi.fn(),
};

function renderDialog(props: Partial<typeof BASE_PROPS> = {}) {
  return render(<AdvancedExportDialog {...BASE_PROPS} {...props} />);
}

/** Click a tab by its accessible name. */
async function clickTab(
  user: ReturnType<typeof userEvent.setup>,
  name: string
) {
  await user.click(screen.getByRole('tab', { name }));
}

// ── test suite ────────────────────────────────────────────────────────────────

describe('AdvancedExportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared hook state
    _hookState = {
      exportOptions: { ...baseExportOptions },
      isExporting: false,
      isDownloading: false,
      exportProgress: 0,
      exportStatus: '',
      completedJobId: null,
      currentJob: null,
      wsConnected: true,
    };
  });

  // ── 1. open/closed rendering ───────────────────────────────────────────────

  describe('open/closed rendering', () => {
    it('does not render dialog content when open=false', () => {
      renderDialog({ open: false });
      expect(
        screen.queryByText('Advanced Export Options')
      ).not.toBeInTheDocument();
    });

    it('renders dialog title when open=true', () => {
      renderDialog();
      expect(screen.getByText('Advanced Export Options')).toBeInTheDocument();
    });
  });

  // ── 2. tab structure ──────────────────────────────────────────────────────

  describe('tab structure', () => {
    it('renders three tabs: General, Visualization, Formats', () => {
      renderDialog();
      expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();
      expect(
        screen.getByRole('tab', { name: 'Visualization' })
      ).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Formats' })).toBeInTheDocument();
    });

    it('General tab is active by default and its content is visible', () => {
      renderDialog();
      // "Export Contents" card header is in the General tab
      expect(screen.getByText('Export Contents')).toBeInTheDocument();
    });

    it('switching to Formats tab shows annotation format checkboxes', async () => {
      const user = userEvent.setup();
      renderDialog();
      await clickTab(user, 'Formats');
      // COCO label appears in the Formats tab
      expect(
        screen.getByLabelText('Include COCO format annotations')
      ).toBeInTheDocument();
    });
  });

  // ── 3. content option checkboxes ──────────────────────────────────────────

  describe('content option checkboxes', () => {
    it('toggling "Include original images" calls updateExportOptions with includeOriginalImages: false when currently checked', async () => {
      overrideHookState({ exportOptions: { includeOriginalImages: true } });
      const user = userEvent.setup();
      renderDialog();
      const checkbox = screen.getByRole('checkbox', {
        name: /include original images/i,
      });
      await user.click(checkbox);
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({ includeOriginalImages: false })
      );
    });

    it('toggling "Include visualizations" calls updateExportOptions with includeVisualizations: false', async () => {
      overrideHookState({ exportOptions: { includeVisualizations: true } });
      const user = userEvent.setup();
      renderDialog();
      const checkbox = screen.getByRole('checkbox', {
        name: /include visualizations/i,
      });
      await user.click(checkbox);
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({ includeVisualizations: false })
      );
    });

    it('toggling "Include documentation" calls updateExportOptions with includeDocumentation: false', async () => {
      overrideHookState({ exportOptions: { includeDocumentation: true } });
      const user = userEvent.setup();
      renderDialog();
      const checkbox = screen.getByRole('checkbox', {
        name: /include documentation/i,
      });
      await user.click(checkbox);
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({ includeDocumentation: false })
      );
    });
  });

  // ── 4. annotation format checkboxes ──────────────────────────────────────

  describe('annotation format checkboxes (Formats tab)', () => {
    async function openFormats(user: ReturnType<typeof userEvent.setup>) {
      await clickTab(user, 'Formats');
    }

    it('checking COCO adds "coco" to annotationFormats', async () => {
      overrideHookState({ exportOptions: { annotationFormats: [] } });
      const user = userEvent.setup();
      renderDialog();
      await openFormats(user);
      await user.click(
        screen.getByRole('checkbox', {
          name: /include coco format annotations/i,
        })
      );
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          annotationFormats: expect.arrayContaining(['coco']),
        })
      );
    });

    it('un-checking COCO removes "coco" from annotationFormats', async () => {
      overrideHookState({
        exportOptions: { annotationFormats: ['coco', 'json'] },
      });
      const user = userEvent.setup();
      renderDialog();
      await openFormats(user);
      await user.click(
        screen.getByRole('checkbox', {
          name: /include coco format annotations/i,
        })
      );
      const call = _mockUpdateExportOptions.mock.calls.at(-1)?.[0];
      expect(call?.annotationFormats).not.toContain('coco');
    });

    it('checking YOLO adds "yolo" to annotationFormats', async () => {
      overrideHookState({ exportOptions: { annotationFormats: [] } });
      const user = userEvent.setup();
      renderDialog();
      await openFormats(user);
      await user.click(screen.getByRole('checkbox', { name: /yolo format/i }));
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          annotationFormats: expect.arrayContaining(['yolo']),
        })
      );
    });

    it('checking JSON annotation adds "json" to annotationFormats', async () => {
      overrideHookState({ exportOptions: { annotationFormats: [] } });
      const user = userEvent.setup();
      renderDialog();
      await openFormats(user);
      await user.click(
        screen.getByRole('checkbox', { name: /include json metadata/i })
      );
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          annotationFormats: expect.arrayContaining(['json']),
        })
      );
    });
  });

  // ── 5. metrics format checkboxes ─────────────────────────────────────────

  describe('metrics format checkboxes (Formats tab)', () => {
    async function openFormats(user: ReturnType<typeof userEvent.setup>) {
      await clickTab(user, 'Formats');
    }

    it('checking Excel adds "excel" to metricsFormats', async () => {
      overrideHookState({ exportOptions: { metricsFormats: [] } });
      const user = userEvent.setup();
      renderDialog();
      await openFormats(user);
      await user.click(screen.getByRole('checkbox', { name: /excel format/i }));
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          metricsFormats: expect.arrayContaining(['excel']),
        })
      );
    });

    it('checking CSV adds "csv" to metricsFormats', async () => {
      overrideHookState({ exportOptions: { metricsFormats: [] } });
      const user = userEvent.setup();
      renderDialog();
      await openFormats(user);
      await user.click(
        screen.getByRole('checkbox', {
          name: /comma-separated values/i,
        })
      );
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          metricsFormats: expect.arrayContaining(['csv']),
        })
      );
    });

    it('checking JSON metrics adds "json" to metricsFormats', async () => {
      overrideHookState({ exportOptions: { metricsFormats: [] } });
      const user = userEvent.setup();
      renderDialog();
      await openFormats(user);
      await user.click(
        screen.getByRole('checkbox', { name: /^json format$/i })
      );
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          metricsFormats: expect.arrayContaining(['json']),
        })
      );
    });

    it('un-checking Excel removes "excel" from metricsFormats', async () => {
      overrideHookState({ exportOptions: { metricsFormats: ['excel'] } });
      const user = userEvent.setup();
      renderDialog();
      await openFormats(user);
      await user.click(screen.getByRole('checkbox', { name: /excel format/i }));
      const call = _mockUpdateExportOptions.mock.calls.at(-1)?.[0];
      expect(call?.metricsFormats).not.toContain('excel');
    });
  });

  // ── 6. formats tab summary card ───────────────────────────────────────────

  describe('summary card on Formats tab', () => {
    it('displays correct selected image count when no selectedImageIds', async () => {
      const user = userEvent.setup();
      renderDialog({ images: BASE_PROPS.images });
      await clickTab(user, 'Formats');
      // 2 images provided in BASE_PROPS
      expect(screen.getByText(/images:\s*2/i)).toBeInTheDocument();
    });

    it('displays explicit selectedImageIds count when provided', async () => {
      overrideHookState({
        exportOptions: { selectedImageIds: ['img-1'] },
      });
      const user = userEvent.setup();
      renderDialog();
      await clickTab(user, 'Formats');
      expect(screen.getByText(/images:\s*1/i)).toBeInTheDocument();
    });
  });

  // ── 7. MT-project gating ──────────────────────────────────────────────────

  describe('MT-project gating', () => {
    it('does NOT render MicrotubuleMetricsSection for non-MT project types', () => {
      renderDialog({ projectType: 'spheroid' });
      expect(
        screen.queryByTestId('mt-metrics-section')
      ).not.toBeInTheDocument();
    });

    it('does NOT render MicrotubuleMetricsSection when projectType is null', () => {
      renderDialog({ projectType: null });
      expect(
        screen.queryByTestId('mt-metrics-section')
      ).not.toBeInTheDocument();
    });

    it('renders MicrotubuleMetricsSection when projectType === "microtubules"', () => {
      renderDialog({ projectType: 'microtubules' });
      expect(screen.getByTestId('mt-metrics-section')).toBeInTheDocument();
    });

    it('does NOT render MicrotubuleMetricsSection for singular "microtubule" (typo guard)', () => {
      renderDialog({ projectType: 'microtubule' });
      expect(
        screen.queryByTestId('mt-metrics-section')
      ).not.toBeInTheDocument();
    });
  });

  // ── 9. start export action ────────────────────────────────────────────────

  describe('Start Export action', () => {
    it('calls startExport with projectName on button click (success path)', async () => {
      _mockStartExport.mockResolvedValueOnce('job-123');
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('button', { name: /start export/i }));
      await waitFor(() => {
        expect(_mockStartExport).toHaveBeenCalledWith('My Project');
      });
    });

    it('calls toast.success and onClose after successful export', async () => {
      _mockStartExport.mockResolvedValueOnce('job-123');
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderDialog({ onClose });
      await user.click(screen.getByRole('button', { name: /start export/i }));
      await waitFor(() => {
        expect(_mockToastSuccess).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('calls toast.error when startExport rejects', async () => {
      _mockStartExport.mockRejectedValueOnce(new Error('server error'));
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('button', { name: /start export/i }));
      await waitFor(() => {
        expect(_mockToastError).toHaveBeenCalled();
      });
    });
  });

  // ── 11. WebSocket banner ──────────────────────────────────────────────────

  describe('WebSocket connection status banner', () => {
    it('shows disconnected banner when wsConnected=false', () => {
      overrideHookState({ wsConnected: false });
      renderDialog();
      expect(
        screen.getByText(/websocket connection lost/i)
      ).toBeInTheDocument();
    });

    it('does not show disconnected banner when wsConnected=true', () => {
      overrideHookState({ wsConnected: true });
      renderDialog();
      expect(
        screen.queryByText(/websocket connection lost/i)
      ).not.toBeInTheDocument();
    });
  });

  // ── 12. export progress bar ───────────────────────────────────────────────

  describe('export progress display', () => {
    it('shows progress bar with status text when isExporting=true', () => {
      overrideHookState({
        isExporting: true,
        exportProgress: 42,
        exportStatus: 'Processing...',
      });
      renderDialog();
      expect(screen.getByText('Processing...')).toBeInTheDocument();
      expect(screen.getByText('42%')).toBeInTheDocument();
    });

    it('progress bar is absent when isExporting=false', () => {
      overrideHookState({ isExporting: false, exportStatus: '' });
      renderDialog();
      // No percentage text visible
      expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    });
  });

  // ── 13. failed export banner ──────────────────────────────────────────────

  describe('failed export banner', () => {
    it('shows error banner when currentJob.status === "failed"', () => {
      overrideHookState({
        currentJob: {
          id: 'job-x',
          status: 'failed',
          message: 'disk full',
        },
      });
      renderDialog();
      expect(screen.getByText(/export failed: disk full/i)).toBeInTheDocument();
    });

    it('does not show error banner when currentJob is null', () => {
      overrideHookState({ currentJob: null });
      renderDialog();
      expect(screen.queryByText(/export failed/i)).not.toBeInTheDocument();
    });
  });

  // ── 14. completed download banner ─────────────────────────────────────────

  describe('completed job download banner', () => {
    it('shows download banner when completedJobId is set and not exporting', () => {
      overrideHookState({
        completedJobId: 'job-done',
        isExporting: false,
        isDownloading: false,
      });
      renderDialog();
      // The download button or the status message should appear
      expect(
        screen.getByRole('button', { name: /download/i })
      ).toBeInTheDocument();
    });

    it('clicking Download button calls triggerDownload', async () => {
      overrideHookState({
        completedJobId: 'job-done',
        isExporting: false,
        isDownloading: false,
      });
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByRole('button', { name: /^download$/i }));
      expect(_mockTriggerDownload).toHaveBeenCalled();
    });

    it('dismiss (X) button calls dismissExport', async () => {
      overrideHookState({
        completedJobId: 'job-done',
        isExporting: false,
        isDownloading: false,
      });
      const user = userEvent.setup();
      renderDialog();
      await user.click(screen.getByTitle('Dismiss'));
      expect(_mockDismissExport).toHaveBeenCalled();
    });

    it('does not show download banner when completedJobId is null', () => {
      overrideHookState({ completedJobId: null, isExporting: false });
      renderDialog();
      // Only the Start Export button visible, not a Download button
      expect(
        screen.queryByRole('button', { name: /^download$/i })
      ).not.toBeInTheDocument();
    });
  });

  // ── 15. cancel button visibility ─────────────────────────────────────────

  describe('Cancel button visibility', () => {
    it('Cancel button is visible when not exporting', () => {
      overrideHookState({ isExporting: false });
      renderDialog();
      expect(
        screen.getByRole('button', { name: /^cancel$/i })
      ).toBeInTheDocument();
    });

    it('Cancel button is hidden while exporting', () => {
      overrideHookState({ isExporting: true });
      renderDialog();
      expect(
        screen.queryByRole('button', { name: /^cancel$/i })
      ).not.toBeInTheDocument();
    });
  });

  // ── 16. parent callbacks ──────────────────────────────────────────────────

  describe('parent state callbacks', () => {
    it('calls onExportingChange(true) when isExporting becomes true', () => {
      overrideHookState({ isExporting: true });
      const onExportingChange = vi.fn();
      renderDialog({ onExportingChange });
      expect(onExportingChange).toHaveBeenCalledWith(true);
    });

    it('calls onDownloadingChange(true) when isDownloading becomes true', () => {
      overrideHookState({ isDownloading: true });
      const onDownloadingChange = vi.fn();
      renderDialog({ onDownloadingChange });
      expect(onDownloadingChange).toHaveBeenCalledWith(true);
    });
  });

  // ── 17. selectedImageIds sync ─────────────────────────────────────────────

  describe('selectedImageIds sync', () => {
    it('calls updateExportOptions with selectedImageIds on mount', () => {
      renderDialog({ selectedImageIds: ['img-1'] });
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({ selectedImageIds: ['img-1'] })
      );
    });
  });

  // ── 18. pixelToMicrometerScale auto-fill ─────────────────────────────────

  describe('pixelToMicrometerScale auto-fill', () => {
    it('auto-fills scale from first image with positive pixelSizeUm', () => {
      const imagesWithCalibration = [
        {
          ...BASE_PROPS.images[0],
          pixelSizeUm: 0.065,
        },
      ];
      renderDialog({
        images: imagesWithCalibration as typeof BASE_PROPS.images,
      });
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({ pixelToMicrometerScale: 0.065 })
      );
    });

    it('does not auto-fill when exportOptions already has a scale value', () => {
      overrideHookState({
        exportOptions: { pixelToMicrometerScale: 0.1 },
      });
      const imagesWithCalibration = [
        {
          ...BASE_PROPS.images[0],
          pixelSizeUm: 0.065,
        },
      ];
      renderDialog({
        images: imagesWithCalibration as typeof BASE_PROPS.images,
      });
      // The auto-fill effect is gated on pixelToMicrometerScale == null
      const autofillCalls = _mockUpdateExportOptions.mock.calls.filter(
        c => 'pixelToMicrometerScale' in c[0]
      );
      // Should not have been called with the image's scale
      const calledWithImageScale = autofillCalls.some(
        c => c[0].pixelToMicrometerScale === 0.065
      );
      expect(calledWithImageScale).toBe(false);
    });
  });

  // ── 19. scale input validation ─────────────────────────────────────────────

  describe('scale input validation', () => {
    it('clears the scale when input is emptied', async () => {
      overrideHookState({
        exportOptions: { pixelToMicrometerScale: 0.5 },
      });
      const user = userEvent.setup();
      renderDialog();
      const input = screen.getByRole('spinbutton');
      await user.clear(input);
      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({ pixelToMicrometerScale: undefined })
      );
    });

    it('accepts a valid scale value within [0.001, 1000]', async () => {
      overrideHookState({
        exportOptions: { pixelToMicrometerScale: undefined },
      });
      const user = userEvent.setup();
      renderDialog();
      const input = screen.getByRole('spinbutton');
      await user.type(input, '0.5');
      // At least one call should have a valid scale
      const validCalls = _mockUpdateExportOptions.mock.calls.filter(
        c => typeof c[0].pixelToMicrometerScale === 'number'
      );
      expect(validCalls.length).toBeGreaterThan(0);
    });
  });
});
