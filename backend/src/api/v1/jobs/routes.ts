import { createHash } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import path from 'path';
import {
  Router,
  Request,
  Response,
  NextFunction,
  RequestHandler,
} from 'express';
import type { ApiJob } from '@prisma/client';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../../db';
import {
  formatMismatch,
  readOutputFormat,
  readSegmentationFields,
  refuseUnacceptable,
  safeBasename,
  sendResult,
  sniffImageExtension,
  type FieldError,
} from '../execute';
import { V1_MODELS, outputFormatsFor } from '../models';
import { sendProblem } from '../problem';
import type { KnownModelId } from '../../../constants/modelRegistry';
import {
  JOB_MAX_FILE_BYTES,
  JOB_MAX_ITEMS,
  JOB_MAX_TOTAL_BYTES,
  JOB_STORAGE_BUDGET_BYTES,
  MAX_ACTIVE_JOBS_PER_USER,
  activeInputBytes,
  countActiveJobs,
  describeJob,
  incomingDir,
  inputPath,
  isActive,
  jobDir,
  parseItems,
  readResult,
  removeQuietly,
  type JobItem,
} from './store';

/**
 * `/api/v1/jobs` — segmentation that does not hold a connection open.
 *
 * `POST /jobs` stores the uploads and answers 202 at once; a worker runs the
 * images one at a time; the client polls `GET /jobs/{id}` and fetches each
 * image's result from `GET /jobs/{id}/results/{index}`, choosing the output
 * format THEN. A job keeps the model's result, not a rendering of it, so one
 * job can be read as JSON, as COCO and as a label image without running
 * anything twice.
 *
 * There is no IETF standard for a job resource. RFC 9110 §15.3.3 says a 202
 * "ought to ... point to (or embed) a status monitor"; `Location` and
 * `Retry-After` on it are convention (they are what Replicate and Google's
 * long-running operations do), and so are the state names.
 */
const BASE = '/api/v1';
/** Seconds a client is told to wait between polls. */
const POLL_AFTER_SECONDS = 5;

const userId = (req: Request): string => (req.user as { id: string }).id;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, done) => done(null, incomingDir()),
    filename: (_req, _file, done) => done(null, uuidv4()),
  }),
  limits: { fileSize: JOB_MAX_FILE_BYTES, files: JOB_MAX_ITEMS, fields: 16 },
  defParamCharset: 'utf8',
}).array('images', JOB_MAX_ITEMS);

