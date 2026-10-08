import {
  MODEL_REGISTRY,
  type KnownModelId,
} from '../../constants/modelRegistry';

/**
 * What the public API says about each model.
 *
 * `MODEL_REGISTRY` remains the source of truth for WHICH models exist and
 * which project types they serve; this adds the facts a caller outside the
 * app needs and the app's own UI expresses in other ways: what geometry
 * comes back, which request parameters the model actually reads, and which
 * output formats can represent its result.
 *
 * The `threshold` / `detectHoles` flags are not preferences. They record
 * what `backend/segmentation/api/routes.py::_dispatch_inference` does with
 * each parameter, model by model — six models never read `threshold` and
 * five never read `detect_holes`. A parameter a model ignores is REFUSED by
 * the API rather than accepted and dropped, so these must stay true; change
 * one only together with the dispatch.
 */
export type Geometry = 'polygon' | 'polyline';

export const OUTPUT_FORMATS = [
  'json',
  'coco',
  'mask_png',
  'mask_tiff',
  'imagej_roi',
  'yolo',
] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export interface V1Model {
  name: string;
  description: string;
  geometry: Geometry;
  /** Class names an object of this model can carry, in YOLO class-id order. */
  classes: readonly string[];
  /** Named parts of one instance (sperm); absent when objects are whole. */
  parts?: readonly string[];
  /** The model reads `threshold`; `default` is used when it is omitted. */
  threshold: { default: number } | null;
  /** The model reads `detect_holes`. */
  detectHoles: boolean;
  /**
   * `native`: 16-bit / float input is used at full depth.
   * `8bit`: such input is first stretched to 8 bits (0.1-99.9 percentile).
   */
  inputDepth: 'native' | '8bit';
  /** The result carries image-level `metrics`. */
  metrics?: boolean;
  notes?: readonly string[];
}

const SPHEROID_BASE = {
  geometry: 'polygon',
  classes: ['spheroid'],
  threshold: { default: 0.5 },
  detectHoles: true,
  inputDepth: '8bit',
  // `ModelLoader.preprocess_image`, target_size (1024, 1024). Said out loud
  // because it decides what a larger upload buys: a 6 x 6 mosaic of spheroids
  // at 6000 x 6000 came back from the deployed API with no objects at all.
  notes: [
    'The image is resized to 1024 x 1024 for inference, whatever its size or aspect ratio, and the outlines are scaled back. A frame much larger than that gains no detail; segment one spheroid per image.',
  ],
} as const;

