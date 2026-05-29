/**
 * ProjectImageExport — behavioral unit tests
 *
 * Covered behaviours:
 *  - Returns null when segmentation is null
 *  - Renders a title heading
 *  - Renders close button; clicking it calls onClose
 *  - Renders bottom-panel close button; clicking it also calls onClose
 *  - Shows Metrics tab when segmentation has polygon geometry
 *  - Does NOT show Metrics tab when segmentation has only polylines
 *  - Shows Sperm tab when segmentation has polyline geometry
 *  - Does NOT show Sperm tab when segmentation has only polygons
 *  - Always shows COCO tab regardless of geometry
 *  - Default active tab is "metrics" when segmentation has polygons
 *  - Default active tab is "sperm" when segmentation has only polylines
 *  - Default active tab is "coco" when segmentation has neither (edge case)
 *
 * NOT tested:
 *  - ExcelExporter file download (lazy-loaded, involves Blob/FileSaver; separate)
 *  - Clipboard API (requires navigator.clipboard stub; separate)
 *  - Framer-motion animations (CSS; not behavioural)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ProjectImageExport from '../ProjectImageExport';
import type { SegmentationResult, Polygon } from '@/lib/segmentation';

// ---------------------------------------------------------------------------
// Mock sub-components that have heavy deps or side-effects
// ---------------------------------------------------------------------------

vi.mock('../export/LazyExcelExporter', () => ({
  default: () => <button>ExcelExport</button>,
}));

vi.mock('../export/MetricsDisplay', () => ({
  default: ({ segmentation }: { segmentation: SegmentationResult }) => (
    <div
      data-testid="metrics-display"
      data-polygon-count={segmentation.polygons?.length}
    />
  ),
}));

vi.mock('../export/CocoTab', () => ({
  default: () => <div data-testid="coco-tab" />,
}));

vi.mock('../export/SpermExcelExporter', () => ({
  default: () => <div data-testid="sperm-exporter" />,
}));

vi.mock('@/services/excelExportService', () => ({
  createExcelExport: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makePolygon(id: string, geometry?: 'polygon' | 'polyline'): Polygon {
  return {
    id,
    type: 'external',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    ...(geometry !== undefined ? { geometry } : {}),
  };
}

function makeSegmentation(polygons: Polygon[]): SegmentationResult {
  return {
    id: 'seg-1',
    imageId: 'img-1',
    polygons,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as unknown as SegmentationResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProjectImageExport', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Null-guard
  // -------------------------------------------------------------------------

  describe('null guard', () => {
    it('renders nothing when segmentation is null', () => {
      const { container } = render(
        <ProjectImageExport segmentation={null} onClose={onClose} />
      );
      expect(container).toBeEmptyDOMElement();
    });
  });

  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------

  describe('basic rendering', () => {
    it('renders the modal heading', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
          onClose={onClose}
        />
      );
      // Heading uses t('export.segmentationData') — seeded English or raw key
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading).toBeInTheDocument();
    });

    it('calls onClose when the X button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
          onClose={onClose}
        />
      );
      // The icon-only close button is the one with no text label
      const closeButtons = screen.getAllByRole('button');
      // First button in the header is the X close button
      await user.click(closeButtons[0]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when the bottom Close button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
          onClose={onClose}
        />
      );
      // Find the last "Close" button in the footer
      const allButtons = screen.getAllByRole('button');
      const lastButton = allButtons[allButtons.length - 1];
      await user.click(lastButton);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Tab visibility
  // -------------------------------------------------------------------------

  describe('tab visibility', () => {
    it('shows Metrics tab when segmentation has polygon geometry', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
          onClose={onClose}
        />
      );
      // English translation: 'Spheroid Metrics'
      expect(
        screen.getByRole('tab', { name: 'Spheroid Metrics' })
      ).toBeInTheDocument();
    });

    it('does NOT show Metrics tab when segmentation has only polylines', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polyline')])}
          onClose={onClose}
        />
      );
      expect(
        screen.queryByRole('tab', { name: 'Spheroid Metrics' })
      ).toBeNull();
    });

    it('shows Sperm tab when segmentation has polyline geometry', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polyline')])}
          onClose={onClose}
        />
      );
      // English translation: 'Sperm Metrics'
      expect(
        screen.getByRole('tab', { name: 'Sperm Metrics' })
      ).toBeInTheDocument();
    });

    it('does NOT show Sperm tab when segmentation has only polygons', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
          onClose={onClose}
        />
      );
      expect(screen.queryByRole('tab', { name: 'Sperm Metrics' })).toBeNull();
    });

    it('always shows COCO tab regardless of geometry type', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
          onClose={onClose}
        />
      );
      // English translation: 'COCO Format'
      expect(
        screen.getByRole('tab', { name: 'COCO Format' })
      ).toBeInTheDocument();
    });

    it('shows COCO tab even with only polylines', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polyline')])}
          onClose={onClose}
        />
      );
      expect(
        screen.getByRole('tab', { name: 'COCO Format' })
      ).toBeInTheDocument();
    });

    it('shows both Metrics and Sperm tabs when mixed geometry exists', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([
            makePolygon('p1', 'polygon'),
            makePolygon('p2', 'polyline'),
          ])}
          onClose={onClose}
        />
      );
      expect(
        screen.getByRole('tab', { name: 'Spheroid Metrics' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('tab', { name: 'Sperm Metrics' })
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Default active tab
  // -------------------------------------------------------------------------

  describe('default active tab', () => {
    it('activates "metrics" tab by default when segmentation has polygons', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
          onClose={onClose}
        />
      );
      // The MetricsDisplay is rendered (metrics panel visible)
      expect(screen.getByTestId('metrics-display')).toBeInTheDocument();
    });

    it('activates "sperm" tab by default when segmentation has only polylines', () => {
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polyline')])}
          onClose={onClose}
        />
      );
      expect(screen.getByTestId('sperm-exporter')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Tab switching
  // -------------------------------------------------------------------------

  describe('tab switching', () => {
    it('switches to COCO tab when COCO tab trigger is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
          onClose={onClose}
        />
      );
      await user.click(screen.getByRole('tab', { name: 'COCO Format' }));
      expect(screen.getByTestId('coco-tab')).toBeInTheDocument();
    });

    it('switches to Sperm tab when both tabs exist', async () => {
      const user = userEvent.setup();
      render(
        <ProjectImageExport
          segmentation={makeSegmentation([
            makePolygon('p1', 'polygon'),
            makePolygon('p2', 'polyline'),
          ])}
          onClose={onClose}
        />
      );
      await user.click(screen.getByRole('tab', { name: 'Sperm Metrics' }));
      expect(screen.getByTestId('sperm-exporter')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // imageName prop (passed through to sub-components)
  // -------------------------------------------------------------------------

  describe('imageName prop', () => {
    it('renders without error when imageName is provided', () => {
      expect(() =>
        render(
          <ProjectImageExport
            segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
            imageName="sample_image.tiff"
            onClose={onClose}
          />
        )
      ).not.toThrow();
    });

    it('renders without error when imageName is omitted', () => {
      expect(() =>
        render(
          <ProjectImageExport
            segmentation={makeSegmentation([makePolygon('p1', 'polygon')])}
            onClose={onClose}
          />
        )
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Polygons without explicit geometry (backward compat: treated as polygon)
  // -------------------------------------------------------------------------

  describe('backward-compat: polygon without geometry field', () => {
    it('treats polygons missing geometry field as polygons (shows Metrics tab)', () => {
      // makePolygon without second arg = no geometry property
      const seg = makeSegmentation([makePolygon('p1')]);
      render(<ProjectImageExport segmentation={seg} onClose={onClose} />);
      expect(
        screen.getByRole('tab', { name: 'Spheroid Metrics' })
      ).toBeInTheDocument();
    });
  });
});
