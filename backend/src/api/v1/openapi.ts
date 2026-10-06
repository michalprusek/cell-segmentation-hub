import { MODEL_REGISTRY } from '../../constants/modelRegistry';
import { V1_RATE_LIMIT_PER_MINUTE } from './limits';
import { OUTPUT_FORMATS } from './models';
import { PROBLEM_TYPES, PROBLEM_TYPE_BASE, type ProblemCode } from './problem';
import {
  MAX_CONCURRENT_PER_KEY,
  SYNC_MAX_BYTES,
  SYNC_MAX_PIXELS,
} from './segment';

/**
 * The OpenAPI 3.1 description of `/api/v1`, built from the constants the
 * code itself runs on — model ids, output formats, problem types, limits — so
 * that a new model or a changed limit cannot leave the published contract
 * behind. `openapi.test.ts` checks the parts that are written by hand.
 *
 * 3.1 rather than 3.2 (the current release): tooling support for 3.2 is not
 * yet something to rely on, and nothing here needs it.
 */
const MODEL_IDS = Object.keys(MODEL_REGISTRY);

const problem = (codes: ProblemCode[]): Record<string, unknown> => ({
  description: codes
    .map(code => `\`${code}\` — ${PROBLEM_TYPES[code].title}.`)
    .join(' '),
  content: {
    'application/problem+json': {
      schema: { $ref: '#/components/schemas/Problem' },
    },
  },
});

const byStatus = (codes: ProblemCode[]): Record<string, unknown> => {
  const grouped = new Map<number, ProblemCode[]>();
  for (const code of codes) {
    const status = PROBLEM_TYPES[code].status;
    grouped.set(status, [...(grouped.get(status) ?? []), code]);
  }
  return Object.fromEntries(
    [...grouped].sort(([a], [b]) => a - b).map(([s, c]) => [String(s), problem(c)])
  );
};

const AUTH_PROBLEMS: ProblemCode[] = [
  'authentication-required',
  'invalid-api-key',
  'credentials-in-url',
  'rate-limit-exceeded',
  'internal-error',
];

export const SEGMENT_PROBLEMS: ProblemCode[] = [
  ...AUTH_PROBLEMS,
  'too-many-concurrent-requests',
  'unsupported-media-type',
  'validation-failed',
  'unsupported-image',
  'payload-too-large',
  'image-too-large',
  'output-not-representable',
  'not-acceptable',
  'server-busy',
  'segmentation-timeout',
  'segmentation-failed',
];

const point = {
  type: 'array',
  prefixItems: [{ type: 'number' }, { type: 'number' }],
  minItems: 2,
  maxItems: 2,
  description: '`[x, y]` in pixels of the image as uploaded. Origin top-left.',
};

