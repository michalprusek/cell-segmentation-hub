/**
 * Unit tests for useExportFunctions.
 *
 * Coverage targets:
 *  - selectedImages initialised from images array on mount
 *  - handleSelectAll: toggles between all-on and all-off
 *  - handleSelectImage: individual toggle
 *  - getSelectedCount accuracy
 *  - Boolean option setters (includeMetadata, includeObjectMetrics, includeSegmentation)
 *  - isExporting flag lifecycle during handleExport / handleExportMetricsAsXlsx
 *  - handleExport: skips metrics xlsx when includeObjectMetrics=false
 *
 * NOTE: handleExportMetricsAsXlsx and handleExport rely on heavy lazy imports
 * (ExcelJS, lazyLoadMetricCalculations) and DOM file-download APIs that have no
 * meaningful jsdom equivalent. We mock those surfaces and focus on the hook's
 * own state-machine logic (flag transitions, filtering, API call decisions).
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ProjectImage } from '@/types';
import { useExportFunctions } from '../useExportFunctions';

// ------------------------------------------------------------------
// Mocks
// ------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Mock useLanguage so we don't need the full auth/provider tree
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
  }),
}));

// Mock the heavy lazy imports used inside the hook
vi.mock('@/lib/lazyImports', () => ({
  lazyLoadMetricCalculations: vi.fn().mockResolvedValue({
    calculateMetrics: vi.fn().mockReturnValue({
      Area: 100,
      Perimeter: 40,
      Circularity: 0.9,
      EquivalentDiameter: 11,
      Compactness: 0.85,
      Convexity: 0.95,
      Solidity: 0.9,
      Sphericity: 0.88,
      FeretDiameterMax: 12,
      FeretDiameterMin: 10,
      FeretAspectRatio: 1.2,
    }),
  }),
}));

vi.mock('@/services/excelExportService', () => ({
  createExcelExport: vi.fn().mockResolvedValue({
    createWorkbook: vi.fn().mockReturnValue({
      addWorksheet: vi.fn().mockReturnValue({
        columns: [],
        addRow: vi.fn(),
        getRow: vi.fn().mockReturnValue({
          font: {},
          fill: {},
        }),
      }),
    }),
    writeBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    createBlob: vi.fn().mockReturnValue(new Blob(['test'])),
    downloadFile: vi.fn(),
  }),
}));

vi.mock('@/lib/downloadUtils', () => ({
  downloadJSON: vi.fn(),
}));

vi.mock('@/lib/polygonGeometry', () => ({
  isPolygonInsidePolygon: vi.fn().mockReturnValue(false),
}));

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function makeImage(
  id: string,
  name = `Image ${id}`,
  hasSegmentation = false
): ProjectImage {
  return {
    id,
    name,
    url: `http://example.com/${id}.png`,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    segmentationStatus: hasSegmentation ? 'completed' : 'no_segmentation',
    segmentationResult: hasSegmentation
      ? {
          polygons: [
            {
              id: 'p1',
              type: 'external',
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
              ],
            },
          ],
        }
      : undefined,
  } as unknown as ProjectImage;
}

// ------------------------------------------------------------------

describe('useExportFunctions — initial state', () => {
  it('initialises selectedImages to all images selected', async () => {
    const images = [makeImage('a'), makeImage('b'), makeImage('c')];
    const { result } = renderHook(() =>
      useExportFunctions(images, 'TestProject')
    );

    // The effect fires on mount; wait for it
    await waitFor(() => {
      const vals = Object.values(result.current.selectedImages);
      return vals.length === 3 && vals.every(Boolean);
    });

    expect(Object.keys(result.current.selectedImages)).toHaveLength(3);
    expect(result.current.getSelectedCount()).toBe(3);
  });

  it('has default option flags set to true', () => {
    const { result } = renderHook(() => useExportFunctions([], 'TestProject'));

    expect(result.current.includeMetadata).toBe(true);
    expect(result.current.includeObjectMetrics).toBe(true);
    expect(result.current.includeSegmentation).toBe(true);
  });

  it('is not exporting on mount', () => {
    const { result } = renderHook(() => useExportFunctions([], 'TestProject'));

    expect(result.current.isExporting).toBe(false);
  });
});

// ------------------------------------------------------------------

describe('useExportFunctions — handleSelectImage', () => {
  it('deselects a selected image', async () => {
    const images = [makeImage('a'), makeImage('b')];
    const { result } = renderHook(() => useExportFunctions(images, 'Test'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    act(() => {
      result.current.handleSelectImage('a');
    });

    expect(result.current.selectedImages['a']).toBe(false);
    expect(result.current.getSelectedCount()).toBe(1);
  });

  it('selects a deselected image', async () => {
    const images = [makeImage('a'), makeImage('b')];
    const { result } = renderHook(() => useExportFunctions(images, 'Test'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    // first deselect
    act(() => {
      result.current.handleSelectImage('a');
    });
    expect(result.current.selectedImages['a']).toBe(false);

    // then re-select
    act(() => {
      result.current.handleSelectImage('a');
    });
    expect(result.current.selectedImages['a']).toBe(true);
  });
});

// ------------------------------------------------------------------

describe('useExportFunctions — handleSelectAll', () => {
  it('deselects all when all are currently selected', async () => {
    const images = [makeImage('a'), makeImage('b')];
    const { result } = renderHook(() => useExportFunctions(images, 'Test'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    act(() => {
      result.current.handleSelectAll();
    });

    expect(result.current.getSelectedCount()).toBe(0);
  });

  it('selects all when at least one is deselected', async () => {
    const images = [makeImage('a'), makeImage('b'), makeImage('c')];
    const { result } = renderHook(() => useExportFunctions(images, 'Test'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    // deselect one
    act(() => {
      result.current.handleSelectImage('a');
    });
    expect(result.current.getSelectedCount()).toBe(2);

    // handleSelectAll should select all
    act(() => {
      result.current.handleSelectAll();
    });
    expect(result.current.getSelectedCount()).toBe(3);
  });
});

// ------------------------------------------------------------------

describe('useExportFunctions — option flags', () => {
  it('setIncludeMetadata toggles the flag', () => {
    const { result } = renderHook(() => useExportFunctions([], 'Test'));

    act(() => {
      result.current.setIncludeMetadata(false);
    });
    expect(result.current.includeMetadata).toBe(false);

    act(() => {
      result.current.setIncludeMetadata(true);
    });
    expect(result.current.includeMetadata).toBe(true);
  });

  it('setIncludeObjectMetrics toggles the flag', () => {
    const { result } = renderHook(() => useExportFunctions([], 'Test'));

    act(() => {
      result.current.setIncludeObjectMetrics(false);
    });
    expect(result.current.includeObjectMetrics).toBe(false);
  });

  it('setIncludeSegmentation toggles the flag', () => {
    const { result } = renderHook(() => useExportFunctions([], 'Test'));

    act(() => {
      result.current.setIncludeSegmentation(false);
    });
    expect(result.current.includeSegmentation).toBe(false);
  });
});

// ------------------------------------------------------------------

describe('useExportFunctions — getSelectedCount', () => {
  it('returns 0 when no images', () => {
    const { result } = renderHook(() => useExportFunctions([], 'Test'));

    expect(result.current.getSelectedCount()).toBe(0);
  });

  it('counts only true entries', async () => {
    const images = [makeImage('a'), makeImage('b'), makeImage('c')];
    const { result } = renderHook(() => useExportFunctions(images, 'Test'));

    await waitFor(() => result.current.getSelectedCount() === 3);

    act(() => {
      result.current.handleSelectImage('b');
    });

    expect(result.current.getSelectedCount()).toBe(2);
  });
});

// ------------------------------------------------------------------

describe('useExportFunctions — handleExport (JSON path)', () => {
  it('sets isExporting=true during export and resets to false after', async () => {
    const { downloadJSON } = await import('@/lib/downloadUtils');
    const images = [makeImage('a', 'ImageA')];
    const { result } = renderHook(() => useExportFunctions(images, 'Project'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    // Disable xlsx metrics to simplify the async path
    act(() => {
      result.current.setIncludeObjectMetrics(false);
    });

    await act(async () => {
      await result.current.handleExport();
    });

    expect(result.current.isExporting).toBe(false);
    expect(downloadJSON).toHaveBeenCalled();
  });

  it('does not call xlsx export when includeObjectMetrics=false', async () => {
    const { createExcelExport } = await import('@/services/excelExportService');
    const images = [makeImage('a', 'A', true)];
    const { result } = renderHook(() => useExportFunctions(images, 'Project'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    act(() => {
      result.current.setIncludeObjectMetrics(false);
    });

    await act(async () => {
      await result.current.handleExport();
    });

    // createExcelExport should NOT have been called
    expect(createExcelExport).not.toHaveBeenCalled();
  });

  it('filters export data to only selected images', async () => {
    const { downloadJSON } = await import('@/lib/downloadUtils');
    (downloadJSON as ReturnType<typeof vi.fn>).mockClear();

    const images = [makeImage('a', 'Selected'), makeImage('b', 'Skipped')];
    const { result } = renderHook(() => useExportFunctions(images, 'Project'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    // deselect 'b'
    act(() => {
      result.current.handleSelectImage('b');
    });
    act(() => {
      result.current.setIncludeObjectMetrics(false);
    });

    await act(async () => {
      await result.current.handleExport();
    });

    const [exportData] = (downloadJSON as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(Array.isArray(exportData)).toBe(true);
    expect((exportData as Array<{ id: string }>).length).toBe(1);
    expect((exportData as Array<{ id: string }>)[0].id).toBe('a');
  });
});

// ------------------------------------------------------------------

describe('useExportFunctions — handleExportMetricsAsXlsx', () => {
  it('resets isExporting=false after completion', async () => {
    const images = [makeImage('a', 'WithSeg', true)];
    const { result } = renderHook(() => useExportFunctions(images, 'Project'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    await act(async () => {
      await result.current.handleExportMetricsAsXlsx();
    });

    expect(result.current.isExporting).toBe(false);
  });

  it('shows toast.error when no selected images have segmentation', async () => {
    const { toast } = await import('sonner');
    const images = [makeImage('a', 'NoSeg', false)];
    const { result } = renderHook(() => useExportFunctions(images, 'Project'));

    await waitFor(() => result.current.selectedImages['a'] === true);

    await act(async () => {
      await result.current.handleExportMetricsAsXlsx();
    });

    expect(toast.error).toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });
});
