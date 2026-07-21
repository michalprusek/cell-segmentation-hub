/**
 * Frontend single source of truth (SSOT) for segmentation model identity,
 * display metadata, and project-type compatibility.
 *
 * Mirrors the backend SSOT at `backend/src/constants/modelRegistry.ts`. To
 * add or remove a model on the frontend, edit ONLY the `MODEL_REGISTRY`
 * record below. Every derived structure — the `ModelType` union, the ordered
 * `ALL_MODEL_IDS` list, `BASIC_MODEL_INFO`, the i18n `keyMap`, and the
 * inverted `MODEL_TYPE_COMPATIBILITY` map — is computed from it so they can
 * never drift out of sync.
 *
 * This file is intentionally free of any `@/types` import so that
 * `@/types/index.ts` can import FROM here without a circular dependency. The
 * project-type keys are therefore declared locally (identical to the backend
 * `ProjectTypeKey`), and `@/types` re-derives `KnownModelId` +
 * `MODEL_TYPE_COMPATIBILITY` from this module.
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
  | 'microcapsule';

/** Coarse size bucket surfaced in the model picker UI. */
export type ModelSize = 'small' | 'medium' | 'large';

/** Catalogue category used to group models in settings. */
export type ModelCategory =
  | 'spheroid'
  | 'sperm'
  | 'wound'
  | 'microtubule'
  | 'microcapsule';

export interface ModelPerformance {
  avgTimePerImage: number; // seconds
  throughput: number; // images per second
  p95Latency: number; // seconds
  batchSize: number; // optimal batch size
}

/**
 * Canonical per-model metadata. The KEY is the canonical model id used
 * everywhere (DB, API, ML service). All other model structures are derived
 * from this record.
 *
 * Field provenance (so a future editor knows what each field feeds):
 *  - `size`, `defaultThreshold`, `category`, `performance` → the static base
 *    used by both `getLocalizedModelInfo()` and `BASIC_MODEL_INFO`.
 *  - `name`, `displayName`, `description` → the English fallbacks held in
 *    `BASIC_MODEL_INFO` (localized variants come from `t()` at render time).
 *  - `i18nKey` → the translation-key segment (`settings.modelSelection.models
 *    .<i18nKey>.{name,description}`).
 *  - `compatibleProjectTypes` → inverted into `MODEL_TYPE_COMPATIBILITY`.
 *    ORDER within each project type's list follows registry declaration order.
 */
export interface ModelRegistryEntry {
  readonly size: ModelSize;
  readonly defaultThreshold: number;
  readonly category: ModelCategory;
  readonly performance: ModelPerformance;
  /** English name shown when no translation is available. */
  readonly name: string;
  /** English long-form display name shown when no translation is available. */
  readonly displayName: string;
  /** English description shown when no translation is available. */
  readonly description: string;
  /** Translation-key segment used under `settings.modelSelection.models.*`. */
  readonly i18nKey: string;
  /** Project types this model can run on. ORDER MATTERS for UI lists. */
  readonly compatibleProjectTypes: readonly ProjectTypeKey[];
}

/**
 * THE single source of truth. Declaration order is load-bearing: derived
 * arrays (`ALL_MODEL_IDS`, `getAllLocalizedModels()`, the per-project-type
 * lists in `MODEL_TYPE_COMPATIBILITY`) preserve it and tests assert it.
 */
