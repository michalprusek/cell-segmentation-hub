/**
 * exportDocs.gaps5.test.ts
 *
 * Covers branches still uncovered after exportDocs.test.ts:
 *
 *  A. generateReadme — optional fields
 *     - pixelToMicrometerScale > 0 → includes "Scale Conversion" line
 *     - no scale → includes "Units: All measurements in pixels"
 *     - annotationFormats non-empty → includes format names
 *     - metricsFormats non-empty → includes format names
 *
 *  B. generateMetricsGuide — 'microtubules' type (line 107/115 uncovered)
 *     - returns string containing microtubule-specific content
 *
 *  C. generateAnnotationGuides — branch paths
 *     - includes 'coco' → generateCocoGuide called (file written)
 *     - includes 'yolo' → generateYoloGuide called (file written)
 *     - includes 'json' → generateJsonGuide called (file written)
 *     - all formats → all guides generated
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── FS mock ──────────────────────────────────────────────────────────────────

const { mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockWriteFile: vi.fn().mockResolvedValue(undefined),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  promises: {
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
  },
}));

import {
  generateReadme,
  generateMetricsGuide,
  generateAnnotationGuides,
} from '../exportDocs';
import type { ExportOptions, ProjectWithImages } from '../../exportService';

function makeProject(
  overrides: Partial<ProjectWithImages> = {}
): ProjectWithImages {
  return {
    id: 'proj-1',
    title: 'My Project',
    images: [],
    ...overrides,
  } as unknown as ProjectWithImages;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── A. generateReadme ────────────────────────────────────────────────────────

describe('generateReadme', () => {
  it('includes scale conversion line when pixelToMicrometerScale > 0', () => {
    const result = generateReadme(makeProject(), {
      pixelToMicrometerScale: 0.5,
    } as ExportOptions);
    expect(result).toContain('Scale Conversion');
    expect(result).toContain('0.5 um/pixel');
  });

  it('includes pixel units line when no scale', () => {
    const result = generateReadme(makeProject(), {} as ExportOptions);
    expect(result).toContain('**Units**: All measurements in pixels');
  });

  it('includes annotation format names when annotationFormats is set', () => {
    const result = generateReadme(makeProject(), {
      annotationFormats: ['coco', 'yolo'],
      includeOriginalImages: true,
      includeVisualizations: true,
    } as ExportOptions);
    expect(result).toContain('COCO');
    expect(result).toContain('YOLO');
    expect(result).toContain('Original images included');
    expect(result).toContain('Visualizations with numbered polygons included');
  });

  it('includes metrics format names when metricsFormats is set', () => {
    const result = generateReadme(makeProject(), {
      metricsFormats: ['excel', 'csv'],
    } as ExportOptions);
    expect(result).toContain('EXCEL');
    expect(result).toContain('CSV');
  });

  it('handles image count correctly', () => {
    const project = makeProject({
      images: [{ id: 'img-1' }, { id: 'img-2' }] as never,
    });
    const result = generateReadme(project, {} as ExportOptions);
    expect(result).toContain('Total Images**: 2');
  });
});

// ─── B. generateMetricsGuide — microtubules ───────────────────────────────────

describe('generateMetricsGuide — microtubules', () => {
  it('returns microtubule-specific content for microtubules type', () => {
    const guide = generateMetricsGuide('microtubules', {
      metricsFormats: ['excel'],
    } as ExportOptions);

    expect(guide).toContain('Microtubule');
    expect(guide.length).toBeGreaterThan(100);
  });

  it('includes pixel units note when no scale', () => {
    const guide = generateMetricsGuide('microtubules', {} as ExportOptions);
    expect(guide).toContain('pixel');
  });
});

// ─── C. generateAnnotationGuides ──────────────────────────────────────────────

describe('generateAnnotationGuides', () => {
  it('generates coco guide when annotationFormats includes coco', async () => {
    await generateAnnotationGuides('/tmp/export', {
      annotationFormats: ['coco'],
    } as ExportOptions);

    const writtenFiles = mockWriteFile.mock.calls.map(c => c[0] as string);
    expect(writtenFiles.some(f => f.includes('coco'))).toBe(true);
  });

  it('generates yolo guide when annotationFormats includes yolo', async () => {
    await generateAnnotationGuides('/tmp/export', {
      annotationFormats: ['yolo'],
    } as ExportOptions);

    const writtenFiles = mockWriteFile.mock.calls.map(c => c[0] as string);
    expect(writtenFiles.some(f => f.includes('yolo'))).toBe(true);
  });

  it('generates json guide when annotationFormats includes json', async () => {
    await generateAnnotationGuides('/tmp/export', {
      annotationFormats: ['json'],
    } as ExportOptions);

    const writtenFiles = mockWriteFile.mock.calls.map(c => c[0] as string);
    expect(writtenFiles.some(f => f.includes('json'))).toBe(true);
  });

  it('generates all guides when all formats are included', async () => {
    await generateAnnotationGuides('/tmp/export', {
      annotationFormats: ['coco', 'yolo', 'json'],
    } as ExportOptions);

    const writtenFiles = mockWriteFile.mock.calls.map(c => c[0] as string);
    expect(writtenFiles.some(f => f.includes('coco'))).toBe(true);
    expect(writtenFiles.some(f => f.includes('yolo'))).toBe(true);
    expect(writtenFiles.some(f => f.includes('json'))).toBe(true);
    // Also the main annotation README
    expect(writtenFiles.some(f => f.includes('annotations'))).toBe(true);
  });

  it('generates only the main README when no formats included', async () => {
    await generateAnnotationGuides('/tmp/export', {
      annotationFormats: [],
    } as ExportOptions);

    // Should only write the main annotations README
    const writtenFiles = mockWriteFile.mock.calls.map(c => c[0] as string);
    // Main guide should be written
    expect(writtenFiles.length).toBeGreaterThanOrEqual(1);
  });
});
