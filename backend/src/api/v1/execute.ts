import { Response } from 'express';
import { z } from 'zod';
import type { KnownModelId } from '../../constants/modelRegistry';
import { logger } from '../../utils/logger';
import {
  FormatNotRepresentableError,
  MEDIA_TYPES,
  render,
  type SegmentationResult,
} from './formats';
import {
  MlBusyError,
  MlRejectedError,
  MlTimeoutError,
  MlUnavailableError,
  segmentWithMl,
} from './mlClient';
import {
  OUTPUT_FORMATS,
  V1_MODELS,
  isKnownModel,
  outputFormatsFor,
  type OutputFormat,
  type V1Model,
} from './models';
import { buildObjects, type V1Warning } from './objects';
import { sendProblem, type ProblemCode, type ProblemOptions } from './problem';

/**
 * What the synchronous endpoint and the job worker have in common: reading
 * the request's fields, running one image through one model, and turning a
 * failure into a problem. Both go through here so that an image segmented by
 * a job is segmented exactly as it would have been synchronously.
 */

export type FieldError = { field: string; detail: string };

/**
 * What kind of image the bytes are, by their first bytes — never by the
 * filename or the declared content type, both of which the client chooses.
 * The extension matters only because the ML service's own (older) gate reads
 * one off the filename it is given.
 */
export function sniffImageExtension(data: Buffer): string | null {
  if (data.length < 4) {
    return null;
  }
  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'png';
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'jpg';
  }
  // TIFF and BigTIFF, either byte order.
  const le = data[0] === 0x49 && data[1] === 0x49 && data[3] === 0x00;
  const be = data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00;
  if (
    (le && (data[2] === 0x2a || data[2] === 0x2b)) ||
    (be && (data[3] === 0x2a || data[3] === 0x2b))
  ) {
    return 'tif';
  }
  if (data[0] === 0x42 && data[1] === 0x4d) {
    return 'bmp';
  }
  return null;
}

/** A client-supplied name reduced to something safe to echo in a header. */
export function safeBasename(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"\\]/g, '').trim();
  return cleaned.slice(0, 200) || 'image';
}

/** RFC 6266 §4.3 + §5: an ASCII fallback and the UTF-8 form. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const booleanField = z
  .enum(['true', 'false'])
  .transform(value => value === 'true');

const outputFormatField = z
  .enum(OUTPUT_FORMATS, {
    errorMap: () => ({
      message: `output_format must be one of: ${OUTPUT_FORMATS.join(', ')}`,
    }),
  })
  .optional();

const fieldsSchema = z.object({
  model: z.string({ required_error: 'model is required' }),
  threshold: z.coerce
    .number({ invalid_type_error: 'threshold must be a number' })
    .min(0.1, 'threshold must be at least 0.1')
    .max(0.99, 'threshold must be at most 0.99')
    .optional(),
  detect_holes: booleanField.optional(),
  page: z.coerce
    .number({ invalid_type_error: 'page must be an integer' })
    .int('page must be an integer')
    .min(0, 'page must not be negative')
    .optional(),
  output_format: outputFormatField,
});

export interface SegmentationRequest {
  modelId: KnownModelId;
  model: V1Model;
  /** What the model will actually run with; empty for a model that reads none. */
  parameters: { threshold?: number; detect_holes?: boolean };
  page: number;
  format: OutputFormat;
}

/**
 * Validate the form fields of a segmentation request. Every problem is
 * collected, so a client fixes its request in one round trip.
 *
 * `acceptOutputFormat: false` is for creating a job, where the format is
 * chosen when the result is fetched and the field does not belong.
 */