export const MODEL_REGISTRY = {
  hrnet: {
    size: 'small',
    defaultThreshold: 0.5,
    category: 'spheroid',
    performance: {
      avgTimePerImage: 0.204,
      throughput: 4.9,
      p95Latency: 0.309,
      batchSize: 8,
    },
    name: 'HRNet',
    displayName: 'HRNet (Balanced)',
    description: 'Balanced model with good speed and quality, E2E ~309ms',
    i18nKey: 'hrnet',
    compatibleProjectTypes: ['spheroid'],
  },
  cbam_resunet: {
    size: 'medium',
    defaultThreshold: 0.5,
    category: 'spheroid',
    performance: {
      avgTimePerImage: 0.377,
      throughput: 2.7,
      p95Latency: 0.482,
      batchSize: 2,
    },
    name: 'CBAM-ResUNet',
    displayName: 'CBAM-ResUNet (Precise)',
    description:
      'Most precise segmentation with attention mechanisms, E2E ~482ms',
    i18nKey: 'cbam',
    compatibleProjectTypes: ['spheroid'],
  },
  unet_spherohq: {
    size: 'small',
    defaultThreshold: 0.5,
    category: 'spheroid',
    performance: {
      avgTimePerImage: 0.181,
      throughput: 5.5,
      p95Latency: 0.286,
      batchSize: 4,
    },
    name: 'UNet (SpheroHQ)',
    displayName: 'UNet (Fastest)',
    description:
      'Fastest model after optimizations, excellent for real-time processing, E2E ~286ms',
    i18nKey: 'unet_spherohq',
    compatibleProjectTypes: ['spheroid'],
  },
  spheroid_disintegration: {
    size: 'medium',
    defaultThreshold: 0.2,
    category: 'spheroid',
    performance: {
      avgTimePerImage: 0.35,
      throughput: 2.8,
      p95Latency: 0.5,
      batchSize: 1,
    },
    name: 'Spheroid Disintegration',
    displayName: 'Spheroid Disintegration',
    description:
      'UNet++ / EfficientNet-B5 3-class model (background / corona / core) for disintegrating spheroids; predicts the dense core directly for a correct Disintegration Index',
    i18nKey: 'spheroid_disintegration',
    compatibleProjectTypes: ['spheroid_invasive'],
  },
  segformer: {
    size: 'small',
    defaultThreshold: 0.5,
    category: 'spheroid',
    performance: {
      avgTimePerImage: 0.2,
      throughput: 5.0,
      p95Latency: 0.3,
      batchSize: 4,
    },
    name: 'SegFormer',
    displayName: 'SegFormer',
    description:
      'Transformer-based model (SegFormer-B0) for bright-field spheroids — highest accuracy (93% IoU) and very fast (~13 ms/image)',
    i18nKey: 'segformer',
    compatibleProjectTypes: ['spheroid'],
  },
  mamba_unet: {
    size: 'large',
    defaultThreshold: 0.5,
    category: 'spheroid',
    performance: {
      avgTimePerImage: 0.236,
      throughput: 4.2,
      p95Latency: 0.249,
      batchSize: 2,
    },
    name: 'Mamba-UNet',
    displayName: 'Mamba-UNet',
    description:
      'U-Net with a bidirectional Mamba (state-space) bottleneck — best robustness on out-of-distribution images (external labs, unknown optics, drug-treated, unusual morphologies)',
    i18nKey: 'mamba_unet',
    compatibleProjectTypes: ['spheroid'],
  },
  sperm: {
    size: 'medium',
    defaultThreshold: 0.5,
    category: 'sperm',
    performance: {
      avgTimePerImage: 0.3,
      throughput: 3.3,
      p95Latency: 0.45,
      batchSize: 1,
    },
    name: 'Sperm Morphology',
    displayName: 'Sperm Morphology',
    description:
      'Sperm morphology model with skeleton extraction for head/midpiece/tail measurement',
    i18nKey: 'sperm',
    compatibleProjectTypes: ['sperm'],
  },
  wound: {
    size: 'medium',
    defaultThreshold: 0.5,
    category: 'wound',
    performance: {
      avgTimePerImage: 0.032,
      throughput: 35.0,
      p95Latency: 0.05,
      batchSize: 1,
    },
    name: 'Wound Healing',
    displayName: 'Wound Healing (Scratch Assay)',
    description:
      'U-Net with MiT-B5 (SegFormer) encoder for binary wound segmentation in scratch-assay microscopy timelapses (~32 ms on A5000 GPU, 90% IoU on external test set)',
    i18nKey: 'wound',
    compatibleProjectTypes: ['wound'],
  },
  microtubule: {
    size: 'large',
    defaultThreshold: 0.5,
    category: 'microtubule',
    performance: {
      // DINOv3-L (~300M params) + PySOAX iterative snake evolver. Numbers
      // are conservative estimates on A5000; first call is much slower
      // because of the gated HuggingFace download of the backbone weights.
      avgTimePerImage: 8.0,
      throughput: 0.13,
      p95Latency: 10.0,
      batchSize: 1,
    },
    name: 'Microtubule (v7)',
    displayName: 'Microtubule (DINOv3 + PySOAX)',
    description:
      'Instance segmentation for IRM/TIRF microtubule time-lapses. DINOv3-L ViT-L/16 backbone + DPT-style fusion produces a per-pixel 32-d embedding that PySOAX uses to extract individual MT centerlines. The embedding also drives automatic cross-frame tracking for kymograph analysis. Slow (~8 s/frame) but the only model in the platform producing polyline output.',
    i18nKey: 'microtubule',
    compatibleProjectTypes: ['microtubules'],
  },
  microcapsule: {
    size: 'small',
    defaultThreshold: 0.5,
    category: 'microcapsule',
    performance: {
      // Distilled U-Net (MobileNetV3-Small, ~14.5 MB) + watershed. ~0.3 s/image
      // on the A5000 (measured on 1280x1024 bright-field capsule TIFFs).
      avgTimePerImage: 0.3,
      throughput: 3.0,
      p95Latency: 0.6,
      batchSize: 1,
    },
    name: 'Microcapsule',
    displayName: 'Microcapsule',
    description:
      'Instance segmentation for microcapsules (round objects) in bright-field microscopy. A compact U-Net distilled from Meta SAM 3 returns one clean, full-resolution boundary per capsule and separates touching capsules with a watershed; capsules cut off by the image border are flagged and excluded from metrics (area, perimeter, compactness).',
    i18nKey: 'microcapsule',
    compatibleProjectTypes: ['microcapsule'],
  },
} as const satisfies Record<string, ModelRegistryEntry>;

