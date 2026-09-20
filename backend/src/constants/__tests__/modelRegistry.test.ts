import { describe, it, expect } from 'vitest';
import {
  MODEL_REGISTRY,
  SEGMENTATION_MODELS,
  MODEL_TYPE_COMPATIBILITY,
  DEFAULT_MODEL_BY_PROJECT_TYPE,
  resolveProjectModel,
  type ProjectTypeKey,
} from '../modelRegistry';

const CANONICAL_IDS = [
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
] as const;

describe('backend model registry SSOT', () => {
  it('registry keys are exactly the canonical 11 models', () => {
    expect(Object.keys(MODEL_REGISTRY).sort()).toEqual(
      [...CANONICAL_IDS].sort()
    );
  });

  it('SEGMENTATION_MODELS derives from the registry and drops deleted models', () => {
    expect([...SEGMENTATION_MODELS].sort()).toEqual([...CANONICAL_IDS].sort());
    expect(SEGMENTATION_MODELS).not.toContain('resunet_advanced');
    expect(SEGMENTATION_MODELS).not.toContain('resunet_small');
  });

  it('MODEL_TYPE_COMPATIBILITY reproduces the verified matrix exactly (incl. order)', () => {
    expect(MODEL_TYPE_COMPATIBILITY).toEqual({
      spheroid: [
        'hrnet',
        'cbam_resunet',
        'unet_spherohq',
        'segformer',
        'mamba_unet',
      ],
      spheroid_invasive: ['spheroid_disintegration'],
      wound: ['wound'],
      sperm: ['sperm'],
      microtubules: ['microtubule'],
      microcapsule: ['microcapsule'],
      neurite: ['neurite_soma'],
    });
  });
});

// ─── resolveProjectModel ─────────────────────────────────────────────────────

describe('resolveProjectModel', () => {
  it('falls back to the type default when nothing is stored', () => {
    for (const [type, expected] of Object.entries(
      DEFAULT_MODEL_BY_PROJECT_TYPE
    )) {
      expect(resolveProjectModel(type as ProjectTypeKey, null)).toBe(expected);
      expect(resolveProjectModel(type as ProjectTypeKey, undefined)).toBe(
        expected
      );
    }
  });

  it('honours a stored model valid for the type', () => {
    expect(resolveProjectModel('spheroid', 'mamba_unet')).toBe('mamba_unet');
  });

  it('ignores a stored model the type cannot run', () => {
    expect(resolveProjectModel('wound', 'segformer')).toBe('wound');
    expect(resolveProjectModel('spheroid', 'resunet_advanced')).toBe(
      DEFAULT_MODEL_BY_PROJECT_TYPE.spheroid
    );
  });

  it('is TOTAL over a raw projects.type value', () => {
    // `queueController.addBatchToQueue` passes `project.type` straight from
    // the column, which is a plain String. An unrecognised legacy value must
    // yield a default rather than indexing `undefined` and throwing on
    // `.includes` — a 500 on a batch submit instead of a segmentation.
    // NOT covered by `getProjectModel`'s own tests: that caller coerces first,
    // so it never reaches this branch.
    expect(() =>
      resolveProjectModel('some_retired_type', null)
    ).not.toThrow();
    expect(resolveProjectModel('some_retired_type', null)).toBe(
      DEFAULT_MODEL_BY_PROJECT_TYPE.spheroid
    );
    expect(resolveProjectModel('', 'hrnet')).toBe('hrnet');
    expect(() => resolveProjectModel('nope', 'nonsense')).not.toThrow();
  });

  it('never returns a model incompatible with the type asked for', () => {
    const candidates = [null, undefined, '', 'nonsense', 'hrnet', 'wound'];
    for (const type of Object.keys(
      DEFAULT_MODEL_BY_PROJECT_TYPE
    ) as ProjectTypeKey[]) {
      for (const stored of candidates) {
        expect(MODEL_TYPE_COMPATIBILITY[type]).toContain(
          resolveProjectModel(type, stored)
        );
      }
    }
  });
});