export function buildOpenApi(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'SpheroSeg API',
      version: '1.0.0',
      description: [
        'Segment microscopy images with the SpheroSeg models: send one image, get the objects back in the format you choose. Nothing is stored.',
        '',
        '**Authentication.** `Authorization: Bearer <key>`. Create a key under Settings → API. A key in the URL is refused.',
        '',
        '**Errors.** Every error is an RFC 9457 problem document (`application/problem+json`) with a stable `code`.',
        '',
        `**Limits.** ${V1_RATE_LIMIT_PER_MINUTE} requests per minute and ${MAX_CONCURRENT_PER_KEY} concurrent segmentations per key; images up to ${SYNC_MAX_PIXELS} pixels (4096 x 4096) and ${SYNC_MAX_BYTES / 1024 / 1024} MiB. Inference is serial across the whole service, so a request may wait behind others.`,
        '',
        '**Versioning.** `v1` changes only additively: new endpoints, new optional fields, new response fields. Ignore fields you do not know.',
      ].join('\n'),
    },
    servers: [{ url: '/api/v1' }],
    security: [{ apiKey: [] }],
    tags: [
      { name: 'Models' },
      { name: 'Segmentation' },
      { name: 'Meta', description: 'Public; no API key needed.' },
    ],
    paths: {
      '/models': {
        get: {
          tags: ['Models'],
          operationId: 'listModels',
          summary: 'List the segmentation models',
          responses: {
            '200': {
              description: 'Every model, with what it returns and which parameters it reads.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Model' },
                      },
                    },
                  },
                },
              },
            },
            ...byStatus(AUTH_PROBLEMS),
          },
        },
      },
      '/models/{id}': {
        get: {
          tags: ['Models'],
          operationId: 'getModel',
          summary: 'Describe one model',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { $ref: '#/components/schemas/ModelId' },
            },
          ],
          responses: {
            '200': {
              description: 'The model.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Model' },
                },
              },
            },
            ...byStatus([...AUTH_PROBLEMS, 'not-found']),
          },
        },
      },
      '/segment': {
        post: {
          tags: ['Segmentation'],
          operationId: 'segment',
          summary: 'Segment one image',
          description: [
            'Runs one model on one image and returns the result in `output_format`.',
            '',
            '`threshold` and `detect_holes` are read only by some models — see `parameters` on each model. Sending one to a model that does not read it is a 422, not a silent no-op.',
            '',
            'A 16-bit, 32-bit or float image sent to a model whose `input_depth` is `8bit` is stretched from its 0.1–99.9 percentile range to 0–255 first; the result then carries an `input_depth_converted` warning.',
            '',
            'For every format but `json` the warnings travel as codes in the `SpheroSeg-Warnings` header.',
          ].join('\n'),
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['image', 'model'],
                  properties: {
                    image: {
                      description: 'PNG, JPEG, TIFF (including 16-bit, float and multi-page) or BMP. Judged by content, not by name.',
                    },
                    model: { $ref: '#/components/schemas/ModelId' },
                    threshold: {
                      type: 'number',
                      minimum: 0.1,
                      maximum: 0.99,
                      description: 'Foreground probability cut. Only for models whose `parameters.threshold.supported` is true.',
                    },
                    detect_holes: {
                      type: 'boolean',
                      description: 'Report holes inside objects. Only for models whose `parameters.detect_holes.supported` is true. Default true.',
                    },
                    page: {
                      type: 'integer',
                      minimum: 0,
                      default: 0,
                      description: 'Zero-based page of a multi-page TIFF.',
                    },
                    output_format: {
                      $ref: '#/components/schemas/OutputFormat',
                    },
                  },
                },
                encoding: {
                  image: {
                    contentType: 'image/png, image/jpeg, image/tiff, image/bmp, application/octet-stream',
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'The segmentation, in the requested format.',
              headers: {
                'SpheroSeg-Object-Count': {
                  schema: { type: 'integer' },
                  description: 'Number of objects found.',
                },
                'SpheroSeg-Warnings': {
                  schema: { type: 'string' },
                  description: 'Comma-separated warning codes; absent when there are none.',
                },
                'Content-Disposition': {
                  schema: { type: 'string' },
                  description: 'Suggested filename, for every format but `json`.',
                },
              },
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/Segmentation' },
                      {
                        type: 'object',
                        description: '`output_format=coco`: a COCO instance-annotation document. Polygons with holes are RLE with `iscrowd: 1`; polylines carry `attributes.geometry: "polyline"`.',
                      },
                    ],
                  },
                },
                'image/png': {
                  schema: { type: 'string', contentMediaType: 'image/png' },
                },
                'image/tiff': {
                  schema: { type: 'string', contentMediaType: 'image/tiff' },
                },
                'application/zip': {
                  schema: { type: 'string', contentMediaType: 'application/zip' },
                },
              },
            },
            ...byStatus(SEGMENT_PROBLEMS),
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['Meta'],
          operationId: 'getOpenApi',
          summary: 'This document',
          security: [],
          responses: {
            '200': {
              description: 'OpenAPI 3.1.',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/problems/{code}': {
        get: {
          tags: ['Meta'],
          operationId: 'getProblemType',
          summary: 'Describe a problem type',
          description: 'What a problem `type` URI resolves to.',
          security: [],
          parameters: [
            {
              name: 'code',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: Object.keys(PROBLEM_TYPES) },
            },
          ],
          responses: {
            '200': {
              description: 'The problem type.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ProblemType' },
                },
              },
            },
            '404': problem(['not-found']),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API key (sseg_...)',
        },
      },
      schemas: {
        ModelId: { type: 'string', enum: MODEL_IDS },
        OutputFormat: {
          type: 'string',
          enum: [...OUTPUT_FORMATS],
          default: 'json',
          description: [
            '- `json` — the objects, as described by the `Segmentation` schema.',
            '- `coco` — COCO instance annotations (JSON download).',
            '- `mask_png`, `mask_tiff` — a 16-bit label image: pixel value = the object\'s `label`, 0 = background. Always 16-bit. Polylines are drawn one pixel wide; where objects overlap the smaller one is on top.',
            '- `imagej_roi` — a `RoiSet.zip` for ImageJ / Fiji, one `.roi` per object and one per hole.',
            '- `yolo` — a zip with `labels/<name>.txt` (YOLO segmentation lines, normalised) and `classes.txt`. Polygon models only; holes are not representable and are left out.',
          ].join('\n'),
        },
        Model: {
          type: 'object',
          required: [
            'id',
            'name',
            'description',
            'project_types',
            'geometry',
            'classes',
            'parameters',
            'input_depth',
            'returns_metrics',
            'output_formats',
            'notes',
          ],
          properties: {
            id: { $ref: '#/components/schemas/ModelId' },
            name: { type: 'string' },
            description: { type: 'string' },
            project_types: {
              type: 'array',
              items: { type: 'string' },
              description: 'The SpheroSeg project types this model serves in the app.',
            },
            geometry: { type: 'string', enum: ['polygon', 'polyline'] },
            classes: { type: 'array', items: { type: 'string' } },
            parts: {
              type: 'array',
              items: { type: 'string' },
              description: 'Named parts of one instance, when objects are parts (sperm).',
            },
            parameters: {
              type: 'object',
              required: ['threshold', 'detect_holes'],
              properties: {
                threshold: {
                  type: 'object',
                  required: ['supported'],
                  properties: {
                    supported: { type: 'boolean' },
                    default: { type: 'number' },
                    minimum: { type: 'number' },
                    maximum: { type: 'number' },
                  },
                },
                detect_holes: {
                  type: 'object',
                  required: ['supported'],
                  properties: {
                    supported: { type: 'boolean' },
                    default: { type: 'boolean' },
                  },
                },
              },
            },
            input_depth: { type: 'string', enum: ['native', '8bit'] },
            returns_metrics: { type: 'boolean' },
            output_formats: {
              type: 'array',
              items: { $ref: '#/components/schemas/OutputFormat' },
            },
            notes: { type: 'array', items: { type: 'string' } },
          },
        },
        Object: {
          type: 'object',
          required: ['label', 'geometry', 'class', 'points'],
          properties: {
            label: {
              type: 'integer',
              minimum: 1,
              description: 'Position in `objects`, from 1. Also this object\'s pixel value in the mask formats.',
            },
            geometry: { type: 'string', enum: ['polygon', 'polyline'] },
            class: { type: 'string' },
            part: { type: 'string', description: 'Sperm: head, midpiece or tail.' },
            instance: {
              type: 'string',
              description: 'Objects that are parts of one thing share an instance.',
            },
            confidence: { type: 'number' },
            complete: {
              type: 'boolean',
              description: 'Microcapsule: false when cut by the image border.',
            },
            points: {
              type: 'array',
              items: point,
              description: 'A closed ring for a polygon (the first point is not repeated), an open path for a polyline.',
            },
            holes: {
              type: 'array',
              items: { type: 'array', items: point },
              description: 'Polygons only. An island inside a hole is an object of its own.',
            },
          },
        },
        Warning: {
          type: 'object',
          required: ['code', 'detail'],
          properties: {
            code: {
              type: 'string',
              description: 'Known codes: multipage_image, input_depth_converted, model_warning, no_objects, invalid_geometry_dropped, orphan_holes_dropped. More may be added.',
            },
            detail: { type: 'string' },
          },
        },
        Segmentation: {
          type: 'object',
          required: ['model', 'image', 'parameters', 'objects', 'warnings', 'timing'],
          properties: {
            model: { $ref: '#/components/schemas/ModelId' },
            image: {
              type: 'object',
              required: ['width', 'height', 'page', 'page_count'],
              properties: {
                width: { type: 'integer' },
                height: { type: 'integer' },
                page: { type: 'integer' },
                page_count: { type: 'integer' },
              },
            },
            parameters: {
              type: 'object',
              description: 'The parameters the model actually ran with. Empty for a model that reads none.',
              properties: {
                threshold: { type: 'number' },
                detect_holes: { type: 'boolean' },
              },
            },
            objects: {
              type: 'array',
              items: { $ref: '#/components/schemas/Object' },
            },
            metrics: {
              type: 'object',
              description: 'Image-level metrics, for models whose `returns_metrics` is true.',
            },
            warnings: {
              type: 'array',
              items: { $ref: '#/components/schemas/Warning' },
            },
            timing: {
              type: 'object',
              required: ['inference_ms'],
              properties: { inference_ms: { type: 'integer' } },
            },
          },
        },
        Problem: {
          type: 'object',
          description: 'RFC 9457 problem details. Extension members vary by `code`.',
          required: ['type', 'title', 'status', 'code'],
          properties: {
            type: { type: 'string', format: 'uri', examples: [`${PROBLEM_TYPE_BASE}validation-failed`] },
            title: { type: 'string' },
            status: { type: 'integer' },
            detail: { type: 'string' },
            code: { type: 'string', enum: Object.keys(PROBLEM_TYPES) },
            errors: {
              type: 'array',
              description: '`validation-failed` only.',
              items: {
                type: 'object',
                required: ['field', 'detail'],
                properties: {
                  field: { type: 'string' },
                  detail: { type: 'string' },
                },
              },
            },
          },
        },
        ProblemType: {
          type: 'object',
          required: ['type', 'code', 'title', 'status', 'description'],
          properties: {
            type: { type: 'string', format: 'uri' },
            code: { type: 'string' },
            title: { type: 'string' },
            status: { type: 'integer' },
            description: { type: 'string' },
          },
        },
      },
    },
  };
}
