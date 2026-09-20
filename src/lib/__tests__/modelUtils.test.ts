import { describe, it, expect } from 'vitest';
import {
  BASIC_MODEL_INFO,
  getLocalizedModelInfo,
  type ModelType,
} from '../modelUtils';

// The SPHEROID_PRESETS / getSpheroidPreset / SPHEROID_PRESET_META suites that
// used to head this file were deleted with the constants themselves: their
// only consumer was the Settings → Models section, which is gone now that the
// model is chosen per project. Same for getAllLocalizedModels, whose only
// caller was the deleted useLocalizedModels hook.

// ---------------------------------------------------------------------------
// BASIC_MODEL_INFO
// ---------------------------------------------------------------------------

describe('BASIC_MODEL_INFO', () => {
  const allModelIds: ModelType[] = [
    'hrnet',
    'cbam_resunet',
    'unet_spherohq',
    'spheroid_disintegration',
    'segformer',
    'mamba_unet',
    'sperm',
    'wound',
    'microtubule',
    'microcapsule',
    'neurite_soma',
  ];

  it('contains all 11 model ids', () => {
    for (const id of allModelIds) {
      expect(BASIC_MODEL_INFO[id]).toBeDefined();
      expect(BASIC_MODEL_INFO[id].id).toBe(id);
    }
  });

  it('every entry has a non-empty name and displayName', () => {
    for (const id of allModelIds) {
      expect(BASIC_MODEL_INFO[id].name.length).toBeGreaterThan(0);
      expect(BASIC_MODEL_INFO[id].displayName.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty description', () => {
    for (const id of allModelIds) {
      expect(BASIC_MODEL_INFO[id].description.length).toBeGreaterThan(0);
    }
  });

  it('defaultThreshold is in (0, 1]', () => {
    for (const id of allModelIds) {
      const t = BASIC_MODEL_INFO[id].defaultThreshold;
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('size is one of small | medium | large', () => {
    const valid = new Set(['small', 'medium', 'large']);
    for (const id of allModelIds) {
      expect(valid.has(BASIC_MODEL_INFO[id].size)).toBe(true);
    }
  });

  describe('category assignments', () => {
    it('spheroid models have category spheroid', () => {
      const spheroidIds: ModelType[] = [
        'hrnet',
        'cbam_resunet',
        'unet_spherohq',
        'spheroid_disintegration',
        'segformer',
        'mamba_unet',
      ];
      for (const id of spheroidIds) {
        expect(BASIC_MODEL_INFO[id].category).toBe('spheroid');
      }
    });

    it('sperm model has category sperm', () => {
      expect(BASIC_MODEL_INFO.sperm.category).toBe('sperm');
    });

    it('wound model has category wound', () => {
      expect(BASIC_MODEL_INFO.wound.category).toBe('wound');
    });

    it('microtubule model has category microtubule', () => {
      expect(BASIC_MODEL_INFO.microtubule.category).toBe('microtubule');
    });
  });

  describe('performance data', () => {
    it('every model has performance metrics', () => {
      for (const id of allModelIds) {
        const p = BASIC_MODEL_INFO[id].performance;
        expect(p).toBeDefined();
      }
    });

    it('avgTimePerImage > 0 for all models', () => {
      for (const id of allModelIds) {
        expect(
          BASIC_MODEL_INFO[id].performance!.avgTimePerImage
        ).toBeGreaterThan(0);
      }
    });

    it('throughput > 0 for all models', () => {
      for (const id of allModelIds) {
        expect(BASIC_MODEL_INFO[id].performance!.throughput).toBeGreaterThan(0);
      }
    });

    it('spheroid_disintegration has lower threshold (0.2) for dissolved spheroids', () => {
      expect(BASIC_MODEL_INFO.spheroid_disintegration.defaultThreshold).toBe(
        0.2
      );
    });

    it('neurite_soma has the slowest avgTimePerImage', () => {
      // 3-fold ensemble x 4-way mirroring TTA over a sliding window — the
      // heaviest inference in the platform, ahead of microtubule.
      const times = allModelIds.map(
        id => BASIC_MODEL_INFO[id].performance!.avgTimePerImage
      );
      const maxTime = Math.max(...times);
      expect(BASIC_MODEL_INFO.neurite_soma.performance!.avgTimePerImage).toBe(
        maxTime
      );
      expect(
        BASIC_MODEL_INFO.microtubule.performance!.avgTimePerImage
      ).toBeLessThan(maxTime);
    });

    it('wound has the fastest throughput (scratch assay is cheap)', () => {
      const throughputs = allModelIds.map(
        id => BASIC_MODEL_INFO[id].performance!.throughput
      );
      const maxThroughput = Math.max(...throughputs);
      expect(BASIC_MODEL_INFO.wound.performance!.throughput).toBe(
        maxThroughput
      );
    });

    it('mamba_unet is large size', () => {
      expect(BASIC_MODEL_INFO.mamba_unet.size).toBe('large');
    });

    it('microtubule is large size', () => {
      expect(BASIC_MODEL_INFO.microtubule.size).toBe('large');
    });
  });
});

// ---------------------------------------------------------------------------
// getLocalizedModelInfo — uses a passthrough t() so we can assert key routing
// ---------------------------------------------------------------------------

describe('getLocalizedModelInfo', () => {
  // Passthrough t: returns the key itself so we can verify key construction
  const passthroughT = (key: string) => key;

  it('returns the correct id', () => {
    const info = getLocalizedModelInfo('hrnet', passthroughT);
    expect(info.id).toBe('hrnet');
  });

  it('uses key settings.modelSelection.models.hrnet.name for hrnet', () => {
    const info = getLocalizedModelInfo('hrnet', passthroughT);
    expect(info.name).toBe('settings.modelSelection.models.hrnet.name');
  });

  it('uses key settings.modelSelection.models.cbam.name for cbam_resunet', () => {
    // cbam_resunet maps to key segment "cbam"
    const info = getLocalizedModelInfo('cbam_resunet', passthroughT);
    expect(info.name).toBe('settings.modelSelection.models.cbam.name');
  });

  it('uses key settings.modelSelection.models.mamba_unet.name for mamba_unet', () => {
    const info = getLocalizedModelInfo('mamba_unet', passthroughT);
    expect(info.name).toBe('settings.modelSelection.models.mamba_unet.name');
  });

  it('name equals displayName (both use the same translation key)', () => {
    const info = getLocalizedModelInfo('segformer', passthroughT);
    expect(info.name).toBe(info.displayName);
  });

  it('preserves non-localized fields from base model', () => {
    const info = getLocalizedModelInfo('hrnet', passthroughT);
    expect(info.size).toBe('small');
    expect(info.defaultThreshold).toBe(0.5);
    expect(info.category).toBe('spheroid');
  });

  it('returns actual translated strings with a real t function', () => {
    const fakeT = (key: string) =>
      key === 'settings.modelSelection.models.hrnet.name' ? 'HRNet Real' : key;
    const info = getLocalizedModelInfo('hrnet', fakeT);
    expect(info.name).toBe('HRNet Real');
  });
});
