/**
 * Single source of truth for backend model facts.
 *
 * To add or remove a segmentation model on the backend, edit ONLY this
 * registry — `SEGMENTATION_MODELS`, `KnownModelId`, `MODEL_TYPE_COMPATIBILITY`,
 * `BATCH_LIMITS` and `SERIAL_DISPATCH_MODELS` are all derived from it, so they
 * can never drift apart again. (Previously these lived in 4 separate files and
 * had already drifted: the whitelist carried two deleted models.)
 *
 * Cross-language parity (Python ML registry, frontend registry) is enforced by
 * `scripts/check-model-parity.cjs` and `scripts/verify-shared-types.cjs`.
 */

/** Project-type keys exactly as used by the segmentation compatibility map.
 *  NOTE: the microtubule project-type key is the plural `microtubules` while
 *  the model id is the singular `microtubule` — preserved from legacy data. */
export type ProjectTypeKey =
  | 'spheroid'
  | 'spheroid_invasive'
  | 'wound'
  | 'sperm'
  | 'microtubules';

interface BackendModelSpec {
  /** Project types whose picker offers (and whose worker accepts) this model. */
  readonly compatibleProjectTypes: readonly ProjectTypeKey[];
  /** Max images per ML batch request for this model. */
  readonly batchLimit: number;
  /** `serial` = dispatched one-at-a-time (heavy pipelines, e.g. microtubule v7). */
  readonly dispatch: 'serial' | 'parallel';
}

/**
 * The canonical model set. Declaration order is load-bearing: the derived
 * `MODEL_TYPE_COMPATIBILITY` preserves it, and tests assert the exact arrays.
 */
export const MODEL_REGISTRY = {
  hrnet: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: 8,
    dispatch: 'parallel',
  },
  cbam_resunet: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: 4,
    dispatch: 'parallel',
  },
  unet_spherohq: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: 8,
    dispatch: 'parallel',
  },
  unet_attention_aspp: {
    compatibleProjectTypes: ['spheroid_invasive'],
    batchLimit: 8,
    dispatch: 'parallel',
  },
  segformer: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: 8,
    dispatch: 'parallel',
  },
  mamba_unet: {
    compatibleProjectTypes: ['spheroid'],
    batchLimit: 8,
    dispatch: 'parallel',
  },
  sperm: {
    compatibleProjectTypes: ['sperm'],
    batchLimit: 2,
    dispatch: 'parallel',
  },
  wound: {
    compatibleProjectTypes: ['wound'],
    batchLimit: 8,
    dispatch: 'parallel',
  },
  microtubule: {
    compatibleProjectTypes: ['microtubules'],
    batchLimit: 1,
    dispatch: 'serial',
  },
} as const satisfies Record<string, BackendModelSpec>;

/** All known model identifiers — derived, so a typo or a removed model is a
 *  compile error everywhere it is consumed. */
export type KnownModelId = keyof typeof MODEL_REGISTRY;

/** Ordered list of supported model ids (replaces the hand-maintained whitelist). */
export const SEGMENTATION_MODELS = Object.keys(
  MODEL_REGISTRY
) as readonly KnownModelId[];

/** Models compatible with each project type, derived by inverting the registry.
 *  Cross-type segmentation is blocked at both the frontend dropdown and the
 *  backend (400 on submit / rejected in the queue worker). */
export const MODEL_TYPE_COMPATIBILITY: Record<
  ProjectTypeKey,
  readonly KnownModelId[]
> = (() => {
  const out: Record<string, KnownModelId[]> = {};
  for (const [id, spec] of Object.entries(MODEL_REGISTRY)) {
    for (const projectType of spec.compatibleProjectTypes) {
      (out[projectType] ??= []).push(id as KnownModelId);
    }
  }
  return out as Record<ProjectTypeKey, readonly KnownModelId[]>;
})();

/** Per-model batch ceiling. Unknown models fall back to 8 (matches legacy
 *  `BATCH_LIMITS.default`). */
export const BATCH_LIMITS: Record<KnownModelId, number> = Object.fromEntries(
  Object.entries(MODEL_REGISTRY).map(([id, spec]) => [id, spec.batchLimit])
) as Record<KnownModelId, number>;

/** Default batch limit for any model id not present in the registry. */
export const DEFAULT_BATCH_LIMIT = 8;

/** Models that must be dispatched serially (one in-flight request at a time). */
export const SERIAL_DISPATCH_MODELS = new Set<KnownModelId>(
  (
    Object.entries(MODEL_REGISTRY) as [KnownModelId, BackendModelSpec][]
  )
    .filter(([, spec]) => spec.dispatch === 'serial')
    .map(([id]) => id)
);
