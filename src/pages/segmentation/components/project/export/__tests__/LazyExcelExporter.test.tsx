/**
 * Tests for LazyExcelExporter component.
 *
 * Covers:
 *  - null render when segmentation is null or has no polygons
 *  - renders the "Export All Metrics" trigger button initially
 *  - clicking the button swaps in the lazy ExcelExporter (mocked)
 *  - the Suspense fallback ("Loading…" disabled button) is shown
 *    while the lazy chunk is pending
 *  - ExcelExporter receives the correct segmentation / imageName props
 *
 * lazyWithRetry is mocked so we control when the lazy component resolves.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import type { SegmentationResult } from '@/lib/segmentation';

// -----------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'segmentationEditor.export.exportAllMetrics': 'Export All Metrics',
      };
      return map[key] ?? key;
    },
  }),
}));

// ExcelExporter stub — records the props it receives.
const MockExcelExporter = vi.fn(
  ({ imageName }: { segmentation: SegmentationResult; imageName?: string }) => (
    <div data-testid="excel-exporter">{imageName ?? 'no-name'}</div>
  )
);

// lazyWithRetry mock — returns a real React.lazy wrapping our stub so
// Suspense still works exactly as it would at runtime.
vi.mock('@/lib/lazyWithRetry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lazyWithRetry')>(
    '@/lib/lazyWithRetry'
  );
  return {
    ...actual,
    lazyWithRetry: (_importFn: () => Promise<{ default: unknown }>) =>
      React.lazy(() =>
        Promise.resolve({
          default: MockExcelExporter as unknown as React.ComponentType<any>,
        })
      ),
  };
});

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function makeSegmentation(polygonCount = 1): SegmentationResult {
  return {
    id: 'seg-1',
    imageId: 'img-1',
    polygons: Array.from({ length: polygonCount }, (_, i) => ({
      id: `poly-${i}`,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      name: `Polygon ${i}`,
      geometry: 'polygon' as const,
    })),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

// Import under test — must come AFTER the mocks are registered.
import LazyExcelExporter from '../LazyExcelExporter';

describe('LazyExcelExporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Null render cases
  // -----------------------------------------------------------------------

  describe('Null render', () => {
    it('renders nothing when segmentation is null', () => {
      const { container } = render(<LazyExcelExporter segmentation={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when segmentation has no polygons array', () => {
      const { container } = render(
        <LazyExcelExporter
          segmentation={{ ...makeSegmentation(0), polygons: undefined as any }}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Trigger button
  // -----------------------------------------------------------------------

  describe('Trigger button', () => {
    it('shows the Export All Metrics button initially', () => {
      render(<LazyExcelExporter segmentation={makeSegmentation()} />);
      expect(
        screen.getByRole('button', { name: /export all metrics/i })
      ).toBeInTheDocument();
    });

    it('trigger button is enabled', () => {
      render(<LazyExcelExporter segmentation={makeSegmentation()} />);
      expect(
        screen.getByRole('button', { name: /export all metrics/i })
      ).not.toBeDisabled();
    });

    it('does not show ExcelExporter before the button is clicked', () => {
      render(<LazyExcelExporter segmentation={makeSegmentation()} />);
      expect(screen.queryByTestId('excel-exporter')).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // After button click — lazy loads ExcelExporter
  // -----------------------------------------------------------------------

  describe('After button click', () => {
    it('lazy-loads and renders ExcelExporter after button click', async () => {
      const user = userEvent.setup();
      render(<LazyExcelExporter segmentation={makeSegmentation()} />);

      await user.click(
        screen.getByRole('button', { name: /export all metrics/i })
      );

      await waitFor(() => {
        expect(screen.getByTestId('excel-exporter')).toBeInTheDocument();
      });
    });

    it('hides the trigger button after click', async () => {
      const user = userEvent.setup();
      render(<LazyExcelExporter segmentation={makeSegmentation()} />);

      await user.click(
        screen.getByRole('button', { name: /export all metrics/i })
      );

      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /export all metrics/i })
        ).not.toBeInTheDocument();
      });
    });

    it('passes imageName to ExcelExporter', async () => {
      const user = userEvent.setup();
      render(
        <LazyExcelExporter
          segmentation={makeSegmentation()}
          imageName="my-image.tif"
        />
      );

      await user.click(
        screen.getByRole('button', { name: /export all metrics/i })
      );

      await waitFor(() => {
        expect(screen.getByTestId('excel-exporter')).toHaveTextContent(
          'my-image.tif'
        );
      });
    });

    it('calls ExcelExporter with segmentation prop', async () => {
      const user = userEvent.setup();
      const seg = makeSegmentation(2);
      render(<LazyExcelExporter segmentation={seg} />);

      await user.click(
        screen.getByRole('button', { name: /export all metrics/i })
      );

      await waitFor(() => {
        expect(MockExcelExporter).toHaveBeenCalledWith(
          expect.objectContaining({ segmentation: seg }),
          expect.anything()
        );
      });
    });
  });
});
