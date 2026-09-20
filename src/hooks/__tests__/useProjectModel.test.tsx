import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectModel } from '@/hooks/useProjectModel';
import {
  DEFAULT_MODEL_BY_PROJECT_TYPE,
  MODEL_TYPE_COMPATIBILITY,
  resolveProjectModel,
  type ProjectTypeKey,
} from '@/lib/models/modelRegistry';
import type { ProjectType } from '@/types';

// Passthrough translator: these tests assert model IDENTITY and list
// membership, never copy, so returning the key is enough and keeps the
// assertions readable.
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const ALL_TYPES = Object.keys(
  DEFAULT_MODEL_BY_PROJECT_TYPE
) as ProjectTypeKey[];

describe('resolveProjectModel', () => {
  it.each(ALL_TYPES)('falls back to the %s default when unset', type => {
    expect(resolveProjectModel(type, null)).toBe(
      DEFAULT_MODEL_BY_PROJECT_TYPE[type]
    );
    expect(resolveProjectModel(type, undefined)).toBe(
      DEFAULT_MODEL_BY_PROJECT_TYPE[type]
    );
  });

  it('honours a stored model that is valid for the type', () => {
    // spheroid is the only type with a real choice, and mamba_unet is not its
    // default — so this cannot pass by coincidence.
    expect(resolveProjectModel('spheroid', 'mamba_unet')).toBe('mamba_unet');
    expect(DEFAULT_MODEL_BY_PROJECT_TYPE.spheroid).not.toBe('mamba_unet');
  });

  it('ignores a stored model stranded by a type change', () => {
    // A spheroid project switched to wound keeps 'segformer' in the column
    // until the next write. Returning it would produce a request the backend
    // rejects, so the type's default wins.
    expect(resolveProjectModel('wound', 'segformer')).toBe('wound');
  });

  it('ignores a stored model that no longer exists in the registry', () => {
    expect(resolveProjectModel('spheroid', 'resunet_advanced')).toBe(
      DEFAULT_MODEL_BY_PROJECT_TYPE.spheroid
    );
  });

  it('never returns a model incompatible with the type it was asked for', () => {
    // The property the removed "incompatible model" dialog used to guard at
    // runtime. Exhaustive over every (type, stored) pair, including garbage.
    const candidates = [
      null,
      undefined,
      '',
      'nonsense',
      ...Object.values(MODEL_TYPE_COMPATIBILITY).flat(),
    ];
    for (const type of ALL_TYPES) {
      for (const stored of candidates) {
        expect(MODEL_TYPE_COMPATIBILITY[type]).toContain(
          resolveProjectModel(type, stored)
        );
      }
    }
  });
});

describe('DEFAULT_MODEL_BY_PROJECT_TYPE', () => {
  it('covers every project type exactly once', () => {
    expect(Object.keys(DEFAULT_MODEL_BY_PROJECT_TYPE).sort()).toEqual(
      Object.keys(MODEL_TYPE_COMPATIBILITY).sort()
    );
  });

  it("picks spheroid's most accurate model, not its fastest", () => {
    // Pinned deliberately. The registry's own `performance` numbers make
    // unet_spherohq the fastest (0.181 s) and this must not drift to it;
    // segformer is chosen on 93 % IoU, the only published accuracy figure
    // among the five spheroid candidates.
    expect(DEFAULT_MODEL_BY_PROJECT_TYPE.spheroid).toBe('segformer');
  });

  it('is the forced choice wherever a type has a single model', () => {
    for (const type of ALL_TYPES) {
      const compatible = MODEL_TYPE_COMPATIBILITY[type];
      if (compatible.length === 1) {
        expect(DEFAULT_MODEL_BY_PROJECT_TYPE[type]).toBe(compatible[0]);
      }
    }
  });
});

describe('useProjectModel', () => {
  it('returns nothing while the project type is still loading', () => {
    const { result } = renderHook(() => useProjectModel(undefined, null));

    expect(result.current.model).toBeUndefined();
    expect(result.current.modelInfo).toBeUndefined();
    expect(result.current.threshold).toBeUndefined();
    expect(result.current.compatibleModels).toEqual([]);
  });

  it.each([
    ['spheroid', 5],
    ['spheroid_invasive', 1],
    ['wound', 1],
    ['sperm', 1],
    ['microtubules', 1],
    ['microcapsule', 1],
    ['neurite', 1],
  ])('offers only the %s models (%i of them)', (type, count) => {
    const { result } = renderHook(() =>
      useProjectModel(type as ProjectType, null)
    );

    expect(result.current.compatibleModels).toHaveLength(count);
    expect(result.current.compatibleModels.map(m => m.id)).toEqual(
      MODEL_TYPE_COMPATIBILITY[type as ProjectTypeKey]
    );
  });

  it('locks the picker exactly when there is one option', () => {
    expect(
      renderHook(() => useProjectModel('spheroid', null)).result.current
        .isLocked
    ).toBe(false);
    expect(
      renderHook(() => useProjectModel('wound', null)).result.current.isLocked
    ).toBe(true);
  });

  it("reports the RESOLVED model's threshold, not a shared one", () => {
    // The values differ by a factor of five between models, so a threshold
    // borrowed from another model is a silently wrong ML request.
    expect(
      renderHook(() => useProjectModel('microtubules', null)).result.current
        .threshold
    ).toBe(0.98);
    expect(
      renderHook(() => useProjectModel('spheroid_invasive', null)).result
        .current.threshold
    ).toBe(0.2);
    expect(
      renderHook(() => useProjectModel('spheroid', null)).result.current
        .threshold
    ).toBe(0.5);
  });
});
