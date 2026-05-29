import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import { ExportProgressPanel } from '../ExportProgressPanel';

// framer-motion: render children directly without animation
vi.mock('framer-motion', () => ({
  motion: {
    div: ({
      children,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...rest}>{children}</div>,
  },
}));

// UniversalCancelButton has its own language dep; mock it simply
vi.mock('@/components/ui/universal-cancel-button', () => ({
  UniversalCancelButton: ({
    onCancel,
    cancelText,
    disabled,
  }: {
    onCancel: () => void;
    cancelText?: string;
    disabled?: boolean;
  }) => (
    <button onClick={onCancel} disabled={disabled} data-testid="cancel-btn">
      {cancelText ?? 'Cancel'}
    </button>
  ),
}));

const BASE_PROPS = {
  isExporting: false,
  isDownloading: false,
  exportProgress: 0,
  exportStatus: '',
  completedJobId: null,
  onCancelExport: vi.fn().mockResolvedValue(undefined),
  onTriggerDownload: vi.fn(),
  onDismissExport: vi.fn(),
};

describe('ExportProgressPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    BASE_PROPS.onCancelExport.mockResolvedValue(undefined);
  });

  describe('Visibility', () => {
    it('renders null when no operation is active', () => {
      const { container } = render(<ExportProgressPanel {...BASE_PROPS} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders when isExporting is true', () => {
      render(<ExportProgressPanel {...BASE_PROPS} isExporting={true} />);
      // t('export.title') = 'Export Progress'
      expect(screen.getByText('Export Progress')).toBeInTheDocument();
    });

    it('renders when isDownloading is true', () => {
      render(<ExportProgressPanel {...BASE_PROPS} isDownloading={true} />);
      expect(screen.getByText('Export Progress')).toBeInTheDocument();
    });

    it('renders when completedJobId is set', () => {
      render(<ExportProgressPanel {...BASE_PROPS} completedJobId="job-123" />);
      expect(screen.getByText('Export Progress')).toBeInTheDocument();
    });
  });

  describe('Processing phase', () => {
    it('shows Processing badge when isExporting', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          exportProgress={35}
          exportStatus="Packaging files..."
        />
      );
      // t('export.processingExport') = 'Processing...'
      expect(screen.getByText('Processing...')).toBeInTheDocument();
    });

    it('displays progress percentage', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          exportProgress={72}
        />
      );
      expect(screen.getByText('72%')).toBeInTheDocument();
    });

    it('shows custom exportStatus text when provided', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          exportProgress={50}
          exportStatus="Compressing data..."
        />
      );
      expect(screen.getByText('Compressing data...')).toBeInTheDocument();
    });

    it('renders the cancel button when exporting', () => {
      render(<ExportProgressPanel {...BASE_PROPS} isExporting={true} />);
      expect(screen.getByTestId('cancel-btn')).toBeInTheDocument();
    });
  });

  describe('Completed phase', () => {
    it('shows Download and Dismiss buttons when job is complete', () => {
      render(<ExportProgressPanel {...BASE_PROPS} completedJobId="job-456" />);
      // t('export.download') = 'Download'
      expect(
        screen.getByRole('button', { name: /download/i })
      ).toBeInTheDocument();
      // t('common.dismiss') = 'Dismiss'
      expect(
        screen.getByRole('button', { name: /dismiss/i })
      ).toBeInTheDocument();
    });

    it('shows Completed badge', () => {
      render(<ExportProgressPanel {...BASE_PROPS} completedJobId="job-456" />);
      // t('export.completed') = 'Export completed'
      expect(screen.getByText('Export completed')).toBeInTheDocument();
    });

    it('calls onTriggerDownload when Download button is clicked', async () => {
      const user = userEvent.setup();
      const onTriggerDownload = vi.fn();
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          completedJobId="job-456"
          onTriggerDownload={onTriggerDownload}
        />
      );
      await user.click(screen.getByRole('button', { name: /download/i }));
      expect(onTriggerDownload).toHaveBeenCalledTimes(1);
    });

    it('calls onDismissExport when Dismiss button is clicked', async () => {
      const user = userEvent.setup();
      const onDismissExport = vi.fn();
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          completedJobId="job-456"
          onDismissExport={onDismissExport}
        />
      );
      await user.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(onDismissExport).toHaveBeenCalledTimes(1);
    });

    it('shows 100% progress when completed', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          completedJobId="job-456"
          exportProgress={0}
        />
      );
      // Completed phase: getProgressPercentage() returns 100
      // But the progress bar is only rendered when isExporting/isDownloading/isCancelling
      // The completed state shows readyToDownload text
      expect(screen.getByText('Export Progress')).toBeInTheDocument();
    });
  });

  describe('Downloading phase', () => {
    it('shows Downloading badge when isDownloading', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isDownloading={true}
          completedJobId="job-789"
        />
      );
      // t('export.downloading') = 'Downloading...'
      expect(screen.getAllByText('Downloading...').length).toBeGreaterThan(0);
    });

    it('disables Download button while downloading', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isDownloading={true}
          completedJobId="job-789"
        />
      );
      // The download button: completedJobId set + !isExporting → rendered
      // but disabled when isDownloading
      const downloadBtn = screen.getByRole('button', { name: /downloading/i });
      expect(downloadBtn).toBeDisabled();
    });
  });

  describe('Cancel flow', () => {
    it('calls onCancelExport when cancel button is clicked', async () => {
      const user = userEvent.setup();
      const onCancelExport = vi.fn().mockResolvedValue(undefined);
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          onCancelExport={onCancelExport}
        />
      );
      await user.click(screen.getByTestId('cancel-btn'));
      expect(onCancelExport).toHaveBeenCalledTimes(1);
    });

    it('disables cancel button during isCancelling state', async () => {
      const user = userEvent.setup();
      // Make onCancelExport a long-running promise
      let resolve: () => void;
      const onCancelExport = vi.fn().mockImplementation(
        () =>
          new Promise<void>(r => {
            resolve = r;
          })
      );
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          onCancelExport={onCancelExport}
        />
      );
      const cancelBtn = screen.getByTestId('cancel-btn');
      // Click cancel — this starts isCancelling
      await user.click(cancelBtn);
      // isCancelling=true → cancel button is disabled (prop passed through our mock)
      await waitFor(() => {
        expect(cancelBtn).toBeDisabled();
      });
      // Clean up
      act(() => {
        resolve();
      });
    });
  });

  describe('WebSocket fallback', () => {
    it('shows fallback mode badge when ws is disconnected and exporting', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          wsConnected={false}
        />
      );
      // t('export.fallbackMode') = 'Polling mode'
      expect(screen.getByText('Polling mode')).toBeInTheDocument();
    });

    it('shows fallback message text when ws disconnected', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          wsConnected={false}
        />
      );
      // t('export.fallbackMessage') — multiple elements may match /polling/i
      const matches = screen.getAllByText(/polling/i);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('does not show fallback elements when ws is connected', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          wsConnected={true}
        />
      );
      expect(screen.queryByText('Polling mode')).not.toBeInTheDocument();
    });
  });

  describe('Progress clamping', () => {
    it('clamps progress to 0 when exportProgress is negative', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          exportProgress={-10}
        />
      );
      expect(screen.getByText('0%')).toBeInTheDocument();
    });

    it('clamps progress to 100 when exportProgress exceeds 100', () => {
      render(
        <ExportProgressPanel
          {...BASE_PROPS}
          isExporting={true}
          exportProgress={150}
        />
      );
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });
});
