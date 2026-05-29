/**
 * AdvancedExportDialog — additional tests for branches not covered by the
 * main AdvancedExportDialog.test.tsx (35 cases).
 *
 * Covered here:
 *  1.  Visualization tab: "Show polygon numbers" checkbox calls updateExportOptions
 *      with showNumbers toggled.
 *  2.  Visualization tab: external stroke-color hex input fires updateExportOptions
 *      with the new polygon color.
 *  3.  Visualization tab: internal (background) color input fires updateExportOptions.
 *  4.  Scale input: value below min (0.0001) is ignored — updateExportOptions NOT
 *      called with a scale value.
 *  5.  Scale input: value above max (1001) is ignored.
 *  6.  Completed job + isDownloading=true: Download button shows spinner text.
 *  7.  Formats summary card: "Original images included" line when
 *      includeOriginalImages=true.
 *  8.  Formats summary card: "Visualizations" line when includeVisualizations=true.
 *  9.  Formats summary card: Annotations line lists formats when annotationFormats
 *      is non-empty.
 * 10.  Formats summary card: Metrics line lists formats when metricsFormats non-empty.
 * 11.  Formats summary card: "Documentation" line when includeDocumentation=true.
 * 12.  Failed export banner: message defaults to "Unknown error" when currentJob
 *      has no message field.
 * 13.  Download banner: shows export status text from exportStatus when set.
 * 14.  open=false: dialog closed on open=false, no content rendered.
 *
 * Skipped / not tested:
 *  - Slider interactions (no accessible role; all three sliders, not tested in the
 *    main suite either — Radix Slider doesn't expose input roles in jsdom).
 *  - Auto-download WS race (tested in useSharedAdvancedExport.test.ts).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';

// ── top-level mocks ───────────────────────────────────────────────────────────

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

// ── mutable hook state ────────────────────────────────────────────────────────

const _mockStartExport = vi.fn();
const _mockUpdateExportOptions = vi.fn();
const _mockCancelExport = vi.fn();
const _mockTriggerDownload = vi.fn();
const _mockDismissExport = vi.fn();

type HookExportOptions = {
  includeOriginalImages?: boolean;
  includeVisualizations?: boolean;
  includeDocumentation?: boolean;
  annotationFormats?: string[];
  metricsFormats?: string[];
  visualizationOptions?: {
    showNumbers?: boolean;
    polygonColors?: { external?: string; internal?: string };
    strokeWidth?: number;
    fontSize?: number;
    transparency?: number;
  };
  selectedImageIds?: string[];
  pixelToMicrometerScale?: number;
  mtMetrics?: {
    enabled: boolean;
    thicknessPx: number;
    marginMultiplier: number;
    channels: string[];
  };
};

const defaultExportOptions: HookExportOptions = {
  includeOriginalImages: true,
  includeVisualizations: true,
  includeDocumentation: true,
  annotationFormats: ['coco'],
  metricsFormats: ['excel'],
  visualizationOptions: {
    showNumbers: true,
    polygonColors: { external: '#ff0000', internal: '#0000ff' },
    strokeWidth: 2,
    fontSize: 32,
    transparency: 0.3,
  },
  selectedImageIds: undefined,
  pixelToMicrometerScale: undefined,
  mtMetrics: undefined,
};

let _hookState = {
  exportOptions: { ...defaultExportOptions },
  isExporting: false,
  isDownloading: false,
  exportProgress: 0,
  exportStatus: '',
  completedJobId: null as string | null,
  currentJob: null as { id: string; status: string; message?: string } | null,
  wsConnected: true,
};

function patchHookState(
  patch: Partial<typeof _hookState> & {
    exportOptions?: Partial<HookExportOptions>;
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

vi.mock('../components/MicrotubuleMetricsSection', () => ({
  MicrotubuleMetricsSection: () => <div data-testid="mt-metrics-section" />,
}));

vi.mock('../components/ImageSelectionGrid', () => ({
  ImageSelectionGrid: () => <div data-testid="image-selection-grid" />,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/contexts/useWebSocket', () => ({
  useWebSocket: () => ({
    socket: { connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    manager: null,
    isConnected: true,
  }),
}));

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

// ── component import ──────────────────────────────────────────────────────────
import { AdvancedExportDialog } from '../AdvancedExportDialog';

// ── helpers ───────────────────────────────────────────────────────────────────

const BASE_IMAGES = [
  {
    id: 'img-1',
    name: 'a.png',
    segmentationStatus: 'completed' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    url: '',
    project_id: 'proj-1',
  },
];

const BASE_PROPS = {
  open: true,
  onClose: vi.fn(),
  projectId: 'proj-1',
  projectName: 'My Project',
  projectType: 'spheroid' as string | null | undefined,
  images: BASE_IMAGES as any[],
};

function renderDialog(props: Partial<typeof BASE_PROPS> = {}) {
  return render(<AdvancedExportDialog {...BASE_PROPS} {...props} />);
}

async function switchToVisualizationTab(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.click(screen.getByRole('tab', { name: /visualization/i }));
}

async function switchToFormatsTab(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: /formats/i }));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('AdvancedExportDialog — additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _hookState = {
      exportOptions: { ...defaultExportOptions },
      isExporting: false,
      isDownloading: false,
      exportProgress: 0,
      exportStatus: '',
      completedJobId: null,
      currentJob: null,
      wsConnected: true,
    };
  });

  // ── 1–3. Visualization tab ───────────────────────────────────────────────

  describe('Visualization tab interactions', () => {
    it('toggling showNumbers calls updateExportOptions with updated showNumbers', async () => {
      patchHookState({
        exportOptions: {
          visualizationOptions: {
            showNumbers: true,
            polygonColors: { external: '#ff0000', internal: '#0000ff' },
            strokeWidth: 2,
            fontSize: 32,
            transparency: 0.3,
          },
        },
      });

      const user = userEvent.setup();
      renderDialog();
      await switchToVisualizationTab(user);

      const showNumbersCheckbox = screen.getByRole('checkbox', {
        name: /show polygon numbers/i,
      });
      await user.click(showNumbersCheckbox);

      expect(_mockUpdateExportOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          visualizationOptions: expect.objectContaining({ showNumbers: false }),
        })
      );
    });

    it('changing external stroke color input calls updateExportOptions with new color', async () => {
      const user = userEvent.setup();
      renderDialog();
      await switchToVisualizationTab(user);

      // The stroke-color hex text input (not the color picker)
      const hexInputs = screen.getAllByRole('textbox');
      // First textbox in the color section is the external color hex input
      const externalHexInput = hexInputs[0];
      await user.clear(externalHexInput);
      await user.type(externalHexInput, '#aabbcc');

      // At least one call should contain the polygon colors with external updated
      const colorCalls = _mockUpdateExportOptions.mock.calls.filter(
        c => c[0]?.visualizationOptions?.polygonColors?.external !== undefined
      );
      expect(colorCalls.length).toBeGreaterThan(0);
    });

    it('changing internal background color input calls updateExportOptions', async () => {
      const user = userEvent.setup();
      renderDialog();
      await switchToVisualizationTab(user);

      const hexInputs = screen.getAllByRole('textbox');
      // Second textbox is the internal color hex input
      const internalHexInput = hexInputs[1];
      await user.clear(internalHexInput);
      await user.type(internalHexInput, '#ccddee');

      const colorCalls = _mockUpdateExportOptions.mock.calls.filter(
        c => c[0]?.visualizationOptions?.polygonColors?.internal !== undefined
      );
      expect(colorCalls.length).toBeGreaterThan(0);
    });
  });

  // ── 4–5. Scale input out-of-range ────────────────────────────────────────

  describe('scale input — out-of-range rejection', () => {
    it('value below min (0.0001) does not call updateExportOptions with a number', async () => {
      patchHookState({ exportOptions: { pixelToMicrometerScale: undefined } });
      const user = userEvent.setup();
      renderDialog();

      const input = screen.getByRole('spinbutton');
      // Type a value that rounds to 0 (< 0.001 minimum)
      await user.type(input, '0.0001');

      // Only pixelToMicrometerScale: undefined is acceptable (from the onChange
      // clearing branch). A defined number < 0.001 must NOT appear.
      const numericCalls = _mockUpdateExportOptions.mock.calls.filter(
        c => typeof c[0]?.pixelToMicrometerScale === 'number'
      );
      const outOfRangeCalls = numericCalls.filter(
        c => c[0].pixelToMicrometerScale < 0.001
      );
      expect(outOfRangeCalls).toHaveLength(0);
    });

    it('value above max (1001) does not call updateExportOptions with a number > 1000', async () => {
      patchHookState({ exportOptions: { pixelToMicrometerScale: undefined } });
      const user = userEvent.setup();
      renderDialog();

      const input = screen.getByRole('spinbutton');
      await user.type(input, '1001');

      const numericCalls = _mockUpdateExportOptions.mock.calls.filter(
        c => typeof c[0]?.pixelToMicrometerScale === 'number'
      );
      const outOfRangeCalls = numericCalls.filter(
        c => c[0].pixelToMicrometerScale > 1000
      );
      expect(outOfRangeCalls).toHaveLength(0);
    });
  });

  // ── 6. Download banner hidden when isDownloading=true ───────────────────
  //
  // The outer render condition is: completedJobId && !isExporting && !isDownloading
  // So the download banner (and its "Download" button) is HIDDEN when
  // isDownloading=true. The inner ternary inside the button is unreachable in
  // normal flow — the banner is only shown when isDownloading is false.
  // We assert the banner is absent (correct behavior), not that a spinner appears.

  describe('download banner — hidden when isDownloading=true', () => {
    it('hides the download banner when isDownloading=true (outer condition requires !isDownloading)', () => {
      patchHookState({
        completedJobId: 'job-done',
        isExporting: false,
        isDownloading: true,
        exportStatus: 'Export ready',
      });
      renderDialog();

      // Banner is hidden — Download button not rendered
      expect(
        screen.queryByRole('button', { name: /^download$/i })
      ).not.toBeInTheDocument();
    });
  });

  // ── 7–11. Formats tab summary card ───────────────────────────────────────

  describe('Formats tab summary card content', () => {
    it('shows "Original images included" when includeOriginalImages=true', async () => {
      patchHookState({ exportOptions: { includeOriginalImages: true } });
      const user = userEvent.setup();
      renderDialog();
      await switchToFormatsTab(user);

      expect(screen.getByText(/original images included/i)).toBeInTheDocument();
    });

    it('does NOT show "Original images included" when includeOriginalImages=false', async () => {
      patchHookState({ exportOptions: { includeOriginalImages: false } });
      const user = userEvent.setup();
      renderDialog();
      await switchToFormatsTab(user);

      expect(
        screen.queryByText(/original images included/i)
      ).not.toBeInTheDocument();
    });

    it('shows "Visualizations" line when includeVisualizations=true', async () => {
      patchHookState({ exportOptions: { includeVisualizations: true } });
      const user = userEvent.setup();
      renderDialog();
      await switchToFormatsTab(user);

      expect(
        screen.getByText(/visualizations with numbered polygons/i)
      ).toBeInTheDocument();
    });

    it('shows annotations formats line when annotationFormats is non-empty', async () => {
      patchHookState({
        exportOptions: { annotationFormats: ['coco', 'yolo'] },
      });
      const user = userEvent.setup();
      renderDialog();
      await switchToFormatsTab(user);

      // "COCO, YOLO" (uppercased) should appear in summary
      const annLine = screen.getByText(/annotations:/i);
      expect(annLine.textContent).toMatch(/COCO/);
      expect(annLine.textContent).toMatch(/YOLO/);
    });

    it('shows metrics formats line when metricsFormats is non-empty', async () => {
      patchHookState({ exportOptions: { metricsFormats: ['excel', 'csv'] } });
      const user = userEvent.setup();
      renderDialog();
      await switchToFormatsTab(user);

      const metricsLine = screen.getByText(/metrics:/i);
      expect(metricsLine.textContent).toMatch(/EXCEL/);
    });

    it('shows "Documentation and metadata" line when includeDocumentation=true', async () => {
      patchHookState({ exportOptions: { includeDocumentation: true } });
      const user = userEvent.setup();
      renderDialog();
      await switchToFormatsTab(user);

      expect(
        screen.getByText(/documentation and metadata/i)
      ).toBeInTheDocument();
    });
  });

  // ── 12. Failed export with no message ────────────────────────────────────

  describe('failed export banner — missing message fallback', () => {
    it('shows "Unknown error" when currentJob.status=failed but message is absent', () => {
      patchHookState({
        currentJob: { id: 'j1', status: 'failed' }, // no message
      });
      renderDialog();

      expect(
        screen.getByText(/export failed: unknown error/i)
      ).toBeInTheDocument();
    });
  });

  // ── 13. Download banner — exportStatus text ───────────────────────────────

  describe('completed download banner — exportStatus text', () => {
    it('shows exportStatus text when set alongside completedJobId', () => {
      patchHookState({
        completedJobId: 'job-done',
        isExporting: false,
        isDownloading: false,
        exportStatus: 'Your export is ready to download.',
      });
      renderDialog();

      expect(
        screen.getByText(/your export is ready to download/i)
      ).toBeInTheDocument();
    });
  });

  // ── 14. Dialog closed when open=false ────────────────────────────────────

  describe('open=false prop', () => {
    it('renders no dialog content when open=false', () => {
      renderDialog({ open: false });
      expect(
        screen.queryByText('Advanced Export Options')
      ).not.toBeInTheDocument();
    });
  });
});
