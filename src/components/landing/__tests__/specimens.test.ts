/**
 * `specimens.ts` is generated, and the two things it copies out of other
 * modules are exactly the two that can rot silently: the model's display name
 * and the project type it belongs to. Both are pinned here against their
 * single sources of truth, so a rename in the registry turns this red instead
 * of leaving the landing page quoting a name the product no longer uses.
 */
import { describe, it, expect } from 'vitest';
import { SPECIMENS, SPECIMEN_IDS } from '../specimens';
import { MODEL_REGISTRY } from '@/lib/models/modelRegistry';
import { PROJECT_TYPES } from '@/types';
import en from '@/translations/en';

describe('landing specimens', () => {
  it('quotes each model by the name in MODEL_REGISTRY', () => {
    for (const specimen of SPECIMENS) {
      expect(MODEL_REGISTRY[specimen.modelId].name).toBe(specimen.model);
    }
  });

  it('pairs each specimen with a project type the model can actually run on', () => {
    for (const specimen of SPECIMENS) {
      expect(PROJECT_TYPES).toContain(specimen.projectType);
      expect(
        MODEL_REGISTRY[specimen.modelId]
          .compatibleProjectTypes as readonly string[]
      ).toContain(specimen.projectType);
    }
  });

  it('has a label, a detail line and alt text for every tile', () => {
    for (const id of SPECIMEN_IDS) {
      const copy = en.landing.specimens[id];
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.detail.length).toBeGreaterThan(0);
      // Alt text is the only description a screen reader gets of a scientific
      // image, so a stub is worse than useless.
      expect(copy.alt.length).toBeGreaterThan(40);
    }
  });

  it('carries only outlines that fall inside the tile', () => {
    for (const specimen of SPECIMENS) {
      expect(specimen.outlines.length).toBeGreaterThan(0);
      for (const outline of specimen.outlines) {
        const numbers = outline.d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
        const xs = numbers.filter((_, i) => i % 2 === 0);
        const ys = numbers.filter((_, i) => i % 2 === 1);
        // Bounding box must overlap the 1000x1000 viewBox, otherwise the path
        // ships bytes and takes a draw-on slot while rendering nothing.
        expect(Math.max(...xs)).toBeGreaterThanOrEqual(0);
        expect(Math.min(...xs)).toBeLessThanOrEqual(1000);
        expect(Math.max(...ys)).toBeGreaterThanOrEqual(0);
        expect(Math.min(...ys)).toBeLessThanOrEqual(1000);
      }
    }
  });

  it('uses the stroke colours the segmentation editor draws', () => {
    const EDITOR_COLOURS = new Set([
      '#ef4444', // external contour
      '#0ea5e9', // internal contour
      '#22c55e', // spheroid core / sperm head
      '#f59e0b', // sperm midpiece
      '#06b6d4', // sperm tail
      '#969696', // border-cut microcapsule, excluded from metrics
    ]);
    for (const specimen of SPECIMENS) {
      for (const outline of specimen.outlines) {
        const isTrackHue = /^hsl\(\d{1,3}, 70%, 55%\)$/.test(outline.stroke);
        expect(isTrackHue || EDITOR_COLOURS.has(outline.stroke)).toBe(true);
      }
    }
  });
});