export function readSegmentationFields(
  body: Record<string, unknown> | undefined,
  options: { acceptOutputFormat: boolean }
): { request?: SegmentationRequest; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const known = Object.keys(fieldsSchema.shape).filter(
    field => options.acceptOutputFormat || field !== 'output_format'
  );

  for (const field of Object.keys(body ?? {})) {
    if (!known.includes(field)) {
      // Refused, not ignored: a misspelt `treshold` would otherwise run with
      // the default and look like it had worked.
      errors.push({ field, detail: 'Unknown field.' });
    }
  }

  const parsed = fieldsSchema.safeParse(body ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        field: String(issue.path[0] ?? ''),
        detail: issue.message,
      });
    }
  }
  const fields = parsed.success ? parsed.data : undefined;

  // Read from the raw body, not from `fields`: that is undefined whenever
  // ANY field failed to parse, and an unknown model must still be reported
  // alongside the others.
  const rawModel: unknown = body?.model;
  const requested = typeof rawModel === 'string' ? rawModel : undefined;
  const modelId: KnownModelId | undefined =
    requested && isKnownModel(requested) ? requested : undefined;
  const model = modelId ? V1_MODELS[modelId] : undefined;
  if (requested !== undefined && !model) {
    errors.push({
      field: 'model',
      detail: `Unknown model. Available: ${Object.keys(V1_MODELS).join(', ')}.`,
    });
  }

  const format: OutputFormat =
    (options.acceptOutputFormat ? fields?.output_format : undefined) ?? 'json';
  if (fields && model && modelId) {
    // A parameter the model does not read is refused, never dropped: the
    // caller would otherwise believe it had been applied.
    if (fields.threshold !== undefined && !model.threshold) {
      errors.push({
        field: 'threshold',
        detail: `The ${modelId} model does not use a threshold.`,
      });
    }
    if (fields.detect_holes !== undefined && !model.detectHoles) {
      errors.push({
        field: 'detect_holes',
        detail: `The ${modelId} model does not use detect_holes.`,
      });
    }
    if (!outputFormatsFor(model).includes(format)) {
      errors.push({
        field: 'output_format',
        detail: formatMismatch(modelId, model, format),
      });
    }
  }

  if (errors.length > 0 || !fields || !model || !modelId) {
    return { errors };
  }

  const parameters: SegmentationRequest['parameters'] = {};
  if (model.threshold) {
    parameters.threshold = fields.threshold ?? model.threshold.default;
  }
  if (model.detectHoles) {
    parameters.detect_holes = fields.detect_holes ?? true;
  }
  return {
    request: { modelId, model, parameters, page: fields.page ?? 0, format },
    errors,
  };
}

export const formatMismatch = (
  modelId: string,
  model: V1Model,
  format: string
): string =>
  `The ${modelId} model returns ${model.geometry}s, which "${format}" cannot represent. Available: ${outputFormatsFor(model).join(', ')}.`;

/** Parse an `output_format` value on its own (the job result endpoint). */
export function readOutputFormat(
  value: unknown
): { format: OutputFormat } | { error: string } {
  const parsed = outputFormatField.safeParse(value);
  return parsed.success
    ? { format: parsed.data ?? 'json' }
    : { error: parsed.error.issues[0].message };
}

export class UnsupportedImageError extends Error {}

/** Run one image through one model and build the public result. */
export async function runSegmentation(input: {
  image: Buffer;
  originalName: string | undefined;
  request: SegmentationRequest;
  maxPixels: number;
  timeoutMs: number;
}): Promise<SegmentationResult> {
  const { image, request, maxPixels, timeoutMs } = input;
  const { modelId, model, parameters, page } = request;

  const extension = sniffImageExtension(image);
  if (!extension) {
    throw new UnsupportedImageError(
      'The file is not a PNG, JPEG, TIFF or BMP image.'
    );
  }

  const started = Date.now();
  const ml = await segmentWithMl({
    image,
    filename: `upload.${extension}`,
    model: modelId,
    threshold: parameters.threshold,
    detectHoles: parameters.detect_holes,
    page,
    maxPixels,
    timeoutMs,
  });

  const size = ml.image_size;
  if (
    !size ||
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height)
  ) {
    throw new Error('ML response carries no image_size');
  }

  const { objects, warnings } = buildObjects(
    modelId,
    ml.polygons ?? [],
    ml.polylines ?? []
  );
  const pageCount = ml.page_count ?? 1;
  const allWarnings: V1Warning[] = [...warnings];
  if (pageCount > 1) {
    allWarnings.push({
      code: 'multipage_image',
      detail: `The image has ${pageCount} pages; only page ${page} was segmented. Use the "page" field to choose another.`,
    });
  }
  if (ml.input_conversion) {
    const c = ml.input_conversion;
    allWarnings.push({
      code: 'input_depth_converted',
      detail: `The ${modelId} model works on 8-bit input. The image (${c.from_mode}) was stretched from its ${c.low_percentile}-${c.high_percentile} percentile range [${c.low}, ${c.high}] to 0-255.`,
    });
  }
  if (Array.isArray(ml.warnings)) {
    for (const warning of ml.warnings) {
      allWarnings.push({ code: 'model_warning', detail: String(warning) });
    }
  }
  if (objects.length === 0) {
    allWarnings.push({
      code: 'no_objects',
      detail: 'The model found nothing in this image.',
    });
  }

  return {
    model: modelId,
    modelInfo: model,
    image: {
      filename: safeBasename(input.originalName),
      width: size.width,
      height: size.height,
      page,
      page_count: pageCount,
    },
    parameters,
    objects,
    ...(ml.image_metrics ? { metrics: ml.image_metrics } : {}),
    warnings: allWarnings,
    timing: {
      inference_ms:
        Math.round((ml.inference_time ?? 0) * 1000) || Date.now() - started,
    },
  };
}

