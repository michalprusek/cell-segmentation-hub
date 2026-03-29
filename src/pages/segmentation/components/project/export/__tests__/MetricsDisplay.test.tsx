import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import MetricsDisplay from '../MetricsDisplay';

// vi.mock factories are hoisted — do NOT reference module-level variables inside them
vi.mock('@/pages/segmentation/utils/metricCalculations', () => ({
  calculateMetrics: vi.fn(() => ({
    Area: 1234.56,
    Perimeter: 150.2,
    Circularity: 0.72,
    EquivalentDiameter: 39.6,
    FeretDiameterMax: 48.0,
    FeretDiameterMin: 32.0,
    Compactness: 0.65,
    Convexity: 0.94,
    Solidity: 0.89,
    Sphericity: 0.81,
    FeretAspectRatio: 1.5,
  })),
  formatNumber: (n: number) => (n !== undefined && n !== null ? n.toFixed(2) : '0.00'),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  isPolygonInsidePolygon: vi.fn(() => false),
}));

vi.mock('@/lib/downloadUtils', () => ({
  downloadJSON: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const makePoints = () => [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

const makeSegmentation = (overrides?: object) => ({
  id: 'seg-1',
  imageWidth: 800,
  imageHeight: 600,
  polygons: [
    { id: 'ext-1', points: makePoints(), type: 'external' as const, ...overrides },
  ],
});

beforeEach(async () => {
  vi.clearAllMocks();
  // Re-apply implementations cleared by clearAllMocks
  const { calculateMetrics } = await import('@/pages/segmentation/utils/metricCalculations');
  vi.mocked(calculateMetrics).mockReturnValue({
    Area: 1234.56, Perimeter: 150.2, Circularity: 0.72, EquivalentDiameter: 39.6,
    FeretDiameterMax: 48.0, FeretDiameterMin: 32.0, Compactness: 0.65, Convexity: 0.94,
    Solidity: 0.89, Sphericity: 0.81, FeretAspectRatio: 1.5,
  });
  const { isPolygonInsidePolygon } = await import('@/lib/polygonGeometry');
  vi.mocked(isPolygonInsidePolygon).mockReturnValue(false);
  const { downloadJSON } = await import('@/lib/downloadUtils');
  vi.mocked(downloadJSON).mockImplementation(() => {});
});

describe('MetricsDisplay', () => {
  it('renders metrics section for each external polygon', () => {
    render(<MetricsDisplay segmentation={makeSegmentation()} />);
    expect(screen.getByText(/#1/)).toBeInTheDocument();
  });

  it('displays area metric label', () => {
    render(<MetricsDisplay segmentation={makeSegmentation()} />);
    expect(screen.getByText(/px²/)).toBeInTheDocument();
  });

  it('shows empty state when no external polygons', () => {
    const emptySegmentation = {
      id: 'seg-2',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [],
    };
    render(<MetricsDisplay segmentation={emptySegmentation} />);
    // The empty-state message contains "no" — from i18n key metrics.noPolygonsFound
    expect(document.body.textContent).toMatch(/no/i);
  });

  it('renders copy button for each external polygon', () => {
    render(<MetricsDisplay segmentation={makeSegmentation()} />);
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders download button for each external polygon', () => {
    render(<MetricsDisplay segmentation={makeSegmentation()} />);
    const downloadButtons = screen.getAllByRole('button', { name: /download/i });
    expect(downloadButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('copy button is clickable without throwing', async () => {
    // jsdom does not support navigator.clipboard in a secure context;
    // verify the button can be clicked without error
    const user = userEvent.setup();
    render(<MetricsDisplay segmentation={makeSegmentation()} />);
    const copyButton = screen.getAllByRole('button', { name: /copy/i })[0];
    await expect(user.click(copyButton)).resolves.toBeUndefined();
  });

  it('calls downloadJSON when download button is clicked', async () => {
    const { downloadJSON } = await import('@/lib/downloadUtils');
    const user = userEvent.setup();
    render(<MetricsDisplay segmentation={makeSegmentation()} />);
    const downloadButton = screen.getAllByRole('button', { name: /download/i })[0];
    await user.click(downloadButton);
    expect(downloadJSON).toHaveBeenCalled();
  });

  it('filters out polylines — calculateMetrics is not called for polyline polygons', async () => {
    const { calculateMetrics } = await import('@/pages/segmentation/utils/metricCalculations');
    const segWithPolyline = {
      id: 'seg-3',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [
        {
          id: 'ext-1',
          points: makePoints(),
          type: 'external' as const,
          geometry: 'polyline' as const,
        },
      ],
    };
    render(<MetricsDisplay segmentation={segWithPolyline} />);
    // Polylines are excluded by the filter before calculateMetrics is called
    expect(calculateMetrics).not.toHaveBeenCalled();
  });
});
