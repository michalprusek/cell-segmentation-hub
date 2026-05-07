import { describe, it, expect } from 'vitest';
import { generateMetricsGuide } from '../exportDocs';
import type { ExportOptions } from '../../exportService';

const baseOptions: ExportOptions = {
  includeOriginalImages: false,
  includeVisualizations: false,
  includeDocumentation: true,
  annotationFormats: [],
  metricsFormats: ['excel'],
};

const scaledOptions: ExportOptions = {
  ...baseOptions,
  pixelToMicrometerScale: 0.5,
};

describe('generateMetricsGuide — type-specific dispatch', () => {
  describe('spheroid (default)', () => {
    const guide = generateMetricsGuide('spheroid', baseOptions);

    it('emits the full polygon metrics catalogue', () => {
      expect(guide).toContain('# Polygon Metrics Reference Guide');
      expect(guide).toContain('### Area');
      expect(guide).toContain('### Perimeter');
      expect(guide).toContain('### Circularity');
      expect(guide).toContain('### Solidity');
      expect(guide).toContain('### Feret Diameters');
    });

    it('excludes disintegration / sperm / wound-time-series sections', () => {
      expect(guide).not.toContain('Disintegration Index');
      expect(guide).not.toContain('Head Length');
      expect(guide).not.toContain('Time-Series Analysis');
      expect(guide).not.toContain('partClass');
    });

    it('reports pixel units when scale is not configured', () => {
      expect(guide).toContain('All measurements are in pixel units');
      expect(guide).not.toContain('## Scale Conversion');
    });

    it('reports micrometer units when scale is configured', () => {
      const scaled = generateMetricsGuide('spheroid', scaledOptions);
      expect(scaled).toContain('## Scale Conversion');
      expect(scaled).toContain('0.5 um/pixel');
    });
  });

  describe('spheroid_invasive', () => {
    const guide = generateMetricsGuide('spheroid_invasive', baseOptions);

    it('emits only the disintegration analysis sections', () => {
      expect(guide).toContain('# Disintegration Analysis Metrics Guide');
      expect(guide).toContain('Total Spheroid Area');
      expect(guide).toContain('Core Area');
      expect(guide).toContain('Invasion Area');
      expect(guide).toContain('Disintegration Index');
      expect(guide).toContain('## Pipeline Overview');
      expect(guide).toContain('## Core Detection');
    });

    it('excludes per-polygon catalogue sections', () => {
      expect(guide).not.toContain('### Circularity');
      expect(guide).not.toContain('### Solidity');
      expect(guide).not.toContain('### Feret Diameters');
      expect(guide).not.toContain('### Compactness');
      expect(guide).not.toContain('# Polygon Metrics Reference Guide');
    });

    it('excludes sperm and wound-specific sections', () => {
      expect(guide).not.toContain('Head Length');
      expect(guide).not.toContain('Midpiece Length');
      expect(guide).not.toContain('Time-Series Analysis');
    });
  });

  describe('wound', () => {
    const guide = generateMetricsGuide('wound', baseOptions);

    it('emits the Area metric only and the time-series section', () => {
      expect(guide).toContain('# Wound Healing Metrics Reference Guide');
      expect(guide).toContain('## Area');
      expect(guide).toContain('## Time-Series Analysis');
      expect(guide).toContain('Time-Point Detection');
      expect(guide).toContain('Wound Area Series');
    });

    it('excludes other polygon metrics that are irrelevant for wound healing', () => {
      expect(guide).not.toContain('### Circularity');
      expect(guide).not.toContain('### Solidity');
      expect(guide).not.toContain('### Feret Diameters');
      expect(guide).not.toContain('### Compactness');
      expect(guide).not.toContain('### Equivalent Diameter');
    });

    it('excludes sperm / disintegration sections', () => {
      expect(guide).not.toContain('Head Length');
      expect(guide).not.toContain('Disintegration Index');
      expect(guide).not.toContain('Core Area');
    });
  });

  describe('sperm', () => {
    const guide = generateMetricsGuide('sperm', baseOptions);

    it('emits the head/midpiece/tail morphology sections', () => {
      expect(guide).toContain('# Sperm Morphology Metrics Reference Guide');
      expect(guide).toContain('### Head Length');
      expect(guide).toContain('### Midpiece Length');
      expect(guide).toContain('### Tail Length');
      expect(guide).toContain('### Total Length');
      expect(guide).toContain('## Polyline Geometry');
      expect(guide).toContain('## Instance Grouping');
      expect(guide).toContain('partClass');
      expect(guide).toContain('instanceId');
    });

    it('excludes polygon catalogue sections', () => {
      expect(guide).not.toContain('### Area');
      expect(guide).not.toContain('### Perimeter');
      expect(guide).not.toContain('### Circularity');
      expect(guide).not.toContain('### Solidity');
      expect(guide).not.toContain('### Feret Diameters');
    });

    it('excludes disintegration and wound-specific sections', () => {
      expect(guide).not.toContain('Disintegration Index');
      expect(guide).not.toContain('Total Spheroid Area');
      expect(guide).not.toContain('Time-Series Analysis');
    });

    it('reports micrometer units when scale is configured', () => {
      const scaled = generateMetricsGuide('sperm', scaledOptions);
      expect(scaled).toContain('## Scale Conversion');
      expect(scaled).toContain('0.5 um/pixel');
      // Each length metric carries an explicit Units bullet.
      expect(scaled).toMatch(/### Head Length[\s\S]+?\*\*Units\*\*: um/);
    });
  });

  describe('unknown / undefined project type', () => {
    it('falls through to spheroid when given an unexpected value', () => {
      const guide = generateMetricsGuide(
        'definitely-not-a-real-type' as 'spheroid',
        baseOptions
      );
      expect(guide).toContain('# Polygon Metrics Reference Guide');
      expect(guide).toContain('### Circularity');
    });
  });
});
