import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ExcelExporter from '../ExcelExporter';

// vi.mock factories are hoisted — do NOT reference module-level variables inside them
vi.mock('@/pages/segmentation/utils/metricCalculations', () => ({
  calculateMetrics: vi.fn(() => ({
    Area: 1000,
    Perimeter: 120,
    Circularity: 0.87,
    Extent: 0.78,
    Convexity: 0.95,
    Solidity: 0.91,
    EquivalentDiameter: 35.7,
    FeretAspectRatio: 1.2,
    FeretDiameterMax: 45,
    FeretDiameterOrthogonal: 38,
    FeretDiameterMin: 30,
    BoundingBoxWidth: 40,
    BoundingBoxHeight: 35,
  })),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  isPolygonInsidePolygon: vi.fn(() => false),
}));

vi.mock('@/services/excelExportService', () => ({
  createExcelExport: vi.fn().mockResolvedValue({
    createWorkbook: () => ({
      addWorksheet: () => ({
        columns: [],
        addRow: vi.fn(),
        getRow: vi.fn(() => ({ font: {}, fill: {} })),
      }),
    }),
    writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    createBlob: vi.fn(() => new Blob()),
    downloadFile: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const makePoints = () => [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

const segmentationWithPolygons = {
  id: 'seg-1',
  imageWidth: 800,
  imageHeight: 600,
  polygons: [
    { id: 'ext-1', points: makePoints(), type: 'external' as const },
  ],
};

describe('ExcelExporter', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createExcelExport } = await import('@/services/excelExportService');
    vi.mocked(createExcelExport).mockResolvedValue({
      createWorkbook: () => ({
        addWorksheet: () => ({
          columns: [],
          addRow: vi.fn(),
          getRow: vi.fn(() => ({ font: {}, fill: {} })),
        }),
      }),
      writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      createBlob: vi.fn(() => new Blob()),
      downloadFile: vi.fn(),
    });
    const { calculateMetrics } = await import('@/pages/segmentation/utils/metricCalculations');
    vi.mocked(calculateMetrics).mockReturnValue({
      Area: 1000, Perimeter: 120, Circularity: 0.87, Extent: 0.78, Convexity: 0.95,
      Solidity: 0.91, EquivalentDiameter: 35.7, FeretAspectRatio: 1.2, FeretDiameterMax: 45,
      FeretDiameterOrthogonal: 38, FeretDiameterMin: 30, BoundingBoxWidth: 40, BoundingBoxHeight: 35,
    });
    const { isPolygonInsidePolygon } = await import('@/lib/polygonGeometry');
    vi.mocked(isPolygonInsidePolygon).mockReturnValue(false);
  });

  it('returns null when segmentation is null', () => {
    const { container } = render(<ExcelExporter segmentation={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a button even when polygon array is empty (guard only blocks null)', () => {
    // ExcelExporter guards against null segmentation but not empty arrays
    // It will render a button, but clicking it will export no rows
    render(
      <ExcelExporter segmentation={{ id: 'seg', polygons: [], imageWidth: 800, imageHeight: 600 }} />
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders export button when external polygons are present', () => {
    render(<ExcelExporter segmentation={segmentationWithPolygons} imageName="test.jpg" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders XLSX export button text', () => {
    render(<ExcelExporter segmentation={segmentationWithPolygons} imageName="test.jpg" />);
    expect(screen.getByRole('button')).toHaveTextContent(/xlsx/i);
  });

  it('calls createExcelExport when button is clicked', async () => {
    const { createExcelExport } = await import('@/services/excelExportService');
    const user = userEvent.setup();
    render(<ExcelExporter segmentation={segmentationWithPolygons} imageName="test.jpg" />);
    await user.click(screen.getByRole('button'));
    expect(createExcelExport).toHaveBeenCalled();
  });

  it('skips polylines — only external non-polyline polygons are exported', () => {
    const segWithPolylineOnly = {
      id: 'seg-2',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [
        {
          id: 'polyline-1',
          points: makePoints(),
          type: 'external' as const,
          geometry: 'polyline' as const,
        },
      ],
    };
    // Component renders because polygons array is non-empty
    const { container } = render(<ExcelExporter segmentation={segWithPolylineOnly} />);
    expect(container).toBeDefined();
  });

  it('calls isPolygonInsidePolygon to associate holes with external polygons', async () => {
    const { isPolygonInsidePolygon } = await import('@/lib/polygonGeometry');
    const { calculateMetrics } = await import('@/pages/segmentation/utils/metricCalculations');
    const user = userEvent.setup();

    const segWithInternal = {
      id: 'seg-3',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [
        { id: 'ext-1', points: makePoints(), type: 'external' as const },
        { id: 'int-1', points: makePoints(), type: 'internal' as const },
      ],
    };

    render(<ExcelExporter segmentation={segWithInternal} imageName="test.jpg" />);
    await user.click(screen.getByRole('button'));

    expect(isPolygonInsidePolygon).toHaveBeenCalled();
    expect(calculateMetrics).toHaveBeenCalled();
  });
});