export interface Failure {
  code: ProblemCode;
  options: ProblemOptions;
}

/**
 * What a failed segmentation means to the caller, or `null` for something
 * unexpected (which must surface as a 500, not be dressed up).
 */
export function describeFailure(
  error: unknown,
  limits: { maxPixels: number; timeoutMs: number }
): Failure | null {
  if (error instanceof UnsupportedImageError) {
    return { code: 'unsupported-image', options: { detail: error.message } };
  }
  if (error instanceof MlBusyError) {
    return {
      code: 'server-busy',
      options: {
        detail: 'Too many segmentations are queued. Retry shortly.',
        headers: { 'Retry-After': '10' },
      },
    };
  }
  if (error instanceof MlTimeoutError) {
    return {
      code: 'segmentation-timeout',
      options: {
        detail: `The segmentation did not finish within ${Math.round(limits.timeoutMs / 1000)} s.`,
      },
    };
  }
  if (error instanceof MlRejectedError) {
    return rejectedByMl(error, limits.maxPixels);
  }
  if (error instanceof FormatNotRepresentableError) {
    return {
      code: 'output-not-representable',
      options: { detail: error.message },
    };
  }
  if (error instanceof MlUnavailableError) {
    logger.error('ML service failed a v1 segmentation', error, 'V1');
    return {
      code: 'segmentation-failed',
      options: {
        detail: 'The segmentation service could not process the image.',
      },
    };
  }
  return null;
}

/** Map the ML service's own 4xx onto this API's problems. */
function rejectedByMl(error: MlRejectedError, maxPixels: number): Failure {
  const detail = error.detail;
  if (error.status === 413 && detail && typeof detail === 'object') {
    const d = detail as { width?: number; height?: number; pixels?: number };
    return {
      code: 'image-too-large',
      options: {
        detail: `The image is ${d.width} x ${d.height} px (${d.pixels} pixels); the limit here is ${maxPixels}.`,
        extensions: { width: d.width, height: d.height, max_pixels: maxPixels },
      },
    };
  }
  const text = typeof detail === 'string' ? detail : '';
  if (/^page \d+ is out of range/.test(text)) {
    return {
      code: 'validation-failed',
      options: {
        detail: 'One or more request fields are invalid.',
        extensions: { errors: [{ field: 'page', detail: text }] },
      },
    };
  }
  return {
    code: 'unsupported-image',
    options: { detail: text || 'The image could not be decoded.' },
  };
}

/** Render `result` as `format` and send it. */
export async function sendResult(
  res: Response,
  result: SegmentationResult,
  format: OutputFormat
): Promise<void> {
  const output = await render(result, format);
  res.setHeader('SpheroSeg-Object-Count', String(result.objects.length));
  if (result.warnings.length > 0) {
    res.setHeader(
      'SpheroSeg-Warnings',
      [...new Set(result.warnings.map(w => w.code))].join(', ')
    );
  }
  if (output.filename) {
    res.setHeader('Content-Disposition', contentDisposition(output.filename));
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).type(output.contentType).send(output.body);
}

/**
 * `Accept` is a CHECK on the chosen format, not the way to choose it: three
 * of the six formats share a media type (RFC 9110 §15.5.7). Decided from the
 * format alone, so it is asked before any work is done.
 *
 * @returns true when the request was refused (and answered).
 */
export function refuseUnacceptable(
  req: { headers: { accept?: string }; accepts(type: string): unknown },
  res: Response,
  format: OutputFormat
): boolean {
  const mediaType = MEDIA_TYPES[format];
  if (!req.headers.accept || req.accepts(mediaType)) {
    return false;
  }
  sendProblem(res, 'not-acceptable', {
    detail: `output_format "${format}" is ${mediaType}, which the Accept header excludes.`,
    extensions: { content_type: mediaType },
  });
  return true;
}
