import { Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { KnownModelId } from '../../constants/modelRegistry';
import { logger } from '../../utils/logger';
import {
  FormatNotRepresentableError,
  render,
  type SegmentationResult,
} from './formats';
import {
  MlBusyError,
  MlRejectedError,
  MlTimeoutError,
  segmentWithMl,
} from './mlClient';
import {
  OUTPUT_FORMATS,
  V1_MODELS,
  isKnownModel,
  outputFormatsFor,
  type OutputFormat,
} from './models';
import { buildObjects, type V1Warning } from './objects';
import { sendProblem } from './problem';

/**
 * `POST /api/v1/segment` — one image in, one segmentation out, nothing kept.
 *
 * LIMITS, and where each number comes from:
 *
 *  - SYNC_MAX_PIXELS: 4096 x 4096. A synchronous request holds a connection
 *    for the whole inference, and inference is serial across the entire
 *    deployment (one GPU, one lock). The slowest model here takes about 15 s
 *    at 2048^2 and about 150 s at 6657^2 (measured, A5000 — see the note in
 *    `backend/segmentation/api/routes.py`), so 4096^2 keeps the worst case
 *    near a minute. Larger frames belong to the asynchronous jobs endpoint.
 *  - SYNC_MAX_BYTES: 64 MiB, the size of a 4096^2 16-bit frame stored
 *    uncompressed (32 MiB) with room for RGB.
 *  - SYNC_TIMEOUT_MS: 180 s — comfortably under nginx's 600 s for `/api`.
 */
export const SYNC_MAX_PIXELS = 4096 * 4096;
export const SYNC_MAX_BYTES = 64 * 1024 * 1024;
export const SYNC_TIMEOUT_MS = 180_000;
/** In-flight segmentations one key may hold at once. */
export const MAX_CONCURRENT_PER_KEY = 2;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SYNC_MAX_BYTES, files: 1, fields: 16 },
}).single('image');

type FieldError = { field: string; detail: string };

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
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'png';
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'jpg';
  }
  // TIFF and BigTIFF, either byte order.
  const le = data[0] === 0x49 && data[1] === 0x49 && data[3] === 0x00;
  const be = data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00;
  if ((le && (data[2] === 0x2a || data[2] === 0x2b)) || (be && (data[3] === 0x2a || data[3] === 0x2b))) {
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

const booleanField = z.enum(['true', 'false']).transform(value => value === 'true');

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
  output_format: z
    .enum(OUTPUT_FORMATS, {
      errorMap: () => ({
        message: `output_format must be one of: ${OUTPUT_FORMATS.join(', ')}`,
      }),
    })
    .optional(),
});

const KNOWN_FIELDS = Object.keys(fieldsSchema.shape);

const inFlight = new Map<string, number>();

const parseUpload: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    sendProblem(res, 'unsupported-media-type', {
      detail:
        'Send the image as multipart/form-data, in a file part named "image".',
    });
    return;
  }
  upload(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        sendProblem(res, 'payload-too-large', {
          detail: `The upload exceeds ${SYNC_MAX_BYTES} bytes.`,
          extensions: { max_bytes: SYNC_MAX_BYTES },
        });
        return;
      }
      sendProblem(res, 'validation-failed', {
        detail: 'The multipart body is not what this endpoint expects.',
        extensions: {
          errors: [
            {
              field: error.field ?? 'image',
              detail:
                error.code === 'LIMIT_UNEXPECTED_FILE'
                  ? 'Unexpected file part. Send exactly one file, in the part named "image".'
                  : error.message,
            },
          ],
        },
      });
      return;
    }
    next(error);
  });
};

