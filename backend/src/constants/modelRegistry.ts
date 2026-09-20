/**
 * Single source of truth for backend model identity + project-type compatibility.
 *
 * To add or remove a segmentation model on the backend, edit ONLY this registry.
 * `SEGMENTATION_MODELS`, `KnownModelId` and `MODEL_TYPE_COMPATIBILITY` are all
 * derived from it, so they can never drift apart again. (They previously lived
 * in separate files and HAD drifted — the whitelist still carried two deleted
 * models, `resunet_advanced` / `resunet_small`.)
 *
 * Deliberately NOT modelled here: queue batch sizes / serial-dispatch. Those
 * live in `queueService.ts` as a runtime kill-switch (currently forcing
 * single-image processing to bypass a broken batch endpoint) — a queue concern,
 * not model identity. Keep them out of this registry.
 *
 * Cross-tree (frontend) and cross-language (Python ML) parity is enforced by
 * `scripts/check-model-parity.cjs` plus per-side equality tests.
 */

/** Project-type keys exactly as used by the compatibility map.
 *  NOTE: the microtubule project-type key is the plural `microtubules` while
 *  the model id is the singular `microtubule` — preserved from legacy data. */
export type ProjectTypeKey =
  | 'spheroid'
  | 'spheroid_invasive'
  | 'wound'
  | 'sperm'
  | 'microtubules'
  | 'microcapsule'
  | 'neurite';

interface BackendModelSpec {
  /** Project types whose picker offers (and whose worker accepts) this model. */
  readonly compatibleProjectTypes: readonly ProjectTypeKey[];
}

/**
 * The canonical model set. Declaration order is load-bearing: the derived
 * `MODEL_TYPE_COMPATIBILITY` preserves it and tests assert the exact arrays.
 */
export const MODEL_REGISTRY = {
  hrnet: { compatibleProjectTypes: ['spheroid'] },
  cbam_resunet: { compatibleProjectTypes: ['spheroid'] },
  unet_spherohq: { compatibleProjectTypes: ['spheroid'] },
  spheroid_disintegration: { compatibleProjectTypes: ['spheroid_invasive'] },
  segformer: { compatibleProjectTypes: ['spheroid'] },
  mamba_unet: { compatibleProjectTypes: ['spheroid'] },
  sperm: { compatibleProjectTypes: ['sperm'] },
  wound: { compatibleProjectTypes: ['wound'] },
  microtubule: { compatibleProjectTypes: ['microtubules'] },
  microcapsule: { compatibleProjectTypes: ['microcapsule'] },
  neurite_soma: { compatibleProjectTypes: ['neurite'] },
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

/**
 * Type-level set of the models compatible with a given project type, derived
 * by filtering the registry. Constrains `DEFAULT_MODEL_BY_PROJECT_TYPE` below
 * so an incompatible default is a compile error, not a runtime 400.
 */
type CompatibleModelFor<PT extends ProjectTypeKey> = {
  [M in KnownModelId]: PT extends (typeof MODEL_REGISTRY)[M]['compatibleProjectTypes'][number]
    ? M
    : never;
}[KnownModelId];

/**
 * The model a project of each type starts on when it has never had one chosen
 * — the most ACCURATE compatible model, deliberately not the fastest.
 *
 * MIRROR of `src/lib/models/modelRegistry.ts`; the rationale for `spheroid`
 * resolving to `segformer` (93 % IoU, the only published figure among the five
 * spheroid candidates) lives there in full, as does the warning not to
 * re-derive this from the view-layer `SPHEROID_PRESETS` tiers. Parity between
 * the two copies is asserted by `modelRegistry.test.ts` on each side.
 *
 * Read on the backend by `resolveProjectModel()` so that a project row with a
 * NULL `segmentationModel` (every row predating the column) answers with the
 * right model instead of forcing a backfill.
 */
export const DEFAULT_MODEL_BY_PROJECT_TYPE = {
  spheroid: 'segformer',
  spheroid_invasive: 'spheroid_disintegration',
  wound: 'wound',
  sperm: 'sperm',
  microtubules: 'microtubule',
  microcapsule: 'microcapsule',
  neurite: 'neurite_soma',
} as const satisfies { [K in ProjectTypeKey]: CompatibleModelFor<K> };

/**
 * The model a project should segment with: its stored choice when that choice
 * is still valid for its type, otherwise the type's default.
 *
 * The fallback is not merely for NULL rows. A project whose `type` is changed
 * keeps its old `segmentationModel` until the next write, and a model can be
 * removed from the registry entirely — both leave a stored value that is no
 * longer compatible. Answering with the default rather than the stale value
 * keeps the Segment button working instead of failing the compatibility check
 * one layer deeper.
 */
export function resolveProjectModel(
  projectType: ProjectTypeKey,
  storedModel: string | null | undefined
): KnownModelId {
  const compatible = MODEL_TYPE_COMPATIBILITY[projectType];
  if (
    storedModel &&
    (compatible as readonly string[]).includes(storedModel)
  ) {
    return storedModel as KnownModelId;
  }
  return DEFAULT_MODEL_BY_PROJECT_TYPE[projectType];
}
