import { describe, it, expect } from 'vitest';
import {
  SPHEROID_PRESETS,
  getSpheroidPreset,
  SPHEROID_PRESET_META,
  BASIC_MODEL_INFO,
  getLocalizedModelInfo,
  getAllLocalizedModels,
  type ModelType,
  type SpheroidPresetTier,
} from '../modelUtils';

// ---------------------------------------------------------------------------
// SPHEROID_PRESETS constant
// ---------------------------------------------------------------------------

describe('SPHEROID_PRESETS', () => {
  it('maps segformer → fast', () => {
    expect(SPHEROID_PRESETS.segformer).toBe('fast');
  });

  it('maps cbam_resunet → accurate', () => {
    expect(SPHEROID_PRESETS.cbam_resunet).toBe('accurate');
  });

  it('maps mamba_unet → robust', () => {
    expect(SPHEROID_PRESETS.mamba_unet).toBe('robust');
  });

  it('maps hrnet → additional', () => {
    expect(SPHEROID_PRESETS.hrnet).toBe('additional');
  });

  it('maps unet_spherohq → additional', () => {
    expect(SPHEROID_PRESETS.unet_spherohq).toBe('additional');
  });
});

// ---------------------------------------------------------------------------
// getSpheroidPreset
// ---------------------------------------------------------------------------

describe('getSpheroidPreset', () => {
  const cases: Array<[ModelType, SpheroidPresetTier]> = [
    ['segformer', 'fast'],
    ['cbam_resunet', 'accurate'],
    ['mamba_unet', 'robust'],
    ['hrnet', 'additional'],
    ['unet_spherohq', 'additional'],
  ];

  for (const [id, tier] of cases) {
    it(`returns '${tier}' for '${id}'`, () => {
      expect(getSpheroidPreset(id)).toBe(tier);
    });
  }

  // Non-spheroid models fall back to 'additional'
  const nonSpheroidModels: ModelType[] = [
    'sperm',
    'wound',
    'microtubule',
    'microcapsule',
    'unet_attention_aspp',
  ];
  for (const id of nonSpheroidModels) {
    it(`falls back to 'additional' for non-preset model '${id}'`, () => {
      expect(getSpheroidPreset(id)).toBe('additional');
    });
  }
});

// ---------------------------------------------------------------------------
// SPHEROID_PRESET_META icons
// ---------------------------------------------------------------------------

describe('SPHEROID_PRESET_META', () => {
  it('fast tier has an icon string', () => {
    expect(typeof SPHEROID_PRESET_META.fast.icon).toBe('string');
    expect(SPHEROID_PRESET_META.fast.icon.length).toBeGreaterThan(0);
  });

  it('accurate tier has an icon string', () => {
    expect(typeof SPHEROID_PRESET_META.accurate.icon).toBe('string');
    expect(SPHEROID_PRESET_META.accurate.icon.length).toBeGreaterThan(0);
  });

  it('robust tier has an icon string', () => {
    expect(typeof SPHEROID_PRESET_META.robust.icon).toBe('string');
    expect(SPHEROID_PRESET_META.robust.icon.length).toBeGreaterThan(0);
  });

  it('all three tiers have distinct icons', () => {
    const icons = [
      SPHEROID_PRESET_META.fast.icon,
      SPHEROID_PRESET_META.accurate.icon,
      SPHEROID_PRESET_META.robust.icon,
    ];
    expect(new Set(icons).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// BASIC_MODEL_INFO
// ---------------------------------------------------------------------------

describe('BASIC_MODEL_INFO', () => {
  const allModelIds: ModelType[] = [
    'hrnet',
    'cbam_resunet',
    'unet_spherohq',
    'unet_attention_aspp',
    'segformer',
    'mamba_unet',
    'sperm',
    'wound',
    'microtubule',
    'microcapsule',
  ];

  it('contains all 10 model ids', () => {
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
        'unet_attention_aspp',
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

    it('unet_attention_aspp has lower threshold (0.2) for dissolved spheroids', () => {
      expect(BASIC_MODEL_INFO.unet_attention_aspp.defaultThreshold).toBe(0.2);
    });

    it('microtubule has the slowest avgTimePerImage', () => {
      const times = allModelIds.map(
        id => BASIC_MODEL_INFO[id].performance!.avgTimePerImage
      );
      const maxTime = Math.max(...times);
      expect(BASIC_MODEL_INFO.microtubule.performance!.avgTimePerImage).toBe(
        maxTime
      );
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

// ---------------------------------------------------------------------------
// getAllLocalizedModels
// ---------------------------------------------------------------------------

describe('getAllLocalizedModels', () => {
  const passthroughT = (key: string) => key;

  it('returns 10 models', () => {
    expect(getAllLocalizedModels(passthroughT)).toHaveLength(10);
  });

  it('contains all model ids exactly once', () => {
    const ids = getAllLocalizedModels(passthroughT).map(m => m.id);
    const expectedIds: ModelType[] = [
      'hrnet',
      'cbam_resunet',
      'unet_spherohq',
      'unet_attention_aspp',
      'segformer',
      'mamba_unet',
      'sperm',
      'wound',
      'microtubule',
      'microcapsule',
    ];
    for (const id of expectedIds) {
      expect(ids).toContain(id);
    }
    // No duplicates
    expect(new Set(ids).size).toBe(10);
  });

  it('preserves order: hrnet first, microcapsule last', () => {
    const models = getAllLocalizedModels(passthroughT);
    expect(models[0].id).toBe('hrnet');
    expect(models[models.length - 1].id).toBe('microcapsule');
  });
});