export const segmentHandler = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const errors: FieldError[] = [];

  for (const field of Object.keys(req.body ?? {})) {
    if (!KNOWN_FIELDS.includes(field)) {
      // Refused, not ignored: a misspelt `treshold` would otherwise run with
      // the default and look like it had worked.
      errors.push({ field, detail: 'Unknown field.' });
    }
  }

  const parsed = fieldsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ field: String(issue.path[0] ?? ''), detail: issue.message });
    }
  }
  const fields = parsed.success ? parsed.data : undefined;

  const file = req.file;
  if (!file || file.size === 0) {
    errors.push({ field: 'image', detail: 'A non-empty file part named "image" is required.' });
  }

  const requested = fields?.model;
  const modelId: KnownModelId | undefined =
    requested && isKnownModel(requested) ? requested : undefined;
  const model = modelId ? V1_MODELS[modelId] : undefined;
  if (fields && !model) {
    errors.push({
      field: 'model',
      detail: `Unknown model. Available: ${Object.keys(V1_MODELS).join(', ')}.`,
    });
  }

  const format: OutputFormat = fields?.output_format ?? 'json';
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
        detail: `The ${modelId} model returns ${model.geometry}s, which "${format}" cannot represent. Available: ${outputFormatsFor(model).join(', ')}.`,
      });
    }
  }

  if (errors.length > 0 || !fields || !model || !modelId || !file) {
    sendProblem(res, 'validation-failed', {
      detail: 'One or more request fields are invalid.',
      extensions: { errors },
    });
    return;
  }

  const extension = sniffImageExtension(file.buffer);
  if (!extension) {
    sendProblem(res, 'unsupported-image', {
      detail: 'The file is not a PNG, JPEG, TIFF or BMP image.',
    });
    return;
  }

  const keyId = req.apiKey?.id ?? 'anonymous';
  const held = inFlight.get(keyId) ?? 0;
  if (held >= MAX_CONCURRENT_PER_KEY) {
    sendProblem(res, 'too-many-concurrent-requests', {
      detail: `At most ${MAX_CONCURRENT_PER_KEY} segmentations may run at once per API key. Wait for one to finish.`,
      headers: { 'Retry-After': '5' },
    });
    return;
  }
  inFlight.set(keyId, held + 1);

  const page = fields.page ?? 0;
  const parameters: Record<string, unknown> = {};
  if (model.threshold) {
    parameters.threshold = fields.threshold ?? model.threshold.default;
  }
  if (model.detectHoles) {
    parameters.detect_holes = fields.detect_holes ?? true;
  }

  try {
    const started = Date.now();
    const ml = await segmentWithMl({
      image: file.buffer,
      filename: `upload.${extension}`,
      model: modelId,
      threshold: parameters.threshold as number | undefined,
      detectHoles: parameters.detect_holes as boolean | undefined,
      page,
      maxPixels: SYNC_MAX_PIXELS,
      timeoutMs: SYNC_TIMEOUT_MS,
    });

    const size = ml.image_size;
    if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height)) {
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

    const result: SegmentationResult = {
      model: modelId,
      modelInfo: model,
      image: {
        filename: safeBasename(file.originalname),
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
        inference_ms: Math.round((ml.inference_time ?? 0) * 1000) || Date.now() - started,
      },
    };

    const output = await render(result, format);

    // `Accept` is a CHECK on the chosen format, not the way to choose it:
    // three of the six formats share a media type. RFC 9110 §15.5.7.
    if (req.headers.accept && !req.accepts(output.contentType)) {
      sendProblem(res, 'not-acceptable', {
        detail: `output_format "${format}" is ${output.contentType}, which the Accept header excludes.`,
        extensions: { content_type: output.contentType },
      });
      return;
    }

    res.setHeader('SpheroSeg-Object-Count', String(objects.length));
    if (allWarnings.length > 0) {
      res.setHeader(
        'SpheroSeg-Warnings',
        [...new Set(allWarnings.map(w => w.code))].join(', ')
      );
    }
    if (output.filename) {
      res.setHeader('Content-Disposition', contentDisposition(output.filename));
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).type(output.contentType).send(output.body);
  } catch (error) {
    if (error instanceof MlBusyError) {
      sendProblem(res, 'server-busy', {
        detail: 'Too many segmentations are queued. Retry shortly.',
        headers: { 'Retry-After': '10' },
      });
    } else if (error instanceof MlTimeoutError) {
      sendProblem(res, 'segmentation-timeout', {
        detail: `The segmentation did not finish within ${SYNC_TIMEOUT_MS / 1000} s.`,
      });
    } else if (error instanceof MlRejectedError) {
      rejectedByMl(res, error);
    } else if (error instanceof FormatNotRepresentableError) {
      sendProblem(res, 'output-not-representable', { detail: error.message });
    } else if (error instanceof Error && error.name === 'MlUnavailableError') {
      logger.error('ML service failed a v1 segmentation', error, 'V1');
      sendProblem(res, 'segmentation-failed', {
        detail: 'The segmentation service could not process the image.',
      });
    } else {
      next(error);
    }
  } finally {
    const remaining = (inFlight.get(keyId) ?? 1) - 1;
    if (remaining > 0) {
      inFlight.set(keyId, remaining);
    } else {
      inFlight.delete(keyId);
    }
  }
};

/** Map the ML service's own 4xx onto this API's problems. */
function rejectedByMl(res: Response, error: MlRejectedError): void {
  const detail = error.detail;
  if (error.status === 413 && detail && typeof detail === 'object') {
    const d = detail as { width?: number; height?: number; pixels?: number };
    sendProblem(res, 'image-too-large', {
      detail: `The image is ${d.width} x ${d.height} px (${d.pixels} pixels); a synchronous request accepts at most ${SYNC_MAX_PIXELS}.`,
      extensions: {
        width: d.width,
        height: d.height,
        max_pixels: SYNC_MAX_PIXELS,
      },
    });
    return;
  }
  const text = typeof detail === 'string' ? detail : '';
  if (/^page \d+ is out of range/.test(text)) {
    sendProblem(res, 'validation-failed', {
      detail: 'One or more request fields are invalid.',
      extensions: { errors: [{ field: 'page', detail: text }] },
    });
    return;
  }
  sendProblem(res, 'unsupported-image', {
    detail: text || 'The image could not be decoded.',
  });
}

export const segmentRoute: RequestHandler[] = [parseUpload, segmentHandler];