/** Refuse BEFORE the body is read, so a refused upload is never written. */
const admit: RequestHandler = async (req, res, next) => {
  try {
    if ((await countActiveJobs(userId(req))) >= MAX_ACTIVE_JOBS_PER_USER) {
      sendProblem(res, 'too-many-jobs', {
        detail: `At most ${MAX_ACTIVE_JOBS_PER_USER} jobs may be queued or running per account.`,
        headers: { 'Retry-After': '30' },
      });
      return;
    }
    if ((await activeInputBytes()) >= JOB_STORAGE_BUDGET_BYTES) {
      sendProblem(res, 'server-busy', {
        detail: 'Job storage is full. Retry when running jobs have finished.',
        headers: { 'Retry-After': '60' },
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

const receive: RequestHandler = (req, res, next) => {
  if (!req.is('multipart/form-data')) {
    sendProblem(res, 'unsupported-media-type', {
      detail:
        'Send the images as multipart/form-data, in file parts named "images".',
    });
    return;
  }
  upload(req, res, (error: unknown) => {
    // Whatever happens next, files this request wrote and no job adopted are
    // removed when the response is done.
    res.once('close', () => {
      for (const file of (req.files as Express.Multer.File[]) ?? []) {
        void removeQuietly(file.path);
      }
    });
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        sendProblem(res, 'payload-too-large', {
          detail: `A file exceeds ${JOB_MAX_FILE_BYTES} bytes.`,
          extensions: { max_bytes: JOB_MAX_FILE_BYTES },
        });
        return;
      }
      sendProblem(res, 'validation-failed', {
        detail: 'The multipart body is not what this endpoint expects.',
        extensions: {
          errors: [
            {
              field: error.field ?? 'images',
              detail:
                error.code === 'LIMIT_FILE_COUNT' ||
                error.code === 'LIMIT_UNEXPECTED_FILE'
                  ? `Send between 1 and ${JOB_MAX_ITEMS} files, all in parts named "images".`
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

const sha256File = (file: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });

const firstBytes = async (file: string): Promise<Buffer> => {
  const handle = await fs.open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(8), 0, 8, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

/**
 * `Idempotency-Key`: an IETF draft (draft-ietf-httpapi-idempotency-key-header,
 * expired April 2026), not a standard. The draft makes the value a quoted
 * structured-field string; every client in the wild (Stripe's convention)
 * sends it bare. Both are accepted.
 */
function readIdempotencyKey(
  req: Request
): { key: string | null } | { error: string } {
  const raw = req.headers['idempotency-key'];
  if (raw === undefined) {
    return { key: null };
  }
  const value = (Array.isArray(raw) ? raw[0] : raw).trim().replace(/^"(.*)"$/, '$1');
  if (value.length === 0 || value.length > 255) {
    return { error: 'Idempotency-Key must be 1 to 255 characters.' };
  }
  return { key: value };
}

const create = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const { request, errors } = readSegmentationFields(req.body, {
      acceptOutputFormat: false,
    });

    if (files.length === 0) {
      errors.push({
        field: 'images',
        detail: `Send between 1 and ${JOB_MAX_ITEMS} files in parts named "images".`,
      });
    }
    const idempotency = readIdempotencyKey(req);
    if ('error' in idempotency) {
      errors.push({ field: 'Idempotency-Key', detail: idempotency.error });
    }

    const extensions: string[] = [];
    for (const [index, file] of files.entries()) {
      const extension =
        file.size > 0 ? sniffImageExtension(await firstBytes(file.path)) : null;
      if (!extension) {
        errors.push({
          field: `images[${index}]`,
          detail: `"${safeBasename(file.originalname)}" is not a PNG, JPEG, TIFF or BMP image.`,
        } satisfies FieldError);
      }
      extensions.push(extension ?? '');
    }

    if (errors.length > 0 || !request || 'error' in idempotency) {
      sendProblem(res, 'validation-failed', {
        detail: 'One or more request fields are invalid.',
        extensions: { errors },
      });
      return;
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > JOB_MAX_TOTAL_BYTES) {
      sendProblem(res, 'payload-too-large', {
        detail: `The job's files total ${totalBytes} bytes; the limit is ${JOB_MAX_TOTAL_BYTES}.`,
        extensions: { max_bytes: JOB_MAX_TOTAL_BYTES },
      });
      return;
    }

    const owner = userId(req);
    const parameters = JSON.stringify(request.parameters);

    let requestHash: string | null = null;
    if (idempotency.key) {
      // The same key with the same request is a retry; with a different
      // request it is a mistake. "Same" covers the bytes of every file.
      const hash = createHash('sha256').update(
        `${request.modelId}\n${parameters}\n${request.page}\n`
      );
      for (const file of files) {
        hash.update(`${await sha256File(file.path)}\n`);
      }
      requestHash = hash.digest('hex');
    }

    const id = uuidv4();
    const items: JobItem[] = files.map((file, index) => ({
      index,
      filename: safeBasename(file.originalname),
      ext: extensions[index],
      bytes: file.size,
      status: 'queued',
    }));

    await fs.mkdir(path.join(jobDir(id), 'input'), { recursive: true });
    try {
      for (const [index, file] of files.entries()) {
        await fs.rename(file.path, inputPath(id, items[index]));
      }
      const job = await prisma.apiJob.create({
        data: {
          id,
          userId: owner,
          apiKeyId: req.apiKey?.id ?? null,
          model: request.modelId,
          parameters,
          page: request.page,
          items: JSON.stringify(items),
          inputBytes: BigInt(totalBytes),
          idempotencyKey: idempotency.key,
          requestHash,
        },
      });
      res.setHeader('Location', `${BASE}/jobs/${job.id}`);
      res.setHeader('Retry-After', String(POLL_AFTER_SECONDS));
      res.status(202).json(describeJob(job, BASE));
    } catch (error) {
      await removeQuietly(jobDir(id));
      // The key has been used before. This is the ONLY place that is
      // decided — there is no look-up-first step — so a retry and two
      // requests racing with the same new key take the same path, and the
      // unique index is what makes "at most one job per key" true.
      if ((error as { code?: string }).code === 'P2002' && idempotency.key) {
        const winner = await prisma.apiJob.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: owner,
              idempotencyKey: idempotency.key,
            },
          },
        });
        if (winner && winner.requestHash === requestHash) {
          res.setHeader('Idempotent-Replayed', 'true');
          res.setHeader('Location', `${BASE}/jobs/${winner.id}`);
          res.status(200).json(describeJob(winner, BASE));
          return;
        }
        sendProblem(res, 'idempotency-key-reused', {
          detail:
            'This Idempotency-Key already created a job from a different request.',
        });
        return;
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The caller's job, or a 404 — also for a job that belongs to someone else. */
async function ownJob(req: Request, res: Response): Promise<ApiJob | null> {
  const id = req.params.id;
  const job = UUID.test(id)
    ? await prisma.apiJob.findFirst({ where: { id, userId: userId(req) } })
    : null;
  if (!job) {
    sendProblem(res, 'not-found', { detail: 'No such job.' });
  }
  return job;
}

const wrap =
  (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    handler(req, res).catch(next);
  };

const list = wrap(async (req, res) => {
  const jobs = await prisma.apiJob.findMany({
    where: { userId: userId(req) },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json({
    data: jobs.map(job => describeJob(job, BASE, { withItems: false })),
  });
});

const show = wrap(async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) {
    return;
  }
  if (isActive(job.status)) {
    res.setHeader('Retry-After', String(POLL_AFTER_SECONDS));
  }
  res.json(describeJob(job, BASE));
});

const cancel = wrap(async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) {
    return;
  }
  // Best effort, and idempotent: an image already running finishes, and
  // cancelling a finished job changes nothing. The worker does the rest.
  const updated = isActive(job.status)
    ? await prisma.apiJob.update({
        where: { id: job.id },
        data: { cancelRequested: true },
      })
    : job;
  res.json(describeJob(updated, BASE));
});

const remove = wrap(async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) {
    return;
  }
  await prisma.apiJob.deleteMany({ where: { id: job.id } });
  await removeQuietly(jobDir(job.id));
  res.status(204).end();
});

const result = wrap(async (req, res) => {
  const job = await ownJob(req, res);
  if (!job) {
    return;
  }
  const index = /^\d{1,4}$/.test(req.params.index)
    ? Number(req.params.index)
    : -1;
  const item = parseItems(job).find(i => i.index === index);
  if (!item) {
    sendProblem(res, 'not-found', { detail: 'No such image in this job.' });
    return;
  }

  const unknown = Object.keys(req.query).filter(k => k !== 'output_format');
  const parsed = readOutputFormat(req.query.output_format);
  const model = V1_MODELS[job.model as KnownModelId];
  const errors: FieldError[] = unknown.map(field => ({
    field,
    detail: 'Unknown query parameter.',
  }));
  if ('error' in parsed) {
    errors.push({ field: 'output_format', detail: parsed.error });
  } else if (!outputFormatsFor(model).includes(parsed.format)) {
    errors.push({
      field: 'output_format',
      detail: formatMismatch(job.model, model, parsed.format),
    });
  }
  if (errors.length > 0 || 'error' in parsed) {
    sendProblem(res, 'validation-failed', {
      detail: 'One or more request fields are invalid.',
      extensions: { errors },
    });
    return;
  }

  if (item.status === 'queued' || item.status === 'processing') {
    sendProblem(res, 'result-not-ready', {
      detail: `Image ${index} is ${item.status}.`,
      headers: { 'Retry-After': String(POLL_AFTER_SECONDS) },
    });
    return;
  }
  if (item.status !== 'succeeded') {
    sendProblem(res, 'result-unavailable', {
      detail: `Image ${index} ${item.status === 'canceled' ? 'was canceled' : 'failed'}.`,
      extensions: item.error ? { item_error: item.error } : {},
    });
    return;
  }

  if (refuseUnacceptable(req, res, parsed.format)) {
    return;
  }
  // An expired job's files are gone, so this is also what answers for one:
  // there is no separate check on the job's status to keep in step with it.
  const stored = await readResult(job.id, index);
  if (!stored) {
    sendProblem(res, 'result-expired', {
      detail: 'Results are kept for 24 hours after a job finishes; this one has been deleted.',
    });
    return;
  }
  await sendResult(res, stored, parsed.format);
});

const router = Router();
router.post('/', admit, receive, create);
router.get('/', list);
router.get('/:id', show);
router.post('/:id/cancel', cancel);
router.delete('/:id', remove);
router.get('/:id/results/:index', result);

export default router;
