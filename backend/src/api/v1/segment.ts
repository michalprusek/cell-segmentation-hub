import { Request, Response, NextFunction, RequestHandler } from 'express';
import multer from 'multer';
import {
  describeFailure,
  readSegmentationFields,
  refuseUnacceptable,
  runSegmentation,
  sendResult,
} from './execute';
import { SYNC_MAX_PIXELS } from './limits';
import { sendProblem } from './problem';

export { SYNC_MAX_PIXELS };

export {
  contentDisposition,
  safeBasename,
  sniffImageExtension,
} from './execute';

/**
 * `POST /api/v1/segment` — one image in, one segmentation out, nothing kept.
 *
 * LIMITS, and where each number comes from:
 *
 *  - SYNC_MAX_PIXELS: 4096 x 4096 — reasoned in `limits.ts`.
 *  - SYNC_MAX_BYTES: 64 MiB, the size of a 4096^2 16-bit frame stored
 *    uncompressed (32 MiB) with room for RGB.
 *  - SYNC_TIMEOUT_MS: 180 s — comfortably under nginx's 600 s for `/api`.
 */
export const SYNC_MAX_BYTES = 64 * 1024 * 1024;
export const SYNC_TIMEOUT_MS = 180_000;
/** In-flight segmentations one key may hold at once. */
export const MAX_CONCURRENT_PER_KEY = 2;
/**
 * In-flight segmentations across ALL keys. Each one may hold a buffered
 * upload of up to SYNC_MAX_BYTES in this process — the same process that
 * serves the app — so this bounds that at 12 x 64 MiB. It sits just above
 * what the ML queue can use (1 running + 8 waiting), so it is never the
 * limit a well-behaved client meets first.
 */
export const MAX_IN_FLIGHT_TOTAL = 12;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SYNC_MAX_BYTES, files: 1, fields: 16 },
  // The part's filename is UTF-8 on the wire for every current client (curl,
  // requests, fetch). The parser's default is Latin-1, which turned
  // `snímek.tif` into `snÃ­mek.tif` — and that mis-decoded name into the
  // download's Content-Disposition. Seen on the deployed API.
  defParamCharset: 'utf8',
}).single('image');

const inFlight = new Map<string, number>();
let totalInFlight = 0;

/**
 * Take a slot BEFORE the body is read.
 *
 * This used to happen in the handler, i.e. after multer had buffered the
 * whole upload — so the limit bounded inferences but not memory: one key
 * could have as many 64 MiB bodies in the heap at once as the rate limiter
 * let through (120 a minute). The slot is released when the response
 * closes, which covers success, every error path and a client that hangs up
 * mid-upload alike.
 */
const reserveSlot: RequestHandler = (req, res, next) => {
  const keyId = req.apiKey?.id ?? 'anonymous';
  const held = inFlight.get(keyId) ?? 0;
  if (held >= MAX_CONCURRENT_PER_KEY) {
    sendProblem(res, 'too-many-concurrent-requests', {
      detail: `At most ${MAX_CONCURRENT_PER_KEY} segmentations may run at once per API key. Wait for one to finish.`,
      headers: { 'Retry-After': '5' },
    });
    return;
  }
  if (totalInFlight >= MAX_IN_FLIGHT_TOTAL) {
    sendProblem(res, 'server-busy', {
      detail: 'Too many segmentations are in progress. Retry shortly.',
      headers: { 'Retry-After': '10' },
    });
    return;
  }

  inFlight.set(keyId, held + 1);
  totalInFlight++;
  let released = false;
  res.once('close', () => {
    if (released) {
      return;
    }
    released = true;
    totalInFlight--;
    const remaining = (inFlight.get(keyId) ?? 1) - 1;
    if (remaining > 0) {
      inFlight.set(keyId, remaining);
    } else {
      inFlight.delete(keyId);
    }
  });
  next();
};

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
  const { request, errors } = readSegmentationFields(req.body, {
    acceptOutputFormat: true,
  });
  const file = req.file;
  if (!file || file.size === 0) {
    errors.push({
      field: 'image',
      detail: 'A non-empty file part named "image" is required.',
    });
  }
  if (errors.length > 0 || !request || !file) {
    sendProblem(res, 'validation-failed', {
      detail: 'One or more request fields are invalid.',
      extensions: { errors },
    });
    return;
  }

  if (refuseUnacceptable(req, res, request.format)) {
    return;
  }

  const limits = { maxPixels: SYNC_MAX_PIXELS, timeoutMs: SYNC_TIMEOUT_MS };
  try {
    const result = await runSegmentation({
      image: file.buffer,
      originalName: file.originalname,
      request,
      ...limits,
    });
    await sendResult(res, result, request.format);
  } catch (error) {
    const failure = describeFailure(error, limits);
    if (failure) {
      sendProblem(res, failure.code, failure.options);
    } else {
      next(error);
    }
  }
};

export const segmentRoute: RequestHandler[] = [
  reserveSlot,
  parseUpload,
  segmentHandler,
];