const DETAILS: Record<KnownModelId, V1Model> = {
  hrnet: {
    ...SPHEROID_BASE,
    name: 'HRNet',
    description: 'Spheroid outlines in brightfield images. Balanced speed and quality.',
  },
  cbam_resunet: {
    ...SPHEROID_BASE,
    name: 'CBAM-ResUNet',
    description: 'Spheroid outlines in brightfield images. Slower, attention-based.',
  },
  unet_spherohq: {
    ...SPHEROID_BASE,
    name: 'U-Net (SpheroHQ)',
    description: 'Spheroid outlines in brightfield images. The fastest spheroid model.',
  },
  segformer: {
    ...SPHEROID_BASE,
    name: 'SegFormer',
    description:
      'Spheroid outlines in brightfield images. The most accurate spheroid model and the default for spheroid projects in the app.',
  },
  mamba_unet: {
    ...SPHEROID_BASE,
    name: 'Mamba-UNet',
    description: 'Spheroid outlines in brightfield images. State-space backbone.',
  },
  spheroid_disintegration: {
    name: 'Spheroid Disintegration',
    description:
      'Invasive spheroids: the whole spheroid footprint plus its compact core, with the outside-core fraction, the Disintegration Index and related image-level metrics.',
    geometry: 'polygon',
    classes: ['spheroid', 'core'],
    threshold: null,
    detectHoles: false,
    inputDepth: '8bit',
    metrics: true,
    notes: [
      'Runs at the native resolution of the image. Validated on 2048 x 2048 px frames; other sizes are reported in the result warnings.',
      'Holes are never emitted for this model.',
    ],
  },
  sperm: {
    name: 'Sperm Morphology',
    description:
      'Sperm cells as open centerlines, one per part (head, midpiece, tail), grouped by instance.',
    geometry: 'polyline',
    classes: ['sperm'],
    parts: ['head', 'midpiece', 'tail'],
    threshold: null,
    detectHoles: false,
    inputDepth: '8bit',
  },
  sperm_2part: {
    name: 'Sperm Morphology (head + tail)',
    description:
      'Sperm cells as open centerlines with two parts per cell (head, tail), grouped by instance.',
    geometry: 'polyline',
    classes: ['sperm'],
    parts: ['head', 'tail'],
    threshold: null,
    detectHoles: false,
    inputDepth: '8bit',
  },
  wound: {
    name: 'Wound Healing',
    description: 'The cell-free wound area in scratch-assay images.',
    notes: [
      'The image is resized to 256 x 256 for inference and the outline is scaled back, so its edge is only as fine as that grid.',
    ],
    geometry: 'polygon',
    classes: ['wound'],
    threshold: { default: 0.5 },
    detectHoles: true,
    inputDepth: '8bit',
  },
  microtubule: {
    name: 'Microtubule',
    description:
      'Individual microtubules as open centerlines in interference-reflection (IRM) images.',
    geometry: 'polyline',
    classes: ['microtubule'],
    threshold: null,
    detectHoles: false,
    inputDepth: 'native',
    notes: [
      'IRM (label-free) images only. On fluorescence (TIRF) frames the output does not track image content.',
      'The detection cut is part of the fitted model and cannot be set.',
    ],
  },
  microcapsule: {
    name: 'Microcapsule',
    description:
      'Microcapsules as closed outlines, each followed by the outline of its membrane.',
    geometry: 'polygon',
    classes: ['microcapsule', 'membrane'],
    threshold: { default: 0.5 },
    detectHoles: false,
    inputDepth: '8bit',
    notes: [
      'A membrane outline encloses its capsule, so the two overlap. In mask outputs the smaller object is drawn on top.',
    ],
  },
  neurite_soma: {
    name: 'Neurite / Soma',
    description: 'Neurites and cell bodies (somata) as closed outlines.',
    geometry: 'polygon',
    classes: ['neurite', 'soma'],
    threshold: null,
    detectHoles: true,
    inputDepth: 'native',
    notes: [
      'Single-channel images. A colour image is accepted only if its channels are identical.',
    ],
  },
  neurite_soma_classical: {
    name: 'Neurite / Soma (classical)',
    description:
      'Neurites and cell bodies (somata) as closed outlines, from a ridge filter and a shape test. No trained network.',
    geometry: 'polygon',
    classes: ['neurite', 'soma'],
    threshold: null,
    detectHoles: true,
    inputDepth: 'native',
    notes: [
      'One image is one channel here. Merging several channels before segmentation is a feature of the application; this endpoint does not take them.',
      'A colour image is reduced to its luminance.',
      'Images over 64 megapixels are refused.',
    ],
  },
};

/** YOLO segmentation labels are closed polygons; a centerline has no area. */
export function outputFormatsFor(model: V1Model): OutputFormat[] {
  return OUTPUT_FORMATS.filter(
    format => format !== 'yolo' || model.geometry === 'polygon'
  );
}

export const V1_MODELS: Readonly<Record<KnownModelId, V1Model>> = DETAILS;

export function isKnownModel(id: string): id is KnownModelId {
  return Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, id);
}

/** The `GET /api/v1/models` representation of one model. */
export function describeModel(id: KnownModelId): Record<string, unknown> {
  const model = V1_MODELS[id];
  return {
    id,
    name: model.name,
    description: model.description,
    project_types: MODEL_REGISTRY[id].compatibleProjectTypes,
    geometry: model.geometry,
    classes: model.classes,
    ...(model.parts ? { parts: model.parts } : {}),
    parameters: {
      threshold: model.threshold
        ? { supported: true, default: model.threshold.default, minimum: 0.1, maximum: 0.99 }
        : { supported: false },
      detect_holes: model.detectHoles
        ? { supported: true, default: true }
        : { supported: false },
    },
    input_depth: model.inputDepth,
    returns_metrics: model.metrics === true,
    output_formats: outputFormatsFor(model),
    notes: model.notes ?? [],
  };
}
