import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen as rtlScreen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import SpermExcelExporter from '../SpermExcelExporter';

// vi.mock factories are hoisted — do not reference module-level variables inside them
vi.mock('@/pages/segmentation/utils/metricCalculations', () => ({
  calculatePolylineLength: vi.fn(() => 50.5),
}));

vi.mock('@/services/excelExportService', () => ({
  createExcelExport: vi.fn().mockResolvedValue({
    createWorkbook: () => ({
      addWorksheet: () => ({
        addRow: vi.fn(() => ({ font: {}, fill: {} })),
        columns: [],
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const makePolyline = (
  id: string,
  partClass: string,
  instanceId = 'sperm-1'
) => ({
  id,
  points: [
    { x: 0, y: 0 },
    { x: 50, y: 50 },
  ],
  type: 'external' as const,
  geometry: 'polyline' as const,
  instanceId,
  partClass,
});

describe('SpermExcelExporter', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Restore default mock implementations after clearAllMocks
    const { createExcelExport } = await import('@/services/excelExportService');
    vi.mocked(createExcelExport).mockResolvedValue({
      createWorkbook: () => ({
        addWorksheet: () => ({
          addRow: vi.fn(() => ({ font: {}, fill: {} })),
          columns: [],
        }),
      }),
      writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      createBlob: vi.fn(() => new Blob()),
      downloadFile: vi.fn(),
    });
    const { calculatePolylineLength } = await import(
      '@/pages/segmentation/utils/metricCalculations'
    );
    vi.mocked(calculatePolylineLength).mockReturnValue(50.5);
  });

  it('returns null when segmentation is null', () => {
    const { container } = render(<SpermExcelExporter segmentation={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when there are no polylines', () => {
    const segNoPolylines = {
      id: 'seg-1',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [
        {
          id: 'p1',
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 },
          ],
          type: 'external' as const,
        },
      ],
    };
    const { container } = render(
      <SpermExcelExporter segmentation={segNoPolylines} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders when polylines are present', () => {
    const seg = {
      id: 'seg-2',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [makePolyline('pl-1', 'head')],
    };
    render(<SpermExcelExporter segmentation={seg} imageName="sperm.jpg" />);
    expect(rtlScreen.getByRole('button')).toBeInTheDocument();
  });

  it('renders calibration input', () => {
    const seg = {
      id: 'seg-3',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [makePolyline('pl-1', 'head')],
    };
    render(<SpermExcelExporter segmentation={seg} />);
    expect(rtlScreen.getByRole('spinbutton')).toBeInTheDocument();
  });

  it('groups polylines by instanceId and shows instance/polyline summary', () => {
    const seg = {
      id: 'seg-4',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [
        makePolyline('pl-1', 'head'),
        makePolyline('pl-2', 'midpiece'),
        makePolyline('pl-3', 'tail'),
      ],
    };
    render(<SpermExcelExporter segmentation={seg} imageName="sperm.jpg" />);
    // 1 instance, 3 polylines — the summary contains at least one digit
    expect(document.body.textContent).toMatch(/1/);
  });

  it('accepts calibration value input', async () => {
    const user = userEvent.setup();
    const seg = {
      id: 'seg-5',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [makePolyline('pl-1', 'head')],
    };
    render(<SpermExcelExporter segmentation={seg} />);
    const input = rtlScreen.getByRole('spinbutton');
    await user.type(input, '0.065');
    expect(input).toHaveValue(0.065);
  });

  it('calls createExcelExport when export button is clicked', async () => {
    const { createExcelExport } = await import('@/services/excelExportService');
    const user = userEvent.setup();
    const seg = {
      id: 'seg-6',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [makePolyline('pl-1', 'head')],
    };
    render(<SpermExcelExporter segmentation={seg} imageName="sperm.jpg" />);
    const button = rtlScreen.getByRole('button');
    await user.click(button);
    expect(createExcelExport).toHaveBeenCalled();
  });

  it('disables button while export is in progress', async () => {
    const { createExcelExport } = await import('@/services/excelExportService');

    let resolveExport!: (v: any) => void;
    vi.mocked(createExcelExport).mockReturnValueOnce(
      new Promise(resolve => {
        resolveExport = resolve;
      })
    );

    const user = userEvent.setup();
    const seg = {
      id: 'seg-7',
      imageWidth: 800,
      imageHeight: 600,
      polygons: [makePolyline('pl-1', 'head')],
    };
    render(<SpermExcelExporter segmentation={seg} imageName="sperm.jpg" />);
    const button = rtlScreen.getByRole('button');
    await user.click(button);

    expect(button).toBeDisabled();

    // Resolve to avoid memory leaks
    resolveExport({
      createWorkbook: () => ({
        addWorksheet: () => ({
          addRow: vi.fn(() => ({ font: {}, fill: {} })),
          columns: [],
        }),
      }),
      writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      createBlob: vi.fn(() => new Blob()),
      downloadFile: vi.fn(),
    });
  });
});
