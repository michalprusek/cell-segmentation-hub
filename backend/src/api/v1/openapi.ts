import { MODEL_REGISTRY } from '../../constants/modelRegistry';
import { SYNC_MAX_PIXELS, V1_RATE_LIMIT_PER_MINUTE } from './limits';
import { OUTPUT_FORMATS } from './models';
import {
  JOB_MAX_FILE_BYTES,
  JOB_MAX_ITEMS,
  JOB_MAX_PIXELS,
  JOB_MAX_TOTAL_BYTES,
  JOB_STATUSES,
  MAX_ACTIVE_JOBS_PER_USER,
} from './jobs/limits';
import { PROBLEM_TYPES, PROBLEM_TYPE_BASE, type ProblemCode } from './problem';
import { MAX_CONCURRENT_PER_KEY, SYNC_MAX_BYTES } from './segment';

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

export const JOB_PROBLEMS: ProblemCode[] = [
  ...AUTH_PROBLEMS,
  'too-many-jobs',
  'unsupported-media-type',
  'validation-failed',
  'payload-too-large',
  'idempotency-key-reused',
  'server-busy',
  'not-found',
  'result-not-ready',
  'result-unavailable',
  'result-expired',
  'not-acceptable',
  'output-not-representable',
];

const jobId = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const jobResponse = (description: string): Record<string, unknown> => ({
  description,
  content: {
    'application/json': { schema: { $ref: '#/components/schemas/Job' } },
  },
});

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
      { name: 'Jobs', description: 'Asynchronous segmentation of larger images and batches.' },
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
      '/jobs': {
        post: {
          tags: ['Jobs'],
          operationId: 'createJob',
          summary: 'Create a job',
          description: [
            `Queue 1–${JOB_MAX_ITEMS} images for one model and return at once. Poll the job, then fetch each image's result — and choose its format — from \`/jobs/{id}/results/{index}\`.`,
            '',
            `Limits: ${JOB_MAX_FILE_BYTES / 1024 / 1024} MiB per file and ${JOB_MAX_TOTAL_BYTES / 1024 / 1024 / 1024} GiB per job; images up to ${JOB_MAX_PIXELS} pixels (8192 x 8192), except \`spheroid_disintegration\`, which keeps the synchronous ${SYNC_MAX_PIXELS}; ${MAX_ACTIVE_JOBS_PER_USER} active jobs per account.`,
            '',
            'An image over the pixel limit, or one that cannot be decoded, fails as an item of the job — it is found when it is processed, not at upload.',
            '',
            'Send an `Idempotency-Key` header to make a retry safe: the same key with the same request returns the job already created (200, `Idempotent-Replayed: true`); with a different request it is a 422.',
          ].join('\n'),
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string', maxLength: 255 },
              description: 'Any unique string, e.g. a UUID. An IETF draft, not yet a standard.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['images', 'model'],
                  properties: {
                    images: {
                      type: 'array',
                      minItems: 1,
                      maxItems: JOB_MAX_ITEMS,
                      items: {},
                      description: 'One file part named `images` per image.',
                    },
                    model: { $ref: '#/components/schemas/ModelId' },
                    threshold: { type: 'number', minimum: 0.1, maximum: 0.99 },
                    detect_holes: { type: 'boolean' },
                    page: { type: 'integer', minimum: 0, default: 0 },
                  },
                },
              },
            },
          },
          responses: {
            '202': {
              ...jobResponse('The job was queued.'),
              headers: {
                Location: {
                  schema: { type: 'string' },
                  description: 'The job to poll.',
                },
                'Retry-After': {
                  schema: { type: 'integer' },
                  description: 'Seconds to wait before polling.',
                },
              },
            },
            '200': jobResponse(
              'A replay: this `Idempotency-Key` had already created this job.'
            ),
            ...byStatus([
              ...AUTH_PROBLEMS,
              'too-many-jobs',
              'unsupported-media-type',
              'validation-failed',
              'payload-too-large',
              'idempotency-key-reused',
              'server-busy',
            ]),
          },
        },
        get: {
          tags: ['Jobs'],
          operationId: 'listJobs',
          summary: 'List your 50 most recent jobs',
          responses: {
            '200': {
              description: 'Jobs, newest first, without their items.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['data'],
                    properties: {
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Job' },
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
      '/jobs/{id}': {
        get: {
          tags: ['Jobs'],
          operationId: 'getJob',
          summary: 'Get a job and the state of each image',
          parameters: [jobId],
          responses: {
            '200': {
              ...jobResponse('The job. `Retry-After` is present while it is still running.'),
              headers: {
                'Retry-After': {
                  schema: { type: 'integer' },
                  description: 'Seconds to wait before polling again.',
                },
              },
            },
            ...byStatus([...AUTH_PROBLEMS, 'not-found']),
          },
        },
        delete: {
          tags: ['Jobs'],
          operationId: 'deleteJob',
          summary: 'Delete a job and everything stored for it',
          parameters: [jobId],
          responses: {
            '204': { description: 'Deleted.' },
            ...byStatus([...AUTH_PROBLEMS, 'not-found']),
          },
        },
      },
      '/jobs/{id}/cancel': {
        post: {
          tags: ['Jobs'],
          operationId: 'cancelJob',
          summary: 'Cancel a job',
          description:
            'Best effort and idempotent. Images not yet started are canceled; one already running finishes; results already produced stay available. Cancelling a finished job changes nothing.',
          parameters: [jobId],
          responses: {
            '200': jobResponse('The job, with cancellation requested.'),
            ...byStatus([...AUTH_PROBLEMS, 'not-found']),
          },
        },
      },
      '/jobs/{id}/results/{index}': {
        get: {
          tags: ['Jobs'],
          operationId: 'getJobResult',
          summary: 'Get one image\'s result, in any format',
          description:
            'The same representations as `POST /segment`. The format is chosen here, so one job can be read in several formats without running anything again.',
          parameters: [
            jobId,
            {
              name: 'index',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 0 },
              description: 'The image\'s position in the upload, from 0.',
            },
            {
              name: 'output_format',
              in: 'query',
              required: false,
              schema: { $ref: '#/components/schemas/OutputFormat' },
            },
          ],
          responses: {
            '200': {
              description: 'The result, in the requested format.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Segmentation' },
                },
                'image/png': {
                  schema: { type: 'string', contentMediaType: 'image/png' },
                },
                'image/tiff': {
                  schema: { type: 'string', contentMediaType: 'image/tiff' },
                },
                'application/zip': {
                  schema: {
                    type: 'string',
                    contentMediaType: 'application/zip',
                  },
                },
              },
            },
            ...byStatus([
              ...AUTH_PROBLEMS,
              'not-found',
              'validation-failed',
              'result-not-ready',
              'result-unavailable',
              'result-expired',
              'not-acceptable',
              'output-not-representable',
            ]),
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
        Job: {
          type: 'object',
          required: [
            'id',
            'status',
            'model',
            'parameters',
            'page',
            'counts',
            'created_at',
            'started_at',
            'completed_at',
            'expires_at',
            'urls',
          ],
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: [...JOB_STATUSES],
              description:
                '`queued` → `processing` → `succeeded` (every image), `partially_succeeded` (some), `failed` (none) or `canceled` (at least one image was skipped) → `expired` once the results have been deleted.',
            },
            model: { $ref: '#/components/schemas/ModelId' },
            parameters: { type: 'object' },
            page: { type: 'integer' },
            counts: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                queued: { type: 'integer' },
                processing: { type: 'integer' },
                succeeded: { type: 'integer' },
                failed: { type: 'integer' },
                canceled: { type: 'integer' },
              },
            },
            created_at: { type: 'string', format: 'date-time' },
            started_at: { type: ['string', 'null'], format: 'date-time' },
            completed_at: { type: ['string', 'null'], format: 'date-time' },
            expires_at: {
              type: ['string', 'null'],
              format: 'date-time',
              description: 'When the results are deleted: 24 hours after the job finished.',
            },
            urls: {
              type: 'object',
              properties: {
                self: { type: 'string' },
                cancel: { type: 'string' },
              },
            },
            items: {
              type: 'array',
              description: 'One per uploaded image, in upload order. Absent in the list.',
              items: { $ref: '#/components/schemas/JobItem' },
            },
          },
        },
        JobItem: {
          type: 'object',
          required: ['index', 'filename', 'status'],
          properties: {
            index: { type: 'integer' },
            filename: { type: 'string' },
            status: {
              type: 'string',
              enum: ['queued', 'processing', 'succeeded', 'failed', 'canceled'],
            },
            error: {
              type: 'object',
              description: 'Why the image failed: a problem `code` and its detail.',
              properties: {
                code: { type: 'string' },
                detail: { type: 'string' },
              },
            },
            object_count: { type: 'integer' },
            width: { type: 'integer' },
            height: { type: 'integer' },
            warnings: { type: 'array', items: { type: 'string' } },
            inference_ms: { type: 'integer' },
            result_url: { type: 'string' },
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