/** Canonical model id union, derived from the registry keys. */
export type ModelType = keyof typeof MODEL_REGISTRY;

/** Ordered list of all known model ids (declaration order preserved). */
export const ALL_MODEL_IDS = Object.keys(MODEL_REGISTRY) as ModelType[];

/**
 * Static display metadata for a single model. Localized name/displayName/
 * description are produced by `getLocalizedModelInfo()` in `modelUtils.ts`;
 * these are the static facts.
 */
export interface ModelInfo {
  id: ModelType;
  name: string;
  displayName: string;
  description: string;
  size: ModelSize;
  defaultThreshold: number;
  category: ModelCategory;
  performance?: ModelPerformance;
}

/**
 * Static, non-localized base metadata per model (no name/displayName/
 * description) — the input both `getLocalizedModelInfo()` and
 * `BASIC_MODEL_INFO` build on. Derived from the registry.
 */
export const BASE_MODEL_INFO = (() => {
  const out = {} as Record<
    ModelType,
    Omit<ModelInfo, 'name' | 'displayName' | 'description'>
  >;
  for (const id of ALL_MODEL_IDS) {
    const e = MODEL_REGISTRY[id];
    out[id] = {
      id,
      size: e.size,
      defaultThreshold: e.defaultThreshold,
      category: e.category,
      performance: e.performance,
    };
  }
  return out;
})();

/**
 * Full static model info record with English name/displayName/description,
 * for contexts that cannot call `t()`. Derived from the registry.
 */
export const BASIC_MODEL_INFO = (() => {
  const out = {} as Record<ModelType, ModelInfo>;
  for (const id of ALL_MODEL_IDS) {
    const e = MODEL_REGISTRY[id];
    out[id] = {
      ...BASE_MODEL_INFO[id],
      name: e.name,
      displayName: e.displayName,
      description: e.description,
    };
  }
  return out;
})();

/**
 * Maps canonical model id → i18n key segment used in translation files
 * (`settings.modelSelection.models.<segment>.*`). Derived from the registry.
 */
export const keyMap = (() => {
  const out = {} as Record<ModelType, string>;
  for (const id of ALL_MODEL_IDS) {
    out[id] = MODEL_REGISTRY[id].i18nKey;
  }
  return out;
})();

/**
 * Project-type → compatible model ids, INVERTED from the registry. Order
 * within each list follows registry declaration order. Mirrors the backend
 * `MODEL_TYPE_COMPATIBILITY`.
 */
export const MODEL_TYPE_COMPATIBILITY = (() => {
  const out: Record<string, ModelType[]> = {};
  for (const id of ALL_MODEL_IDS) {
    for (const pt of MODEL_REGISTRY[id].compatibleProjectTypes) {
      (out[pt] ??= []).push(id);
    }
  }
  return out as Record<ProjectTypeKey, ModelType[]>;
})();
