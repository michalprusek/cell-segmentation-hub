import { describe, it, expect } from 'vitest';
import { EXPORT_DEFAULTS, type ExportFormat, type MetricsFormat } from '@/lib/export-config';

describe('export-config', () => {
  describe('EXPORT_DEFAULTS.COLORS', () => {
    it('external polygon color is red (#FF0000)', () => {
      expect(EXPORT_DEFAULTS.COLORS.EXTERNAL_POLYGON).toBe('#FF0000');
    });

    it('internal polygon color is blue (#0000FF)', () => {
      expect(EXPORT_DEFAULTS.COLORS.INTERNAL_POLYGON).toBe('#0000FF');
    });

    it('colors are distinct from each other', () => {
      expect(EXPORT_DEFAULTS.COLORS.EXTERNAL_POLYGON).not.toBe(
        EXPORT_DEFAULTS.COLORS.INTERNAL_POLYGON
      );
    });
  });

  describe('EXPORT_DEFAULTS.VISUALIZATION', () => {
    it('stroke width is a positive number', () => {
      expect(EXPORT_DEFAULTS.VISUALIZATION.STROKE_WIDTH).toBeGreaterThan(0);
      expect(EXPORT_DEFAULTS.VISUALIZATION.STROKE_WIDTH).toBe(2);
    });

    it('font size is a positive number', () => {
      expect(EXPORT_DEFAULTS.VISUALIZATION.FONT_SIZE).toBeGreaterThan(0);
      expect(EXPORT_DEFAULTS.VISUALIZATION.FONT_SIZE).toBe(32);
    });

    it('transparency is between 0 and 1 (exclusive)', () => {
      expect(EXPORT_DEFAULTS.VISUALIZATION.TRANSPARENCY).toBeGreaterThan(0);
      expect(EXPORT_DEFAULTS.VISUALIZATION.TRANSPARENCY).toBeLessThan(1);
      expect(EXPORT_DEFAULTS.VISUALIZATION.TRANSPARENCY).toBe(0.3);
    });

    it('show numbers defaults to true', () => {
      expect(EXPORT_DEFAULTS.VISUALIZATION.SHOW_NUMBERS).toBe(true);
    });
  });

  describe('EXPORT_DEFAULTS.FORMATS', () => {
    it('annotation formats contain coco and json', () => {
      expect(EXPORT_DEFAULTS.FORMATS.ANNOTATION).toContain('coco');
      expect(EXPORT_DEFAULTS.FORMATS.ANNOTATION).toContain('json');
    });

    it('metrics formats contain excel', () => {
      expect(EXPORT_DEFAULTS.FORMATS.METRICS).toContain('excel');
    });

    it('annotation formats array has at least 2 entries', () => {
      expect(EXPORT_DEFAULTS.FORMATS.ANNOTATION.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('EXPORT_DEFAULTS.OPTIONS', () => {
    it('includes original images by default', () => {
      expect(EXPORT_DEFAULTS.OPTIONS.INCLUDE_ORIGINAL_IMAGES).toBe(true);
    });

    it('includes visualizations by default', () => {
      expect(EXPORT_DEFAULTS.OPTIONS.INCLUDE_VISUALIZATIONS).toBe(true);
    });

    it('includes documentation by default', () => {
      expect(EXPORT_DEFAULTS.OPTIONS.INCLUDE_DOCUMENTATION).toBe(true);
    });
  });

  describe('ExportFormat type values', () => {
    it('valid ExportFormat values are assignable', () => {
      const coco: ExportFormat = 'coco';
      const yolo: ExportFormat = 'yolo';
      const json: ExportFormat = 'json';

      expect(['coco', 'yolo', 'json']).toContain(coco);
      expect(['coco', 'yolo', 'json']).toContain(yolo);
      expect(['coco', 'yolo', 'json']).toContain(json);
    });
  });

  describe('MetricsFormat type values', () => {
    it('valid MetricsFormat values are assignable', () => {
      const excel: MetricsFormat = 'excel';
      const csv: MetricsFormat = 'csv';
      const json: MetricsFormat = 'json';

      expect(['excel', 'csv', 'json']).toContain(excel);
      expect(['excel', 'csv', 'json']).toContain(csv);
      expect(['excel', 'csv', 'json']).toContain(json);
    });
  });
});
