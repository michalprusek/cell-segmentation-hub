/**
 * Behavioral unit tests for ExportOptionsCard.
 *
 * Tested behaviours:
 *  1.  Card title "Export Options" renders.
 *  2.  "Include metadata" checkbox renders and reflects includeMetadata prop (checked).
 *  3.  "Include metadata" checkbox reflects unchecked state.
 *  4.  Clicking Include metadata checkbox calls setIncludeMetadata(!includeMetadata).
 *  5.  "Include segmentation" checkbox renders and reflects includeSegmentation.
 *  6.  Clicking Include segmentation calls setIncludeSegmentation(!includeSegmentation).
 *  7.  "Include object metrics" checkbox renders.
 *  8.  Clicking Include object metrics calls setIncludeObjectMetrics(!includeObjectMetrics).
 *  9.  "Export only metrics (XLSX)" button is hidden when includeObjectMetrics=false.
 *  10. "Export only metrics (XLSX)" button appears when includeObjectMetrics=true.
 *  11. XLSX button is disabled when getSelectedCount() returns 0.
 *  12. XLSX button is enabled when getSelectedCount() returns > 0 and isExporting=false.
 *  13. XLSX button is disabled when isExporting=true (even if count > 0).
 *  14. Clicking XLSX button calls handleExportMetricsAsXlsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ExportOptionsCard from '../ExportOptionsCard';

// ── default props factory ────────────────────────────────────────────────────

function makeProps(
  overrides: Partial<{
    includeMetadata: boolean;
    setIncludeMetadata: (v: boolean) => void;
    includeSegmentation: boolean;
    setIncludeSegmentation: (v: boolean) => void;
    includeObjectMetrics: boolean;
    setIncludeObjectMetrics: (v: boolean) => void;
    handleExportMetricsAsXlsx: () => void;
    getSelectedCount: () => number;
    isExporting: boolean;
  }> = {}
) {
  return {
    includeMetadata: false,
    setIncludeMetadata: vi.fn(),
    includeSegmentation: false,
    setIncludeSegmentation: vi.fn(),
    includeObjectMetrics: false,
    setIncludeObjectMetrics: vi.fn(),
    handleExportMetricsAsXlsx: vi.fn(),
    getSelectedCount: vi.fn().mockReturnValue(0),
    isExporting: false,
    ...overrides,
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('ExportOptionsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1
  it('renders the card title', () => {
    render(<ExportOptionsCard {...makeProps()} />);
    expect(screen.getByText('Export Options')).toBeInTheDocument();
  });

  // 2
  it('renders Include metadata checkbox as checked', () => {
    render(<ExportOptionsCard {...makeProps({ includeMetadata: true })} />);
    const cb = screen.getByRole('checkbox', { name: 'Include metadata' });
    expect(cb).toBeChecked();
  });

  // 3
  it('renders Include metadata checkbox as unchecked', () => {
    render(<ExportOptionsCard {...makeProps({ includeMetadata: false })} />);
    const cb = screen.getByRole('checkbox', { name: 'Include metadata' });
    expect(cb).not.toBeChecked();
  });

  // 4
  it('calls setIncludeMetadata with toggled value when checkbox clicked', async () => {
    const setIncludeMetadata = vi.fn();
    render(
      <ExportOptionsCard
        {...makeProps({ includeMetadata: false, setIncludeMetadata })}
      />
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Include metadata' })
    );
    expect(setIncludeMetadata).toHaveBeenCalledWith(true);
  });

  // 5
  it('renders Include segmentation checkbox reflecting the prop', () => {
    render(<ExportOptionsCard {...makeProps({ includeSegmentation: true })} />);
    expect(
      screen.getByRole('checkbox', { name: 'Include segmentation' })
    ).toBeChecked();
  });

  // 6
  it('calls setIncludeSegmentation with toggled value when clicked', async () => {
    const setIncludeSegmentation = vi.fn();
    render(
      <ExportOptionsCard
        {...makeProps({ includeSegmentation: true, setIncludeSegmentation })}
      />
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Include segmentation' })
    );
    expect(setIncludeSegmentation).toHaveBeenCalledWith(false);
  });

  // 7
  it('renders Include object metrics checkbox', () => {
    render(<ExportOptionsCard {...makeProps()} />);
    expect(
      screen.getByRole('checkbox', { name: 'Include object metrics' })
    ).toBeInTheDocument();
  });

  // 8
  it('calls setIncludeObjectMetrics with toggled value when clicked', async () => {
    const setIncludeObjectMetrics = vi.fn();
    render(
      <ExportOptionsCard
        {...makeProps({ includeObjectMetrics: false, setIncludeObjectMetrics })}
      />
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Include object metrics' })
    );
    expect(setIncludeObjectMetrics).toHaveBeenCalledWith(true);
  });

  // 9
  it('hides XLSX button when includeObjectMetrics=false', () => {
    render(
      <ExportOptionsCard {...makeProps({ includeObjectMetrics: false })} />
    );
    expect(
      screen.queryByText('Export only metrics (XLSX)')
    ).not.toBeInTheDocument();
  });

  // 10
  it('shows XLSX button when includeObjectMetrics=true', () => {
    render(
      <ExportOptionsCard
        {...makeProps({
          includeObjectMetrics: true,
          getSelectedCount: () => 1,
        })}
      />
    );
    expect(screen.getByText('Export only metrics (XLSX)')).toBeInTheDocument();
  });

  // 11
  it('disables XLSX button when getSelectedCount() === 0', () => {
    render(
      <ExportOptionsCard
        {...makeProps({
          includeObjectMetrics: true,
          getSelectedCount: () => 0,
        })}
      />
    );
    expect(
      screen.getByText('Export only metrics (XLSX)').closest('button')
    ).toBeDisabled();
  });

  // 12
  it('enables XLSX button when count > 0 and not exporting', () => {
    render(
      <ExportOptionsCard
        {...makeProps({
          includeObjectMetrics: true,
          getSelectedCount: () => 3,
          isExporting: false,
        })}
      />
    );
    expect(
      screen.getByText('Export only metrics (XLSX)').closest('button')
    ).not.toBeDisabled();
  });

  // 13
  it('disables XLSX button when isExporting=true', () => {
    render(
      <ExportOptionsCard
        {...makeProps({
          includeObjectMetrics: true,
          getSelectedCount: () => 5,
          isExporting: true,
        })}
      />
    );
    expect(
      screen.getByText('Export only metrics (XLSX)').closest('button')
    ).toBeDisabled();
  });

  // 14
  it('calls handleExportMetricsAsXlsx when XLSX button is clicked', async () => {
    const handleExportMetricsAsXlsx = vi.fn();
    render(
      <ExportOptionsCard
        {...makeProps({
          includeObjectMetrics: true,
          getSelectedCount: () => 2,
          handleExportMetricsAsXlsx,
        })}
      />
    );
    await userEvent.click(screen.getByText('Export only metrics (XLSX)'));
    expect(handleExportMetricsAsXlsx).toHaveBeenCalledTimes(1);
  });
});
